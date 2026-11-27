import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test } from "@playwright/test";

// The manager session is captured only in memory after a real password + MFA
// login. The later same-journey staff actions reuse that authenticated session;
// no password, TOTP seed, or session state is written to disk or CI artifacts.
let managerStorageState: Awaited<ReturnType<import("@playwright/test").BrowserContext["storageState"]>> | undefined;
let syntheticAssignedJob: { id: string; number: string } | undefined;
let syntheticConfirmedOrder: { id: string; centreId: string } | undefined;

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
  { key: "FINANCE", finance: 200, leads: 403, collections: 403, deniedCentre: 403 },
  { key: "COLLECTOR", finance: 403, leads: 403, collections: 200, deniedCentre: 403 },
  { key: "BRANCH", finance: 403, leads: 403, collections: 200, deniedCentre: 403 },
  { key: "RESTRICTED", finance: 403, leads: 403, collections: 403, deniedCentre: 403 },
] as const;

// Multiple synthetic accounts share the same CI IP and application rate limiter.
// A 429 is verified and retried after the real limit window, never bypassed.

for (const identity of identities) {
  test("real MFA " + identity.key + " sign-in enforces role and centre permissions", async ({ page, browser }) => {
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
      await expect(page.locator(".auth-error")).toBeVisible();
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
    let enrollmentHttp = await enrollResponse;
    if (enrollmentHttp.status() === 429) {
      // Enrollment also has a server-enforced limiter. Never change the limiter
      // for CI; retry the same actual UI action after its window expires.
      await expect(page.locator(".auth-error")).toBeVisible();
      await page.waitForTimeout(65_000);
      const enrollmentRetry = page.waitForResponse(response =>
        response.request().method() === "POST" && response.url().includes("/api/auth/two-factor/enable"),
      );
      await page.getByRole("button", { name: "Begin authenticator setup" }).click();
      enrollmentHttp = await enrollmentRetry;
    }
    expect(enrollmentHttp.status(), identity.key + " MFA enrollment HTTP status").toBe(200);
    const enrollment = await enrollmentHttp.json() as { method: string; totpURI: string };
    expect(enrollment.method).toBe("totp");
    const secret = new URL(enrollment.totpURI).searchParams.get("secret");
    expect(secret).toBeTruthy();
    // Keep a freshly computed code away from a TOTP boundary.
    if (Date.now() % 30_000 > 27_000) await page.waitForTimeout(3_000);
    await page.getByLabel("Current six-digit authenticator code").fill(currentTotp(secret!));
    await page.getByRole("button", { name: "Verify and finish setup" }).click();
    await expect(page).toHaveURL(/\/staff\/workspace$/);
    if (identity.key === "MANAGER") managerStorageState = await page.context().storageState();

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
    if (identity.key === "FINANCE") {
      const privateEnquiryQueue = await page.request.get("/api/public/enquiries?centreId=" + centreId);
      expect(privateEnquiryQueue.status(), "finance-only staff cannot read private reception enquiries").toBe(403);
    }
    if (identity.key === "FINANCE" && syntheticConfirmedOrder) {
      const orderId = syntheticConfirmedOrder.id;
      await page.goto(`/finance/orders/${orderId}`);
      await expect(page.getByRole("heading", { name: "Order billing snapshot" })).toBeVisible();
      await expect(page.getByText("₹125.00 INR")).toBeVisible();
      await expect(page.getByText("Disabled pending policy approval")).toBeVisible();
      const chargeSave = page.waitForResponse(response =>
        response.request().method() === "POST" && new URL(response.url()).pathname === "/api/finance",
      );
      await page.getByRole("button", { name: "Create internal charge snapshot" }).click();
      expect((await chargeSave).status(), "finance staff creates only an internal charge snapshot").toBe(201);
      await expect(page.locator("section[aria-labelledby='order-billing-heading']").getByRole("status")).toContainText("No legal invoice was issued.");
      const financePool = new pg.Pool({ connectionString: process.env.DATABASE_TEST_URL, max: 1 });
      try {
        const records = await financePool.query(
          "SELECT c.amount_minor::text AS amount,c.state,c.snapshot->>'legalInvoice' AS legal_invoice,(SELECT count(*)::int FROM finance_payments p WHERE p.organization_id=c.organization_id AND p.centre_id=c.centre_id AND EXISTS (SELECT 1 FROM finance_allocations a WHERE a.payment_id=p.id AND a.charge_id=c.id)) AS payments,(SELECT count(*)::int FROM audit_events a WHERE a.entity_id=c.order_id::text AND a.action='finance.order_charges_created') AS audit_count FROM finance_charges c WHERE c.order_id=$1 AND c.centre_id=$2 AND c.charge_type='DIAGNOSTIC'",
          [orderId, syntheticConfirmedOrder.centreId],
        );
        expect(records.rowCount).toBe(1);
        expect(records.rows[0]).toMatchObject({ amount: "12500", state: "ACTIVE", legal_invoice: "false", payments: 0, audit_count: 1 });
        const ledger = await page.request.get(`/api/finance?orderId=${orderId}`);
        expect(ledger.status()).toBe(200);
        const ledgerBody = await ledger.json() as { charges: Array<{ amountMinor: string; paidMinor: string; orderId: string }> };
        expect(ledgerBody.charges).toContainEqual(expect.objectContaining({ orderId, amountMinor: "12500", paidMinor: "0" }));
      } finally {
        await financePool.end();
      }
    }
    if (identity.key === "COLLECTOR" && syntheticAssignedJob) {
      const assignedQueue = await page.request.get(`/api/collections?centreId=${centreId}&assignedToMe=1`);
      expect(assignedQueue.status(), "collector reads only the permitted assigned queue").toBe(200);
      const queueBody = await assignedQueue.json() as { jobs: Array<{ id: string; jobNumber: string }> };
      expect(queueBody.jobs).toContainEqual(expect.objectContaining({ id: syntheticAssignedJob.id, jobNumber: syntheticAssignedJob.number }));
      await page.goto(`/field/jobs/${syntheticAssignedJob.id}`);
      // The job number is rendered as the detail card's eyebrow; the heading
      // describes the current status. Assert the actual semantic element.
      await expect(page.getByText(syntheticAssignedJob.number)).toBeVisible();
      await expect(page.getByRole("button", { name: "Accept assignment" })).toBeVisible();
      // Stop at the assigned job. No arrival, identity claim, collection,
      // custody or branch receipt is recorded while consent is absent and no
      // active collection procedure exists in this synthetic centre.
    }
    if (identity.key === "RECEPTION") {
      test.setTimeout(180_000);
      // Public visitor -> real booking request -> authenticated receptionist
      // review. The public catalogue fixture is published only in the
      // disposable CI database; this does not publish a real service/price.
      const publicItemId = process.env.FINANCE_BROWSER_PUBLIC_BOOKING_CATALOGUE_ITEM_ID;
      expect(publicItemId).toBeTruthy();
      const publicContext = await browser.newContext({ baseURL: "http://127.0.0.1:3000", viewport: { width: 390, height: 844 } });
      try {
        const publicPage = await publicContext.newPage();
        await publicPage.goto("/book");
        await publicPage.getByLabel("Centre").selectOption(centreId!);
        const publicService = publicPage.getByLabel(/Synthetic public booking browser item/);
        await expect(publicService).toBeVisible();
        await expect.poll(() => publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await publicService.check();
        const publicFirstName = "Synthetic Public " + randomUUID().slice(0, 8);
        const publicLastName = "Booking";
        const publicEmail = "public-booking-" + randomUUID().slice(0, 8) + "@invalid.test";
        const publicPhone = "+1555" + String(Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 7), 16) % 10_000_000).padStart(7, "0");
        const preferredDate = new Date(Date.now() + 24 * 60 * 60 * 1000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
        await publicPage.getByLabel("First name").fill(publicFirstName);
        await publicPage.getByLabel("Last name").fill(publicLastName);
        await publicPage.getByLabel("Mobile number").fill(publicPhone);
        await publicPage.getByLabel("Email address").fill(publicEmail);
        await publicPage.getByLabel("Preferred date").fill(preferredDate);
        await publicPage.getByRole("checkbox", { name: /Rudra staff may contact me about this specific request/ }).check();
        const reviewRequest = publicPage.getByRole("button", { name: /Review request/ });
        await reviewRequest.focus();
        await publicPage.keyboard.press("Enter");
        await expect(publicPage).toHaveURL(/\/book\/review$/);
        await expect(publicPage.getByRole("heading", { name: "Not a confirmed booking" })).toBeVisible();
        await expect(publicPage.getByText(/It does not create an appointment, reserve a time, authorize a fee, or submit a payment/)).toBeVisible();
        await expect.poll(() => publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const submitRequest = publicPage.getByRole("button", { name: "Send request for staff review" });
        const publicSubmission = publicPage.waitForResponse(response =>
          response.request().method() === "POST" && new URL(response.url()).pathname === "/api/public/enquiries",
        );
        await submitRequest.focus();
        await publicPage.keyboard.press("Enter");
        const publicSubmissionResponse = await publicSubmission;
        expect(publicSubmissionResponse.status(), "anonymous visitor submits a public booking enquiry").toBe(202);
        const publicReceipt = await publicSubmissionResponse.json() as { accepted: boolean; reference: string; receiptId: string };
        expect(publicReceipt.accepted).toBe(true);
        expect(publicReceipt.receiptId).toMatch(/^[0-9a-f-]{36}$/i);
        await expect(publicPage).toHaveURL(new RegExp("/booking/success/" + publicReceipt.receiptId));
        await expect(publicPage.getByRole("heading", { name: "Enquiry received for staff review" })).toBeVisible();
        await expect(publicPage.getByRole("heading", { name: "This is not an appointment confirmation." })).toBeVisible();
        await expect(publicPage.getByText(publicEmail)).toHaveCount(0);
        await expect(publicPage.getByText(publicPhone)).toHaveCount(0);

        const publicPool = new pg.Pool({ connectionString: process.env.DATABASE_TEST_URL, max: 1 });
        let enquiryNumber = "";
        try {
          const saved = await publicPool.query(
            "SELECT e.enquiry_number,e.status,e.centre_id,e.private_data_ciphertext,e.resulting_lead_id,array(SELECT h.event_type FROM public_enquiry_events h WHERE h.enquiry_id=e.id ORDER BY h.recorded_at,h.id) AS event_types FROM public_enquiries e WHERE e.id=$1",
            [publicReceipt.receiptId],
          );
          expect(saved.rowCount).toBe(1);
          expect(saved.rows[0]).toMatchObject({ status: "PENDING_REVIEW", centre_id: centreId, resulting_lead_id: null, event_types: ["SUBMITTED"] });
          enquiryNumber = saved.rows[0].enquiry_number as string;
          expect(saved.rows[0].private_data_ciphertext).not.toContain(publicFirstName);
          expect(saved.rows[0].private_data_ciphertext).not.toContain(publicEmail);
          expect(saved.rows[0].private_data_ciphertext).not.toContain(publicPhone);
        } finally {
          await publicPool.end();
        }

        await page.goto("/leads/public-enquiries");
        const reviewCard = page.locator("article.public-enquiry-item").filter({ hasText: enquiryNumber });
        await expect(reviewCard).toBeVisible();
        await expect(reviewCard).toContainText("BOOKING REQUEST");
        await expect(reviewCard).toContainText("NOT CONFIRMED");
        await expect(reviewCard).toContainText("Synthetic public booking browser item");
        await expect(reviewCard).toContainText(preferredDate);
        await expect(reviewCard).toContainText("Requested; contact permission remains pending staff review");
        await expect(reviewCard.getByLabel("Assign new CRM lead to")).toHaveCount(0);
        await expect(reviewCard.getByRole("button", { name: "Create CRM lead" })).toBeVisible();
        const publicReview = page.waitForResponse(response =>
          response.request().method() === "PATCH" && new URL(response.url()).pathname === "/api/public/enquiries",
        );
        await reviewCard.getByRole("button", { name: "Create CRM lead" }).click();
        const publicReviewResponse = await publicReview;
        expect(publicReviewResponse.status(), "receptionist reviews the public request into the CRM").toBe(200);
        const publicReviewBody = await publicReviewResponse.json() as { status: string; leadId: string; leadNumber: string };
        expect(publicReviewBody.status).toBe("CONVERTED_TO_LEAD");
        expect(publicReviewBody.leadId).toBeTruthy();
        await expect(page.getByRole("status")).toContainText("Enquiry converted to " + publicReviewBody.leadNumber);

        const reviewPool = new pg.Pool({ connectionString: process.env.DATABASE_TEST_URL, max: 1 });
        try {
          const result = await reviewPool.query(
            "SELECT e.status,e.reviewed_by_staff_id,e.resulting_lead_id,l.status AS lead_status,l.source,d.payload_ciphertext,array(SELECT h.event_type FROM public_enquiry_events h WHERE h.enquiry_id=e.id ORDER BY h.recorded_at,h.id) AS event_types,(SELECT count(*)::int FROM audit_events a WHERE a.entity_id=l.id AND a.action='public_enquiry.converted_to_lead') AS audit_count FROM public_enquiries e JOIN leads l ON l.id=e.resulting_lead_id AND l.organization_id=e.organization_id AND l.centre_id=e.centre_id JOIN lead_private_data d ON d.lead_id=l.id AND d.organization_id=l.organization_id AND d.centre_id=l.centre_id WHERE e.id=$1 AND l.id=$2",
            [publicReceipt.receiptId, publicReviewBody.leadId],
          );
          expect(result.rowCount).toBe(1);
          expect(result.rows[0]).toMatchObject({ status: "CONVERTED_TO_LEAD", resulting_lead_id: publicReviewBody.leadId, lead_status: "NEW", source: "WEBSITE", event_types: ["SUBMITTED", "CONVERTED_TO_LEAD"], audit_count: 1 });
          expect(result.rows[0].reviewed_by_staff_id).toBeTruthy();
          expect(result.rows[0].payload_ciphertext).not.toContain(publicEmail);
          expect(result.rows[0].payload_ciphertext).not.toContain(publicPhone);
        } finally {
          await reviewPool.end();
        }
      } finally {
        await publicContext.close();
      }

      // A connected real UI -> API -> PostgreSQL CRM creation journey, using
      // the MFA-authenticated receptionist rather than a test-only direct insert.
      const leadName = "Synthetic Reception " + randomUUID().slice(0, 8);
      const leadEmail = "reception-enquiry-" + randomUUID().slice(0, 8) + "@invalid.test";
      await page.goto("/leads/new");
      await expect(page.getByRole("button", { name: "Create lead" })).toBeVisible();
      await page.getByLabel("First name").fill("Synthetic");
      await page.getByLabel("Last name").fill(leadName);
      await page.getByRole("textbox", { name: "Email" }).fill(leadEmail);
      const create = page.waitForResponse(response =>
        response.request().method() === "POST" && new URL(response.url()).pathname === "/api/leads",
      );
      await page.getByRole("button", { name: "Create lead" }).click();
      const saved = await create;
      expect(saved.status(), "receptionist saved a real CRM record").toBe(201);
      const body = await saved.json() as { lead: { id: string; leadNumber: string } };
      expect(body.lead?.id).toBeTruthy();
      await expect(page.getByText("Lead created. Contact permission remains pending until documented.")).toBeVisible();
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_TEST_URL, max: 1 });
      try {
        const stored = await pool.query(
          "SELECT l.status, l.centre_id, d.payload_ciphertext FROM leads l JOIN lead_private_data d ON d.lead_id=l.id WHERE l.id=$1 AND l.organization_id=d.organization_id AND l.centre_id=d.centre_id",
          [body.lead.id],
        );
        expect(stored.rowCount).toBe(1);
        expect(stored.rows[0].status).toBe("NEW");
        expect(stored.rows[0].centre_id).toBe(centreId);
        expect(stored.rows[0].payload_ciphertext).not.toContain(leadEmail);
        const audit = await pool.query(
          "SELECT count(*)::int AS events FROM audit_events WHERE entity_id=$1 AND action LIKE 'lead.%'",
          [body.lead.id],
        );
        expect(audit.rows[0].events).toBeGreaterThan(0);
      } finally {
        await pool.end();
      }
      await page.getByRole("link", { name: /open Lead 360/ }).click();
      await expect(page).toHaveURL(new RegExp("/leads/" + body.lead.id + "$"));
      await expect(page.getByRole("heading", { name: "Synthetic " + leadName })).toBeVisible();

      // Continue the same synthetic record through qualified lead conversion
      // and a CRM-linked appointment request. Consent remains NOT_RECORDED and
      // the appointment remains REQUESTED: this is not identity proofing or a
      // confirmed slot.
      const stageForm = page.locator("form.admin-form").filter({ has: page.getByRole("heading", { name: "Update stage" }) });
      await stageForm.getByRole("combobox").selectOption("QUALIFIED");
      await stageForm.getByLabel("Reason", { exact: true }).fill("Synthetic browser workflow qualification");
      const qualify = page.waitForResponse(response =>
        response.request().method() === "PATCH" && new URL(response.url()).pathname === "/api/leads/" + body.lead.id,
      );
      await page.getByRole("button", { name: "Save stage" }).click();
      expect((await qualify).status(), "synthetic lead qualification persisted").toBe(200);

      await expect(page.getByRole("button", { name: "Convert", exact: true })).toBeEnabled();
      await page.getByLabel("Patient phone for new registration").fill("+15551234567");
      await page.getByLabel("Date of birth for new registration").fill("1990-01-01");
      const conversionResponse = page.waitForResponse(response =>
        response.request().method() === "POST" && new URL(response.url()).pathname === "/api/leads/" + body.lead.id + "/convert",
      );
      await page.getByRole("button", { name: "Convert", exact: true }).click();
      const conversionHttp = await conversionResponse;
      expect(conversionHttp.status(), "synthetic patient conversion persisted").toBe(200);
      const conversionBody = await conversionHttp.json() as { conversion: { patientId: string } };
      expect(conversionBody.conversion.patientId).toBeTruthy();
      await expect(page.getByRole("link", { name: "Create appointment request" })).toBeVisible();

      const conversionPool = new pg.Pool({ connectionString: process.env.DATABASE_TEST_URL, max: 1 });
      try {
        const conversionAudit = await conversionPool.query(
          "SELECT count(*)::int AS events FROM audit_events WHERE (entity_id=$1 AND action='lead.converted') OR (entity_id=$2 AND action='patient.registered')",
          [body.lead.id, conversionBody.conversion.patientId],
        );
        expect(conversionAudit.rows[0].events).toBe(2);
      } finally {
        await conversionPool.end();
      }

      await page.getByRole("link", { name: "Create appointment request" }).click();
      await expect(page).toHaveURL(/\/appointments\/new\?leadId=/);
      await expect(page.getByText(/Patient is fixed by this verified CRM conversion/)).toBeVisible();
      await page.getByLabel("Visit type").selectOption("HOME_COLLECTION");
      await page.getByLabel("Address", { exact: true }).fill("100 Synthetic Test Lane");
      await page.getByLabel("City", { exact: true }).fill("Test City");
      await page.getByLabel("State", { exact: true }).fill("Test State");
      await page.getByLabel("Postal code").fill("000000");
      await page.getByLabel("Preferred time window").fill("10:00-12:00 synthetic test window");
      await page.getByLabel(/Requested date and time/).fill("2099-05-10T10:00");
      await page.getByLabel("Requested tests/packages or service references").fill("Synthetic test workflow reference; pending catalogue verification");
      const appointmentResponse = page.waitForResponse(response =>
        response.request().method() === "POST" && new URL(response.url()).pathname === "/api/appointments",
      );
      await expect(page.getByRole("button", { name: "Create booking request" })).toBeEnabled();
      await page.getByRole("button", { name: "Create booking request" }).click();
      const appointmentHttp = await appointmentResponse;
      expect(appointmentHttp.status(), "CRM-linked appointment request saved").toBe(201);
      const appointmentBody = await appointmentHttp.json() as { appointment: { id: string; appointmentNumber: string; status: string } };
      expect(appointmentBody.appointment.status).toBe("REQUESTED");
      await expect(page.getByText("Booking request saved. Confirmation is still pending.")).toBeVisible();
      await page.goto("/appointments/" + appointmentBody.appointment.id);
      await expect(page.getByText("REQUESTED", { exact: true })).toBeVisible();
      const appointmentPool = new pg.Pool({ connectionString: process.env.DATABASE_TEST_URL, max: 1 });
      try {
        const persisted = await appointmentPool.query(
          "SELECT a.status, a.patient_id, a.lead_id, count(DISTINCT h.id)::int AS history_count, count(DISTINCT e.id)::int AS audit_count FROM appointments a LEFT JOIN appointment_status_history h ON h.appointment_id=a.id LEFT JOIN audit_events e ON e.entity_id=a.id::text AND e.action='appointment.created' WHERE a.id=$1 AND a.centre_id=$2 GROUP BY a.id",
          [appointmentBody.appointment.id, centreId],
        );
        expect(persisted.rowCount).toBe(1);
        expect(persisted.rows[0].status).toBe("REQUESTED");
        expect(persisted.rows[0].patient_id).toBe(conversionBody.conversion.patientId);
        expect(persisted.rows[0].lead_id).toBe(body.lead.id);
        expect(persisted.rows[0].history_count).toBe(1);
        expect(persisted.rows[0].audit_count).toBe(1);
      } finally {
        await appointmentPool.end();
      }

      // Create an internal synthetic order for the same appointment, then
      // verify collection creation fails closed while the order is still a
      // draft. No appointment confirmation, collector assignment, collection,
      // physical custody, payment, or external receipt is fabricated here.
      await page.goto("/orders/new");
      await page.getByLabel("Search booking number or patient name").fill(appointmentBody.appointment.appointmentNumber);
      await page.getByRole("button", { name: "Find appointments" }).click();
      await page.getByRole("button", { name: new RegExp(appointmentBody.appointment.appointmentNumber) }).click();
      await page.getByLabel(/Synthetic quote browser item/).check();
      const orderResponse = page.waitForResponse(response =>
        response.request().method() === "POST" && new URL(response.url()).pathname === "/api/orders",
      );
      await page.getByRole("button", { name: "Create order draft" }).click();
      const orderHttp = await orderResponse;
      expect(orderHttp.status(), "same-patient synthetic order draft created").toBe(201);
      const orderBody = await orderHttp.json() as { order: { id: string; status: string } };
      expect(orderBody.order.status).toBe("DRAFT");
      const collectionAttempt = await page.evaluate(async ({ appointmentId, orderId, idempotencyKey }) => {
        const response = await fetch("/api/collections", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
          body: JSON.stringify({ appointmentId, orderId }),
        });
        return { status: response.status, body: await response.json() as { error?: string } };
      }, { appointmentId: appointmentBody.appointment.id, orderId: orderBody.order.id, idempotencyKey: randomUUID() });
      expect(collectionAttempt.status).toBe(409);
      expect(collectionAttempt.body.error).toBe("order_not_confirmed");

      const sameJourney = new pg.Pool({ connectionString: process.env.DATABASE_TEST_URL, max: 1 });
      try {
        const rows = await sameJourney.query(
          "SELECT o.status AS order_status, o.patient_id AS order_patient_id, o.appointment_id, a.status AS appointment_status, a.patient_id AS appointment_patient_id, p.consent_status, count(DISTINCT e.id)::int AS order_audit_count, count(DISTINCT j.id)::int AS collection_jobs FROM diagnostic_orders o JOIN appointments a ON a.id=o.appointment_id AND a.centre_id=o.centre_id JOIN patients p ON p.id=o.patient_id AND p.centre_id=o.centre_id LEFT JOIN audit_events e ON e.entity_id=o.id::text AND e.action='diagnostic_order.created' LEFT JOIN collection_jobs j ON j.order_id=o.id WHERE o.id=$1 AND o.centre_id=$2 GROUP BY o.id,a.id,p.id",
          [orderBody.order.id, centreId],
        );
        expect(rows.rowCount).toBe(1);
        expect(rows.rows[0].order_status).toBe("DRAFT");
        expect(rows.rows[0].appointment_status).toBe("REQUESTED");
        expect(rows.rows[0].order_patient_id).toBe(conversionBody.conversion.patientId);
        expect(rows.rows[0].appointment_patient_id).toBe(conversionBody.conversion.patientId);
        expect(rows.rows[0].appointment_id).toBe(appointmentBody.appointment.id);
        expect(rows.rows[0].consent_status).toBe("NOT_RECORDED");
        expect(rows.rows[0].order_audit_count).toBe(1);
        expect(rows.rows[0].collection_jobs).toBe(0);
      } finally {
        await sameJourney.end();
      }

      // Use the separately authenticated centre-manager session to perform
      // the real confirmation and collector-assignment actions. The manager
      // account completed password + MFA earlier in this same CI run.
      expect(managerStorageState, "manager password/MFA session was established").toBeTruthy();
      const managerContext = await browser.newContext({
        baseURL: "http://127.0.0.1:3000",
        storageState: managerStorageState!,
      });
      try {
        const managerPage = await managerContext.newPage();
        await managerPage.goto(`/orders/${orderBody.order.id}`);
        await expect(managerPage.getByRole("heading", { name: "Review and confirm" })).toBeVisible();
        await expect(managerPage.getByText("VERIFIED", { exact: true })).toBeVisible();
        managerPage.once("dialog", dialog => dialog.accept());
        const confirmOrderResponse = managerPage.waitForResponse(response =>
          response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/orders/${orderBody.order.id}`,
        );
        await managerPage.getByRole("button", { name: "Confirm order" }).click();
        const confirmedOrderHttp = await confirmOrderResponse;
        expect(confirmedOrderHttp.status(), "manager confirms using the verified synthetic catalogue price").toBe(200);
        const confirmedOrderBody = await confirmedOrderHttp.json() as { order: { status: string; totalAmount: string } };
        expect(confirmedOrderBody.order.status).toBe("CONFIRMED");
        expect(confirmedOrderBody.order.totalAmount).toBe("125.00");
        syntheticConfirmedOrder = { id: orderBody.order.id, centreId: centreId! };
        await expect(managerPage.getByText("CONFIRMED", { exact: true })).toBeVisible();

        await managerPage.goto(`/appointments/${appointmentBody.appointment.id}`);
        const statusForm = managerPage.locator("form.admin-form").filter({ has: managerPage.getByRole("heading", { name: "Status", exact: true }) });
        await statusForm.getByRole("combobox").selectOption("CONFIRMED");
        await statusForm.getByLabel("Reason", { exact: true }).fill("Synthetic centre manager confirmed the requested appointment");
        const confirmAppointmentResponse = managerPage.waitForResponse(response =>
          response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/appointments/${appointmentBody.appointment.id}`,
        );
        await statusForm.getByRole("button", { name: "Update status" }).click();
        expect((await confirmAppointmentResponse).status(), "manager confirms appointment through scheduling controls").toBe(200);
        await expect(managerPage.getByText("CONFIRMED", { exact: true })).toBeVisible();

        const appointmentAssignmentForm = managerPage.locator("form.admin-form").filter({ has: managerPage.getByRole("heading", { name: "Staff assignment", exact: true }) });
        const appointmentStaffSelect = appointmentAssignmentForm.getByLabel("Staff");
        const appointmentCollectorOption = appointmentStaffSelect.locator("option").filter({ hasText: "Synthetic Field Collector" });
        await expect(appointmentCollectorOption).toHaveCount(1);
        const appointmentCollectorId = await appointmentCollectorOption.getAttribute("value");
        expect(appointmentCollectorId).toBeTruthy();
        await appointmentStaffSelect.selectOption(appointmentCollectorId!);
        await appointmentAssignmentForm.getByLabel("Reason", { exact: true }).fill("Synthetic centre manager assigned the verified collector in the schedule");
        const assignAppointmentResponse = managerPage.waitForResponse(response =>
          response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/appointments/${appointmentBody.appointment.id}`,
        );
        await appointmentAssignmentForm.getByRole("button", { name: "Save assignment" }).click();
        expect((await assignAppointmentResponse).status(), "manager assignment validates active staff and scheduling conflicts").toBe(200);
        await expect(managerPage.getByText("ASSIGNED", { exact: true })).toBeVisible();

        await managerPage.goto("/collections");
        const createJobSection = managerPage.locator("section.admin-card").filter({ has: managerPage.getByRole("heading", { name: "Start from a confirmed appointment and order" }) });
        const createJobForm = createJobSection.locator("form.admin-form");
        await expect(createJobForm.getByLabel("Eligible booking")).toBeVisible();
        await createJobForm.getByLabel("Eligible booking").selectOption(orderBody.order.id);
        const createJobResponse = managerPage.waitForResponse(response =>
          response.request().method() === "POST" && new URL(response.url()).pathname === "/api/collections",
        );
        await createJobForm.getByRole("button", { name: "Create collection job" }).click();
        const createdJobHttp = await createJobResponse;
        expect(createdJobHttp.status(), "manager creates a job only after both records are confirmed").toBe(201);
        const createdJobBody = await createdJobHttp.json() as { job: { id: string; jobNumber: string } };
        expect(createdJobBody.job.id).toBeTruthy();
        expect(createdJobBody.job.jobNumber).toMatch(/^RHC-C-/);
        syntheticAssignedJob = { id: createdJobBody.job.id, number: createdJobBody.job.jobNumber };

        await managerPage.goto(`/field/jobs/${createdJobBody.job.id}`);
        const createdJobRead = await managerPage.request.get(`/api/collections/${createdJobBody.job.id}`);
        expect(createdJobRead.status(), "manager reads the newly created collection job").toBe(200);
        const createdJobDetail = await createdJobRead.json() as { job: { status: string } };
        expect(createdJobDetail.job.status).toBe("ASSIGNED");

        const completionPool = new pg.Pool({ connectionString: process.env.DATABASE_TEST_URL, max: 1 });
        try {
          const verified = await completionPool.query(
            "SELECT o.status AS order_status,o.total_amount,a.status AS appointment_status,j.status AS job_status,j.assigned_staff_id,cs.display_name AS collector_name,(SELECT count(*)::int FROM diagnostic_order_status_history h WHERE h.order_id=o.id AND h.to_status='CONFIRMED') AS order_history,(SELECT count(*)::int FROM appointment_status_history h WHERE h.appointment_id=a.id AND h.to_status='CONFIRMED') AS appointment_confirmation_history,(SELECT count(*)::int FROM appointment_assignment_history h WHERE h.appointment_id=a.id AND h.action='ASSIGNED' AND h.staff_id=j.assigned_staff_id) AS appointment_assignment_history,(SELECT count(*)::int FROM collection_job_events e WHERE e.job_id=j.id AND e.event_type='ASSIGNED' AND e.staff_id=j.assigned_staff_id) AS job_assignment_events,(SELECT count(*)::int FROM audit_events e WHERE e.entity_id=o.id::text AND e.action='diagnostic_order.confirmed') AS order_audits,(SELECT count(*)::int FROM audit_events e WHERE e.entity_id=a.id::text AND e.action='appointment.updated') AS appointment_confirmation_audits,(SELECT count(*)::int FROM audit_events e WHERE e.entity_id=a.id::text AND e.action='appointment.assigned') AS appointment_assignment_audits,(SELECT count(*)::int FROM audit_events e WHERE e.entity_id=j.id::text AND e.action='collection_job.created') AS collection_job_audits,p.consent_status,(SELECT count(*)::int FROM sample_procedure_approvals sp WHERE sp.centre_id=a.centre_id AND sp.operation='COLLECTION' AND sp.status='ACTIVE') AS active_collection_procedures,(SELECT count(*)::int FROM specimens s WHERE s.job_id=j.id) AS specimen_count FROM diagnostic_orders o JOIN appointments a ON a.id=o.appointment_id AND a.centre_id=o.centre_id JOIN collection_jobs j ON j.order_id=o.id AND j.appointment_id=a.id JOIN patients p ON p.id=o.patient_id AND p.centre_id=o.centre_id JOIN staff_users cs ON cs.id=j.assigned_staff_id WHERE o.id=$1 AND j.id=$2 AND o.centre_id=$3 GROUP BY o.id,a.id,j.id,p.id,cs.id",
            [orderBody.order.id, createdJobBody.job.id, centreId],
          );
          expect(verified.rowCount).toBe(1);
          expect(verified.rows[0]).toMatchObject({ order_status: "CONFIRMED", total_amount: "125.00", appointment_status: "ASSIGNED", job_status: "ASSIGNED", collector_name: "Synthetic Field Collector", order_history: 1, appointment_confirmation_history: 1, appointment_assignment_history: 1, job_assignment_events: 1, order_audits: 1, appointment_confirmation_audits: 1, appointment_assignment_audits: 1, collection_job_audits: 1, consent_status: "NOT_RECORDED", active_collection_procedures: 0, specimen_count: 0 });
        } finally {
          await completionPool.end();
        }
      } finally {
        await managerContext.close();
      }
    }
  });
}
