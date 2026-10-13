import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { HttpError, assertPermission } from './authorization.mjs';
import { authenticate, beginLogin, clearCookies, completeLogin, listSessions, logout, readCookieHeader, recordAuthFailure, refreshSession, revokeSession } from './auth.mjs';
import {
  addFamilyMember, addLeadActivity, addPatientAddress, addExternalIdentifier, updateExternalIdentifier, listExternalIdentifiers,
  convertLead, createLead, createPatient, endFamilyRelationship, getLeadDetail,
  getPatientDetail, listFamily, listLeads, listPatientAddresses, listPatients,
  markLeadLost, patientTimeline, updateLead, updatePatient
} from './records.mjs';

const { Pool } = pg;
const pool = new Pool({ connectionString: required('DATABASE_URL'), max: Number(process.env.DB_POOL_SIZE || 10), idleTimeoutMillis: 30_000 });
const port = Number(process.env.PORT || 8080);
const loginAttempts = new Map();

for (const name of ['RUDRA_ORGANIZATION_ID','OIDC_ISSUER','OIDC_CLIENT_ID','OIDC_REDIRECT_URI','RUDRA_COOKIE_SIGNING_KEY','RUDRA_FIELD_ENCRYPTION_KEY','RUDRA_LOOKUP_HMAC_KEY']) required(name);
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(process.env.RUDRA_ORGANIZATION_ID)) throw new Error('RUDRA_ORGANIZATION_ID must be a UUID');
const configuredKeys = ['RUDRA_COOKIE_SIGNING_KEY','RUDRA_FIELD_ENCRYPTION_KEY','RUDRA_LOOKUP_HMAC_KEY'].map((name) => Buffer.from(process.env[name], 'base64'));
if (configuredKeys.some((key) => key.length !== 32)) throw new Error('Cookie signing, field encryption, and lookup keys must each decode to 32 bytes');
if (new Set(configuredKeys.map((key) => key.toString('hex'))).size !== configuredKeys.length) throw new Error('Use a distinct key for each Rudra cryptographic purpose');

function required(name) { if (!process.env[name]) throw new Error(`${name} is required`); return process.env[name]; }

function rateLimit(request) {
  const now = Date.now(); const key = request.socket.remoteAddress || 'unknown';
  const bucket = (loginAttempts.get(key) || []).filter((time) => now - time < 60_000);
  if (bucket.length >= 12) throw new HttpError(429, 'RATE_LIMITED', 'Too many sign-in attempts. Wait a minute and try again.');
  bucket.push(now); loginAttempts.set(key, bucket);
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  response.end(JSON.stringify(body));
}

function sendRedirect(response, location, cookies = []) {
  response.writeHead(302, { location, 'cache-control': 'no-store', 'set-cookie': cookies });
  response.end();
}

async function readBody(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_048_576) throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body exceeds the 1 MB limit.');
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'INVALID_JSON', 'Request body must be valid JSON.'); }
}

