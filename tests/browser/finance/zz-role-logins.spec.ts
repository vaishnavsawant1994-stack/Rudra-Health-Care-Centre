import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test } from "@playwright/test";

// The manager session is captured only in memory after a real password + MFA
// login. The later same-journey staff actions reuse that authenticated session;
// no password, TOTP seed, or session state is written to disk or CI artifacts.
let managerStorageState: Awaited<ReturnType<import("@playwright/test").BrowserContext["storageState"]>> | undefined;
let syntheticAssignedJob: { id: string; number: string } | undefined;

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
    if (identity.key === "COLLECTOR" && syntheticAssignedJob) {
      const assignedQueue = await page.request.get(`/api/collections?centreId=${centreId}&assignedToMe=1`);
      expect(assignedQueue.status(), "collector reads only the permitted assigned queue").toBe(200);
      const queueBody = await assignedQueue.json() as { jobs: Array<{ id: string; jobNumber: string }> };
      expect(queueBody.jobs).toContainEqual(expect.objectContaining(syntheticAssignedJob));
      await page.goto(`/field/jobs/${syntheticAssignedJob.id}`);
      await expect(page.getByRole("heading", { name: syntheticAssignedJob.number })).toBeVisible();
      await expect(page.getByRole("button", { name: "Accept assignment" })).toBeVisible();
      // Stop at the assigned job. No arrival, identity claim, collection,
      // custody or branch receipt is recorded while consent is absent and no
      // active collection procedure exists in this synthetic centre.
    }
    if (identity.key === "RECEPTION") {
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

        await managerPage.goto("/collections");
        const createJobForm = managerPage.locator("form.admin-form").filter({ has: managerPage.getByRole("heading", { name: "Start from a confirmed appointment and order" }) });
        await expect(createJobForm.getByLabel("Eligible booking")).toBeVisible();
        await createJobForm.getByLabel("Eligible booking").selectOption(orderBody.order.id);
        const createJobResponse = managerPage.waitForResponse(response =>
          response.request().method() === "POST" && new URL(response.url()).pathname === "/api/collections",
        );
        await createJobForm.getByRole("button", { name: "Create collection job" }).click();
        const createdJobHttp = await createJobResponse;
        expect(createdJobHttp.status(), "manager creates a job only after both records are confirmed").toBe(201);
        const createdJobBody = await createdJobHttp.json() as { job: { id: string; jobNumber: string; status: string } };
        expect(createdJobBody.job.status).toBe("PENDING_ASSIGNMENT");
        syntheticAssignedJob = { id: createdJobBody.job.id, number: createdJobBody.job.jobNumber };

        await managerPage.goto(`/field/jobs/${createdJobBody.job.id}`);
        const assignmentForm = managerPage.locator("form.admin-form").filter({ has: managerPage.getByRole("heading", { name: "Staff assignment" }) });
        const collectorSelect = assignmentForm.getByLabel("Authorized collector");
        const collectorOption = collectorSelect.locator("option").filter({ hasText: "Synthetic Field Collector" });
        await expect(collectorOption).toHaveCount(1);
        const collectorId = await collectorOption.getAttribute("value");
        expect(collectorId).toBeTruthy();
        await collectorSelect.selectOption(collectorId!);
        await assignmentForm.getByLabel("Assignment reason").fill("Synthetic manager assignment for isolated workflow verification");
        const assignCollectorResponse = managerPage.waitForResponse(response =>
          response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/collections/${createdJobBody.job.id}`,
        );
        await assignmentForm.getByRole("button", { name: "Assign collector" }).click();
        expect((await assignCollectorResponse).status(), "manager assigns an active collector through collection controls").toBe(200);
        await expect(managerPage.getByText("Collection workflow updated.")).toBeVisible();

        const completionPool = new pg.Pool({ connectionString: process.env.DATABASE_TEST_URL, max: 1 });
        try {
          const verified = await completionPool.query(
            "SELECT o.status AS order_status,o.total_amount,a.status AS appointment_status,j.status AS job_status,j.assigned_staff_id,cs.display_name AS collector_name,(SELECT count(*)::int FROM diagnostic_order_status_history h WHERE h.order_id=o.id AND h.to_status='CONFIRMED') AS order_history,(SELECT count(*)::int FROM appointment_status_history h WHERE h.appointment_id=a.id AND h.to_status='CONFIRMED') AS appointment_history,(SELECT count(*)::int FROM collection_job_events e WHERE e.job_id=j.id AND e.event_type='ASSIGNED' AND e.staff_id=j.assigned_staff_id) AS assignment_events,(SELECT count(*)::int FROM audit_events e WHERE e.entity_id=o.id::text AND e.action='diagnostic_order.confirmed') AS order_audits,(SELECT count(*)::int FROM audit_events e WHERE e.entity_id=a.id::text AND e.action='appointment.updated') AS appointment_audits,(SELECT count(*)::int FROM audit_events e WHERE e.entity_id=j.id::text AND e.action='collection_job.assigned') AS assignment_audits,p.consent_status,(SELECT count(*)::int FROM sample_procedure_approvals sp WHERE sp.centre_id=a.centre_id AND sp.operation='COLLECTION' AND sp.status='ACTIVE') AS active_collection_procedures,(SELECT count(*)::int FROM specimens s WHERE s.job_id=j.id) AS specimen_count FROM diagnostic_orders o JOIN appointments a ON a.id=o.appointment_id AND a.centre_id=o.centre_id JOIN collection_jobs j ON j.order_id=o.id AND j.appointment_id=a.id JOIN patients p ON p.id=o.patient_id AND p.centre_id=o.centre_id JOIN staff_users cs ON cs.id=j.assigned_staff_id WHERE o.id=$1 AND j.id=$2 AND o.centre_id=$3 GROUP BY o.id,a.id,j.id,p.id,cs.id",
            [orderBody.order.id, createdJobBody.job.id, centreId],
          );
          expect(verified.rowCount).toBe(1);
          expect(verified.rows[0]).toMatchObject({ order_status: "CONFIRMED", total_amount: "125.00", appointment_status: "CONFIRMED", job_status: "ASSIGNED", collector_name: "Synthetic Field Collector", order_history: 1, appointment_history: 1, assignment_events: 1, order_audits: 1, appointment_audits: 1, assignment_audits: 1, consent_status: "NOT_RECORDED", active_collection_procedures: 0, specimen_count: 0 });
        } finally {
          await completionPool.end();
        }
      } finally {
        await managerContext.close();
      }
    }
  });
}
