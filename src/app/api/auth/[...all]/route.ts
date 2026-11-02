import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/db/client";
import { staffUsers } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { eq } from "drizzle-orm";
import { withoutTrustedDeviceCookie } from "@/server/mfa-policy";
import { authSession } from "@/db/auth-schema";

function safeAuthFailure(error: unknown) {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const cause = value.cause && typeof value.cause === "object" ? value.cause as Record<string, unknown> : {};
  const body = value.body && typeof value.body === "object" ? value.body as Record<string, unknown> : {};
  const safeToken = (candidate: unknown) => typeof candidate === "string" && /^[A-Za-z0-9_-]{1,48}$/.test(candidate) ? candidate : undefined;
  return {
    errorType: safeToken(value.name) ?? "UnknownError",
    errorCode: safeToken(value.code) ?? safeToken(body.code) ?? safeToken(cause.code),
    status: Number.isInteger(value.status) ? value.status : Number.isInteger(value.statusCode) ? value.statusCode : undefined,
    table: safeToken(value.table) ?? safeToken(cause.table),
    column: safeToken(value.column) ?? safeToken(cause.column),
    constraint: safeToken(value.constraint) ?? safeToken(cause.constraint),
  };
}

async function handle(request: Request) {
  const auth = getAuth();
  if (!auth) return Response.json({ error: "authentication_setup_required" }, { status: 503 });
  try {
    const handlers = toNextJsHandler(auth);
    const isLogout = request.method === "POST" && new URL(request.url).pathname.endsWith("/sign-out");
    const sessionBeforeLogout = isLogout ? await auth.api.getSession({ headers: request.headers }) : null;
    const authRequest = withoutTrustedDeviceCookie(request);
    const response = request.method === "GET" ? await handlers.GET(authRequest) : await handlers.POST(authRequest);
    const path = new URL(request.url).pathname;
    const completedMfaVerification = request.method === "POST"
      && (path.endsWith("/two-factor/verify-totp") || path.endsWith("/two-factor/verify-backup-code"));
    if (completedMfaVerification && response.ok) {
      const cookieHeader = response.headers.getSetCookie()
        .map((cookie) => cookie.split(";", 1)[0])
        .filter((cookie) => {
          const equals = cookie.indexOf("=");
          return equals > 0 && cookie.slice(equals + 1).length > 0;
        })
        .join("; ");
      const completedSession = (cookieHeader
        ? await auth.api.getSession({ headers: new Headers({ cookie: cookieHeader }) })
        : null) ?? await auth.api.getSession({ headers: request.headers });
      if (!completedSession) return Response.json({ error: "mfa_session_verification_failed" }, { status: 503 });
      const db = getDb();
      try {
        const [updated] = await db.update(authSession)
          .set({ mfaVerifiedAt: new Date() })
          .where(eq(authSession.id, completedSession.session.id))
          .returning({ id: authSession.id });
        if (!updated) throw new Error("session_proof_not_written");
      } catch {
        await db.delete(authSession).where(eq(authSession.id, completedSession.session.id)).catch(() => undefined);
        return Response.json({ error: "mfa_session_verification_failed" }, { status: 503 });
      }
    }
    if (isLogout && response.ok && sessionBeforeLogout) {
      const db = getDb();
      const [staff] = await db.select({ id: staffUsers.id, organizationId: staffUsers.organizationId }).from(staffUsers).where(eq(staffUsers.authUserId, sessionBeforeLogout.user.id)).limit(1);
      if (staff) await appendAuditEvent(db, { organizationId: staff.organizationId, actorStaffId: staff.id, action: "staff.session.signed_out", entityType: "session", entityId: sessionBeforeLogout.session.id, details: { source: "user_action" } });
    }
    return response;
  } catch (error) {
    console.error("[rudra-auth] request failed", safeAuthFailure(error));
    return Response.json({ error: "authentication_unavailable" }, { status: 503 });
  }
}

export const GET = handle;
export const POST = handle;
