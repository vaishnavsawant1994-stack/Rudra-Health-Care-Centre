import { describe, expect, it } from "vitest";
import { postSignInRoute } from "./login-policy";

describe("post-sign-in routing", () => {
  it("routes a Better Auth two-factor challenge to verification", () => {
    expect(postSignInRoute({ twoFactorRedirect: true, twoFactorEnabled: true })).toBe("/staff/two-factor");
  });

  it("fails closed if MFA is enabled but Better Auth did not issue a challenge", () => {
    expect(postSignInRoute({ twoFactorRedirect: false, twoFactorEnabled: true })).toBeNull();
  });

  it("requires TOTP enrollment before any un-enrolled account can continue", () => {
    expect(postSignInRoute({ twoFactorRedirect: false, twoFactorEnabled: false })).toBe("/staff/security-setup");
  });
});
