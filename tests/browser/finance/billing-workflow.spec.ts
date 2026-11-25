import { createHmac } from "node:crypto";
import pg from "pg";
import { expect, test } from "@playwright/test";

const { Pool } = pg;
const decodeBase32 = (value: string) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of value.toUpperCase().replace(/=+$/, "")) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};
const totp = (secret: string) => {
  const counter = BigInt(Math.floor(Date.now() / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
};

test("real MFA finance operator creates authorized internal snapshots and reads exact order details", async ({ page }) => {
  const email = process.env.FINANCE_BROWSER_EMAIL;
  const password = process.env.FINANCE_BROWSER_PASSWORD;
  const databaseUrl = process.env.DATABASE_TEST_URL;
  const centreId = process.env.FINANCE_BROWSER_CENTRE_ID;
  const readOnlyCentreId = process.env.FINANCE_BROWSER_READ_ONLY_CENTRE_ID;
  const deniedCentreId = process.env.FINANCE_BROWSER_DENIED_CENTRE_ID;
  const orderIds = JSON.parse(process.env.FINANCE_BROWSER_ORDER_IDS ?? "[]") as string[];
  const catalogueVersionIds = JSON.parse(process.env.FINANCE_BROWSER_CATALOGUE_VERSION_IDS ?? "[]") as string[];
  const catalogueItemIds = JSON.parse(process.env.FINANCE_BROWSER_CATALOGUE_ITEM_IDS ?? "[]") as string[];
  const readOnlyOrderId = process.env.FINANCE_BROWSER_READ_ONLY_ORDER_ID;
  const quoteLeadId = process.env.FINANCE_BROWSER_QUOTE_LEAD_ID;
  const crossCentreLeadId = process.env.FINANCE_BROWSER_CROSS_CENTRE_LEAD_ID;
  const quoteCatalogueVersionId = process.env.FINANCE_BROWSER_QUOTE_VERSION_ID;
  expect(email && password && databaseUrl && centreId && readOnlyCentreId && deniedCentreId && orderIds.length === 6 && catalogueVersionIds.length === 6 && catalogueItemIds.length === 6 && readOnlyOrderId && quoteLeadId && crossCentreLeadId && quoteCatalogueVersionId).toBeTruthy();

  await page.goto("/staff");
  await page.getByLabel("Work email").fill(email!);
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/staff\/security-setup$/);

  await page.getByLabel("Account password").fill(password!);
  const enrollmentResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/api/auth/two-factor/enable"));
  await page.getByRole("button", { name: "Begin authenticator setup" }).click();
  const enrollment = await (await enrollmentResponse).json() as { totpURI: string; method: string };
  expect(enrollment.method).toBe("totp");
  const secret = new URL(enrollment.totpURI).searchParams.get("secret");
  expect(secret).toBeTruthy();
  if (Date.now() % 30_000 > 27_000) await page.waitForTimeout(3_000);
  await page.getByLabel("Current six-digit authenticator code").fill(totp(secret!));
  await page.getByRole("button", { name: "Verify and finish setup" }).click();
  await expect(page).toHaveURL(/\/staff\/workspace$/);

  const deniedCentreResponse = await page.request.get(`/api/finance?centreId=${deniedCentreId}`);
  expect(deniedCentreResponse.status()).toBe(403);

  let failFirstRead = true;
  let failRefreshAfterNextWrite = false;
  let simulateRefreshFailureOnce = true;
  await page.route(/\/api\/finance(?:\?.*)?$/, async (route) => {
    if (failFirstRead && route.request().method() === "GET") {
      failFirstRead = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "synthetic_test_unavailable" }) });
      return;
    }
    if (failRefreshAfterNextWrite && route.request().method() === "GET") {
      failRefreshAfterNextWrite = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "synthetic_refresh_unavailable" }) });
      return;
    }
    if (route.request().method() === "POST" && simulateRefreshFailureOnce) {
      simulateRefreshFailureOnce = false;
      failRefreshAfterNextWrite = true;
    }
    await route.continue();
  });

  await page.goto("/finance/billing");
  await expect(page.getByRole("status").first()).toContainText("synthetic_test_unavailable");
  await page.getByRole("button", { name: "Retry loading financial data" }).click();
  await expect(page.getByLabel("Confirmed order ID")).toBeVisible();

  const billingQueue = page.locator("section").filter({ has: page.getByRole("heading", { name: "Billing work queue" }) });
  const centrePicker = billingQueue.getByLabel("Centre");
  await expect(centrePicker).toBeVisible();
  const orderPicker = page.getByLabel("Confirmed order ID");
  const readOnlyCentreLoad = page.waitForResponse((response) => response.request().method() === "GET" && response.url().includes(`/api/finance?`) && response.url().includes(readOnlyCentreId!));
  await centrePicker.selectOption(readOnlyCentreId!);
  expect((await readOnlyCentreLoad).status()).toBe(200);
  await expect(orderPicker.locator("option")).toHaveCount(1);
  const authorizedCentreLoad = page.waitForResponse((response) => response.request().method() === "GET" && response.url().includes(`/api/finance?`) && response.url().includes(centreId!));
  await centrePicker.selectOption(centreId!);
  expect((await authorizedCentreLoad).status()).toBe(200);

  await expect(orderPicker.locator("option")).toHaveCount(7);
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { level: 2, name: "Billing work queue" })).toBeVisible();
    await expect(orderPicker).toBeVisible();
    await expect(page.getByRole("button", { name: "Create charge snapshots" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `billing queue horizontal overflow at ${width}px`).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const expectedCharges = new Map<string, { choice: string; amount: string | null }>([
    [orderIds[0], { choice: "75", amount: "7500" }],
    [orderIds[1], { choice: "99", amount: "9900" }],
    [orderIds[2], { choice: "150", amount: "15000" }],
    [orderIds[3], { choice: "CUSTOM", amount: "12500" }],
    [orderIds[4], { choice: "WAIVED", amount: null }],
    [orderIds[5], { choice: "ZERO", amount: null }],
  ]);
  for (const orderId of orderIds) {
    await orderPicker.selectOption(orderId);
    const submit = page.getByRole("button", { name: "Create charge snapshots" });
    await submit.focus();
    const actionResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/finance"));
    await submit.press("Enter");
    const savedResponse = await actionResponse;
    const savedBody = await savedResponse.json().catch(() => ({}));
    expect(savedResponse.status(), JSON.stringify(savedBody)).toBe(201);
    if (orderId === orderIds[0]) {
      await expect(page.getByRole("status").first()).toContainText("Saved successfully, but financial data could not be refreshed");
      await page.getByRole("button", { name: "Retry loading financial data" }).click();
      await expect(orderPicker.locator("option")).toHaveCount(7);
    } else {
      await expect(page.getByRole("status").first()).toContainText("Saved successfully.");
    }
  }
  await orderPicker.selectOption(orderIds[0]);
  const duplicateSubmit = page.getByRole("button", { name: "Create charge snapshots" });
  const duplicateResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/finance"));
  await duplicateSubmit.press("Enter");
  expect((await duplicateResponse).status()).toBe(201);

  const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "rudra-finance-browser-assertions" });
  try {
    const saved = await pool.query(
      `SELECT o.id AS order_id,c.charge_type,c.amount_minor::text AS amount,c.snapshot->>'choice' AS choice,
              c.snapshot->'items'->0->>'catalogueVersionId' AS catalogue_version_id,
              c.snapshot->'items'->0->>'catalogueItemId' AS catalogue_item_id,
              c.snapshot->'items'->0->>'verificationStatus' AS verification_status,
              c.snapshot->'items'->0->>'priceSourceReference' AS price_source_reference,
              c.snapshot->'items'->0->>'effectiveFrom' AS effective_from,
              c.snapshot->>'invoiceIssuer' AS invoice_issuer,c.snapshot->>'legalInvoice' AS legal_invoice
       FROM finance_charges c JOIN diagnostic_orders o
         ON (c.order_id=o.id OR c.appointment_id=o.appointment_id)
       WHERE o.id = ANY($1::uuid[]) AND c.state='ACTIVE' ORDER BY o.id,c.charge_type`,
      [orderIds],
    );
    const byOrder = new Map<string, Array<{ charge_type: string; amount: string; choice: string | null }>>();
    for (const row of saved.rows) byOrder.set(row.order_id, [...(byOrder.get(row.order_id) ?? []), row]);
    for (const [orderId, expected] of expectedCharges) {
      const charges = byOrder.get(orderId) ?? [];
      expect(charges.filter((charge) => charge.charge_type === "DIAGNOSTIC")).toHaveLength(1);
      const diagnostic = charges.find((charge) => charge.charge_type === "DIAGNOSTIC");
      expect(diagnostic?.amount).toBe("45000");
      expect(diagnostic).toMatchObject({ catalogue_version_id: catalogueVersionIds[orderIds.indexOf(orderId)], catalogue_item_id: catalogueItemIds[orderIds.indexOf(orderId)], verification_status: "SYNTHETIC", price_source_reference: expect.stringContaining("TEST ONLY synthetic catalogue fixture"), effective_from: "2026-01-01", invoice_issuer: "PENDING", legal_invoice: "false" });
      const home = charges.find((charge) => charge.charge_type === "HOME_COLLECTION");
      if (expected.amount === null) expect(home).toBeUndefined();
      else expect(home).toMatchObject({ amount: expected.amount, choice: expected.choice });
    }
    const audit = await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE action='finance.order_charges_created' AND entity_id=ANY($1::text[])", [orderIds]);
    expect(audit.rows[0].count).toBe(7);
  } finally {
    await pool.end();
  }

  const targetOrderId = orderIds[1];
  await page.goto(`/finance/orders/${targetOrderId}`);
  await expect(page.getByText("Internal charge snapshot", { exact: true }).locator("xpath=..")).toContainText("Recorded");
  await expect(page.getByText("Legal invoice", { exact: true }).locator("xpath=..")).toContainText("Disabled pending policy approval");
  await expect(page.getByRole("button", { name: "Create internal charge snapshot" })).toHaveCount(0);

  await page.goto(`/finance/orders/${readOnlyOrderId}`);
  await expect(page.getByText("read access, but charge creation requires finance charge permission", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create internal charge snapshot" })).toHaveCount(0);
  const crossCentreMutationStatus = await page.evaluate(async (orderId) => {
    const response = await fetch("/api/finance", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ action: "create_order_charges", orderId }),
    });
    return response.status;
  }, readOnlyOrderId!);
  expect(crossCentreMutationStatus).toBe(403);

  const widths = [1280, 768, 390];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "Order billing details" })).toBeVisible();
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noOverflow, `horizontal overflow at ${width}px`).toBe(true);
  }

  const workflowPool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "rudra-finance-workflow-assertions" });
  try {
  // B003: create an internal draft for an authorized synthetic lead, then retrieve it by both quote and lead scope.
  await page.goto(`/staff/quotes?leadId=${encodeURIComponent(quoteLeadId!)}`);
  await expect(page.getByRole("heading", { name: "Prepare an internal price draft" })).toBeVisible();
  const quoteService = page.getByLabel(/Synthetic quote browser item/);
  await expect(quoteService).toBeVisible();
  await quoteService.check();
  const quoteResponsePromise = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith(`/api/leads/${quoteLeadId}/quotes`));
  await page.getByRole("button", { name: "Save internal quote draft" }).click();
  const quoteResponse = await quoteResponsePromise;
  expect(quoteResponse.status()).toBe(201);
  const quoteBody = await quoteResponse.json() as { quote: { id: string; quoteNumber: string; status: string; totalPaise: number; snapshot: { lines: Array<{ catalogueVersionId: string }> } } };
  expect(quoteBody.quote).toMatchObject({ status: "INTERNAL_DRAFT", totalPaise: 12500 });
  expect(quoteBody.quote.snapshot.lines[0]?.catalogueVersionId).toBe(quoteCatalogueVersionId);
  await page.getByRole("link", { name: "Open quote details" }).click();
  await expect(page.getByRole("heading", { name: "Internal quote draft" })).toBeVisible();
  await expect(page.getByText(quoteBody.quote.quoteNumber, { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Diagnostic services", { exact: false })).toBeVisible();
  const quoteStorage = await workflowPool.query("SELECT private_snapshot_ciphertext,status FROM lead_quotes WHERE id=$1 AND lead_id=$2", [quoteBody.quote.id, quoteLeadId]);
  expect(quoteStorage.rowCount).toBe(1);
  expect(quoteStorage.rows[0].status).toBe("INTERNAL_DRAFT");
  expect(quoteStorage.rows[0].private_snapshot_ciphertext).not.toContain('"totalPaise":12500');
  await page.goto(`/finance/quotes/${quoteBody.quote.id}?leadId=${encodeURIComponent(crossCentreLeadId!)}`);
  await expect(page.getByText("This quote is unavailable in the authorized lead scope. No quote data was disclosed.")).toBeVisible();
  const crossCentreQuoteStatus = await page.request.get(`/api/leads/${encodeURIComponent(crossCentreLeadId!)}/quotes`);
  expect(crossCentreQuoteStatus.status()).toBe(404);
  await page.goto(`/finance/quotes/${crypto.randomUUID()}?leadId=${encodeURIComponent(quoteLeadId!)}`);
  await expect(page.getByText("This quote is unavailable in the authorized lead scope. No quote data was disclosed.")).toBeVisible();

  // Phase 07: corporate directory → attributed CRM enquiry → linked follow-up task.
  await page.goto("/corporates");
  await expect(page.getByRole("heading", { name: "Corporate accounts" })).toBeVisible();
  await page.goto("/corporates/new");
  await expect(page.getByRole("heading", { name: "Corporate enquiry and proposal intake" })).toBeVisible();
  await page.getByRole("textbox", { name: "Corporate client name" }).fill("Synthetic Browser Corporate");
  const corporateFormSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Register corporate client" }) });
  await corporateFormSection.getByRole("textbox", { name: "Category" }).fill("EMPLOYER");
  const relationshipResponsePromise = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/business-relationships"));
  await corporateFormSection.getByRole("button", { name: "Save corporate client" }).click();
  const relationshipResponse = await relationshipResponsePromise;
  expect(relationshipResponse.status()).toBe(201);
  const relationshipBody = await relationshipResponse.json() as { relationship: { id: string; relationshipNumber: string; centreId: string; type: string; agreementStatus: string } };
  const relationship = relationshipBody.relationship;
  expect(relationship).toMatchObject({ centreId, type: "CORPORATE", agreementStatus: "NOT_RECORDED" });
  const deniedCorporateResponse = await page.request.get(`/api/business-relationships?centreId=${encodeURIComponent(deniedCentreId!)}&type=CORPORATE`);
  expect(deniedCorporateResponse.status()).toBe(403);
  await page.goto(`/corporates/${relationship.id}`);
  await expect(page.getByRole("heading", { name: "Synthetic Browser Corporate" })).toBeVisible();
  await expect(page.getByText("Contact permission remains pending until documented; marketing consent is not requested.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create linked follow-up task" })).toBeVisible();
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "Synthetic Browser Corporate" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `corporate profile horizontal overflow at ${width}px`).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("textbox", { name: "First name" }).fill("Synthetic");
  await page.getByRole("textbox", { name: "Last name" }).fill("Corporate Contact");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("synthetic-corporate-contact@invalid.test");
  const attributedLeadResponsePromise = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/leads"));
  await page.getByRole("button", { name: "Create attributed lead" }).click();
  const attributedLeadResponse = await attributedLeadResponsePromise;
  expect(attributedLeadResponse.status()).toBe(201);
  const attributedLeadBody = await attributedLeadResponse.json() as { lead: { id: string; leadNumber: string } };
  await expect(page.getByRole("link", { name: attributedLeadBody.lead.leadNumber })).toBeVisible();

  const attributedReportResponse = await page.request.get(`/api/relationships/referrals?centreId=${encodeURIComponent(centreId!)}&type=CORPORATE`);
  expect(attributedReportResponse.status()).toBe(200);
  const attributedReport = await attributedReportResponse.json() as { referrals: Array<{ sourceId: string; leads: number; converted: number }> };
  expect(attributedReport.referrals).toContainEqual(expect.objectContaining({ sourceId: relationship.id, leads: 1, converted: 0 }));
  expect(JSON.stringify(attributedReport)).not.toContain("Corporate Contact");
  await page.goto("/relationships/referrals");
  const referralReport = page.locator('section[aria-labelledby="referral-report-title"]');
  await referralReport.getByLabel("Source type").selectOption("CORPORATE");
  const referralCentre = referralReport.getByLabel("Centre");
  await expect(referralCentre.locator(`option[value="${centreId}"]`)).toHaveCount(1);
  await referralCentre.selectOption(centreId!);
  await referralReport.getByRole("button", { name: "Apply filters" }).click();
  await expect(referralReport.getByRole("row").filter({ hasText: relationship.relationshipNumber })).toBeVisible();
  const corporateStorage = await workflowPool.query(
    `SELECT r.private_data_ciphertext,l.source_relationship_id,l.source_relationship_type,l.source,
            p.payload_ciphertext,e.action
       FROM business_relationships r
       JOIN leads l ON l.source_relationship_id=r.id AND l.source_relationship_type='CORPORATE'
       JOIN lead_private_data p ON p.lead_id=l.id
       JOIN audit_events e ON e.entity_id=r.id::text AND e.action='business_relationship.created'
      WHERE r.id=$1 AND l.id=$2 AND r.centre_id=$3 AND l.centre_id=$3`,
    [relationship.id, attributedLeadBody.lead.id, centreId],
  );
  expect(corporateStorage.rowCount).toBe(1);
  expect(corporateStorage.rows[0]).toMatchObject({ source_relationship_id: relationship.id, source_relationship_type: "CORPORATE", source: "CORPORATE", action: "business_relationship.created" });
  expect(corporateStorage.rows[0].private_data_ciphertext).not.toContain("Synthetic Browser Corporate");
  expect(corporateStorage.rows[0].payload_ciphertext).not.toContain("Corporate Contact");

  await page.getByRole("link", { name: "Create linked follow-up task" }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks\\?.*referenceType=CORPORATE_RELATIONSHIP.*referenceId=${relationship.id}`));
  await expect(page.getByRole("heading", { name: "Create task" })).toBeVisible();
  const followupTaskForm = page.locator("form.task-form");
  await expect(followupTaskForm.getByLabel("Centre")).toHaveValue(centreId!);
  await expect(followupTaskForm.getByLabel("Link to operational record")).toHaveValue("CORPORATE_RELATIONSHIP");
  const linkedRecordSelect = followupTaskForm.locator("label").filter({ hasText: "Choose a permitted record" }).locator("select");
  await expect(linkedRecordSelect).toHaveValue(relationship.id);
  await page.getByRole("textbox", { name: "Title" }).fill("Synthetic corporate follow-up");
  const taskCreateResponsePromise = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/tasks"));
  await page.getByRole("button", { name: "Create task" }).click();
  const taskCreateResponse = await taskCreateResponsePromise;
  expect(taskCreateResponse.status()).toBe(201);
  const taskResult = await taskCreateResponse.json() as { task?: { id: string; taskNumber: string; replayed: boolean } };
  expect(taskResult.task?.id).toBeTruthy();
  const savedTask = await workflowPool.query(
    `SELECT t.centre_id,t.task_type,t.status,t.private_data_ciphertext,e.action
       FROM staff_tasks t JOIN audit_events e ON e.entity_id=t.id::text AND e.action='staff_task.created'
      WHERE t.id=$1 AND t.centre_id=$2`,
    [taskResult.task!.id, centreId],
  );
  expect(savedTask.rowCount).toBe(1);
  expect(savedTask.rows[0]).toMatchObject({ centre_id: centreId, task_type: "FOLLOW_UP", status: "OPEN", action: "staff_task.created" });
  expect(savedTask.rows[0].private_data_ciphertext).not.toContain("Synthetic Browser Corporate");

  // B005/B006: staff-entered evidence is persisted as RECORDED, not settled.
  const chargeLookup = await workflowPool.query(
    "SELECT id,charge_code FROM finance_charges WHERE order_id=$1 AND charge_type='DIAGNOSTIC' AND state='ACTIVE'",
    [orderIds[0]],
  );
  expect(chargeLookup.rowCount).toBe(1);
  await page.goto("/finance/payments/new");
  await expect(page.getByRole("heading", { name: "Record payment against an existing charge" })).toBeVisible();
  await expect(page.getByText("This creates an internal staff record only. It does not verify an external bank, UPI or card transaction.")).toBeVisible();
  await page.locator('select[name="chargeId"]').selectOption(chargeLookup.rows[0].id);
  await page.locator('input[name="amount"]').fill("100.00");
  await page.locator('select[name="method"]').selectOption("UPI");
  await page.locator('input[name="reference"]').fill("TEST ONLY synthetic payment evidence");
  const paymentResponsePromise = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/finance"));
  await page.getByRole("button", { name: "Record payment" }).click();
  const paymentResponse = await paymentResponsePromise;
  expect(paymentResponse.status()).toBe(201);
  await expect(page.getByRole("status").first()).toContainText("Saved successfully.");
  const paymentLookup = await workflowPool.query(
    `SELECT p.id,p.payment_number,p.status,p.amount_minor::text AS amount,p.method,
            a.amount_minor::text AS allocated
       FROM finance_payments p JOIN finance_allocations a ON a.payment_id=p.id
      WHERE p.centre_id=$1 AND p.amount_minor=10000 AND p.method='UPI'
        AND p.private_data_ciphertext IS NOT NULL
      ORDER BY p.recorded_at DESC LIMIT 1`,
    [centreId],
  );
  expect(paymentLookup.rowCount).toBe(1);
  expect(paymentLookup.rows[0]).toMatchObject({ status: "RECORDED", amount: "10000", method: "UPI", allocated: "10000" });
  const paymentAudit = await workflowPool.query(
    "SELECT count(*)::int AS count FROM audit_events WHERE action='finance.payment_recorded' AND entity_id=$1",
    [paymentLookup.rows[0].id],
  );
  expect(paymentAudit.rows[0].count).toBe(1);

  await page.goto("/finance/payments");
  await expect(page.getByRole("heading", { name: "Payment history" })).toBeVisible();
  await page.getByLabel("Exact payment number").fill(paymentLookup.rows[0].payment_number);
  await expect(page.getByRole("row").filter({ hasText: paymentLookup.rows[0].payment_number })).toContainText("RECORDED");
  await expect(page.getByRole("row").filter({ hasText: paymentLookup.rows[0].payment_number })).toContainText("upi");

  // B008: unverified payment evidence must not reduce the outstanding balance.
  await page.goto("/finance/outstanding");
  await expect(page.getByRole("heading", { name: "Charges and balances" })).toBeVisible();
  const outstandingCharge = page.getByRole("row").filter({ hasText: chargeLookup.rows[0].charge_code });
  await expect(outstandingCharge).toContainText("INR 450.00");
  await expect(outstandingCharge).toContainText("UNPAID");

  // B011/B014: home fees are separated from diagnostic charges; export stays gated.
  await page.goto("/finance/home-fees");
  await expect(page.getByRole("heading", { name: "Recorded Rudra home-collection charges" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "HOME_COLLECTION" }).first()).toBeVisible();
  await page.goto("/finance/analytics");
  await expect(page.getByRole("heading", { name: "Export availability" })).toBeVisible();
  await expect(page.getByText("Export is unavailable until a scoped finance export permission, privacy review and immutable export audit contract are approved.")).toBeVisible();

  // B009: an isolated synthetic close is performed by a second authenticated staff user.
  await page.goto("/finance/reconciliation");
  await page.locator('form select[name="centreId"]').selectOption(centreId!);
  await page.getByLabel("Opening cash (INR)").fill("20.00");
  const openResponsePromise = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/finance"));
  await page.getByRole("button", { name: "Open reconciliation" }).click();
  expect((await openResponsePromise).status()).toBe(201);
  await expect(page.getByRole("status").first()).toContainText("Saved successfully.");
  const openRecon = await workflowPool.query(
    "SELECT id,opened_by_staff_id,status,opening_cash_minor::text AS opening FROM finance_reconciliations WHERE centre_id=$1 AND status='OPEN' ORDER BY opened_at DESC LIMIT 1",
    [centreId],
  );
  expect(openRecon.rowCount).toBe(1);
  expect(openRecon.rows[0]).toMatchObject({ opened_by_staff_id: process.env.FINANCE_BROWSER_STAFF_ID, status: "OPEN", opening: "2000" });

  const closerEmail = process.env.FINANCE_BROWSER_CLOSER_EMAIL;
  const closerPassword = process.env.FINANCE_BROWSER_CLOSER_PASSWORD;
  const browser = page.context().browser();
  expect(closerEmail && closerPassword && browser).toBeTruthy();
  const closerContext = await browser!.newContext({ baseURL: "http://127.0.0.1:3000" });
  const closerPage = await closerContext.newPage();
  try {
    await closerPage.goto("/staff");
    await closerPage.getByLabel("Work email").fill(closerEmail!);
    await closerPage.getByLabel("Password", { exact: true }).fill(closerPassword!);
    await closerPage.getByRole("button", { name: "Sign in securely" }).click();
    await expect(closerPage).toHaveURL(/\/staff\/security-setup$/);
    await closerPage.getByLabel("Account password").fill(closerPassword!);
    const closerEnrollmentResponse = closerPage.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/api/auth/two-factor/enable"));
    await closerPage.getByRole("button", { name: "Begin authenticator setup" }).click();
    const closerEnrollment = await (await closerEnrollmentResponse).json() as { totpURI: string; method: string };
    expect(closerEnrollment.method).toBe("totp");
    const closerSecret = new URL(closerEnrollment.totpURI).searchParams.get("secret");
    expect(closerSecret).toBeTruthy();
    if (Date.now() % 30_000 > 27_000) await closerPage.waitForTimeout(3_000);
    await closerPage.getByLabel("Current six-digit authenticator code").fill(totp(closerSecret!));
    await closerPage.getByRole("button", { name: "Verify and finish setup" }).click();
    await expect(closerPage).toHaveURL(/\/staff\/workspace$/);
    await closerPage.goto("/finance/reconciliation");
    const openRow = closerPage.getByRole("row").filter({ hasText: "Synthetic Finance Centre A" }).filter({ hasText: "OPEN" });
    await expect(openRow).toBeVisible();
    closerPage.on("dialog", async (dialog) => {
      if (dialog.type() === "prompt") await dialog.accept("20.00");
      else await dialog.accept();
    });
    const closeResponsePromise = closerPage.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/finance"));
    await openRow.getByRole("button", { name: "Close cash session" }).click();
    const closeResponse = await closeResponsePromise;
    expect(closeResponse.status()).toBe(201);
    await expect(closerPage.getByRole("status").first()).toContainText("Saved successfully.");
    const closedRecon = await workflowPool.query(
      "SELECT status,closed_by_staff_id,expected_cash_minor::text AS expected,counted_cash_minor::text AS counted,variance_minor::text AS variance FROM finance_reconciliations WHERE id=$1",
      [openRecon.rows[0].id],
    );
    expect(closedRecon.rows[0]).toMatchObject({ status: "CLOSED", closed_by_staff_id: process.env.FINANCE_BROWSER_CLOSER_STAFF_ID, expected: "2000", counted: "2000", variance: "0" });
  } finally {
    await closerContext.close();
  }
  } finally {
    await workflowPool.end();
  }
});
