import { randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError } from './authorization.mjs';
import { newOpaqueToken, readSignedCookie, sha256, signedCookie } from './security.mjs';

const sessionLifetimeSeconds = 8 * 60 * 60;
const cookieName = 'rhc_session';
let discovery;
let remoteJwks;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

export function cookieOptions() {
  const secure = process.env.NODE_ENV !== 'development';
  const domain = process.env.COOKIE_DOMAIN ? `; Domain=${process.env.COOKIE_DOMAIN}` : '';
  return { secure, domain };
}

function setCookies(sessionToken, csrf, maxAge = sessionLifetimeSeconds) {
  const { secure, domain } = cookieOptions();
  const securePart = secure ? '; Secure' : '';
  return [
    `${cookieName}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${securePart}${domain}`,
    `rhc_csrf=${encodeURIComponent(csrf)}; Path=/; SameSite=Lax; Max-Age=${maxAge}${securePart}${domain}`
  ];
}

export function clearCookies() {
  const { secure, domain } = cookieOptions();
  const securePart = secure ? '; Secure' : '';
  return [
    `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${securePart}${domain}`,
    `rhc_csrf=; Path=/; SameSite=Lax; Max-Age=0${securePart}${domain}`,
    'rhc_oidc=; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=0' + securePart + domain
  ];
}

async function getDiscovery() {
  if (discovery) return discovery;
  const issuer = new URL(requiredEnv('OIDC_ISSUER'));
  if (issuer.protocol !== 'https:' && process.env.NODE_ENV !== 'development') throw new Error('OIDC_ISSUER must use HTTPS');
  const response = await fetch(new URL('.well-known/openid-configuration', issuer.href.endsWith('/') ? issuer : `${issuer.href}/`));
  if (!response.ok) throw new Error('Identity provider discovery failed');
  discovery = await response.json();
  if (discovery.issuer !== issuer.href.replace(/\/$/, '') && discovery.issuer !== issuer.href) throw new Error('Identity provider issuer does not match OIDC_ISSUER');
  if (process.env.NODE_ENV !== 'development') {
    for (const endpoint of [discovery.authorization_endpoint, discovery.token_endpoint, discovery.jwks_uri]) {
      if (!endpoint || new URL(endpoint).protocol !== 'https:') throw new Error('Identity provider endpoints must use HTTPS');
    }
  }
  remoteJwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
  return discovery;
}

export async function beginLogin() {
  const oidc = await getDiscovery();
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = await import('node:crypto').then(({ createHash }) => createHash('sha256').update(verifier).digest('base64url'));
  const acr = process.env.OIDC_MFA_ACR_VALUES;
  const url = new URL(oidc.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: requiredEnv('OIDC_CLIENT_ID'),
    redirect_uri: requiredEnv('OIDC_REDIRECT_URI'),
    response_type: 'code',
    scope: process.env.OIDC_SCOPES || 'openid profile email',
    state, nonce, code_challenge: challenge, code_challenge_method: 'S256',
    ...(acr ? { acr_values: acr } : {})
  }).toString();
  const transaction = signedCookie({ state, nonce, verifier, issuedAt: Date.now() });
  const secure = cookieOptions().secure ? '; Secure' : '';
  const cookie = `rhc_oidc=${encodeURIComponent(transaction)}; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=600${secure}${cookieOptions().domain}`;
  return { location: url.toString(), cookie };
}

