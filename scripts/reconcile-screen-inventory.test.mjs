import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ACCEPTANCE_COLUMNS, acceptanceSnapshot, checkAcceptanceBaseline, mergeGeneratedMatrix } from "./screen-inventory-evidence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseCsvRow(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { values.push(value); value = ""; }
    else value += char;
  }
  values.push(value);
  return values;
}

describe("178-screen inventory reconciliation", () => {
  let lines;
  let header;
  beforeAll(async () => {
    const run = spawnSync(process.execPath, [path.join(root, "scripts", "reconcile-screen-inventory.mjs")], { cwd: root, encoding: "utf8", timeout: 240_000 });
    expect(run.status, run.stderr || run.error?.message).toBe(0);
    const csv = await readFile(path.join(root, "docs", "SCREEN_IMPLEMENTATION_MATRIX.csv"), "utf8");
    lines = csv.trimEnd().split(/\r?\n/);
    header = parseCsvRow(lines[0]);
  }, 245_000);

  it("validates W008 as the routed review step without treating it as appointment confirmation", async () => {
    const row = parseCsvRow(lines.find((line) => line.startsWith('"W008",')));
    expect(lines).toHaveLength(179);
    expect(row[header.indexOf("Exact source route")]).toContain("/book/review (src/app/book/review/page.tsx)");
    expect(row[header.indexOf("Explicit grouped screen mapping")]).toContain("/book/review (src/app/book/review/page.tsx)");
    expect(row[header.indexOf("Explicit grouped screen mapping")]).toContain("staff-reviewed enquiry");
    expect(row[header.indexOf("Implementation status (evidence-based)")]).toContain("explicit grouped-route mapping is source-validated");
    expect(row[header.indexOf("Evidence limitations")]).toContain("not an appointment");
  });

  it("maps W010 to a reference-only receipt and W015 to the privacy-safe patient boundary", async () => {
    const rowFor = (id) => parseCsvRow(lines.find((line) => line.startsWith(`"${id}",`)));
    const w010 = rowFor("W010");
    expect(w010[header.indexOf("Exact source route")]).toContain("/booking/success/[id]");
    expect(w010[header.indexOf("Direct page imports")]).toContain("public-enquiry-receipt");
    expect(w010[header.indexOf("Evidence limitations")]).toContain("does not confirm an appointment");
    const receiptPage = await readFile(path.join(root, "src", "app", "booking", "success", "[id]", "page.tsx"), "utf8");
    expect(receiptPage).toContain("index: false, follow: false");
    const w015 = rowFor("W015");
    expect(w015[header.indexOf("Exact source route")]).toContain("No public report-entry route");
    expect(w015[header.indexOf("Explicit grouped screen mapping")]).toContain("/report-access");
    expect(w015[header.indexOf("External or policy blockers")]).toContain("identity proofing");
    const staffReports = await readFile(path.join(root, "src", "app", "reports", "page.tsx"), "utf8");
    expect(staffReports).toContain('permission="reports.read"');
  });

  it("keeps the human-readable summary aligned with generated route and status counts", async () => {
    const rows = lines.slice(1).map(parseCsvRow);
    const column = (name) => header.indexOf(name);
    const exactRoutes = rows.filter((row) => !row[column("Exact source route")].startsWith("No ")).length;
    const missingRoutes = rows.length - exactRoutes;
    const explicitMappings = rows.filter((row) => row[column("Explicit grouped screen mapping")]).length;
    const unresolvedMappings = rows.filter((row) => row[column("Exact source route")].startsWith("No ") && !row[column("Explicit grouped screen mapping")]).length;
    const statuses = rows.map((row) => row[column("Implementation status (evidence-based)")]);
    const summary = await readFile(path.join(root, "docs", "SCREEN_IMPLEMENTATION_MATRIX.md"), "utf8");

    expect(rows).toHaveLength(178);
    expect([exactRoutes, missingRoutes, explicitMappings, unresolvedMappings]).toEqual([177, 1, 24, 0]);
    expect(statuses.filter((status) => status.includes("page, module APIs and related tests exist"))).toHaveLength(128);
    expect(statuses.filter((status) => status.includes("explicit grouped-route mapping is source-validated"))).toHaveLength(23);
    expect(statuses.filter((status) => status.includes("mapping unresolved"))).toHaveLength(0);
    expect(statuses.filter((status) => status.includes("Blocked by external decision or integration"))).toHaveLength(27);
    expect(summary).toContain("**177** IDs have a page file whose route matches the proposed route shape");
    expect(summary).toContain("**1** ID has no exact route-shape match: W015 is explicitly mapped to the privacy-safe `/report-access` explanation.");
    expect(summary).toContain("The other 23 explicit grouped mappings are covered by exact canonical routes");
    expect(summary).toContain("**0** IDs lack both a route match and an explicit mapping");
    expect(summary).toContain("**128 partially implemented with page/API/test candidates**");
    expect(summary).toContain("**27 blocked by an identity-proofing, policy or external dependency**");
    expect(summary).toContain("**0 partially implemented with source/action mapping unresolved**");
  });

  it("keeps generated release counts separate from route and acceptance evidence", async () => {
    const readiness = JSON.parse(await readFile(path.join(root, "src", "server", "screen-implementation-summary.json"), "utf8"));
    expect(readiness.screenCount).toBe(178);
    expect(readiness.exactRouteEvidence + readiness.missingRouteEvidence).toBe(178);
    expect(Object.values(readiness.implementation).reduce((total, count) => total + count, 0)).toBe(178);
    expect(readiness.implementation.fullyImplemented).toBe(0);
    expect(readiness.acceptance).toEqual({ manuallyAccepted: 0, pendingManual: 178 });
    expect(Object.values(readiness.phases).reduce((total, count) => total + count, 0)).toBe(178);
  });

  it("preserves all 12 Phase 11 IDs and keeps their evidence dimensions separate", async () => {
    const rows = lines.slice(1).map(parseCsvRow);
    const column = (name) => header.indexOf(name);
    const admin = rows.filter((row) => /^S\d{3}$/.test(row[column("ID")]));
    expect(admin).toHaveLength(12);
    for (const row of admin) {
      expect(row[column("Exact source route")]).toContain(row[column("Target route")]);
      expect(row[column("Visual reference status")]).toContain("Not independently verified");
      expect(row[column("Manual desktop/mobile status")]).toContain("Pending");
      expect(row[column("Final Owner/QA acceptance")]).toContain("Pending");
      expect(row[column("Deployment readiness")]).toContain("Not assessed");
    }
  });

  it("matches Next.js dynamic segment names to the canonical screen route shape", () => {
    const rowFor = (id) => parseCsvRow(lines.find((line) => line.startsWith(`"${id}",`)));
    for (const [id, sourceRoute] of [
      ["P004", "/account/family/[memberId] (src/app/account/family/[memberId]/page.tsx)"],
      ["P005", "/account/orders/[orderId]/journey (src/app/account/orders/[orderId]/journey/page.tsx)"],
      ["P007", "/account/appointments/[appointmentId]/change (src/app/account/appointments/[appointmentId]/change/page.tsx)"],
    ]) expect(rowFor(id)[header.indexOf("Exact source route")]).toBe(sourceRoute);
  });

  it("maps support queue and detail screens to the existing encrypted task lifecycle", async () => {
    const rowFor = (id) => parseCsvRow(lines.find((line) => line.startsWith(`"${id}",`)));
    const queue = rowFor("A006");
    const detail = rowFor("A007");
    expect(queue[header.indexOf("Candidate API routes by module")]).toContain("/api/tasks");
    expect(detail[header.indexOf("Candidate API routes by module")]).toContain("/api/tasks/[id]");
    expect(queue[header.indexOf("Related test files")]).toContain("src/app/api/tasks/route.test.ts");
    expect(detail[header.indexOf("Related test files")]).toContain("src/app/api/tasks/[id]/route.test.ts");
    expect(queue[header.indexOf("Implementation status (evidence-based)")]).toContain("requirements still need action-by-action verification");
    expect(detail[header.indexOf("Implementation status (evidence-based)")]).toContain("requirements still need action-by-action verification");
  });

  it("maps all Phase 08 routes and records provider and AI restrictions", () => {
    const rowFor = (id) => parseCsvRow(lines.find((line) => line.startsWith(`"${id}",`)));
    const column = (name) => header.indexOf(name);
    const routes = {
      A001: "/chat", A002: "/communications/whatsapp", A003: "/communications/voice",
      A004: "/communications/inbox", A005: "/communications/conversations/[id]",
      A006: "/support/tickets", A007: "/support/tickets/[id]", A008: "/ai/knowledge",
      A009: "/ai/reviews", A010: "/communications/outbound", A011: "/communications/calls",
      A012: "/communications/recovery", A013: "/communications/notifications",
    };
    for (const [id, route] of Object.entries(routes)) {
      const row = rowFor(id);
      expect(row[column("Target route")]).toBe(route);
      expect(row[column("Exact source route")]).toContain(route);
    }
    expect(rowFor("A002")[column("External or policy blockers")]).toContain("provider credentials");
    expect(rowFor("A003")[column("External or policy blockers")]).toContain("lawful recording notice");
    expect(rowFor("A005")[column("External or policy blockers")]).toContain("No conversation/transcript entity");
    expect(rowFor("A008")[column("External or policy blockers")]).toContain("review, approval, expiry enforcement");
    expect(rowFor("A009")[column("External or policy blockers")]).toContain("No deployed model transcripts");
    expect(rowFor("A010")[column("External or policy blockers")]).toContain("outbound audiences");
    expect(rowFor("A013")[column("External or policy blockers")]).toContain("internal-only");
  });

  it("maps M017 to campaign and linked appointment aggregates without claiming payment or platform attribution", async () => {
    const row = parseCsvRow(lines.find((line) => line.startsWith('"M017",')));
    expect(row[header.indexOf("Exact source route")]).toContain("/marketing/attribution (src/app/marketing/attribution/page.tsx)");
    expect(row[header.indexOf("Explicit grouped screen mapping")]).toContain("/marketing/campaigns (src/app/marketing/campaigns/page.tsx)");
    expect(row[header.indexOf("Explicit grouped screen mapping")]).toContain("payment attribution and external platform data are not part of this mapping");
    expect(row[header.indexOf("Implementation status (evidence-based)")]).toContain("explicit grouped-route mapping is source-validated");
    expect(row[header.indexOf("Evidence limitations")]).toContain("does not provide payment/revenue attribution, platform data");
  });

  it("keeps all Phase 09 canonical routes and preview identity drift explicit", async () => {
    const rowFor = (id) => parseCsvRow(lines.find((line) => line.startsWith(`"${id}",`)));
    const crosswalk = await readFile(path.join(root, "docs", "MARKETING_SCREEN_CROSSWALK_M001_M018.md"), "utf8");
    for (const id of Array.from({ length: 18 }, (_, index) => `M${String(index + 1).padStart(3, "0")}`)) {
      expect(rowFor(id)[header.indexOf("Exact source route")]).not.toBe("No exact target route file found");
      expect(rowFor(id)[header.indexOf("Target route")]).toMatch(/^\/marketing(?:\/|$)/);
    }
    expect(rowFor("M008")[header.indexOf("Target screen")]).toBe("Instagram / Facebook content workspace");
    expect(rowFor("M009")[header.indexOf("Target screen")]).toBe("YouTube / video content workspace");
    expect(rowFor("M010")[header.indexOf("Target screen")]).toBe("LinkedIn / corporate campaigns");
    expect(rowFor("M011")[header.indexOf("Target screen")]).toBe("Google Business & reputation");
    expect(crosswalk).toContain("Social Reviews & Online Reputation Management");
    expect(crosswalk).toContain("The original IDs/routes remain stable");
  });

  it("maps corporate directory and 360 profiles to canonical centre-scoped routes without overstating completeness", async () => {
    const rowFor = (id) => parseCsvRow(lines.find((line) => line.startsWith(`"${id}",`)));
    const directory = rowFor("C006");
    const profile = rowFor("C008");
    expect(directory[header.indexOf("Explicit grouped screen mapping")]).toContain("/relationships/corporate (src/app/relationships/corporate/page.tsx)");
    expect(profile[header.indexOf("Explicit grouped screen mapping")]).toContain("/relationships/corporate/[id] (src/app/relationships/corporate/[id]/page.tsx)");
    expect(profile[header.indexOf("Implementation status (evidence-based)")]).toContain("explicit grouped-route mapping is source-validated");
    expect(profile[header.indexOf("Evidence limitations")]).toContain("does not implement corporate camps, employee scheduling, contracts");
  });

  it("maps front-desk handover to the encrypted staff handover workflow without claiming automatic queue transfer", async () => {
    const row = parseCsvRow(lines.find((line) => line.startsWith('"R018",')));
    expect(row[header.indexOf("Exact source route")]).toBe("/staff/handover (src/app/staff/handover/page.tsx)");
    expect(row[header.indexOf("Explicit grouped screen mapping")]).toContain("/roster/handovers (src/app/roster/handovers/page.tsx)");
    expect(row[header.indexOf("Implementation status (evidence-based)")]).toContain("explicit grouped-route mapping is source-validated");
    expect(row[header.indexOf("Evidence limitations")]).toContain("does not automatically transfer cash, appointments, tasks");
  });

  it("maps the actionable walk-in queue and arrival check-in without claiming QR identity verification", async () => {
    const rowFor = (id) => parseCsvRow(lines.find((line) => line.startsWith(`"${id}",`)));
    const queue = rowFor("R011");
    const arrivals = rowFor("R012");
    expect(queue[header.indexOf("Explicit grouped screen mapping")]).toContain("/workspaces/[role] (src/app/workspaces/[role]/page.tsx)");
    expect(queue[header.indexOf("Evidence limitations")]).toContain("QR identity scan");
    expect(arrivals[header.indexOf("Explicit grouped screen mapping")]).toContain("/appointments/arrivals (src/app/appointments/arrivals/page.tsx)");
    expect(arrivals[header.indexOf("Evidence limitations")]).toContain("QR scanning and identity verification are not implemented");
  });

  it("maps field exception actions to assigned collection and sample workflows without overstating scope", async () => {
    const row = parseCsvRow(lines.find((line) => line.startsWith('"F012",')));
    expect(row[header.indexOf("Explicit grouped screen mapping")]).toContain("/field/today (src/app/field/today/page.tsx)");
    expect(row[header.indexOf("Explicit grouped screen mapping")]).toContain("open assigned exceptions are listed at /field/exceptions");
    expect(row[header.indexOf("Evidence limitations")]).toContain("no-show/insufficient-specimen reason taxonomy");
    expect(row[header.indexOf("Implementation status (evidence-based)")]).toContain("explicit grouped-route mapping is source-validated");
  });

  it("maps the staff appointment and order workflow to canonical protected routes with lifecycle boundaries", async () => {
    const rowFor = (id) => parseCsvRow(lines.find((line) => line.startsWith(`"${id}",`)));
    const calendar = rowFor("R007");
    const booking = rowFor("R008");
    const order = rowFor("R009");
    const detail = rowFor("R010");
    expect(calendar[header.indexOf("Explicit grouped screen mapping")]).toContain("/appointments/calendar");
    expect(calendar[header.indexOf("Evidence limitations")]).toContain("does not filter by assigned staff");
    expect(booking[header.indexOf("Explicit grouped screen mapping")]).toContain("/appointments/new");
    expect(booking[header.indexOf("Evidence limitations")]).toContain("not a confirmed appointment or guaranteed slot");
    expect(order[header.indexOf("Explicit grouped screen mapping")]).toContain("/orders/new");
    expect(order[header.indexOf("Evidence limitations")]).toContain("does not trigger sample collection");
    expect(detail[header.indexOf("Explicit grouped screen mapping")]).toContain("/orders/[id]");
    expect(detail[header.indexOf("Evidence limitations")]).toContain("does not advance sample, laboratory, report or invoice lifecycles");
  });

  it("maps the Phase 05 canonical routes and records the clinical/integration gates", async () => {
    const rowFor = (id) => parseCsvRow(lines.find((line) => line.startsWith(`"${id}",`)));
    for (const [id, route] of [
      ["L001", "/branch"], ["L002", "/branch/samples"], ["L003", "/branch/receive"], ["L004", "/branch/quality-check"],
      ["L005", "/branch/dispatch"], ["L006", "/branch/handover"], ["L007", "/branch/transit"], ["L008", "/integrations/metropolis/links"],
      ["L009", "/integrations/metropolis/status"], ["L010", "/branch/recollection"], ["L011", "/branch/lab-progress"],
      ["L012", "/integrations/metropolis/imports"], ["L013", "/branch/reports/intake"], ["L014", "/branch/reports/deliver"],
      ["L015", "/branch/reports/exceptions"], ["L016", "/staff/orders/[id]/journey"], ["L017", "/branch/critical-alerts"],
    ]) expect(rowFor(id)[header.indexOf("Exact source route")]).toContain(route);
    const imports = rowFor("L012");
    expect(imports[header.indexOf("External or policy blockers")]).toContain("no approved CSV schema");
    expect(rowFor("L017")[header.indexOf("External or policy blockers")]).toContain("critical-result thresholds");
    expect(rowFor("L016")[header.indexOf("Explicit grouped screen mapping")]).toContain("authorized order journey");
  });

  it("preserves historical custody evidence without regenerating stale verification totals", async () => {
    const rowFor = (id) => parseCsvRow(lines.find((line) => line.startsWith(`"${id}",`)));
    for (const id of ["L003", "L005", "L006", "L007"]) {
      const row = rowFor(id);
      expect(row[header.indexOf("Related test files")]).toContain("src/app/api/public/enquiries/route.db.integration.test.ts");
      expect(row[header.indexOf("Backend/API evidence status")]).toContain("Synthetic PostgreSQL Wave4 coverage");
      expect(row[header.indexOf("Acceptance status")]).toContain("Pending");
      expect(row[header.indexOf("Final Owner/QA acceptance")]).toContain("Pending");
    }
    expect(rowFor("L007")[header.indexOf("Backend/API evidence status")]).toContain("no destination or Metropolis receipt");
  });

  it("preserves Wave 7/8 manual evidence while refreshing machine-derived route fields", () => {
    const rowFor = (id) => parseCsvRow(lines.find((line) => line.startsWith(`"${id}",`)));
    const column = (name) => header.indexOf(name);
    for (const id of ["B002", "B005", "B009", "L016", "S001"]) {
      const row = rowFor(id);
      expect(row[column("Backend/API evidence status")]).toContain("Wave 8:");
      expect(row[column("Automated QA evidence status")]).toContain("Wave 8:");
      expect(row[column("Acceptance status")]).toContain("Pending");
      expect(row[column("Final Owner/QA acceptance")]).toContain("Pending");
    }
  });

  it("keeps matrix, route evidence, summary and acceptance baseline byte-stable on repeated generation", async () => {
    const paths = [
      path.join(root, "docs", "SCREEN_IMPLEMENTATION_MATRIX.csv"),
      path.join(root, "docs", "SCREEN_ROUTE_EVIDENCE.json"),
      path.join(root, "src", "server", "screen-implementation-summary.json"),
      path.join(root, "docs", "SCREEN_ACCEPTANCE_BASELINE.json"),
    ];
    const before = await Promise.all(paths.map((file) => readFile(file)));
    const run = spawnSync(process.execPath, [path.join(root, "scripts", "reconcile-screen-inventory.mjs")], { cwd: root, encoding: "utf8", timeout: 240_000 });
    expect(run.status, run.stderr || run.error?.message).toBe(0);
    const after = await Promise.all(paths.map((file) => readFile(file)));
    expect(after.map((value) => value.toString("hex"))).toEqual(before.map((value) => value.toString("hex")));
  }, 245_000);

  it("requires an explicit review reference for manual acceptance changes", () => {
    const row = Object.fromEntries([
      ["ID", "W001"], ["Experience group", "Public"], ["Target screen", "Home"], ["Target route", "/"],
      ["Access in spec", "Public"], ["Required controls/workflow", "Browse"], ["Authoritative objects in spec", "Content"],
      ...ACCEPTANCE_COLUMNS.map((column) => [column, "Pending"]),
    ]);
    const baseline = { entries: acceptanceSnapshot([row]) };
    const changed = { ...row, "Final Owner/QA acceptance": "Accepted after explicit owner review" };
    expect(() => checkAcceptanceBaseline({ rows: [changed], baseline })).toThrow("manual_acceptance_change_requires_review:W001:Final Owner/QA acceptance");
    const reviewed = checkAcceptanceBaseline({ rows: [changed], baseline, acceptChanges: true, reviewReference: "OWNER-REVIEW-2026-11-16" });
    expect(reviewed.changed).toHaveLength(1);
    expect(reviewed.baseline.W001["Final Owner/QA acceptance"]).toBe(changed["Final Owner/QA acceptance"]);
  });

  it("rejects duplicate and missing canonical inventory identifiers", () => {
    const generated = [{ ID: "W001" }, { ID: "W001" }];
    expect(() => mergeGeneratedMatrix({ generated, existing: [], expectedIds: ["W001"] })).toThrow("generated_matrix_duplicate_ids:W001");
    expect(() => mergeGeneratedMatrix({ generated: [{ ID: "W001" }], existing: [], expectedIds: ["W001", "W002"] })).toThrow("canonical_inventory_id_conflict:missing=W002");
  });

  it("maps reception patient and family workflows while preserving permission and consent boundaries", async () => {
    const rowFor = (id) => parseCsvRow(lines.find((line) => line.startsWith(`"${id}",`)));
    const search = rowFor("R002");
    const profile = rowFor("R003");
    const registration = rowFor("R004");
    const family = rowFor("R005");
    const timeline = rowFor("R006");
    expect(search[header.indexOf("Explicit grouped screen mapping")]).toContain("/patients (src/app/patients/page.tsx)");
    expect(profile[header.indexOf("Explicit grouped screen mapping")]).toContain("/patients/[id]");
    expect(profile[header.indexOf("Evidence limitations")]).toContain("family association does not authorize access");
    expect(registration[header.indexOf("Explicit grouped screen mapping")]).toContain("/patients/new");
    expect(registration[header.indexOf("Evidence limitations")]).toContain("does not establish legal basis");
    expect(family[header.indexOf("Explicit grouped screen mapping")]).toContain("/families/[id]");
    expect(family[header.indexOf("Evidence limitations")]).toContain("Family links do not grant medical access");
    expect(timeline[header.indexOf("Evidence limitations")]).toContain("embedded profile section");
  });

  it("maps reception CRM, communications and catalogue while keeping unconnected actions explicit", async () => {
    const rowFor = (id) => parseCsvRow(lines.find((line) => line.startsWith(`"${id}",`)));
    const lead = rowFor("R013");
    const detail = rowFor("R014");
    const inbox = rowFor("R015");
    const catalogue = rowFor("R016");
    const quote = rowFor("R017");
    expect(lead[header.indexOf("Explicit grouped screen mapping")]).toContain("/leads (src/app/leads/page.tsx)");
    expect(lead[header.indexOf("Evidence limitations")]).toContain("does not authorize outreach");
    expect(detail[header.indexOf("Explicit grouped screen mapping")]).toContain("/leads/[id]");
    expect(inbox[header.indexOf("Explicit grouped screen mapping")]).toContain("/communications");
    expect(inbox[header.indexOf("Evidence limitations")]).toContain("not a telephone/call system");
    expect(catalogue[header.indexOf("Explicit grouped screen mapping")]).toContain("/catalogue/tests");
    expect(catalogue[header.indexOf("Evidence limitations")]).toContain("not approved customer prices");
    expect(quote[header.indexOf("Exact source route")]).toBe("/staff/quotes (src/app/staff/quotes/page.tsx)");
    expect(quote[header.indexOf("Explicit grouped screen mapping")]).toBe("");
    expect(quote[header.indexOf("Candidate API routes by module")]).toContain("/api/leads/[id]/quotes");
    expect(quote[header.indexOf("Related test files")]).toContain("src/app/api/leads/[id]/quotes/route.db.integration.test.ts");
    expect(quote[header.indexOf("Implementation status (evidence-based)")]).toContain("page, module APIs and related tests exist");
  });
});
