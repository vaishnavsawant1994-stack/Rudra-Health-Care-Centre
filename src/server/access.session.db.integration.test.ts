import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { hashPassword } from "better-auth/crypto";
import { loadProjectEnvironment } from "../../scripts/load-project-env.mjs";
import { runMigrations } from "../../scripts/migrate.mjs";

const mocks = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => mocks.headers }));

describe("real Better Auth staff session and MFA PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_auth_session_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  let testUrl = "";
  let pool: InstanceType<typeof Pool>;
  let postAuth: typeof import("@/app/api/auth/[...all]/route").POST;
  let financeHandler: typeof import("@/app/api/finance/route").GET;
  let financePostHandler: typeof import("@/app/api/finance/route").POST;
  let reportsHandler: typeof import("@/app/api/reports/route").GET;
  let leadsHandler: typeof import("@/app/api/leads/route").GET;
  let appointmentsHandler: typeof import("@/app/api/appointments/route").GET;
  let ordersHandler: typeof import("@/app/api/orders/route").GET;
  let collectionsHandler: typeof import("@/app/api/collections/route").GET;
  let samplesHandler: typeof import("@/app/api/samples/route").GET;
  let branchHandler: typeof import("@/app/api/branch/operations/route").GET;
  let adminStaffHandler: typeof import("@/app/api/admin/staff/route").GET;
  let getApiAccess: typeof import("@/server/access").getApiAccess;
  let staffId: string;
  let centreId: string;
  let otherCentreId: string;
  const priorEnvironment: { databaseUrl?: string; betterAuthUrl?: string; betterAuthSecret?: string } = {};
  const email = `wave8-${randomUUID().slice(0, 8)}@invalid.test`;
  const password = `Synthetic-Only-${randomUUID()}!`;

  beforeAll(async () => {
    loadProjectEnvironment();
    priorEnvironment.databaseUrl = process.env.DATABASE_URL;
    priorEnvironment.betterAuthUrl = process.env.BETTER_AUTH_URL;
    priorEnvironment.betterAuthSecret = process.env.BETTER_AUTH_SECRET;
    testUrl = process.env.DATABASE_TEST_URL ?? "";
    if (!testUrl || !/test/i.test(decodeURIComponent(new URL(testUrl).pathname))) throw new Error("A dedicated test database is required.");
    const admin = new Pool({ connectionString: testUrl, max: 1 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();
    await runMigrations(testUrl, null, schema);
    const scopedUrl = new URL(testUrl);
    scopedUrl.searchParams.set("options", `-csearch_path=${schema},public`);
    process.env.DATABASE_URL = scopedUrl.toString();
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64url");
    pool = new Pool({ connectionString: scopedUrl.toString(), max: 1 });
    const organizationId = randomUUID(); centreId = randomUUID(); otherCentreId = randomUUID(); staffId = randomUUID();
    const authUserId = randomUUID(), roleId = randomUUID();
    const passwordHash = await hashPassword(password);
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `AUTH-${organizationId.slice(0, 8)}`, "Synthetic authentication test"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name) VALUES($1,$2,$3,$4),($5,$2,$6,$7)", [centreId, organizationId, `A-${centreId.slice(0, 6)}`, "Synthetic Finance Centre", otherCentreId, `B-${otherCentreId.slice(0, 6)}`, "Synthetic Other Centre"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authUserId, "Synthetic Staff", email]);
    await pool.query('INSERT INTO "account"(id,"accountId","providerId","userId",password) VALUES($1,$2,\'credential\',$3,$4)', [randomUUID(), authUserId, authUserId, passwordHash]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status) VALUES($1,$2,$3,$4,$5,'ACTIVE')", [staffId, authUserId, organizationId, `AUTH-${staffId.slice(0, 8)}`, "Synthetic Staff"]);
    await pool.query("INSERT INTO roles(id,organization_id,key,name,scope) VALUES($1,$2,$3,$4,'CENTRE')", [roleId, organizationId, `finance_${staffId.slice(0, 8)}`, "Synthetic finance role"]);
    await pool.query("INSERT INTO permissions(key,description,scope) VALUES('finance.read','Synthetic finance view','CENTRE') ON CONFLICT(key) DO NOTHING");
    await pool.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE key='finance.read' ON CONFLICT DO NOTHING", [roleId]);
    await pool.query("INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id) VALUES($1,$2,$3,$4)", [organizationId, staffId, roleId, centreId]);
    ({ POST: postAuth } = await import("@/app/api/auth/[...all]/route"));
    ({ GET: financeHandler, POST: financePostHandler } = await import("@/app/api/finance/route"));
    ({ GET: reportsHandler } = await import("@/app/api/reports/route"));
    ({ GET: leadsHandler } = await import("@/app/api/leads/route"));
    ({ GET: appointmentsHandler } = await import("@/app/api/appointments/route"));
    ({ GET: ordersHandler } = await import("@/app/api/orders/route"));
    ({ GET: collectionsHandler } = await import("@/app/api/collections/route"));
    ({ GET: samplesHandler } = await import("@/app/api/samples/route"));
    ({ GET: branchHandler } = await import("@/app/api/branch/operations/route"));
    ({ GET: adminStaffHandler } = await import("@/app/api/admin/staff/route"));
    ({ getApiAccess } = await import("@/server/access"));
  }, 120_000);

  afterAll(async () => {
    try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* pool may not have initialized */ }
    await pool?.end();
    if (testUrl) { const admin = new Pool({ connectionString: testUrl, max: 1 }); await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
    if (priorEnvironment.databaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorEnvironment.databaseUrl;
    if (priorEnvironment.betterAuthUrl === undefined) delete process.env.BETTER_AUTH_URL; else process.env.BETTER_AUTH_URL = priorEnvironment.betterAuthUrl;
    if (priorEnvironment.betterAuthSecret === undefined) delete process.env.BETTER_AUTH_SECRET; else process.env.BETTER_AUTH_SECRET = priorEnvironment.betterAuthSecret;
  }, 60_000);

  const authPost = (path: string, body: Record<string, unknown>, cookie = "") => postAuth(new Request(`http://localhost:3000/api/auth/${path}`, { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
  const mergeCookies = (prior: string, response: Response) => {
    const values = new Map(prior.split(";").map(part => part.trim()).filter(Boolean).map(part => [part.slice(0, part.indexOf("=")), part.slice(part.indexOf("=") + 1)]));
    for (const setCookie of response.headers.getSetCookie()) { const pair = setCookie.split(";", 1)[0]; const split = pair.indexOf("="); if (split > 0 && pair.slice(split + 1)) values.set(pair.slice(0, split), pair.slice(split + 1)); }
    return [...values].map(([key, value]) => `${key}=${value}`).join("; ");
  };
  const decodeBase32 = (value: string) => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = "";
    for (const char of value.toUpperCase().replace(/=+$/, "")) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
    const bytes: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
    return Buffer.from(bytes);
  };
  const totp = (secret: string) => {
    const counter = BigInt(Math.floor(Date.now() / 30_000)); const value = Buffer.alloc(8); value.writeBigUInt64BE(counter);
    const digest = createHmac("sha1", decodeBase32(secret)).update(value).digest(); const offset = digest[digest.length - 1] & 15;
    return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
  };

  it("issues a real session, requires verified TOTP, enforces scoped permissions, and rejects signed-out/expired sessions", async () => {
    const anonymous = await getApiAccess("finance.read", centreId);
    expect(anonymous.response?.status).toBe(401);

    const signIn = await authPost("sign-in/email", { email, password, rememberMe: false });
    expect(signIn.status).toBe(200);
    let cookie = mergeCookies("", signIn);
    expect(cookie).toContain("rudra.session_token=");
    mocks.headers = new Headers({ cookie });
    expect((await getApiAccess("finance.read", centreId)).response?.status).toBe(428);

    const enroll = await authPost("two-factor/enable", { password }, cookie);
    expect(enroll.status).toBe(200);
    const enrollBody = await enroll.json() as { totpURI: string; method: string };
    expect(enrollBody.method).toBe("totp");
    const secret = new URL(enrollBody.totpURI).searchParams.get("secret");
    expect(secret).toBeTruthy();
    const verified = await authPost("two-factor/verify-totp", { code: totp(secret!) }, cookie);
    expect(verified.status).toBe(200);
    cookie = mergeCookies(cookie, verified);
    mocks.headers = new Headers({ cookie });
    const currentSession = await pool.query('SELECT s.token,s."mfaVerifiedAt",u."twoFactorEnabled",tf.verified FROM "session" s JOIN "user" u ON u.id=s."userId" JOIN "twoFactor" tf ON tf."userId"=u.id WHERE u.email=$1 ORDER BY s."createdAt" DESC LIMIT 1', [email]);
    expect(currentSession.rows[0]).toMatchObject({ twoFactorEnabled: true, verified: true });
    expect(currentSession.rows[0].mfaVerifiedAt).toBeInstanceOf(Date);
    expect((await getApiAccess("finance.read", centreId)).response).toBeNull();
    expect((await financeHandler(new Request(`http://localhost:3000/api/finance?centreId=${centreId}`, { headers: { cookie } }))).status).toBe(200);
    expect((await getApiAccess("finance.read", otherCentreId)).response?.status).toBe(403);
    expect((await getApiAccess("staff.read", centreId)).response?.status).toBe(403);
    expect((await getApiAccess("collections.visit.record", centreId)).response?.status).toBe(403);
    for (const [handler, url] of [
      [leadsHandler, `http://localhost:3000/api/leads?centreId=${centreId}`],
      [appointmentsHandler, `http://localhost:3000/api/appointments?centreId=${centreId}`],
      [ordersHandler, `http://localhost:3000/api/orders?centreId=${centreId}`],
      [collectionsHandler, `http://localhost:3000/api/collections?centreId=${centreId}`],
      [samplesHandler, `http://localhost:3000/api/samples?centreId=${centreId}`],
      [branchHandler, "http://localhost:3000/api/branch/operations"],
      [adminStaffHandler, "http://localhost:3000/api/admin/staff"],
    ] as const) {
      expect((await handler(new Request(url, { headers: { cookie } }))).status).toBe(403);
    }
    const reportDenied = await reportsHandler(new Request("http://localhost:3000/api/reports"));
    expect(reportDenied.status).toBe(403);
    const csrfDenied = await financePostHandler(new Request("http://localhost:3000/api/finance", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ action: "billing_policy", centreId, chargeType: "DIAGNOSTIC", issuer: "RUDRA" }) }));
    expect(csrfDenied.status).toBe(403);

    const signOut = await authPost("sign-out", {}, cookie);
    expect(signOut.status).toBe(200);
    mocks.headers = new Headers({ cookie });
    expect((await getApiAccess("finance.read", centreId)).response?.status).toBe(401);
    expect((await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE actor_staff_id=$1 AND action='staff.session.signed_out'", [staffId])).rows[0].count).toBeGreaterThan(0);

    const secondSignIn = await authPost("sign-in/email", { email, password, rememberMe: false });
    expect(secondSignIn.status).toBe(200);
    cookie = mergeCookies("", secondSignIn);
    mocks.headers = new Headers({ cookie });
    const factorChallenge = await getApiAccess("finance.read", centreId);
    expect([401, 428]).toContain(factorChallenge.response?.status);
    const secondVerified = await authPost("two-factor/verify-totp", { code: totp(secret!) }, cookie);
    expect(secondVerified.status).toBe(200);
    cookie = mergeCookies(cookie, secondVerified);
    mocks.headers = new Headers({ cookie });
    const latestSession = await pool.query('SELECT token FROM "session" s JOIN "user" u ON u.id=s."userId" WHERE u.email=$1 ORDER BY s."createdAt" DESC LIMIT 1', [email]);
    const token = latestSession.rows[0].token as string;
    await pool.query('UPDATE "session" SET "expiresAt"=now()-interval \'1 second\' WHERE token=$1', [token]);
    expect((await getApiAccess("finance.read", centreId)).response?.status).toBe(401);
  }, 60_000);
});