export async function completeLogin(pool, request) {
  const url = new URL(request.url, 'http://localhost');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookies = parseCookies(request.headers.cookie);
  const transaction = readSignedCookie(cookies.rhc_oidc);
  if (!code || !state || !transaction || transaction.state !== state || Date.now() - transaction.issuedAt > 10 * 60_000) {
    throw new HttpError(400, 'OIDC_STATE_INVALID', 'Sign-in expired. Start again.');
  }
  const oidc = await getDiscovery();
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code,
    redirect_uri: requiredEnv('OIDC_REDIRECT_URI'),
    client_id: requiredEnv('OIDC_CLIENT_ID'), code_verifier: transaction.verifier
  });
  const secret = process.env.OIDC_CLIENT_SECRET;
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  if (secret) headers.authorization = `Basic ${Buffer.from(`${requiredEnv('OIDC_CLIENT_ID')}:${secret}`).toString('base64')}`;
  const tokenResponse = await fetch(oidc.token_endpoint, { method: 'POST', headers, body });
  if (!tokenResponse.ok) throw new HttpError(401, 'IDENTITY_PROVIDER_REJECTED', 'Sign-in could not be completed. Try again.');
  const tokens = await tokenResponse.json();
  if (!tokens.id_token) throw new HttpError(401, 'ID_TOKEN_MISSING', 'Sign-in could not be verified.');
  const { payload } = await jwtVerify(tokens.id_token, remoteJwks, {
    issuer: oidc.issuer,
    audience: requiredEnv('OIDC_CLIENT_ID'),
    nonce: transaction.nonce
  });
  if (typeof payload.sub !== 'string' || !payload.sub) throw new HttpError(401, 'SUBJECT_MISSING', 'Sign-in could not be verified.');

  const organizationId = requiredEnv('RUDRA_ORGANIZATION_ID');
  const found = await pool.query(
    `SELECT id, organization_id, status, locked_until, mfa_enabled
       FROM users WHERE organization_id = $1 AND auth_subject = $2`,
    [organizationId, payload.sub]
  );
  const user = found.rows[0];
  if (!user) throw new HttpError(403, 'ACCOUNT_UNAVAILABLE', 'This staff account is not enabled for Rudra Health OS. Contact your administrator.');
  if (user.status === 'disabled' || user.status === 'invited') throw new HttpError(403, 'ACCOUNT_INACTIVE', 'Your staff account is inactive. Contact your administrator.');
  if (user.status === 'locked' || (user.locked_until && new Date(user.locked_until) > new Date())) throw new HttpError(423, 'ACCOUNT_LOCKED', 'This account is temporarily locked. Contact your administrator.');
  if (user.mfa_enabled) {
    const amr = Array.isArray(payload.amr) ? payload.amr : [];
    const allowedAcr = (process.env.OIDC_MFA_ACR_VALUES || '').split(/\s+/).filter(Boolean);
    const mfaProven = amr.some((entry) => ['mfa', 'otp', 'hwk', 'webauthn'].includes(entry)) || allowedAcr.includes(payload.acr);
    if (!mfaProven) throw new HttpError(403, 'MFA_REQUIRED', 'The identity provider did not confirm the required second-step verification.');
  }

  const session = newOpaqueToken();
  const csrf = newOpaqueToken();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET last_login_at = now(), failed_login_count = 0, updated_at = now() WHERE id = $1', [user.id]);
    await client.query(
      `INSERT INTO auth_sessions (organization_id, user_id, token_hash, csrf_hash, expires_at, absolute_expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, now() + interval '8 hours', now() + interval '12 hours', $5, $6)`,
      [organizationId, user.id, sha256(session), sha256(csrf), clientAddress(request), request.headers['user-agent'] || null]
    );
    await audit(client, organizationId, user.id, 'auth.login.succeeded', user.id, request);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally { client.release(); }
  return { cookies: [...setCookies(session, csrf), `rhc_oidc=; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=0${cookieOptions().secure ? '; Secure' : ''}${cookieOptions().domain}`] };
}

function clientAddress(request) {
  // Use the direct socket address; do not trust arbitrary forwarded headers.
  const ip = request.socket.remoteAddress;
  return ip?.startsWith('::ffff:') ? ip.slice(7) : ip || null;
}

async function audit(client, organizationId, userId, action, entityId, request) {
  await client.query(
    `INSERT INTO audit_events (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, ip_address, user_agent, request_id, outcome)
     VALUES ($1, $2, 'USER', $3, 'USER', $4, $5, $6, $7, 'SUCCESS')`,
    [organizationId, userId, action, entityId, clientAddress(request), request.headers['user-agent'] || null, request.requestId]
  );
}

