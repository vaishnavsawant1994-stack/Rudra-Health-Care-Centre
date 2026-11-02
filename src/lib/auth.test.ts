import { describe, expect, it, vi } from "vitest";
import { AUTH_ID_GENERATOR, PASSWORD_AUTH_POLICY, PASSWORD_POLICY, REDACTED_AUTH_LOGGER, secureCookiePolicy, STAFF_SESSION_POLICY, TWO_FACTOR_ENFORCEMENT_POLICY } from "./auth";
import { isMfaSessionAuthorized, withoutTrustedDeviceCookie } from "@/server/mfa-policy";

describe("local password and authenticator policy", () => {
  it("requires 2FA enrollment before privileged access can be considered", () => {
    expect(isMfaSessionAuthorized(false, false, null)).toBe(false);
    expect(isMfaSessionAuthorized(true, false, new Date())).toBe(false);
    expect(isMfaSessionAuthorized(false, true, new Date())).toBe(false);
    expect(isMfaSessionAuthorized(true, true, null)).toBe(false);
    expect(isMfaSessionAuthorized(true, true, new Date())).toBe(true);
  });

  it("sets a bounded password policy", () => {
    expect(PASSWORD_POLICY).toEqual({ minPasswordLength: 12, maxPasswordLength: 128 });
    expect(PASSWORD_AUTH_POLICY).toMatchObject({ enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128, autoSignIn: false });
  });

  it("uses HttpOnly SameSite cookies and only relaxes Secure for localhost", () => {
    expect(secureCookiePolicy("http://localhost:3000")).toEqual({ httpOnly: true, sameSite: "lax", secure: false, path: "/" });
    expect(secureCookiePolicy("https://rudra.example").secure).toBe(true);
    expect(secureCookiePolicy("http://rudra.example").secure).toBe(true);
  });

  it("sets bounded database-backed session lifetimes", () => {
    expect(STAFF_SESSION_POLICY).toEqual({ expiresIn: 28800, updateAge: 600, freshAge: 600 });
  });

  it("does not grant trusted devices and strips existing trust cookies before auth processing", () => {
    expect(TWO_FACTOR_ENFORCEMENT_POLICY).toEqual({ trustDeviceMaxAge: 0, skipVerificationOnEnable: false });
    const request = new Request("http://localhost:3000/api/auth/sign-in/email", { headers: { cookie: "rudra.session_token=session; rudra.trust_device=stale; other=kept" } });
    const sanitized = withoutTrustedDeviceCookie(request);
    expect(sanitized.headers.get("cookie")).toBe("rudra.session_token=session; other=kept");
  });

  it("redacts Better Auth error details instead of logging request or database values", () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    REDACTED_AUTH_LOGGER.log("error", "synthetic-secret-session-token");
    expect(errorLog).toHaveBeenCalledWith("[Better Auth] Internal authentication error (details redacted)." );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("synthetic-secret-session-token");
    errorLog.mockRestore();
  });

  it("generates UUID strings for text-backed Better Auth records", () => {
    expect(AUTH_ID_GENERATOR()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
