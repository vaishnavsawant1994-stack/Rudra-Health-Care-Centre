import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assertCentre, assertPermission, HttpError } from '../src/authorization.mjs';
import { newOpaqueToken, sha256 } from '../src/security.mjs';

const enabled = Boolean(process.env.DATABASE_URL);
if (process.env.CI === 'true' && !enabled) {
  throw new Error('DATABASE_URL is required in CI; authentication integration coverage must not be skipped.');
}

test('PostgreSQL sessions enforce active status, CSRF, rotation, logout, roles and centre grants', { skip: !enabled }, async () => {
  const { default: pg } = await import('pg');
  const { authenticate, logout, refreshSession } = await import('../src/auth.mjs');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  try {
    const org = (await pool.query(
      `INSERT INTO organizations (public_id,name,brand_name) VALUES ($1,'Auth Integration','Auth Test') RETURNING id`,
      [`AUTH-ORG-${randomUUID()}`]
    )).rows[0].id;
    const centreA = (await pool.query(
      `INSERT INTO centres (organization_id,public_id,name,centre_type,address_line_1,city,state,postal_code)
       VALUES ($1,$2,'Centre A','MAIN','1 Test Road','Nashik','Maharashtra','422001') RETURNING id`,
      [org, `AUTH-CEN-${randomUUID()}`]
    )).rows[0].id;
    const centreB = (await pool.query(
      `INSERT INTO centres (organization_id,public_id,name,centre_type,address_line_1,city,state,postal_code)
       VALUES ($1,$2,'Centre B','SATELLITE','2 Test Road','Pune','Maharashtra','411001') RETURNING id`,
      [org, `AUTH-CEN-${randomUUID()}`]
    )).rows[0].id;
    const roles = (await pool.query('SELECT id,code FROM roles WHERE organization_id=$1', [org])).rows;
    const roleIds = new Map(roles.map((role) => [role.code, role.id]));
    const expectations = {
      OWNER: ['patients.read','patients.create','patients.update','patients.duplicate.override','leads.read','leads.create','leads.update','leads.convert','audit.read'],
      SUPER_ADMIN: ['patients.read','patients.create','patients.update','patients.duplicate.override','leads.read','leads.create','leads.update','leads.convert','audit.read'],
      ADMIN: ['patients.read','patients.create','patients.update','patients.duplicate.override','leads.read','leads.create','leads.update','leads.convert'],
      CENTRE_MANAGER: ['patients.read','patients.create','patients.update','patients.duplicate.override','leads.read','leads.create','leads.update','leads.convert','audit.read'],
      RECEPTIONIST: ['patients.read','patients.create','patients.update','leads.read','leads.create','leads.update','leads.convert'],
      PHLEBOTOMIST: [],
      CUSTOMER_SUPPORT: ['patients.read','leads.read','leads.update'],
      ACCOUNTS: [],
      SALES_RELATIONSHIP: ['patients.create','leads.read','leads.create','leads.update','leads.convert'],
      READ_ONLY_AUDITOR: ['patients.read','leads.read','audit.read']
    };
    const principals = new Map();
    for (const [roleCode, permissions] of Object.entries(expectations)) {
      assert.ok(roleIds.has(roleCode), `missing seeded role ${roleCode}`);
      const userId = (await pool.query(
        `INSERT INTO users (organization_id,public_id,auth_subject,status) VALUES ($1,$2,$3,'active') RETURNING id`,
        [org, `AUTH-USR-${randomUUID()}`, `auth-test:${roleCode}:${randomUUID()}`]
      )).rows[0].id;
      await pool.query(
        `INSERT INTO staff_profiles (user_id,organization_id,public_id,first_name,display_name,primary_centre_id)
         VALUES ($1,$2,$3,'Test',$4,$5)`,
        [userId, org, `AUTH-PRO-${randomUUID()}`, `Test ${roleCode}`, centreA]
      );
      const organizationWide = ['OWNER','SUPER_ADMIN','ADMIN'].includes(roleCode);
      await pool.query(
        `INSERT INTO user_roles (organization_id,user_id,role_id,centre_id,assigned_by)
         VALUES ($1,$2,$3,$4,$2)`,
        [org, userId, roleIds.get(roleCode), organizationWide ? null : centreA]
      );
      const sessionToken = newOpaqueToken();
      const csrfToken = newOpaqueToken();
      const sessionId = (await pool.query(
        `INSERT INTO auth_sessions (organization_id,user_id,token_hash,csrf_hash,expires_at,absolute_expires_at)
         VALUES ($1,$2,$3,$4,now()+interval '1 hour',now()+interval '8 hours') RETURNING id`,
        [org, userId, sha256(sessionToken), sha256(csrfToken)]
      )).rows[0].id;
      const request = (method = 'GET', token = sessionToken, csrf = csrfToken) => ({
        method, headers: { cookie: `rhc_session=${token}; rhc_csrf=${csrf}`, 'x-csrf-token': csrf },
        socket: { remoteAddress: '127.0.0.1' }, requestId: randomUUID()
      });
      const principal = await authenticate(pool, request());
      for (const permission of expectations[roleCode]) assert.ok(principal.permissions.has(permission), `${roleCode} missing ${permission}`);
      for (const permission of ['patients.read','patients.create','patients.update','patients.duplicate.override','leads.read','leads.create','leads.update','leads.convert','audit.read']) {
        if (!permissions.includes(permission)) assert.ok(!principal.permissions.has(permission), `${roleCode} unexpectedly has ${permission}`);
      }
      if (permissions.includes('patients.read')) {
        assert.doesNotThrow(() => assertPermission(principal, 'patients.read', centreA));
        if (!organizationWide) assert.throws(() => assertCentre(principal, centreB), (error) => error.status === 403);
      } else {
        assert.throws(() => assertPermission(principal, 'patients.read'), (error) => error.status === 403);
      }
      principals.set(roleCode, { principal, request, sessionId, sessionToken, csrfToken });
    }

    const owner = principals.get('OWNER');
    await assert.rejects(authenticate(pool, owner.request('POST', owner.sessionToken, 'wrong-csrf')),
      (error) => error instanceof HttpError && error.status === 403 && error.code === 'CSRF_INVALID');
    const refreshRequest = owner.request('POST');
    const rotatedCookies = await refreshSession(pool, refreshRequest, owner.principal);
    const replacement = rotatedCookies.find((cookie) => cookie.startsWith('rhc_session='))?.match(/^rhc_session=([^;]+)/)?.[1];
    const replacementCsrf = rotatedCookies.find((cookie) => cookie.startsWith('rhc_csrf='))?.match(/^rhc_csrf=([^;]+)/)?.[1];
    assert.ok(replacement && replacementCsrf, 'refresh must issue new session and CSRF cookies');
    await assert.rejects(authenticate(pool, owner.request()), (error) => error.status === 401);
    const rotatedRequest = owner.request('GET', decodeURIComponent(replacement), decodeURIComponent(replacementCsrf));
    const rotatedPrincipal = await authenticate(pool, rotatedRequest);
    await logout(pool, rotatedRequest, rotatedPrincipal);
    await assert.rejects(authenticate(pool, rotatedRequest), (error) => error.status === 401);

    const receptionist = principals.get('RECEPTIONIST');
    await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [receptionist.principal.id]);
    await assert.rejects(authenticate(pool, receptionist.request()), (error) => error.status === 401);
  } finally {
    await pool.end();
  }
});
