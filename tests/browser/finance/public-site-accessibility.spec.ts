import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test } from "@playwright/test";

const viewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

for (const viewport of viewports) {
  test(`public homepage landmarks, layout and keyboard navigation at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");

    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Diagnostic Care, With Clear Next Steps" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    if (viewport.width <= 760) {
      await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeHidden();
      const menu = page.getByRole("button", { name: "Open navigation menu" });
      await menu.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "Close navigation menu" })).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Tests", exact: true })).toBeVisible();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Open navigation menu" })).toHaveAttribute("aria-expanded", "false");
    } else {
      await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Tests", exact: true })).toBeVisible();
      await page.keyboard.press("Tab");
      await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Rudra Health Care Centre home");
    }
  });
}

test("public enquiry forms validate contact and persist synthetic topic requests at each viewport", async ({ page }) => {
  test.setTimeout(120_000);
  const centreId = process.env.FINANCE_BROWSER_CENTRE_ID;
  const databaseUrl = process.env.DATABASE_TEST_URL;
  expect(centreId && databaseUrl).toBeTruthy();
  const database = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const topics = [
    { route: "/contact", topic: "GENERAL", organization: false },
    { route: "/corporate", topic: "CORPORATE", organization: true },
    { route: "/doctors", topic: "DOCTOR", organization: true },
    { route: "/partners", topic: "PARTNER", organization: true },
  ] as const;

  try {
    for (const topic of topics) {
      for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const response = await page.goto(topic.route);
        expect(response?.status(), `${topic.route} renders at ${viewport.name}`).toBe(200);
        const form = page.locator("form.public-enquiry-form");
        await expect(form).toBeVisible();
        await form.getByLabel("Centre").selectOption(centreId!);
        const suffix = randomUUID().slice(0, 8);
        const email = `public-${topic.topic.toLowerCase()}-${suffix}@invalid.test`;
        const phone = `+1555${String(Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 7), 16) % 10_000_000).padStart(7, "0")}`;
        await form.getByLabel("First name").fill("Synthetic Public");
        await form.getByLabel("Last name").fill(`Enquiry ${suffix}`);
        if (topic.organization) await form.getByLabel("Organization or practice name (optional)").fill(`Synthetic ${topic.topic} organization ${suffix}`);
        await form.getByLabel("How can we help?").fill(`Synthetic ${topic.topic.toLowerCase()} enquiry for staff review ${suffix}.`);

        let publicPosts = 0;
        const countPublicPosts = (request: import("@playwright/test").Request) => {
          if (request.method() === "POST" && new URL(request.url()).pathname === "/api/public/enquiries") publicPosts += 1;
        };
        page.on("request", countPublicPosts);
        await form.getByRole("button", { name: "Send enquiry" }).click();
        await expect(form.getByRole("status")).toContainText("Enter either a phone number or email address");
        expect(publicPosts, "missing contact information is rejected before an API request").toBe(0);
        if (viewport.name === "tablet") await form.getByLabel("Email (provide phone or email)").fill(email);
        else await form.getByLabel("Phone (provide phone or email)").fill(phone);

        const submissionRequest = page.waitForRequest(request =>
          request.method() === "POST" && new URL(request.url()).pathname === "/api/public/enquiries",
        );
        const submissionResponse = page.waitForResponse(response =>
          response.request().method() === "POST" && new URL(response.url()).pathname === "/api/public/enquiries",
        );
        const submitButton = form.getByRole("button", { name: "Send enquiry" });
        await submitButton.focus();
        await page.keyboard.press("Enter");
        const [request, savedResponse] = await Promise.all([submissionRequest, submissionResponse]);
        const posted = request.postDataJSON() as Record<string, unknown>;
        expect(posted).toMatchObject({ requestTopic: topic.topic, requestKind: "INQUIRY", responsePermission: false });
        expect(Boolean(posted.email) !== Boolean(posted.phone), "either contact method is accepted without requiring both").toBe(true);
        expect(savedResponse.status(), `${topic.route} submits via the public enquiry API`).toBe(202);
        const receipt = await savedResponse.json() as { accepted: boolean; receiptId: string };
        expect(receipt.accepted).toBe(true);
        await expect(page.getByRole("heading", { name: "Enquiry received for staff review" })).toBeVisible();
        await expect(page.getByText(email)).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

        const stored = await database.query(
          "SELECT status,centre_id,resulting_lead_id,private_data_ciphertext,(SELECT array_agg(event_type ORDER BY recorded_at,id) FROM public_enquiry_events WHERE enquiry_id=public_enquiries.id) AS event_types FROM public_enquiries WHERE id=$1",
          [receipt.receiptId],
        );
        expect(stored.rowCount).toBe(1);
        expect(stored.rows[0]).toMatchObject({ status: "PENDING_REVIEW", centre_id: centreId, resulting_lead_id: null, event_types: ["SUBMITTED"] });
        expect(stored.rows[0].private_data_ciphertext).not.toContain(email);
        expect(stored.rows[0].private_data_ciphertext).not.toContain(phone);
        page.off("request", countPublicPosts);
      }
    }
  } finally {
    await database.end();
  }
});
