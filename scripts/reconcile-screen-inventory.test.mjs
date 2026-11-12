import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

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
    const run = spawnSync(process.execPath, [path.join(root, "scripts", "reconcile-screen-inventory.mjs")], { cwd: root, encoding: "utf8", timeout: 15_000 });
    expect(run.status, run.stderr || run.error?.message).toBe(0);
    const csv = await readFile(path.join(root, "docs", "SCREEN_IMPLEMENTATION_MATRIX.csv"), "utf8");
    lines = csv.trimEnd().split(/\r?\n/);
    header = parseCsvRow(lines[0]);
  }, 20_000);

  it("validates W008 as the routed review step without treating it as appointment confirmation", async () => {
    const row = parseCsvRow(lines.find((line) => line.startsWith('"W008",')));
    expect(lines).toHaveLength(179);
    expect(row[header.indexOf("Exact source route")]).toContain("/book/review (src/app/book/review/page.tsx)");
    expect(row[header.indexOf("Explicit grouped screen mapping")]).toContain("/book/review (src/app/book/review/page.tsx)");
    expect(row[header.indexOf("Explicit grouped screen mapping")]).toContain("staff-reviewed enquiry");
    expect(row[header.indexOf("Implementation status (evidence-based)")]).toContain("explicit grouped-route mapping is source-validated");
    expect(row[header.indexOf("Evidence limitations")]).toContain("not an appointment");
  });

  it("keeps the human-readable summary aligned with generated route and status counts", async () => {
    const rows = lines.slice(1).map(parseCsvRow);
    const column = (name) => header.indexOf(name);
    const exactRoutes = rows.filter((row) => row[column("Exact source route")] !== "No exact target route file found").length;
    const missingRoutes = rows.length - exactRoutes;
    const explicitMappings = rows.filter((row) => row[column("Explicit grouped screen mapping")]).length;
    const unresolvedMappings = missingRoutes - explicitMappings;
    const statuses = rows.map((row) => row[column("Implementation status (evidence-based)")]);
    const summary = await readFile(path.join(root, "docs", "SCREEN_IMPLEMENTATION_MATRIX.md"), "utf8");

    expect(rows).toHaveLength(178);
    expect([exactRoutes, missingRoutes, explicitMappings, unresolvedMappings]).toEqual([54, 124, 22, 102]);
    expect(statuses.filter((status) => status.includes("page, module APIs and related tests exist"))).toHaveLength(39);
    expect(statuses.filter((status) => status.includes("explicit grouped-route mapping is source-validated"))).toHaveLength(22);
    expect(statuses.filter((status) => status.includes("mapping unresolved"))).toHaveLength(92);
    expect(statuses.filter((status) => status.includes("Blocked by external decision or integration"))).toHaveLength(25);
    expect(summary).toContain("**54** IDs have an exact page file");
    expect(summary).toContain("**124** IDs have no exact page");
    expect(summary).toContain("**22** have explicit source-validated mappings");
    expect(summary).toContain("**39 partially implemented with page/API/test candidates**");
    expect(summary).toContain("**92 partially implemented with source/action mapping unresolved**");
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

  it("maps M017 to campaign and linked appointment aggregates without claiming payment or platform attribution", async () => {
    const row = parseCsvRow(lines.find((line) => line.startsWith('"M017",')));
    expect(row[header.indexOf("Exact source route")]).toBe("No exact target route file found");
    expect(row[header.indexOf("Explicit grouped screen mapping")]).toContain("/marketing/campaigns (src/app/marketing/campaigns/page.tsx)");
    expect(row[header.indexOf("Explicit grouped screen mapping")]).toContain("payment attribution and external platform data are not part of this mapping");
    expect(row[header.indexOf("Implementation status (evidence-based)")]).toContain("explicit grouped-route mapping is source-validated");
    expect(row[header.indexOf("Evidence limitations")]).toContain("does not provide payment/revenue attribution, platform data");
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
    expect(row[header.indexOf("Exact source route")]).toBe("No exact target route file found");
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
