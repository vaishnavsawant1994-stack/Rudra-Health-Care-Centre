import { createHmac, randomUUID } from "node:crypto";
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
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
};

test("doctor visit operations, filtered relationship pipeline and internal template governance", async ({ page }) => {
  const email = process.env.RELATIONSHIP_BROWSER_EMAIL;
  const password = process.env.RELATIONSHIP_BROWSER_PASSWORD;
  const databaseUrl = process.env.DATABASE_TEST_URL;
  const centreId = process.env.FINANCE_BROWSER_CENTRE_ID;
  const readOnlyCentreId = process.env.FINANCE_BROWSER_READ_ONLY_CENTRE_ID;
  const deniedCentreId = process.env.FINANCE_BROWSER_DENIED_CENTRE_ID;
  expect(email && password && databaseUrl && centreId && readOnlyCentreId && deniedCentreId).toBeTruthy();
  const workflowPool = new Pool({ connectionString: databaseUrl });

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

    // C004: create and close a staff-recorded visit, then use the protected task handoff.
    await page.goto("/relationships/doctor-visits");
    const visitSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Plan a doctor relationship visit" }) });
    await expect(visitSection).toBeVisible();
    const visitCentre = visitSection.getByRole("combobox").nth(0);
    await visitCentre.focus();
    await page.keyboard.press("Tab");
    const doctorPicker = visitSection.getByRole("combobox").nth(1);
    await expect(doctorPicker).toBeFocused();
    await expect(visitCentre).toHaveValue(centreId!);
    const doctorOption = doctorPicker.locator("option").filter({ hasText: "Synthetic Browser Doctor" });
    await expect(doctorOption).toHaveCount(1);
    const doctorId = await doctorOption.getAttribute("value");
    expect(doctorId).toBeTruthy();
    await doctorPicker.selectOption(doctorId!);
    // Wait for the doctor visit-history request to finish before acting on the form;
    // the workbench replaces its history panel when that response arrives.
    await expect(page.getByText("No visits recorded for this doctor.")).toBeVisible();
    const plannedLocal = new Date(Date.now() + 24 * 60 * 60_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await visitSection.locator('input[name="scheduledAt"]').fill(plannedLocal);
    await visitSection.locator('textarea[name="agenda"]').fill("Synthetic relationship check-in; no patient or clinical information.");
    const planResponsePromise = page.waitForResponse(response => response.request().method() === "POST" && /\/api\/doctors\/[^/]+\/visits$/.test(response.url()));
    await visitSection.getByRole("button", { name: "Plan visit" }).click();
    const planResponse = await planResponsePromise;
    expect(planResponse.status()).toBe(201);
    const planned = await planResponse.json() as { visitEvent: { visitId: string } };
    const visitRow = page.getByRole("row").filter({ hasText: "RELATIONSHIP" });
    await expect(visitRow).toBeVisible();
    const checkInResponsePromise = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/visits"));
    await visitRow.getByRole("button", { name: "Record check-in" }).click();
    expect((await checkInResponsePromise).status()).toBe(201);
    await expect(visitRow).toContainText("Checked in");
    const meetingForm = visitRow.locator("form").filter({ has: page.getByRole("button", { name: "Record meeting" }) });
    await meetingForm.getByLabel("Meeting summary").fill("Synthetic relationship meeting recorded by staff.");
    await meetingForm.getByLabel("Operational follow-up note").fill("Send the approved service overview for internal review.");
    const recordResponsePromise = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/visits"));
    await meetingForm.getByRole("button", { name: "Record meeting" }).click();
    expect((await recordResponsePromise).status()).toBe(201);
    await expect(visitRow).toContainText("Meeting recorded");
    const taskHandoff = visitRow.getByRole("link", { name: "Create linked staff follow-up task" });
    await expect(taskHandoff).toBeVisible();
    await taskHandoff.click();
    await expect(page).toHaveURL(new RegExp(`/tasks\\?.*referenceType=DOCTOR_RELATIONSHIP.*referenceId=${doctorId}`));
    const taskSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Create task" }) });
    const taskForm = taskSection.locator("form");
    await expect(taskForm.getByLabel("Centre")).toHaveValue(centreId!);
    await expect(taskForm.getByLabel("Type")).toHaveValue("FOLLOW_UP");
    await expect(taskForm.getByLabel("Link to operational record")).toHaveValue("DOCTOR_RELATIONSHIP");
    await taskForm.getByLabel("Title").fill("Synthetic doctor follow-up");
    await taskForm.getByLabel("Description").fill("Prepare internal service overview for review.");
    const taskResponsePromise = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/tasks"));
    await taskForm.getByRole("button", { name: "Create task" }).click();
    expect((await taskResponsePromise).status()).toBe(201);
    const visitEvents = await workflowPool.query(
      "SELECT event_type,private_data_ciphertext FROM doctor_relationship_events WHERE doctor_id=$1 AND centre_id=$2 AND event_type LIKE 'VISIT_%' ORDER BY recorded_at",
      [doctorId, centreId],
    );
    expect(visitEvents.rows.map(row => row.event_type)).toEqual(["VISIT_PLANNED", "VISIT_CHECKED_IN", "VISIT_RECORDED"]);
    expect(visitEvents.rows.every(row => !row.private_data_ciphertext.includes("Synthetic relationship meeting"))).toBe(true);
    expect(planned.visitEvent.visitId).toBeTruthy();
    const taskRecord = await workflowPool.query(
      "SELECT task_type,private_data_ciphertext FROM staff_tasks WHERE centre_id=$1 AND task_type='FOLLOW_UP' ORDER BY created_at DESC LIMIT 1",
      [centreId],
    );
    expect(taskRecord.rowCount).toBe(1);
    expect(taskRecord.rows[0].private_data_ciphertext).not.toContain("Synthetic doctor follow-up");

    // Return from the linked task workflow, then cancel a separate planned visit.
    const revisitListResponsePromise = page.waitForResponse(response => response.request().method() === "GET" && response.url().includes(`/api/doctors?centreId=${centreId}`));
    await page.goto("/relationships/doctor-visits");
    expect((await revisitListResponsePromise).status()).toBe(200);
    const revisitSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Plan a doctor relationship visit" }) });
    const revisitDoctorPicker = revisitSection.getByRole("combobox").nth(1);
    await revisitDoctorPicker.selectOption(doctorId!);
    await expect(page.getByRole("row").filter({ hasText: "Synthetic relationship meeting recorded by staff." })).toBeVisible();
    const revisitPlanForm = revisitSection.locator("form");
    await revisitPlanForm.locator('input[name="scheduledAt"]').fill(new Date(Date.now() + 72 * 60 * 60_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
    const secondPlanResponsePromise = page.waitForResponse(response => response.request().method() === "POST" && /\/api\/doctors\/[^/]+\/visits$/.test(response.url()));
    await revisitPlanForm.getByRole("button", { name: "Plan visit" }).click();
    expect((await secondPlanResponsePromise).status()).toBe(201);
    await expect(page.getByRole("row").filter({ hasText: "RELATIONSHIP" })).toHaveCount(2);
    const cancellationButton = page.getByRole("button", { name: "Cancel planned visit" });
    await expect(cancellationButton).toBeVisible();
    const cancellationRow = cancellationButton.locator("xpath=ancestor::tr");
    await cancellationRow.locator('input[name="reason"]').fill("Synthetic schedule change for browser verification.");
    const cancellationResponsePromise = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/visits"));
    const refreshedHistoryPromise = page.waitForResponse(response => response.request().method() === "GET" && response.url().includes(`/api/doctors/${doctorId}/visits?centreId=${centreId}`));
    await cancellationRow.getByRole("button", { name: "Cancel planned visit" }).click();
    const cancellationResponse = await cancellationResponsePromise;
    expect(cancellationResponse.status()).toBe(201);
    expect(await cancellationResponse.json()).toMatchObject({ visitEvent: { type: "VISIT_CANCELLED" } });
    const refreshedHistory = await (await refreshedHistoryPromise).json() as { visits: Array<{ cancelled: string | null }> };
    expect(refreshedHistory.visits).toEqual(expect.arrayContaining([expect.objectContaining({ cancelled: "Synthetic schedule change for browser verification." })]));
    await expect(page.getByRole("cell").filter({ hasText: "Cancelled: Synthetic schedule change for browser verification." })).toBeVisible();
    const cancellationAudit = await workflowPool.query(
      "SELECT count(*)::int AS count FROM doctor_relationship_events WHERE doctor_id=$1 AND centre_id=$2 AND event_type='VISIT_CANCELLED'",
      [doctorId, centreId],
    );
    expect(cancellationAudit.rows[0].count).toBe(1);

    const deniedVisit = await page.request.post(`/api/doctors/${doctorId}/visits`, {
      headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json", "idempotency-key": randomUUID() },
      data: { action: "PLAN", centreId: deniedCentreId, scheduledAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString(), purpose: "OTHER", agenda: null },
    });
    expect(deniedVisit.status()).toBe(403);

    // C012: recover from an unavailable aggregate, then exercise centre-scoped filters and keyboard selection.
    let failPipelineOnce = true;
    await page.route("**/api/relationships/pipeline*", async route => {
      if (failPipelineOnce) {
        failPipelineOnce = false;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "relationship_pipeline_unavailable" }) });
      } else await route.continue();
    });
    await page.goto("/relationships/pipeline");
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.locator(".summary-grid article")).toHaveCount(3);
    const pipelineCentre = page.getByLabel("Relationship pipeline centre");
    await pipelineCentre.focus();
    const centreAResponse = page.waitForResponse(response => response.url().includes(`/api/relationships/pipeline?centreId=${centreId}`));
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(pipelineCentre).toHaveValue(centreId!);
    const centreA = page.locator(".summary-grid article");
    await expect(centreA.nth(0).locator("strong")).toHaveText("1");
    await expect(centreA.nth(1).locator("strong")).toHaveText("1");
    await expect(centreA.nth(2).locator("strong")).toHaveText("1");
    await centreAResponse;
    const centreBResponsePromise = page.waitForResponse(response => response.url().includes(`/api/relationships/pipeline?centreId=${readOnlyCentreId}`));
    await pipelineCentre.selectOption(readOnlyCentreId!);
    await centreBResponsePromise;
    await expect(page.locator(".summary-grid article")).toHaveCount(3);
    for (const card of await page.locator(".summary-grid article").all()) await expect(card.locator("strong")).toHaveText("0");
    const deniedPipeline = await page.request.get(`/api/relationships/pipeline?centreId=${encodeURIComponent(deniedCentreId!)}`);
    expect(deniedPipeline.status()).toBe(403);
    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `relationship pipeline overflow at ${width}px`).toBe(true);
    }
    await page.unroute("**/api/relationships/pipeline*");

    // A013: internal versioned template records remain encrypted; no provider send is available.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/communications/notifications");
    await expect(page.getByRole("heading", { name: "Notification template governance" })).toBeVisible();
    await expect(page.getByText("Sending, scheduling and provider delivery are disabled.", { exact: false })).toBeVisible();
    const templateForm = page.locator("form").filter({ has: page.getByRole("heading", { name: "Create draft template" }) });
    await templateForm.getByLabel("Centre").selectOption(centreId!);
    await templateForm.getByLabel("Purpose").selectOption("OPERATIONAL");
    await templateForm.getByLabel("Channel").selectOption("EMAIL");
    const templateName = `Synthetic internal service template ${randomUUID().slice(0, 8)}`;
    await templateForm.getByLabel("Template name").fill(templateName);
    await templateForm.getByLabel("Message copy").fill("Hello {{firstName}}, please contact {{centreName}} regarding your service enquiry.");
    const createTemplatePromise = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/communications/templates"));
    await templateForm.getByRole("button", { name: "Save draft" }).click();
    const createTemplateResponse = await createTemplatePromise;
    expect(createTemplateResponse.status()).toBe(201);
    const createTemplateBody = await createTemplateResponse.json() as { template: { id: string; status: string; versionNumber: number }; delivery: string };
    expect(createTemplateBody).toMatchObject({ template: { status: "DRAFT", versionNumber: 1 }, delivery: "DISABLED" });
    await expect(page.getByText("Draft saved. It has not been sent.")).toBeVisible();
    const templateDetails = page.getByRole("region", { name: "Template details" });
    await templateDetails.getByLabel("Message copy").fill("Hello {{firstName}}, contact {{centreName}} for your service enquiry.");
    const updateTemplatePromise = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().endsWith(`/api/communications/templates/${createTemplateBody.template.id}`));
    await templateDetails.getByRole("button", { name: "Save draft changes" }).click();
    expect((await updateTemplatePromise).status()).toBe(200);
    await expect(page.getByText("Draft updated.")).toBeVisible();
    await templateDetails.getByLabel("Activation reason").fill("Internal synthetic workflow validation.");
    await expect(templateDetails.getByRole("button", { name: "Activate for internal use" })).toBeEnabled();
    const activateTemplatePromise = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().endsWith(`/api/communications/templates/${createTemplateBody.template.id}`));
    await templateDetails.getByRole("button", { name: "Activate for internal use" }).click();
    expect((await activateTemplatePromise).status()).toBe(200);
    await expect(page.getByText("Template activated for internal use. Delivery remains disabled.")).toBeVisible();
    await expect(page.getByRole("button", { name: /send|deliver/i })).toHaveCount(0);
    const templateStorage = await workflowPool.query(
      `SELECT t.status,t.version_number,t.private_data_ciphertext,count(e.id)::int AS event_count
         FROM communication_templates t JOIN communication_template_events e ON e.template_id=t.id
        WHERE t.id=$1 GROUP BY t.id`,
      [createTemplateBody.template.id],
    );
    expect(templateStorage.rowCount).toBe(1);
    expect(templateStorage.rows[0]).toMatchObject({ status: "ACTIVE", version_number: 3, event_count: 3 });
    expect(templateStorage.rows[0].private_data_ciphertext).not.toContain(templateName);

    // A004: retry the centre-scoped internal draft inbox after a transient failure.
    await page.goto("/communications/inbox");
    await expect(page.getByRole("heading", { name: "Unified communications inbox" })).toBeVisible();
    const inboxDraftsTab = page.getByRole("tab", { name: "Unsent drafts" });
    let inboxFailureInjected = false;
    await page.route("**/api/communications/drafts?*", async route => {
      if (!inboxFailureInjected) {
        inboxFailureInjected = true;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary_unavailable" }) });
      } else await route.continue();
    });
    await inboxDraftsTab.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Draft queue could not be loaded in your authorized scope.")).toBeVisible();
    const inboxRetry = page.waitForResponse(response => response.url().includes("/api/communications/drafts?") && response.status() === 200);
    await page.getByRole("button", { name: "Refresh" }).click();
    await inboxRetry;
    await expect(page.getByText("No internal drafts match these filters.")).toBeVisible();
    await page.unroute("**/api/communications/drafts?*");
    const deniedDrafts = await page.request.get(`/api/communications/drafts?centreId=${encodeURIComponent(deniedCentreId!)}&page=1`);
    expect(deniedDrafts.status()).toBe(403);
    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `communications inbox overflow at ${width}px`).toBe(true);
    }

    // A006/A007: internal support request lifecycle uses encrypted tasks and audit events.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/field/support");
    const supportTaskSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Create task" }) });
    await expect(supportTaskSection).toBeVisible();
    const supportTaskForm = supportTaskSection.locator("form");
    await supportTaskForm.getByLabel("Centre").selectOption(centreId!);
    const supportTitle = `Synthetic internal support request ${randomUUID().slice(0, 8)}`;
    await supportTaskForm.getByLabel("Title").fill(supportTitle);
    await supportTaskForm.getByLabel("Description").fill("Synthetic operations-only request; no patient or clinical details.");
    const supportCreate = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/tasks"));
    await supportTaskForm.getByRole("button", { name: "Create task" }).click();
    const supportCreateResponse = await supportCreate;
    expect(supportCreateResponse.status()).toBe(201);
    const supportBody = await supportCreateResponse.json() as { task: { id: string; taskNumber: string } };
    const supportStored = await workflowPool.query(
      "SELECT task_type,status,private_data_ciphertext FROM staff_tasks WHERE id=$1 AND centre_id=$2",
      [supportBody.task.id, centreId],
    );
    expect(supportStored.rowCount).toBe(1);
    expect(supportStored.rows[0]).toMatchObject({ task_type: "SUPPORT_REQUEST", status: "OPEN" });
    expect(supportStored.rows[0].private_data_ciphertext).not.toContain(supportTitle);

    let supportQueueFailureInjected = false;
    await page.route(url => url.pathname === "/api/tasks" && url.searchParams.get("type") === "SUPPORT_REQUEST", async route => {
      if (!supportQueueFailureInjected) {
        supportQueueFailureInjected = true;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary_unavailable" }) });
      } else await route.continue();
    });
    await page.goto(`/support/tickets?centreId=${encodeURIComponent(centreId!)}`);
    await expect(page.getByText("Support requests could not be loaded in your authorized scope.")).toBeVisible();
    const supportQueueRetry = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === "/api/tasks" && url.searchParams.get("type") === "SUPPORT_REQUEST" && response.status() === 200; });
    await page.getByRole("button", { name: "Refresh" }).click();
    await supportQueueRetry;
    const supportRow = page.getByRole("row").filter({ hasText: supportTitle });
    await expect(supportRow).toBeVisible();
    await supportRow.getByRole("link", { name: "Open request" }).click();
    await expect(page.getByRole("heading", { name: supportTitle })).toBeVisible();
    const startSupport = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().endsWith(`/api/tasks/${supportBody.task.id}`));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    expect((await startSupport).status()).toBe(200);
    await page.getByLabel("Comment").fill("Synthetic internal follow-up note.");
    const supportComment = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().endsWith(`/api/tasks/${supportBody.task.id}`));
    await page.getByRole("button", { name: "Add comment" }).click();
    expect((await supportComment).status()).toBe(200);
    await page.getByLabel("Recorded service outcome").selectOption("INTERNAL_OPERATIONAL_RESOLVED");
    const completeSupport = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().endsWith(`/api/tasks/${supportBody.task.id}`));
    await page.getByRole("button", { name: "Complete", exact: true }).click();
    expect((await completeSupport).status()).toBe(200);
    const supportEvents = await workflowPool.query("SELECT event_type FROM staff_task_events WHERE task_id=$1 ORDER BY recorded_at", [supportBody.task.id]);
    expect(supportEvents.rows.map(row => row.event_type)).toEqual(expect.arrayContaining(["CREATED", "STARTED", "COMMENTED", "COMPLETED"]));
    await expect(page.getByText("Recorded service outcome: internal operational resolved")).toBeVisible();
    await page.unroute(url => url.pathname === "/api/tasks" && url.searchParams.get("type") === "SUPPORT_REQUEST");

    // A002/A003/A008: encrypted governance drafts are centre-scoped and stay inactive.
    const governanceDrafts: Array<{ route: string; kind: "PROVIDER_POLICY" | "KNOWLEDGE"; channel?: "WHATSAPP" | "VOICE"; title: string; fill: (form: ReturnType<typeof page.locator>, title: string) => Promise<void> }> = [
      { route: "/communications/whatsapp", kind: "PROVIDER_POLICY", channel: "WHATSAPP", title: `Synthetic WhatsApp policy ${randomUUID().slice(0, 8)}`, fill: async (form, title) => { await form.getByLabel("Internal policy name").fill(title); await form.getByLabel("Supported language codes").fill("en, hi"); await form.getByLabel("Routing and human escalation instructions").fill("Route all uncertain requests to an authorized human reviewer."); } },
      { route: "/communications/voice", kind: "PROVIDER_POLICY", channel: "VOICE", title: `Synthetic voice policy ${randomUUID().slice(0, 8)}`, fill: async (form, title) => { await form.getByLabel("Internal policy name").fill(title); await form.getByLabel("Supported language codes").fill("en, mr"); await form.getByLabel("Routing and human escalation instructions").fill("Route all clinical questions to authorized staff; do not provide advice."); } },
      { route: "/ai/knowledge", kind: "KNOWLEDGE", title: `Synthetic service knowledge ${randomUUID().slice(0, 8)}`, fill: async (form, title) => { await form.getByLabel("Article title").fill(title); await form.getByLabel("Source reference").fill("Synthetic source reference for workflow testing"); await form.getByLabel("Draft content").fill("This synthetic draft explains that service availability must be confirmed by an authorized centre."); } },
    ];
    for (const item of governanceDrafts) {
      await page.goto(item.route);
      const workbench = page.getByRole("region", { name: item.kind === "KNOWLEDGE" ? "Knowledge drafts" : `${item.channel} policy drafts` });
      await expect(workbench).toBeVisible();
      const form = workbench.locator("form").filter({ has: page.getByRole("heading", { name: "Create governance draft" }) });
      await expect(form).toBeVisible();
      await workbench.getByLabel("Centre").selectOption(centreId!);
      await item.fill(form, item.title);
      const saveDraft = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/communications/governance"));
      await form.getByRole("button", { name: "Save encrypted draft" }).click();
      const draftResponse = await saveDraft;
      expect(draftResponse.status()).toBe(201);
      const draftBody = await draftResponse.json() as { record: { id: string; status: string; versionNumber: number }; delivery: string; publication: string };
      expect(draftBody).toMatchObject({ record: { status: "DRAFT", versionNumber: 1 }, delivery: "DISABLED", publication: "DISABLED" });
      const createdRow = page.getByRole("row").filter({ hasText: item.title });
      await expect(createdRow).toBeVisible();
      await createdRow.getByRole("button", { name: "Edit draft" }).click();
      const editForm = page.locator("form").filter({ has: page.getByRole("heading", { name: /Edit draft/ }) });
      if (item.kind === "KNOWLEDGE") await editForm.getByLabel("Draft content").fill("Updated synthetic service guidance. The centre must confirm availability before a request proceeds.");
      else await editForm.getByLabel("Routing and human escalation instructions").fill("Updated policy: route uncertain requests to an authorized human reviewer.");
      const updateDraft = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().endsWith(`/api/communications/governance/${draftBody.record.id}`));
      await editForm.getByRole("button", { name: "Save new draft version" }).click();
      expect((await updateDraft).status()).toBe(200);
      const governanceStorage = await workflowPool.query(
        `SELECT r.status,r.version_number,r.private_data_ciphertext,count(e.id)::int AS event_count
           FROM communication_governance_records r JOIN communication_governance_events e ON e.record_id=r.id
          WHERE r.id=$1 GROUP BY r.id`,
        [draftBody.record.id],
      );
      expect(governanceStorage.rowCount).toBe(1);
      expect(governanceStorage.rows[0]).toMatchObject({ status: "DRAFT", version_number: 2, event_count: 2 });
      expect(governanceStorage.rows[0].private_data_ciphertext).not.toContain(item.title);
    }
    // configuration.read is organization-scoped: an authorized governance operator may select another centre,
    // but centre-filtered records and history must not leak from the selected centre.
    const otherCentreGovernance = await page.request.get(`/api/communications/governance?centreId=${encodeURIComponent(deniedCentreId!)}&recordKind=KNOWLEDGE`);
    expect(otherCentreGovernance.status()).toBe(200);
    expect((await otherCentreGovernance.json() as { records: unknown[] }).records).toHaveLength(0);

    // Phase 09: keep internal campaign data scoped to the selected centre even
    // when the preceding centre's slower response arrives after a centre switch.
    let delayedCentreRequestSeen = false;
    let markDelayedCentreRequest!: () => void;
    const delayedCentreRequest = new Promise<void>(resolve => { markDelayedCentreRequest = resolve; });
    await page.route(url => url.pathname === "/api/marketing/campaigns" && url.searchParams.get("centreId") === centreId, async route => {
      if (!delayedCentreRequestSeen) {
        delayedCentreRequestSeen = true;
        markDelayedCentreRequest();
        await new Promise(resolve => setTimeout(resolve, 1_200));
      }
      await route.continue();
    });
    await page.goto("/marketing/campaigns");
    await expect(page.getByRole("heading", { name: "Internal campaign directory and attribution" })).toBeVisible();
    const campaignCentre = page.locator(".task-toolbar").getByLabel("Centre");
    if (await campaignCentre.inputValue() !== centreId) await campaignCentre.selectOption(centreId!);
    await delayedCentreRequest;
    const otherCentreCampaignResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/marketing/campaigns" && url.searchParams.get("centreId") === readOnlyCentreId && response.status() === 200;
    });
    await campaignCentre.selectOption(readOnlyCentreId!);
    await otherCentreCampaignResponse;
    await expect(page.getByText("No internal campaigns recorded for this centre.")).toBeVisible();
    await page.waitForTimeout(1_300);
    await expect(campaignCentre).toHaveValue(readOnlyCentreId!);
    await expect(page.getByText("No internal campaigns recorded for this centre.")).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(1);
    await page.unroute(url => url.pathname === "/api/marketing/campaigns" && url.searchParams.get("centreId") === centreId);

    const authorizedCampaignResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/marketing/campaigns" && url.searchParams.get("centreId") === centreId && response.status() === 200;
    });
    await campaignCentre.selectOption(centreId!);
    await authorizedCampaignResponse;
    const campaignForm = page.locator("form").filter({ has: page.getByRole("heading", { name: "Create campaign record" }) });
    const campaignCode = `SYN${randomUUID().slice(0, 8)}`;
    const campaignName = `Synthetic internal attribution ${randomUUID().slice(0, 8)}`;
    await campaignForm.getByLabel("Campaign code").fill(campaignCode);
    await campaignForm.getByLabel("Name", { exact: true }).fill(campaignName);
    await campaignForm.getByLabel("Internal description").fill("Synthetic internal lead attribution only.");
    await campaignForm.getByLabel("Channel").selectOption("REFERRAL");
    const campaignCreate = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/marketing/campaigns"));
    await campaignForm.getByRole("button", { name: "Save draft" }).click();
    const campaignCreateResponse = await campaignCreate;
    expect(campaignCreateResponse.status()).toBe(201);
    await expect(page.getByText("Campaign saved as an internal draft. No publication, messaging or advertising spend occurred.")).toBeVisible();
    const campaignRow = page.getByRole("row").filter({ hasText: campaignCode });
    await expect(campaignRow).toContainText(campaignName);
    const storedCampaign = await workflowPool.query("SELECT centre_id,status,private_data_ciphertext FROM marketing_campaigns WHERE campaign_code=$1", [campaignCode]);
    expect(storedCampaign.rowCount).toBe(1);
    expect(storedCampaign.rows[0]).toMatchObject({ centre_id: centreId, status: "DRAFT" });
    expect(storedCampaign.rows[0].private_data_ciphertext).not.toContain(campaignName);

    page.once("dialog", dialog => dialog.accept("Synthetic internal tracking validation."));
    const activateCampaign = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().includes("/api/marketing/campaigns/"));
    await campaignRow.getByRole("button", { name: "Activate tracking" }).click();
    expect((await activateCampaign).status()).toBe(200);
    await expect(page.getByRole("row").filter({ hasText: campaignCode })).toContainText("ACTIVE");
    await expect(page.getByText("This workspace does not publish content, send communications or spend advertising funds.")).toBeVisible();
  } finally {
    await workflowPool.end();
  }
});
