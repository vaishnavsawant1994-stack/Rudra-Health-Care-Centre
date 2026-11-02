import { describe, expect, it } from "vitest";
import { parseTotpUri } from "./totp-uri";

describe("TOTP provisioning URI validation", () => {
  it("accepts a valid otpauth TOTP URI and returns its Base32 secret", () => {
    const uri = "otpauth://totp/Rudra%20Health%20Care%20Centre:owner?secret=JBSWY3DPEHPK3PXP&issuer=Rudra%20Health%20Care%20Centre";
    expect(parseTotpUri(uri)).toEqual({ uri, secret: "JBSWY3DPEHPK3PXP" });
  });

  it("rejects malformed, non-TOTP, and non-Base32 provisioning URIs", () => {
    expect(parseTotpUri("not a uri")).toBeNull();
    expect(parseTotpUri("otpauth://hotp/account?secret=JBSWY3DPEHPK3PXP")).toBeNull();
    expect(parseTotpUri("otpauth://totp/account?secret=invalid0secret")).toBeNull();
  });
});
