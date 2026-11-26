import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

function currentTotp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = secret.toUpperCase().replace(/=+$/, "");
  let bits = "";
  for (const char of cleaned) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error("invalid_browser_totp_fixture");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

const identities = [
  { key: "OWNER", finance: 200, leads: 200, collections: 200, deniedCentre: 200 },
  { key: "MANAGER", finance: 200, leads: 200, collections: 200, deniedCentre: 403 },
  { key: "RECEPTION", finance: 200, leads: 200, collections: 200, deniedCentre: 403 },
  { key: "COLLECTOR", finance: 403, leads: 403, collections: 200, deniedCentre: 403 },
  { key: "BRANCH", finance: 403, leads: 403, collections: 200, deniedCentre: 403 },
  { key: "RESTRICTED", finance: 403, leads: 403, collections: 403, deniedCentre: 403 },
] as const;

// Multiple synthetic accounts share the same CI IP and application rate limiter.
// A 429 is verified and retried after the real limit window, never bypassed.

for (const identity of identities) {
  test("real MFA " + identity.key + " sign-in enforces role and centre permissions", async ({ page }) => {
    const email = process.env["ROLE_BROWSER_" + identity.key + "_EMAIL"];
    const password = process.env["ROLE_BROWSER_" + identity.key + "_PASSWORD"];
    const centreId = process.env.FINANCE_BROWSER_CENTRE_ID;
    const otherCentreId = process.env.FINANCE_BROWSER_DENIED_CENTRE_ID;
    expect(email && password && centreId && otherCentreId).toBeTruthy();

    await page.goto("/staff");
    await page.getByLabel("Work email").fill(email!);
    await page.getByLabel("Password", { exact: true }).fill(password!);
    const signInResponse = page.waitForResponse(response =>
      response.request().method() === "POST" && response.url().includes("/api/auth/sign-in/email"),
    );
    await page.getByRole("button", { name: "Sign in securely" }).click();
    let signInStatus = (await signInResponse).status();
    if (signInStatus === 429) {
      // Better Auth intentionally limits sign-in attempts from the shared CI IP.
      // Respect that production security control; retry only after its window.
      await expect(page.getByRole("alert")).toBeVisible();
      await page.waitForTimeout(65_000);
      const retryResponse = page.waitForResponse(response =>
        response.request().method() === "POST" && response.url().includes("/api/auth/sign-in/email"),
      );
      await page.getByRole("button", { name: "Sign in securely" }).click();
      signInStatus = (await retryResponse).status();
    }
    expect(signInStatus, identity.key + " authenticates after the permitted rate-limit window").toBe(200);
    await expect(page).toHaveURL(/\/staff\/security-setup$/);

    await page.getByLabel("Account password").fill(password!);
    const enrollResponse = page.waitForResponse(response =>
      response.request().method() === "POST" && response.url().includes("/api/auth/two-factor/enable"),
    );
    await page.getByRole("button", { name: "Begin authenticator setup" }).click();
    const enrollment = await (await enrollResponse).json() as { method: string; totpURI: string };
    expect(enrollment.method).toBe("totp");
    const secret = new URL(enrollment.totpURI).searchParams.get("secret");
    expect(secret).toBeTruthy();
    // Keep a freshly computed code away from a TOTP boundary.
    if (Date.now() % 30_000 > 27_000) await page.waitForTimeout(3_000);
    await page.getByLabel("Current six-digit authenticator code").fill(currentTotp(secret!));
    await page.getByRole("button", { name: "Verify and finish setup" }).click();
    await expect(page).toHaveURL(/\/staff\/workspace$/);

    const [finance, leads, collections, otherCentreFinance] = await Promise.all([
      page.request.get("/api/finance?centreId=" + centreId),
      page.request.get("/api/leads?centreId=" + centreId),
      page.request.get("/api/collections?centreId=" + centreId),
      page.request.get("/api/finance?centreId=" + otherCentreId),
    ]);
    expect(finance.status(), identity.key + " finance access").toBe(identity.finance);
    expect(leads.status(), identity.key + " CRM access").toBe(identity.leads);
    expect(collections.status(), identity.key + " collection access").toBe(identity.collections);
    expect(otherCentreFinance.status(), identity.key + " other-centre finance access").toBe(identity.deniedCentre);
  });
}
