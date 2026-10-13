import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { assertCentre, assertPermission, HttpError } from '../src/authorization.mjs';
import { newOpaqueToken, sha256 } from '../src/security.mjs';

const enabled = Boolean(process.env.DATABASE_URL);
if (process.env.CI === 'true' && !enabled) {
  throw new Error('DATABASE_URL is required in CI; authentication integration coverage must not be skipped.');
}

test('PostgreSQL sessions enforce active status, CSRF, rotation, logout, roles and centre grants', { skip: !enabled }, async () => {
  const { default: pg } = await import('pg');
  const { authenticate, beginLogin } = await import('../src/auth.mjs');
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
    const directoryPermissions = [
      'doctors.read','doctors.create','doctors.update','doctors.contact.read','doctors.credentials.read',
      'corporates.read','corporates.create','corporates.update','corporates.contact.read',
      'partners.read','partners.create','partners.update','partners.contact.read',
      'catalogue.tests.read','catalogue.tests.create','catalogue.tests.update',
      'catalogue.packages.read','catalogue.packages.create','catalogue.packages.update'
    ];
    const directoryRoleGrants = {
      OWNER: directoryPermissions,
      SUPER_ADMIN: directoryPermissions,
      ADMIN: directoryPermissions,
      CENTRE_MANAGER: directoryPermissions.filter((code)=>code!=='doctors.credentials.read'),
      RECEPTIONIST: ['doctors.read','doctors.contact.read','corporates.read','corporates.contact.read','partners.read','partners.contact.read','catalogue.tests.read','catalogue.packages.read'],
      PHLEBOTOMIST: ['catalogue.tests.read','catalogue.packages.read'],
      CUSTOMER_SUPPORT: ['doctors.read','doctors.contact.read','partners.read','partners.contact.read','catalogue.tests.read','catalogue.packages.read'],
      ACCOUNTS: ['corporates.read','corporates.contact.read','catalogue.tests.read','catalogue.packages.read'],
      SALES_RELATIONSHIP: ['doctors.read','doctors.contact.read','corporates.read','corporates.create','corporates.update','corporates.contact.read','partners.read','partners.create','partners.update','partners.contact.read','catalogue.tests.read','catalogue.packages.read'],
      READ_ONLY_AUDITOR: ['doctors.read','corporates.read','partners.read','catalogue.tests.read','catalogue.packages.read']
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
      for (const permission of directoryPermissions) {
        assert.equal(principal.permissions.has(permission),directoryRoleGrants[roleCode].includes(permission),`${roleCode} directory grant mismatch for ${permission}`);
      }
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
    process.env.OIDC_ISSUER = 'https://identity.example.test/';
    process.env.OIDC_CLIENT_ID = 'rudra-integration-test';
    process.env.OIDC_REDIRECT_URI = 'https://rudra.example.test/api/v1/auth/callback';
    process.env.RUDRA_COOKIE_SIGNING_KEY = Buffer.alloc(32, 41).toString('base64');
    process.env.OIDC_MFA_ACR_VALUES = 'urn:rudra:mfa';
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      issuer: process.env.OIDC_ISSUER.replace(/\/$/, ''),
      authorization_endpoint: 'https://identity.example.test/authorize',
      token_endpoint: 'https://identity.example.test/token',
      jwks_uri: 'https://identity.example.test/jwks'
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    try {
      const login = await beginLogin();
      const authorization = new URL(login.location);
      assert.equal(authorization.searchParams.get('response_type'), 'code');
      assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
      assert.ok(authorization.searchParams.get('state'));
      assert.ok(authorization.searchParams.get('nonce'));
      assert.match(authorization.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
      assert.match(login.cookie, /HttpOnly; SameSite=Lax/);
    } finally {
      globalThis.fetch = priorFetch;
    }
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const signingKey = Buffer.alloc(32, 41).toString('base64');
    const encryptionKey = Buffer.alloc(32, 42).toString('base64');
    const lookupKey = Buffer.alloc(32, 43).toString('base64');
    const app = spawn(process.execPath, ['src/server.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port), NODE_ENV: 'test', RUDRA_ORGANIZATION_ID: org,
        OIDC_ISSUER: 'https://identity.example.test/', OIDC_CLIENT_ID: 'rudra-integration-test',
        OIDC_REDIRECT_URI: `https://rudra.example.test/api/v1/auth/callback`,
        RUDRA_COOKIE_SIGNING_KEY: signingKey, RUDRA_FIELD_ENCRYPTION_KEY: encryptionKey, RUDRA_LOOKUP_HMAC_KEY: lookupKey }
    });
    let appOutput = '';
    app.stderr.on('data', (chunk) => { appOutput += chunk.toString(); });
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      let ready = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        try {
          const response = await fetch(`${baseUrl}/health/live`);
          if (response.ok) { ready = true; break; }
        } catch { /* service is still starting */ }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(ready, `API server did not start: ${appOutput}`);
      const cookie = `rhc_session=${owner.sessionToken}; rhc_csrf=${owner.csrfToken}`;
      const call = async (path, method = 'GET', body = undefined, csrf = true) => {
        const response = await fetch(`${baseUrl}${path}`, {
          method, headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(csrf && ['POST','PATCH','PUT','DELETE'].includes(method) ? { 'x-csrf-token': owner.csrfToken } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
        const json = await response.json();
        return { response, json };
      };
      const callAs = async (actor,path,method='GET',body=undefined) => {
        const response=await fetch(`${baseUrl}${path}`,{method,headers:{
          cookie:`rhc_session=${actor.sessionToken}; rhc_csrf=${actor.csrfToken}`,
          ...(body===undefined?{}:{'content-type':'application/json'}),
          ...(['POST','PATCH','PUT','DELETE'].includes(method)?{'x-csrf-token':actor.csrfToken}:{})
        },...(body===undefined?{}:{body:JSON.stringify(body)})});
        return {response,json:await response.json()};
      };
      assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 200);
      assert.equal((await call('/api/v1/auth/me')).response.status, 200);
      assert.equal((await call('/api/v1/auth/sessions')).response.status, 200);
      assert.equal((await call('/api/v1/auth/callback')).response.status, 400);
      assert.equal((await call('/api/v1/patients', 'POST', { firstName: 'No CSRF', centreId: centreA }, false)).response.status, 403);
      assert.equal((await call('/api/v1/patients')).response.status, 200);

      const patient = await call('/api/v1/patients', 'POST', { firstName: 'HTTP Patient', centreId: centreA });
      assert.equal(patient.response.status, 201);
      const patientId = patient.json.data.patientId;
      assert.equal((await call(`/api/v1/patients/${patientId}`)).response.status, 200);
      assert.equal((await call(`/api/v1/patients/${patientId}`, 'PATCH', { lastName: 'Updated' })).response.status, 200);
      assert.equal((await call(`/api/v1/patients/${patientId}/timeline`)).response.status, 200);
      assert.equal((await call(`/api/v1/patients/${patientId}/addresses`, 'POST', {
        addressLine1: 'HTTP Test Road', city: 'Nashik', state: 'Maharashtra', postalCode: '422001', isPrimary: true
      })).response.status, 201);
      assert.equal((await call(`/api/v1/patients/${patientId}/addresses`)).response.status, 200);

      const familyPatient = await call('/api/v1/patients', 'POST', { firstName: 'HTTP Family', centreId: centreA });
      const familyId = familyPatient.json.data.patientId;
      const family = await call(`/api/v1/patients/${patientId}/family`, 'POST', { relatedPatientId: familyId, relationshipType: 'CHILD' });
      assert.equal(family.response.status, 201);
      assert.equal((await call(`/api/v1/patients/${patientId}/family`)).response.status, 200);
      assert.equal((await call(`/api/v1/patients/${patientId}/family/${family.json.data.relationshipId}`, 'DELETE')).response.status, 200);

      const external = await call(`/api/v1/patients/${patientId}/external-identifiers`, 'POST', {
        provider: 'Metropolis', identifierType: 'Patient ID', externalIdentifier: `HTTP-${randomUUID()}`
      });
      assert.equal(external.response.status, 201);
      assert.equal((await call(`/api/v1/patients/${patientId}/external-identifiers`)).response.status, 200);
      assert.equal((await call(`/api/v1/patients/${patientId}/external-identifiers/${external.json.data.id}`, 'PATCH',
        { externalIdentifier: `HTTP-${randomUUID()}` })).response.status, 200);

      const lostLead = await call('/api/v1/leads', 'POST', { firstName: 'Lost HTTP Lead', source: 'WEBSITE', centreId: centreA });
      assert.equal(lostLead.response.status, 201);
      const leadId = lostLead.json.data.id;
      assert.equal((await call('/api/v1/leads')).response.status, 200);
      assert.equal((await call(`/api/v1/leads/${leadId}`)).response.status, 200);
      assert.equal((await call(`/api/v1/leads/${leadId}`, 'PATCH', { status: 'CONTACTED' })).response.status, 200);
      assert.equal((await call(`/api/v1/leads/${leadId}/activities`, 'POST', { note: 'HTTP integration follow-up' })).response.status, 201);
      assert.equal((await call(`/api/v1/leads/${leadId}/lost`, 'POST', { reason: 'Client declined.' })).response.status, 200);
      assert.equal((await call(`/api/v1/leads/${leadId}`)).json.data.status, 'LOST');

      const convertible = await call('/api/v1/leads', 'POST', { firstName: 'Converted HTTP Lead', source: 'PHONE', centreId: centreA });
      const conversion = await call(`/api/v1/leads/${convertible.json.data.id}/convert`, 'POST', {});
      assert.equal(conversion.response.status, 200);
      assert.equal(conversion.json.data.status, 'CONVERTED');

      const doctor=await call('/api/v1/doctors','POST',{firstName:'Synthetic',lastName:'HTTP Doctor',specialty:'Test specialty',
        registrationNumber:'HTTP-SYN-001',mobile:'+919876500201',email:'http-doctor@example.test',centreId:centreA});
      assert.equal(doctor.response.status,201,JSON.stringify(doctor.json));
      const corporate=await call('/api/v1/corporates','POST',{name:'Synthetic HTTP Corporate',contactName:'Synthetic Contact',
        mobile:'+919876500202',email:'http-corporate@example.test',centreId:centreA});
      assert.equal(corporate.response.status,201,JSON.stringify(corporate.json));
      const partner=await call('/api/v1/partners','POST',{partnerType:'REFERRAL',name:'Synthetic HTTP Partner',
        contactName:'Synthetic Contact',mobile:'+919876500203',email:'http-partner@example.test',centreId:centreA});
      assert.equal(partner.response.status,201,JSON.stringify(partner.json));
      const httpTest=await call('/api/v1/catalogue/tests','POST',{code:`HTTP-${randomUUID().slice(0,8)}`,name:'Synthetic HTTP Test',
        fastingRequired:false,priceMinor:12500,centreId:centreA});
      assert.equal(httpTest.response.status,201,JSON.stringify(httpTest.json));
      const httpPackage=await call('/api/v1/catalogue/packages','POST',{code:`HTTP-${randomUUID().slice(0,8)}`,name:'Synthetic HTTP Package',
        priceMinor:22000,centreId:centreA,items:[{testId:httpTest.json.data.testId,quantity:1}]});
      assert.equal(httpPackage.response.status,201,JSON.stringify(httpPackage.json));
      assert.equal((await call(`/api/v1/catalogue/packages/${httpPackage.json.data.packageId}`)).json.data.items.length,1);
      assert.equal((await call(`/api/v1/doctors/${doctor.json.data.doctorId}`)).response.status,200);
      assert.equal((await call(`/api/v1/corporates/${corporate.json.data.corporateId}`)).response.status,200);
      assert.equal((await call(`/api/v1/partners/${partner.json.data.partnerId}`)).response.status,200);
      assert.equal((await call('/api/v1/doctors','GET')).response.status,200);
      assert.equal((await call('/api/v1/corporates','GET')).response.status,200);
      assert.equal((await call('/api/v1/partners','GET')).response.status,200);
      assert.equal((await call('/api/v1/catalogue/tests','GET')).response.status,200);
      assert.equal((await call('/api/v1/catalogue/packages','GET')).response.status,200);
      assert.equal((await call(`/api/v1/doctors/${doctor.json.data.doctorId}`,'PATCH',{specialty:'Updated synthetic specialty'})).response.status,200);
      assert.equal((await call(`/api/v1/corporates/${corporate.json.data.corporateId}`,'PATCH',{status:'PAUSED'})).response.status,200);
      assert.equal((await call(`/api/v1/partners/${partner.json.data.partnerId}`,'PATCH',{status:'INACTIVE'})).response.status,200);
      assert.equal((await call(`/api/v1/catalogue/tests/${httpTest.json.data.testId}`,'PATCH',{priceMinor:13000})).response.status,200);
      assert.equal((await call(`/api/v1/catalogue/packages/${httpPackage.json.data.packageId}`,'PATCH',{status:'INACTIVE'})).response.status,200);
      assert.equal((await call('/api/v1/patients','POST',{firstName:'Synthetic Directory Link',centreId:centreA,
        referredDoctorId:doctor.json.data.doctorId,corporateId:corporate.json.data.corporateId,referredPartnerId:partner.json.data.partnerId})).response.status,201);
      const partnerLead=await call('/api/v1/leads','POST',{firstName:'Synthetic Partner Lead',source:'PARTNER',centreId:centreA,partnerId:partner.json.data.partnerId});
      assert.equal(partnerLead.response.status,201,JSON.stringify(partnerLead.json));
      const convertedPartnerLead=await call(`/api/v1/leads/${partnerLead.json.data.id}/convert`,'POST',{});
      assert.equal(convertedPartnerLead.response.status,200);
      const receptionist=principals.get('RECEPTIONIST');
      assert.equal((await callAs(receptionist,'/api/v1/doctors','POST',{firstName:'Denied',centreId:centreA})).response.status,403);
      const centreBDoctor=await call('/api/v1/doctors','POST',{firstName:'Synthetic Centre B Doctor',centreId:centreB});
      assert.equal(centreBDoctor.response.status,201);
      assert.equal((await callAs(receptionist,`/api/v1/doctors/${centreBDoctor.json.data.doctorId}`)).response.status,404);
      const centreBCorporate=await call('/api/v1/corporates','POST',{name:'Synthetic Centre B Corporate',centreId:centreB});
      const centreBPartner=await call('/api/v1/partners','POST',{partnerType:'COLLECTION',name:'Synthetic Centre B Partner',centreId:centreB});
      const centreBTest=await call('/api/v1/catalogue/tests','POST',{code:`SCOPE-${randomUUID().slice(0,8)}`,name:'Synthetic Centre B Test',centreId:centreB});
      const centreBPackage=await call('/api/v1/catalogue/packages','POST',{code:`SCOPE-${randomUUID().slice(0,8)}`,name:'Synthetic Centre B Package',centreId:centreB,
        items:[{testId:centreBTest.json.data.testId}]});
      assert.equal(centreBCorporate.response.status,201);
      assert.equal(centreBPartner.response.status,201);
      assert.equal(centreBTest.response.status,201);
      assert.equal(centreBPackage.response.status,201);
      for (const path of [
        `/api/v1/corporates/${centreBCorporate.json.data.corporateId}`,
        `/api/v1/partners/${centreBPartner.json.data.partnerId}`,
        `/api/v1/catalogue/tests/${centreBTest.json.data.testId}`,
        `/api/v1/catalogue/packages/${centreBPackage.json.data.packageId}`
      ]) assert.equal((await callAs(receptionist,path)).response.status,404,path);
      for (const path of ['/api/v1/doctors','/api/v1/corporates','/api/v1/partners','/api/v1/catalogue/tests','/api/v1/catalogue/packages']) {
        assert.equal((await callAs(receptionist,`${path}?centreId=${centreB}`)).response.status,403,path);
      }
      assert.equal((await callAs(receptionist,`/api/v1/doctors/${doctor.json.data.doctorId}`)).json.data.mobile.endsWith('0201'),true);

      const foreignOrg=(await pool.query(`INSERT INTO organizations (public_id,name,brand_name) VALUES ($1,'Foreign API Test','Foreign') RETURNING id`,
        [`FOREIGN-ORG-${randomUUID()}`])).rows[0].id;
      const foreignCentre=(await pool.query(`INSERT INTO centres (organization_id,public_id,name,centre_type,address_line_1,city,state,postal_code)
        VALUES ($1,$2,'Foreign Centre','MAIN','1 Foreign Road','Mumbai','Maharashtra','400001') RETURNING id`,
        [foreignOrg,`FOREIGN-CEN-${randomUUID()}`])).rows[0].id;
      const foreignUser=(await pool.query(`INSERT INTO users (organization_id,public_id,auth_subject,status) VALUES ($1,$2,$3,'active') RETURNING id`,
        [foreignOrg,`FOREIGN-USR-${randomUUID()}`,`foreign-api:${randomUUID()}`])).rows[0].id;
      const foreignDoctor=(await pool.query(`INSERT INTO doctors (organization_id,public_id,centre_id,first_name,created_by)
        VALUES ($1,$2,$3,'Synthetic Foreign Doctor',$4) RETURNING public_id`,
        [foreignOrg,`FOREIGN-DOC-${randomUUID()}`,foreignCentre,foreignUser])).rows[0].public_id;
      assert.equal((await call(`/api/v1/doctors/${foreignDoctor}`)).response.status,404);

      const removableSessionToken = newOpaqueToken();
      const removableSession = (await pool.query(
        `INSERT INTO auth_sessions (organization_id,user_id,token_hash,csrf_hash,expires_at,absolute_expires_at)
         VALUES ($1,$2,$3,$4,now()+interval '1 hour',now()+interval '8 hours') RETURNING id`,
        [org, owner.principal.id, sha256(removableSessionToken), sha256(newOpaqueToken())]
      )).rows[0].id;
      const revokeResult = await call(`/api/v1/auth/sessions/${removableSession}`, 'DELETE');
      assert.equal(revokeResult.response.status, 200, `${JSON.stringify(revokeResult.json)} ${appOutput}`);
      const refreshed = await call('/api/v1/auth/refresh', 'POST', {});
      assert.equal(refreshed.response.status, 200);
      const logoutCookies = refreshed.response.headers.get('set-cookie') || '';
      const rotatedToken = logoutCookies.match(/rhc_session=([^;,]+)/)?.[1];
      const rotatedCsrf = logoutCookies.match(/rhc_csrf=([^;,]+)/)?.[1];
      assert.ok(rotatedToken && rotatedCsrf, 'refresh must return rotated session cookies');
      const logoutResponse = await fetch(`${baseUrl}/api/v1/auth/logout`, { method: 'POST',
        headers: { cookie: `rhc_session=${rotatedToken}; rhc_csrf=${rotatedCsrf}`, 'x-csrf-token': rotatedCsrf } });
      assert.equal(logoutResponse.status, 200);
      const expired = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie } });
      assert.equal(expired.status, 401);
    } finally {
      app.kill('SIGTERM');
      await new Promise((resolve) => app.once('exit', resolve));
    }

    const receptionist = principals.get('RECEPTIONIST');
    await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [receptionist.principal.id]);
    await assert.rejects(authenticate(pool, receptionist.request()), (error) => error.status === 401);
  } finally {
    await pool.end();
  }
});
