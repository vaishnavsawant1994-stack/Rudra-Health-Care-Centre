import { createHmac } from "node:crypto";
import pg from "pg";
import { expect, test } from "@playwright/test";

const { Pool } = pg;
const decodeBase32 = (value: string) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of value.toUpperCase().replace(/=+$/, "")) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
};
const totp = (secret: string) => {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
};

test("O015 organization audit reviewer searches only authorized audit history", async ({ page }) => {
  const email = process.env.AUDIT_REVIEWER_BROWSER_EMAIL;
  const password = process.env.AUDIT_REVIEWER_BROWSER_PASSWORD;
  const databaseUrl = process.env.DATABASE_TEST_URL;
  const centreId = process.env.FINANCE_BROWSER_CENTRE_ID;
  expect(email && password && databaseUrl && centreId).toBeTruthy();
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await page.goto("/staff");
    await page.getByLabel("Work email").fill(email!);
    await page.getByLabel("Password", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "Sign in securely" }).click();
    await expect(page).toHaveURL(/\/staff\/security-setup$/);
    await page.getByLabel("Account password").fill(password!);
    const enrollmentResponse = page.waitForResponse(response => response.request().method() === "POST" && response.url().includes("/api/auth/two-factor/enable"));
    await page.getByRole("button", { name: "Begin authenticator setup" }).click();
    const enrollment = await (await enrollmentResponse).json() as { totpURI: string; method: string };
    expect(enrollment.method).toBe("totp");
    const secret = new URL(enrollment.totpURI).searchParams.get("secret");
    expect(secret).toBeTruthy();
    if (Date.now() % 30_000 > 27_000) await page.waitForTimeout(3_000);
    await page.getByLabel("Current six-digit authenticator code").fill(totp(secret!));
    await page.getByRole("button", { name: "Verify and finish setup" }).click();
    await expect(page).toHaveURL(/\/staff\/workspace$/);

    await page.goto("/manage/audit");
    await expect(page.getByRole("heading", { name: "Authorized audit events" })).toBeVisible({ timeout: 8_000 });
    const initialAudit = await page.evaluate(async () => {
      const response = await fetch("/api/admin/audit?page=1", { cache: "no-store" });
      return { status: response.status, body: await response.json() as { events: Array<{ action: string; centreId: string | null }> } };
    });
    expect(initialAudit.status).toBe(200);
    expect(initialAudit.body.events.length).toBeGreaterThan(0);

    const sourceEvent = await pool.query("SELECT action FROM audit_events WHERE centre_id=$1 ORDER BY sequence DESC LIMIT 1", [centreId]);
    expect(sourceEvent.rowCount).toBe(1);
    const action = sourceEvent.rows[0].action as string;
    await page.getByLabel("Action").fill(action);
    const filteredResponsePromise = page.waitForResponse(response => {
      const url = new URL(response.url());
      return response.request().method() === "GET" && url.pathname === "/api/admin/audit" && url.searchParams.get("action") === action;
    });
    await page.getByRole("button", { name: "Apply filters" }).click();
    const filteredResponse = await filteredResponsePromise;
    expect(filteredResponse.status()).toBe(200);
    const filtered = await filteredResponse.json() as { events: Array<{ action: string; centreId: string | null }> };
    expect(filtered.events.length).toBeGreaterThan(0);
    expect(filtered.events.every(event => event.action === action && event.centreId === centreId)).toBe(true);
    await expect(page.locator(".admin-table tbody tr").filter({ hasText: action })).toBeVisible({ timeout: 10_000 });

    const otherCentreId = process.env.FINANCE_BROWSER_READ_ONLY_CENTRE_ID;
    expect(otherCentreId).toBeTruthy();
    const otherCentreResponse = await page.evaluate(async (id) => {
      const response = await fetch(`/api/admin/audit?centreId=${encodeURIComponent(id!)}&page=1`, { cache: "no-store" });
      return { status: response.status, body: await response.json() as { events: Array<{ centreId: string | null }> } };
    }, otherCentreId!);
    expect(otherCentreResponse.status).toBe(200);
    expect(otherCentreResponse.body.events.every(event => event.centreId === otherCentreId)).toBe(true);
  } finally {
    await pool.end();
  }
});
