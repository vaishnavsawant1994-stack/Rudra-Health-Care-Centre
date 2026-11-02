import { afterEach, describe, expect, it, vi } from "vitest";
import { createOTP } from "@better-auth/utils/otp";

describe("synthetic authenticator code verification", () => {
  afterEach(() => vi.useRealTimers());

  it("accepts the current code and rejects an incorrect code", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T10:00:00.000Z"));
    const otp = createOTP(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    const currentCode = await otp.totp();

    expect(await otp.verify(currentCode, { window: 0 })).toBe(true);
    expect(await otp.verify("000000", { window: 0 })).toBe(false);
  });

  it("rejects an expired code when no clock-drift window is allowed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T10:00:00.000Z"));
    const otp = createOTP(new Uint8Array([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]));
    const expiredCode = await otp.totp();
    vi.setSystemTime(new Date("2026-10-28T10:02:00.000Z"));

    expect(await otp.verify(expiredCode, { window: 0 })).toBe(false);
  });
});