export async function authenticate(pool, request) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[cookieName];
  if (!token) throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue.');
  const result = await pool.query(
    `SELECT s.id AS session_id, s.organization_id, s.user_id, s.csrf_hash, u.status,
            u.public_id, sp.display_name, sp.primary_centre_id
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       LEFT JOIN staff_profiles sp ON sp.user_id = u.id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
        AND u.status = 'active'`, [sha256(token)]
  );
  const session = result.rows[0];
  if (!session) throw new HttpError(401, 'SESSION_EXPIRED', 'Your session has expired. Sign in again.');
  const csrf = cookies.rhc_csrf;
  const unsafe = ['POST','PATCH','PUT','DELETE'].includes(request.method);
  if (unsafe && (!csrf || !request.headers['x-csrf-token'] || csrf !== request.headers['x-csrf-token'] || !sha256(csrf).equals(session.csrf_hash))) {
    throw new HttpError(403, 'CSRF_INVALID', 'The security token is missing or expired. Refresh the page and try again.');
  }
  await pool.query('UPDATE auth_sessions SET last_seen_at=now() WHERE id=$1', [session.session_id]);
  const policy = await pool.query(
    `SELECT DISTINCT p.code, ur.centre_id
       FROM user_roles ur JOIN role_permissions rp ON rp.organization_id = ur.organization_id AND rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.organization_id = $1 AND ur.user_id = $2 AND rp.allow = true`,
    [session.organization_id, session.user_id]
  );
  return {
    id: session.user_id, organizationId: session.organization_id,
    publicId: session.public_id, displayName: session.display_name,
    primaryCentreId: session.primary_centre_id,
    permissions: new Set(policy.rows.map((row) => row.code)),
    permissionCentres: new Map(policy.rows.reduce((entries, row) => {
      const scopes = entries.get(row.code) || [];
      scopes.push(row.centre_id);
      entries.set(row.code, scopes);
      return entries;
    }, new Map())),
    centres: [...new Set(policy.rows.map((row) => row.centre_id))],
    sessionId: session.session_id, tokenHash: sha256(token)
  };
}

export async function refreshSession(pool, request, principal) {
  const session = newOpaqueToken();
  const csrf = newOpaqueToken();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const previous = await client.query('SELECT id FROM auth_sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at > now() FOR UPDATE', [principal.sessionId]);
    if (!previous.rowCount) throw new HttpError(401, 'SESSION_EXPIRED', 'Your session has expired. Sign in again.');
    const result = await client.query(
      `INSERT INTO auth_sessions (organization_id, user_id, token_hash, csrf_hash, expires_at, absolute_expires_at, ip_address, user_agent)
       SELECT organization_id, user_id, $2, $3, LEAST(now() + interval '8 hours', absolute_expires_at), absolute_expires_at, $4, $5
         FROM auth_sessions WHERE id=$1 RETURNING id`,
      [principal.sessionId, sha256(session), sha256(csrf), clientAddress(request), request.headers['user-agent'] || null]
    );
    await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [principal.sessionId]);
    await client.query('UPDATE auth_sessions SET replaced_by_session_id = $2 WHERE id = $1', [principal.sessionId, result.rows[0].id]);
    await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND replaced_by_session_id IS NOT NULL', [principal.sessionId]);
    await audit(client, principal.organizationId, principal.id, 'auth.session.refreshed', result.rows[0].id, request);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  return setCookies(session, csrf);
}

export async function logout(pool, request, principal) {
  await pool.query('UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [principal.sessionId]);
  await pool.query(
    `INSERT INTO audit_events (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, ip_address, user_agent, request_id, outcome)
     VALUES ($1, $2, 'USER', 'auth.logout', 'USER', $2, $3, $4, $5, 'SUCCESS')`,
    [principal.organizationId, principal.id, clientAddress(request), request.headers['user-agent'] || null, request.requestId]
  );
}

export async function listSessions(pool, principal) {
  const result = await pool.query(
    `SELECT id, created_at, last_seen_at, expires_at, revoked_at, ip_address::text, user_agent, (id=$3) AS is_current
       FROM auth_sessions WHERE organization_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 30`,
    [principal.organizationId, principal.id, principal.sessionId]
  );
  return result.rows;
}

export async function revokeSession(pool, request, principal, sessionId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE auth_sessions SET revoked_at=now() WHERE id=$1 AND organization_id=$2 AND user_id=$3 AND revoked_at IS NULL RETURNING id`,
      [sessionId, principal.organizationId, principal.id]
    );
    if (!result.rowCount) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session was not found or has already ended.');
    await audit(client, principal.organizationId, principal.id, 'auth.session.revoked', sessionId, request);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export function readCookieHeader(request) { return parseCookies(request.headers.cookie); }

export async function recordAuthFailure(pool, request, action) {
  const organizationId = process.env.RUDRA_ORGANIZATION_ID;
  if (!organizationId) return;
  await pool.query(
    `INSERT INTO audit_events (organization_id, actor_type, action, entity_type, ip_address, user_agent, request_id, outcome)
     VALUES ($1, 'SYSTEM', $2, 'AUTHENTICATION', $3, $4, $5, 'FAILURE')`,
    [organizationId, action, clientAddress(request), request.headers['user-agent'] || null, request.requestId]
  );
}