async function handle(request, response) {
  let authenticatedPrincipal = null;
  const incomingRequestId = request.headers['x-request-id'];
  request.requestId = typeof incomingRequestId === 'string' && /^[a-zA-Z0-9._:-]{1,100}$/.test(incomingRequestId) ? incomingRequestId : randomUUID();
  const headers = { 'x-request-id': request.requestId, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
  if (process.env.NODE_ENV !== 'development') headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const routePath = url.pathname.replace(/^\/api\/v1(?=\/|$)/, '') || '/';
    const method = request.method || 'GET';
    if (method === 'OPTIONS') {
      response.writeHead(204, { ...headers, 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type,x-csrf-token,x-request-id' });
      response.end(); return;
    }
    if (routePath === '/health/live' && method === 'GET') return send(response, 200, { data: { status: 'ok' } }, headers);
    if (routePath === '/health/ready' && method === 'GET') {
      await pool.query('SELECT 1');
      return send(response, 200, { data: { status: 'ready' } }, headers);
    }
    if (routePath === '/auth/login' && method === 'GET') {
      rateLimit(request);
      const login = await beginLogin();
      return sendRedirect(response, login.location, [login.cookie]);
    }
    if (routePath === '/auth/callback' && method === 'GET') {
      try {
        const result = await completeLogin(pool, request);
        return sendRedirect(response, process.env.RUDRA_APP_URL || '/', result.cookies);
      } catch (error) {
        await recordAuthFailure(pool, request, `auth.login.failed.${error.code || 'provider_error'}`).catch(() => {});
        const safeError = error instanceof HttpError;
        return send(response, safeError ? error.status : 503, { error: { code: safeError ? error.code : 'SIGN_IN_UNAVAILABLE', message: safeError ? error.message : 'Sign-in is temporarily unavailable. Try again.', requestId: request.requestId } }, { ...headers, 'set-cookie': clearCookies() });
      }
    }
    if (routePath === '/auth/me' && method === 'GET') {
      const principal = authenticatedPrincipal = await authenticate(pool, request);
      const cookies = readCookieHeader(request);
      return send(response, 200, { data: { id: principal.id, staffId: principal.publicId, displayName: principal.displayName,
        primaryCentreId: principal.primaryCentreId, centreIds: principal.centres.filter(Boolean), organizationWide: principal.centres.includes(null),
        permissions: [...principal.permissions], csrfToken: cookies.rhc_csrf } }, headers);
    }
    if (routePath === '/auth/refresh' && method === 'POST') {
      const principal = authenticatedPrincipal = await authenticate(pool, request);
      return send(response, 200, { data: { refreshed: true } }, { ...headers, 'set-cookie': await refreshSession(pool, request, principal) });
    }
    if (routePath === '/auth/logout' && method === 'POST') {
      const principal = authenticatedPrincipal = await authenticate(pool, request);
      await logout(pool, request, principal);
      return send(response, 200, { data: { signedOut: true } }, { ...headers, 'set-cookie': clearCookies() });
    }
    if (routePath === '/auth/sessions' && method === 'GET') {
      const principal = authenticatedPrincipal = await authenticate(pool, request);
      return send(response, 200, { data: await listSessions(pool, principal) }, headers);
    }
    const sessionMatch = routePath.match(/^\/auth\/sessions\/([^/]+)$/);
    if (sessionMatch && method === 'DELETE') {
      const principal = authenticatedPrincipal = await authenticate(pool, request);
      await revokeSession(pool, request, principal, decodeURIComponent(sessionMatch[1]));
      const isCurrent = decodeURIComponent(sessionMatch[1]) === principal.sessionId;
      return send(response, 200, { data: { revoked: true } }, { ...headers, ...(isCurrent ? { 'set-cookie': clearCookies() } : {}) });
    }

    const principal = authenticatedPrincipal = await authenticate(pool, request);
    if (routePath === '/patients' && method === 'GET') return send(response, 200, await listPatients(pool, principal, url), headers);
    if (routePath === '/patients' && method === 'POST') return send(response, 201, await createPatient(pool, principal, await readBody(request), request), headers);
    let match = routePath.match(/^\/patients\/([^/]+)$/);
    if (match && method === 'GET') return send(response, 200, await getPatientDetail(pool, principal, decodeURIComponent(match[1])), headers);
    if (match && method === 'PATCH') return send(response, 200, await updatePatient(pool, principal, decodeURIComponent(match[1]), await readBody(request), request), headers);
    match = routePath.match(/^\/patients\/([^/]+)\/timeline$/);
    if (match && method === 'GET') return send(response, 200, await patientTimeline(pool, principal, decodeURIComponent(match[1])), headers);
    match = routePath.match(/^\/patients\/([^/]+)\/addresses$/);
    if (match && method === 'GET') return send(response, 200, await listPatientAddresses(pool, principal, decodeURIComponent(match[1])), headers);
    if (match && method === 'POST') return send(response, 201, await addPatientAddress(pool, principal, decodeURIComponent(match[1]), await readBody(request), request), headers);
    match = routePath.match(/^\/patients\/([^/]+)\/family$/);
    if (match && method === 'GET') return send(response, 200, await listFamily(pool, principal, decodeURIComponent(match[1])), headers);
    if (match && method === 'POST') return send(response, 201, await addFamilyMember(pool, principal, decodeURIComponent(match[1]), await readBody(request), request), headers);
    match = routePath.match(/^\/patients\/([^/]+)\/family\/([^/]+)$/);
    if (match && method === 'DELETE') return send(response, 200, await endFamilyRelationship(pool, principal, decodeURIComponent(match[1]), decodeURIComponent(match[2]), request), headers);
    match = routePath.match(/^\/patients\/([^/]+)\/external-identifiers$/);
    if (match && method === 'GET') return send(response, 200, await listExternalIdentifiers(pool, principal, decodeURIComponent(match[1])), headers);
    if (match && method === 'POST') return send(response, 201, await addExternalIdentifier(pool, principal, decodeURIComponent(match[1]), await readBody(request), request), headers);
    match = routePath.match(/^\/patients\/([^/]+)\/external-identifiers\/([^/]+)$/);
    if (match && method === 'PATCH') return send(response, 200, await updateExternalIdentifier(pool, principal, decodeURIComponent(match[1]), decodeURIComponent(match[2]), await readBody(request), request), headers);

    if (routePath === '/leads' && method === 'GET') return send(response, 200, await listLeads(pool, principal, url), headers);
    if (routePath === '/leads' && method === 'POST') return send(response, 201, await createLead(pool, principal, await readBody(request), request), headers);
    match = routePath.match(/^\/leads\/([^/]+)$/);
    if (match && method === 'GET') return send(response, 200, await getLeadDetail(pool, principal, decodeURIComponent(match[1])), headers);
    if (match && method === 'PATCH') return send(response, 200, await updateLead(pool, principal, decodeURIComponent(match[1]), await readBody(request), request), headers);
    match = routePath.match(/^\/leads\/([^/]+)\/activities$/);
    if (match && method === 'POST') return send(response, 201, await addLeadActivity(pool, principal, decodeURIComponent(match[1]), await readBody(request), request), headers);
    match = routePath.match(/^\/leads\/([^/]+)\/convert$/);
    if (match && method === 'POST') return send(response, 200, await convertLead(pool, principal, decodeURIComponent(match[1]), await readBody(request), request), headers);
    match = routePath.match(/^\/leads\/([^/]+)\/lost$/);
    if (match && method === 'POST') return send(response, 200, await markLeadLost(pool, principal, decodeURIComponent(match[1]), await readBody(request), request), headers);

    throw new HttpError(404, 'ROUTE_NOT_FOUND', 'The requested API route was not found.');
  } catch (error) {
    const pgUnique = error.code === '23505';
    const pgConstraint = ['23503','23514','22001','22P02'].includes(error.code);
    const status = error instanceof HttpError ? error.status : pgUnique || pgConstraint ? 409 : 500;
    const code = error.code === '23505' ? 'DUPLICATE_RECORD' : error.code === '23503' ? 'RELATED_RECORD_INVALID' : error.code === '23514' ? 'RECORD_CONSTRAINT_FAILED' : error.code === '22P02' ? 'INVALID_IDENTIFIER' : error.code || 'INTERNAL_ERROR';
    if (status === 403 && authenticatedPrincipal) {
      await pool.query(
        `INSERT INTO audit_events (organization_id, actor_user_id, actor_type, action, entity_type, ip_address, user_agent, request_id, outcome)
         VALUES ($1,$2,'USER','authorization.denied','API',$3,$4,$5,'DENIED')`,
        [authenticatedPrincipal.organizationId, authenticatedPrincipal.id, request.socket.remoteAddress?.replace(/^::ffff:/, '') || null,
          request.headers['user-agent'] || null, request.requestId]
      ).catch(() => {});
    }
    if (status >= 500) console.error(JSON.stringify({ requestId: request.requestId, code, message: error.message }));
    const safeConstraintMessage = pgUnique ? 'A record with the same unique identifier already exists.' : 'The supplied record references are invalid or conflict with an existing record.';
    const payload = { error: { code, message: status >= 500 ? 'Rudra Health OS could not complete the request.' : error instanceof HttpError ? error.message : safeConstraintMessage, requestId: request.requestId } };
    if (error.details) payload.error.details = error.details;
    if (status === 401 && /^\/(?:api\/v1\/)?auth\//.test(request.url || '')) headers['set-cookie'] = clearCookies();
    return send(response, status, payload, headers);
  }
}

const server = createServer((request, response) => { void handle(request, response); });
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.listen(port, '0.0.0.0', () => console.log(`Rudra Health OS backend listening on ${port}`));

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  server.close(); await pool.end(); process.exit(0);
});
