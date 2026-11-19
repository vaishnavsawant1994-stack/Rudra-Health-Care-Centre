import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkAcceptanceBaseline, mergeGeneratedMatrix, parseCsv, serializeCsv } from "./screen-inventory-evidence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const specPath = path.join(root, "docs", "SCREEN_SPEC_178.md");
const outputPath = path.join(root, "docs", "SCREEN_IMPLEMENTATION_MATRIX.csv");
const releaseSummaryPath = path.join(root, "src", "server", "screen-implementation-summary.json");
const routeEvidencePath = path.join(root, "docs", "SCREEN_ROUTE_EVIDENCE.json");
const acceptanceBaselinePath = path.join(root, "docs", "SCREEN_ACCEPTANCE_BASELINE.json");

// Explicit mappings reconcile proposed screen IDs with validated source where
// the canonical implementation route differs from the proposal. Each entry is
// validated against live source markers so module-level matches are not treated
// as screen-specific evidence.
const explicitGroupedMappings = {
  R013: {
    route: "/leads",
    source: "src/components/leads/lead-workbench.tsx",
    pageMarker: "<LeadsDirectory />",
    sourceMarkers: ["Record an enquiry only", "Contact permission starts pending", "Avoid medical details"],
    note: "The proposed reception lead-capture inbox maps to the protected centre-scoped CRM directory and lead creation workflow.",
    limitation: "Creating a lead does not authorize outreach; operational contact permission and marketing consent are separate records.",
  },
  R014: {
    route: "/leads/[id]",
    source: "src/components/leads/lead-workbench.tsx",
    pageMarker: "<LeadDetail leadId={id}",
    sourceMarkers: ["Activity history", "Follow-ups", "Operational contact authorization", "Marketing consent"],
    note: "The proposed lead detail/follow-up screen maps to the protected Lead 360 workflow with assignment, activity, contact consent and follow-up history.",
    limitation: "The screen does not send real communication; all contact attempts and future provider actions remain permission/consent gated.",
  },
  R015: {
    route: "/communications",
    source: "src/components/leads/communication-draft-queue.tsx",
    pageMarker: "<UnifiedCommunicationInbox",
    sourceMarkers: ["Website enquiries and staff-only drafts", "Drafts are never sent from here", "No external email, SMS, WhatsApp or voice provider is connected"],
    note: "The proposed enquiries/callback inbox maps to the protected communications queue for website enquiries and unsent staff communication drafts.",
    limitation: "This is not a telephone/call system and it does not send email, SMS, WhatsApp, or voice communications; real providers are unconnected.",
  },
  R016: {
    route: "/catalogue/tests",
    source: "src/components/catalogue/catalogue-workbench.tsx",
    pageMarker: "<CatalogueDirectory serviceType=\"TEST\"",
    sourceMarkers: ["Diagnostic tests", "verified price", "UNVERIFIED"],
    note: "The proposed staff catalogue lookup maps to the protected diagnostic-test directory with verification-state-aware entries.",
    limitation: "Catalogue records or prices shown as unverified are not approved customer prices and cannot be treated as confirmed quotes.",
  },
  R002: {
    route: "/patients",
    source: "src/components/patients/patient-workbench.tsx",
    pageMarker: "<PatientList canCreate=",
    sourceMarkers: ["Search exact patient name, ID substring or exact phone", "All authorized centres", "No patients found in your authorized centre scope"],
    note: "The proposed reception patient search maps to the centre-scoped patient directory and exact/ID-substring lookup.",
    limitation: "The directory does not expose a separate merge operation or generalized fuzzy name search; duplicate review is handled by protected registration/update workflows.",
  },
  R003: {
    route: "/patients/[id]",
    source: "src/components/patients/patient-workbench.tsx",
    pageMarker: "<PatientProfile patientId={id}",
    sourceMarkers: ["Patient activity", "Diagnostic order history", "Family relationships", "Adult records require their own authorization"],
    note: "The proposed staff Patient 360 screen maps to the permission-protected patient profile with separately permissioned order, sample, report and finance sections.",
    limitation: "Sensitive linked history is only loaded when its distinct module permission is present; family association does not authorize access.",
  },
  R004: {
    route: "/patients/new",
    source: "src/components/patients/patient-workbench.tsx",
    pageMarker: "<PatientRegistrationForm",
    sourceMarkers: ["Register patient", "NOT_RECORDED", "possible duplicate exists in this centre"],
    note: "The proposed reception registration screen maps to centre-authorized patient registration with consent defaulting to Not recorded and duplicate safeguards.",
    limitation: "Patient registration records staff-entered consent status and does not establish legal basis, patient portal identity, or verified identity proofing.",
  },
  R005: {
    route: "/families/[id]",
    source: "src/components/families/family-workbench.tsx",
    pageMarker: "<FamilyOverview familyId={id} />",
    sourceMarkers: ["All new family membership starts pending", "Relationship and membership alone do not permit access", "Record verification", "Family activity history"],
    note: "The proposed family-link/consent screen maps to the staff Family 360 workflow for pending member links, evidence-backed verification, contact arrangements and explicit sharing.",
    limitation: "Family links do not grant medical access; the workflow does not itself prove legal consent beyond recorded staff review evidence.",
  },
  R006: {
    route: "/patients/[id]",
    source: "src/components/patients/patient-workbench.tsx",
    pageMarker: "<PatientProfile patientId={id}",
    sourceMarkers: ["Patient activity", "No activity events are recorded yet.", "Diagnostic order history"],
    note: "The proposed patient activity timeline is rendered within the authorized Patient 360 profile using recorded patient events and linked operational histories.",
    limitation: "This is an embedded profile section, not a separate timeline URL; linked histories appear only with their distinct permissions.",
  },
  R007: {
    route: "/appointments/calendar",
    source: "src/components/appointments/appointment-workbench.tsx",
    pageMarker: "<AppointmentCalendar />",
    sourceMarkers: ["Appointment calendar", "value=\"day\">Daily", "value=\"week\">Weekly", "value=\"month\">Monthly", "open capacity is not inferred"],
    note: "The proposed staff appointment calendar is implemented at the canonical protected `/appointments/calendar` route with daily, weekly and monthly views and centre selection.",
    limitation: "The current calendar does not filter by assigned staff and displays recorded appointments only; it does not invent availability or reserve slots.",
  },
  R008: {
    route: "/appointments/new",
    source: "src/components/appointments/appointment-workbench.tsx",
    pageMarker: "<AppointmentCreateForm",
    sourceMarkers: ["Create booking request", "Search patients", "Separate home-visit service charge", "idempotency"],
    note: "The proposed appointment form maps to the centre-authorized booking-request flow, including patient lookup, requested service and separately recorded home-visit charge.",
    limitation: "The form creates a booking request, not a confirmed appointment or guaranteed slot; catalogue/service availability may remain unverified.",
  },
  R009: {
    route: "/orders/new",
    source: "src/components/orders/order-workbench.tsx",
    pageMarker: "<OrderCreate />",
    sourceMarkers: ["Create diagnostic order", "Create order draft", "Review order", "No sample or laboratory work is triggered"],
    note: "The proposed staff order/quote entry maps to a protected order-draft workflow linked to an authorized appointment or existing patient.",
    limitation: "Order creation does not trigger sample collection or external laboratory processing; confirmation requires eligible catalogue verification and pricing.",
  },
  R010: {
    route: "/orders/[id]",
    source: "src/components/orders/order-workbench.tsx",
    pageMarker: "<OrderDetail id={id} />",
    sourceMarkers: ["Replace draft service selection", "Review and confirm", "Order activity", "no collection, lab processing, report or invoice status"],
    note: "The proposed order detail/status hub maps to the protected order detail workflow with service snapshots, controlled draft editing, confirmation/cancellation and history.",
    limitation: "The screen does not advance sample, laboratory, report or invoice lifecycles; each remains a separate linked workflow.",
  },
  R011: {
    route: "/workspaces/[role]",
    source: "src/components/appointments/walk-in-queue.tsx",
    pageMarker: "<WalkInQueue grants={staff.grants} />",
    sourceMarkers: ["Walk-in tokens and calling queue", "Issue token", "Call next", "Only confirmed centre walk-ins with a recorded arrival"],
    note: "The proposed walk-in queue is an actionable Reception workspace panel with centre-scoped token issue/call controls and server-backed queue APIs.",
    limitation: "The queue does not add a separate no-show/redirect action or QR identity scan; token issue requires a prior appointment confirmation and recorded arrival.",
  },
  R012: {
    route: "/appointments/arrivals",
    source: "src/components/appointments/appointment-workbench.tsx",
    pageMarker: "<AppointmentList awaitingArrival",
    sourceMarkers: ["Record patient arrival", "arrival_already_recorded", "Only confirmed or assigned appointments can be checked in"],
    note: "The proposed arrivals/check-in screen is implemented as a centre-scoped arrival queue with a recorded-arrival action in appointment details.",
    limitation: "Check-in records physical arrival only; QR scanning and identity verification are not implemented by this workflow.",
  },
  R018: {
    route: "/roster/handovers",
    source: "src/components/roster/shift-handover-workbench.tsx",
    pageMarker: "<ShiftHandoverWorkbench staffId=",
    sourceMarkers: ["Pending items and handover note", "Acknowledge receipt", "Review centre operational queues"],
    note: "The proposed front-desk shift handover is served by the encrypted, centre-scoped staff handover workbench at /roster/handovers, including incoming-staff acknowledgment and links to operational queues.",
    limitation: "The workflow records a staff handover note and acknowledgment; it does not automatically transfer cash, appointments, tasks, or operational ownership, and does not itself summarize pending queues.",
  },
  C006: {
    route: "/relationships/corporate",
    source: "src/app/relationships/corporate/page.tsx",
    pageMarker: "<BusinessRelationshipWorkbench type=\"CORPORATE\"",
    sourceMarkers: ["corporate.read", "manageableCentreIds={grants.flatMap"],
    note: "The proposed /corporates directory is implemented at Rudra's canonical /relationships/corporate staff route with centre-scoped directory and management actions.",
    limitation: "The mapping establishes the directory route and its scoped workbench; it does not prove contracts, quotations, employee booking, or every C006 requirement.",
  },
  C008: {
    route: "/relationships/corporate/[id]",
    source: "src/components/relationships/business-relationship-workbench.tsx",
    pageMarker: "initialRelationshipId={id} profileOnly",
    sourceMarkers: ["profileOnly && !selected", "Open profile"],
    note: "The proposed /corporates/[id] screen is implemented as a direct, centre-authorized corporate profile at /relationships/corporate/[id].",
    limitation: "The mapping proves the direct encrypted relationship profile and links to existing CRM/appointment activity; it does not implement corporate camps, employee scheduling, contracts, or every C008 requirement.",
  },
  C010: {
    route: "/relationships/partners",
    source: "src/app/relationships/partners/page.tsx",
    pageMarker: "<BusinessRelationshipWorkbench type=\"PARTNER\"",
    sourceMarkers: ["partners.read", "partners.manage"],
    note: "C010's protected directory is served at /relationships/partners. The canonical /partners route remains the public W020 enquiry page and must not expose partner/staff records.",
    limitation: "Protected directory access is centre-scoped, but onboarding authorization and partner contract review remain separate requirements; this mapping does not establish partner portal access.",
  },
  W008: {
    route: "/book/review",
    source: "src/components/public/rudra-booking-flow.tsx",
    pageMarker: "<RudraBookingFlow step=\"review\" />",
    sourceMarkers: ["Send request for staff review", "router.push(`/booking/success/${result.receiptId}`)", "Payment unavailable"],
    note: "The review route preserves the in-memory public request draft and submits it as a staff-reviewed enquiry.",
    limitation: "An accepted enquiry is not an appointment, reserved slot, authorized charge, payment, or confirmed booking.",
  },
  W015: {
    route: "/report-access",
    source: "src/components/public/rudra-access-pages.tsx",
    pageMarker: "<RudraAccessPage kind=\"reports\"/>",
    sourceMarkers: ["Secure patient self-service is not enabled yet.", "No booking, patient or report data is being looked up or shown on this page."],
    note: "The patient-facing report entry maps to the noindex privacy-safe report-access explanation; the staff /reports workspace remains protected.",
    limitation: "This is an information boundary only; no patient account, report metadata or medical result is returned until identity, authority, consent and release policy are qualified.",
  },
  F012: {
    route: "/field/today",
    source: "src/components/samples/sample-workbench.tsx",
    pageMarker: "<CollectionOperations grants={staff.grants} showDailySchedule />",
    sourceMarkers: ["Mark attempt unsuccessful", "Record a collected specimen", "Record exception", "Request recollection"],
    note: "Assigned field work supports a recorded unsuccessful visit, specimen and sample exception actions, and existing manager-authorized recollection handling; open assigned exceptions are listed at /field/exceptions.",
    limitation: "This maps implemented collection and sample exception actions only; no-show/insufficient-specimen reason taxonomy, all rescheduling rules and every F012 control still require review.",
  },
  M017: {
    route: "/marketing/campaigns",
    source: "src/components/marketing/campaign-workbench.tsx",
    pageMarker: "<CampaignWorkbench managedCentreIds=",
    sourceMarkers: ["aria-label=\"Campaign attribution date filter\"", "Counts leads created", "Read-only campaign attribution access.", "confirmedAppointmentCount", "Active bookings"],
    note: "Consent-safe campaign and CRM lead-cohort aggregates, including linked booking states, are rendered in the campaign workbench; payment attribution and external platform data are not part of this mapping.",
    limitation: "The mapping proves campaign cohort filtering and aggregate lead, recorded conversion and linked appointment counts in the listed component; it does not provide payment/revenue attribution, platform data or every M017 requirement.",
  },
  L016: {
    route: "/staff/orders/[id]/journey",
    source: "src/components/samples/metropolis-workbench.tsx",
    pageMarker: "<MetropolisOrderHistory orderId={id} />",
    sourceMarkers: ["These are manually recorded events and documentary reviews, not a live Metropolis connection.", "Pending independent review"],
    note: "The authorized order journey composes the protected order detail, collection/custody history, centre-scoped external evidence and linked report history.",
    limitation: "Each component enforces its own API permission; only persisted events appear. Clinical critical-result actions and patient preview are not implemented.",
  },
};

// Cross-module tests are explicitly linked to the canonical screens whose
// workflows they exercise. These are source references, not acceptance claims.
const explicitWorkflowEvidenceTests = {
  L003: ["src/app/api/public/enquiries/route.db.integration.test.ts"],
  L005: ["src/app/api/public/enquiries/route.db.integration.test.ts"],
  L006: ["src/app/api/public/enquiries/route.db.integration.test.ts"],
  L007: ["src/app/api/public/enquiries/route.db.integration.test.ts"],
  L014: ["src/app/api/public/enquiries/route.db.integration.test.ts", "src/app/api/reports/[id]/documents/route.test.ts"],
  L015: ["src/app/api/public/enquiries/route.db.integration.test.ts", "src/app/api/reports/[id]/documents/route.test.ts"],
  L016: ["src/app/api/public/enquiries/route.db.integration.test.ts"],
  B001: ["src/app/api/public/enquiries/route.db.integration.test.ts"],
  B002: ["src/app/api/public/enquiries/route.db.integration.test.ts"],
  B005: ["src/app/api/public/enquiries/route.db.integration.test.ts"],
  B006: ["src/app/api/public/enquiries/route.db.integration.test.ts"],
  B008: ["src/app/api/public/enquiries/route.db.integration.test.ts"],
  B009: ["src/app/api/public/enquiries/route.db.integration.test.ts"],
  B011: ["src/app/api/public/enquiries/route.db.integration.test.ts"],
  B015: ["src/app/api/public/enquiries/route.db.integration.test.ts"],
  S001: ["src/server/access.session.db.integration.test.ts"],
};

async function walk(directory) {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files.sort((a, b) => rel(a).localeCompare(rel(b)));
}

function clean(value) {
  return value.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]*>/g, " ").replace(/\*\*/g, "")
    .replace(/`/g, "").replace(/&rarr;|â†’/g, "->").replace(/\s+/g, " ").trim();
}

function csv(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function routeCandidates(route) {
  const normalized = route.replace(/\?.*$/, "").replace(/:([A-Za-z][A-Za-z0-9_]*)/g, "[$1]");
  const alternatives = [normalized];
  alternatives.push(normalized.replace(/\[(?:slug|code|number)\]/g, "[id]"));
  alternatives.push(normalized.replace(/\[(?:slug|code|number)\]/g, "[slug]"));
  return [...new Set(alternatives)];
}

function normalizeDynamicRoute(route) {
  return route.replace(/\[[^\]]+\]/g, "[]");
}

const allFiles = await walk(path.join(root, "src"));
const appPages = allFiles.filter((file) => /(?:^|\\)page\.tsx?$/.test(file) && file.includes(`${path.sep}app${path.sep}`));
const apiRoutes = allFiles.filter((file) => /(?:^|\\)route\.ts$/.test(file) && file.includes(`${path.sep}app${path.sep}api${path.sep}`));
const testFiles = allFiles.filter((file) => /\.(?:test|spec)\.(?:ts|tsx|js|mjs)$/.test(file));

function rel(file) { return path.relative(root, file).replaceAll(path.sep, "/"); }
function routeForFile(file, marker = `${path.sep}app${path.sep}`) {
  const after = file.slice(file.indexOf(marker) + marker.length).replace(/[\\/]?(?:page\.tsx?|route\.ts)$/, "");
  return `/${after.replaceAll(path.sep, "/")}`.replace(/^\/$/, "/");
}

const pageByRoute = new Map(appPages.map((file) => [routeForFile(file), file]));
const pageByDynamicRoute = new Map(appPages.map((file) => [normalizeDynamicRoute(routeForFile(file)), file]));
function dynamicRouteMatches(route, sourceRoute) {
  const expected = sourceRoute.split("/").filter(Boolean);
  const actual = route.split("/").filter(Boolean);
  return expected.length === actual.length && expected.every((segment, index) => /^\[.+\]$/.test(segment) || segment === actual[index]);
}
const apiByPath = new Map(apiRoutes.map((file) => [`/api${routeForFile(file, `${path.sep}app${path.sep}api${path.sep}`)}`, file]));
const spec = await readFile(specPath, "utf8");
const lines = spec.split(/\r?\n/);
const rows = [];
let group = "Unclassified";
for (const line of lines) {
  const heading = line.match(/^#{2,4}\s+(.+?)\s*$/);
  if (heading) group = clean(heading[1]);
  if (!/^\|\s*\*\*[A-Z]\d{3}\*\*\s*\|/.test(line)) continue;
  const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
  if (cells.length < 5) continue;
  const id = cells[0].match(/\*\*([A-Z]\d{3})\*\*/)?.[1];
  const title = cells[1].match(/\*\*(.+?)\*\*/)?.[1] ?? clean(cells[1]);
  const route = cells[1].match(/`([^`]+)`/)?.[1]?.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, "[$1]") ?? "";
  if (!id || !route) continue;
  rows.push({ id, group, title: clean(title), route, access: clean(cells[2]), requirements: clean(cells[3]), entities: clean(cells[4]) });
}

const header = ["ID", "Experience group", "Target screen", "Target route", "Access in spec", "Required controls/workflow", "Authoritative objects in spec", "Exact source route", "Potential grouped source routes", "Explicit grouped screen mapping", "Direct page imports", "Candidate API routes by module", "Schema symbols in candidate APIs", "Permission checks found in candidate APIs", "Related test files", "Implementation status (evidence-based)", "Acceptance status", "External or policy blockers", "Evidence limitations", "Visual reference status", "Frontend evidence status", "Backend/API evidence status", "Database contract evidence status", "RBAC/privacy evidence status", "Integration readiness status", "Automated QA evidence status", "Manual desktop/mobile status", "Accessibility/responsive status", "Final Owner/QA acceptance", "Deployment readiness"];
const output = [header.map(csv).join(",")];
const routeEvidenceRecords = [];
const sourceReferenceCache = new Map();
const sourceTextCache = new Map();
function sourceTextFor(source) {
  if (!sourceTextCache.has(source)) sourceTextCache.set(source, readFile(source, "utf8"));
  return sourceTextCache.get(source);
}
function sourceReferenceFor(source) {
  if (!sourceReferenceCache.has(source)) {
    sourceReferenceCache.set(source, Promise.all([readFile(source), stat(source)]).then(([bytes, info]) => ({
      path: rel(source),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sourceModifiedAt: info.mtime.toISOString(),
    })));
  }
  return sourceReferenceCache.get(source);
}
const specIds = rows.map((row) => row.id);
if (new Set(specIds).size !== specIds.length) throw new Error("screen_spec_duplicate_ids");
if (specIds.length !== 178) throw new Error(`Expected 178 unique screen records; parsed ${specIds.length}. Matrix not written.`);
for (const screen of rows) {
  const candidates = routeCandidates(screen.route);
  const page = candidates.map((candidate) => pageByRoute.get(candidate) ?? pageByDynamicRoute.get(normalizeDynamicRoute(candidate)) ?? appPages.find((file) => dynamicRouteMatches(candidate, routeForFile(file)))).find(Boolean);
  const groupedMapping = explicitGroupedMappings[screen.id];
  let groupedMappingDescription = "";
  if (groupedMapping) {
    const groupedPage = pageByRoute.get(groupedMapping.route);
    const groupedSource = path.join(root, groupedMapping.source);
    if (!groupedPage || !allFiles.includes(groupedSource)) throw new Error(`${screen.id} grouped mapping source is missing.`);
    const [pageText, sourceText] = await Promise.all([sourceTextFor(groupedPage), sourceTextFor(groupedSource)]);
    const missingMarkers = groupedMapping.sourceMarkers.filter((marker) => !sourceText.includes(marker));
    if (!pageText.includes(groupedMapping.pageMarker) || missingMarkers.length > 0) {
      throw new Error(`${screen.id} grouped mapping markers no longer match the implementation.${!pageText.includes(groupedMapping.pageMarker) ? " Page marker missing." : ""}${missingMarkers.length ? ` Source markers missing: ${missingMarkers.join(", ")}` : ""}`);
    }
    groupedMappingDescription = `${groupedMapping.route} (${rel(groupedPage)}); ${groupedMapping.source}; ${groupedMapping.note}`;
  }
  const routeRoot = screen.route.split("/").filter(Boolean)[0] ?? "";
  const key = screen.id[0];
  const moduleRoots = {
    W: ["public", "catalogue", "admin/website-content", "public/content"],
    P: ["patient-portal", "account", "public/account"],
    R: ["patients", "families", "appointments", "leads", "orders", "tasks", "roster", "public/enquiries"],
    F: ["field", "collections", "samples", "roster", "tasks"],
    L: ["samples", "collections", "reports", "branch", "metropolis"],
    B: ["finance"], D: ["doctors", "business-relationships"],
    C: ["business-relationships", "corporate"], S: ["business-relationships", "partners"],
    A: ["communications", "public/assistant"], M: ["marketing"], O: ["owner", "admin"],
  }[key] ?? [routeRoot];
  const pageRoots = {
    W: ["/", "/about", "/tests", "/packages", "/book", "/centres", "/contact", "/home-collection", "/faq", "/corporate", "/doctors", "/partners", "/service-areas", "/information"],
    P: ["/account"],
    R: ["/patients", "/families", "/appointments", "/leads", "/orders", "/finance", "/roster", "/communications", "/tasks", "/workspaces"],
    F: ["/field", "/collections", "/samples", "/roster", "/tasks", "/workspaces"],
    L: ["/branch", "/samples", "/collections", "/reports", "/orders", "/workspaces"],
    B: ["/finance", "/owner/analytics", "/workspaces"],
    D: ["/doctors", "/relationships/doctors", "/workspaces"],
    C: ["/relationships", "/corporate", "/doctors", "/partners", "/workspaces"],
    S: ["/relationships/partners", "/workspaces"],
    A: ["/communications", "/chat", "/quality", "/leads", "/workspaces"],
    M: ["/marketing", "/leads/analytics", "/workspaces"],
    O: ["/owner", "/branch", "/roster", "/quality", "/workspaces"],
  }[key] ?? [`/${routeRoot}`];
  const groupedPages = appPages.map((file) => ({ file, route: routeForFile(file) }))
    .filter(({ route }) => pageRoots.some((prefix) => prefix === "/" ? route === "/" : route === prefix || route.startsWith(`${prefix}/`)))
    .map(({ file, route }) => `${route} (${rel(file)})`).slice(0, 24);
  const screenApiPaths = {
    A006: ["/api/tasks"],
    A007: ["/api/tasks/[id]"],
  }[screen.id] ?? [];
  const apiCandidates = [...new Set([
    ...[...apiByPath.keys()].filter((apiPath) => moduleRoots.some((rootName) => apiPath === `/api/${rootName}` || apiPath.startsWith(`/api/${rootName}/`))),
    ...screenApiPaths.filter((apiPath) => apiByPath.has(apiPath)),
  ])].sort();
  const apiSources = apiCandidates.map((apiPath) => apiByPath.get(apiPath)).filter(Boolean);
  const imports = page ? [...new Set([...readImports(await sourceTextFor(page), "components"), ...readImports(await sourceTextFor(page), "server")])].sort() : [];
  const schemaSymbols = new Set();
  const permissions = new Set();
  for (const source of apiSources) {
    const text = await sourceTextFor(source);
    for (const match of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']@\/db\/schema["']/g)) {
      for (const symbol of match[1].split(",").map((part) => part.trim().split(/\s+as\s+/)[0])) if (/^[A-Za-z_$][\w$]*$/.test(symbol)) schemaSymbols.add(symbol);
    }
    for (const match of text.matchAll(/getApiAccess\(\s*["']([^"']+)["']/g)) permissions.add(match[1]);
  }
  const candidateTests = testFiles.filter((file) => {
    const name = rel(file).toLowerCase();
    const pageBase = page ? rel(page).replace(/\.tsx?$/, "").toLowerCase() : "";
    return (pageBase && (name === `${pageBase}.test.ts` || name === `${pageBase}.test.tsx`))
      || imports.some((item) => name.endsWith(`${item.toLowerCase().replace(/^@\//, "src/")}.test.ts`))
      || apiSources.some((source) => path.dirname(source) === path.dirname(file))
      || (routeRoot && name.includes(`/${routeRoot.toLowerCase()}/`));
  }).map(rel);
  const explicitTests = explicitWorkflowEvidenceTests[screen.id] ?? [];
  for (const evidenceTest of explicitTests) {
    if (!testFiles.includes(path.join(root, evidenceTest))) throw new Error(`${screen.id} evidence test source is missing: ${evidenceTest}`);
  }
  const relatedTests = [...new Set([...candidateTests, ...explicitTests])].sort((a, b) => a.localeCompare(b)).slice(0, 24);
  let blocker = "None identified from route-level inventory; verify screen-specific policy and provider dependencies.";
  if (key === "P" || ["W014", "W015", "W016", "W017"].includes(screen.id)) blocker = "Patient portal account or medical-data access remains disabled pending approved identity proofing.";
  else if (["W023", "W024"].includes(screen.id)) blocker = "Health content requires approved clinical review and source material.";
  else if (screen.id === "W025") blocker = "Promotions require approved pricing, terms and eligibility; none inferred.";
  else if (screen.id === "W026") blocker = "Legal/privacy/accessibility policy text requires Owner/legal approval.";
  else if (screen.id === "W009") blocker = "Live checkout/payment provider and verified-patient delivery are not configured; payment remains unavailable.";
  else if (screen.id === "L012") blocker = "Metropolis has no approved CSV schema, data-use authorization or validated import contract; upload and import actions remain disabled.";
  else if (screen.id === "L017") blocker = "No approved critical-result thresholds, qualified-person roster, response protocol or acknowledgement policy is configured; clinical actions remain disabled.";
  else if (screen.id === "L014" || screen.id === "L015") blocker = "Patient-facing release and external delivery remain restricted pending approved clinical release, recipient-verification and channel policies.";
  else if (screen.id === "L008" || screen.id === "L009" || screen.id === "L011") blocker = "Manual staff-recorded workflow only; Metropolis API connectivity and partner data-use authorization are not verified.";
  else if (screen.id === "A001") blocker = "The website experience is a deterministic service guide, not a connected AI model; no chat transcript is stored and medical advice is prohibited.";
  else if (screen.id === "A002") blocker = "Encrypted centre-scoped non-secret WhatsApp policy drafts are available; provider credentials, verified webhook/number, approved templates and activation remain unavailable; delivery is disabled.";
  else if (screen.id === "A003") blocker = "Encrypted centre-scoped non-secret voice policy drafts are available; telephony/AI voice provider, number routing, lawful recording notice, retention and escalation policies are not approved; calling is disabled.";
  else if (screen.id === "A004") blocker = "The inbox contains only recorded enquiries, CRM drafts and permitted follow-ups; there is no imported provider conversation feed or clinical-context access.";
  else if (screen.id === "A005") blocker = "No conversation/transcript entity or provider ingestion exists; a conversation URL does not grant contact or patient-record access.";
  else if (screen.id === "A008") blocker = "Encrypted, versioned knowledge drafts with source references and expiry metadata are available; review, approval, expiry enforcement, withdrawal and AI publication are not implemented. Clinical knowledge requires qualified review.";
  else if (screen.id === "A009") blocker = "No deployed model transcripts or evaluation pipeline exists; synthetic preview scores are not operational QA evidence.";
  else if (screen.id === "A010") blocker = "Existing marketing campaign records are attribution-only; outbound audiences, suppression, channel delivery and send approvals are unavailable.";
  else if (screen.id === "A011") blocker = "There is no provider call-history or recording store; permission-checked manual lead activity is not proof that a call was placed or reached.";
  else if (screen.id === "A012") blocker = "No provider missed-call/failed-delivery events are ingested; internal follow-ups are not provider retries and do not prove outreach.";
  else if (screen.id === "A013") blocker = "Versioned templates are internal-only; recipient verification, channel preferences, delivery events and provider retry are not connected.";
  else if (screen.id === "S001") blocker = "TOTP MFA is enforced and trusted-device bypass is disabled; account recovery and live browser/session acceptance remain pending.";
  else if (screen.id === "S002") blocker = "Provisioning is owner- and organization-scoped; complete account lifecycle and centre-scope review is pending.";
  else if (screen.id === "S003") blocker = "Role definitions are owner-managed with separate scoped assignments; live self-escalation and wrong-centre review remains pending.";
  else if (screen.id === "S004") blocker = "No privacy request, lawful export/erasure or retention execution workflow exists; separate consent controls remain in their modules.";
  else if (screen.id === "S005") blocker = "System endpoint is read-only readiness; versioned feature-flag proposal, approval, apply, verify and rollback are unavailable.";
  else if (screen.id === "S006") blocker = "Manual reference/import workbenches exist; provider credentials, API authorization, approved data use and automatic sync remain unavailable.";
  else if (screen.id === "S007") blocker = "The screen displays staff-recorded evidence, not provider event ingestion, retry execution or confirmed integration failures.";
  else if (screen.id === "S008") blocker = "Price verification exists; promotion lifecycle/publication and policy approval remain restricted.";
  else if (screen.id === "S009") blocker = "Legal issuer, invoice tax/settlement and approved official template decisions remain open; no legal document is issued here.";
  else if (screen.id === "S010") blocker = "No verified backup inventory, encrypted-document restore, key recovery qualification or approved export workflow is evidenced.";
  else if (screen.id === "S011") blocker = "Encrypted provider-policy drafts are available; external delivery and automatic job execution remain disabled.";
  else if (screen.id === "S012") blocker = "Read-only status is derived from the local screen matrix; no CI release evidence, deployment, rollback or owner release approval is connected.";
  else if (key === "M") blocker = "Live platform credentials, publication authorization and ad-spend approval are absent.";
  const pageRef = screen.id === "W015" ? "No public report-entry route; /reports currently serves a staff-protected workspace (not equivalent)."
    : page ? `${routeForFile(page)} (${rel(page)})` : "No exact target route file found";
  const implementation = key === "P" || ["W014", "W015", "W016", "W017", "W023", "W024", "W025", "W026", "W009", "A005", "A009"].includes(screen.id)
    ? "4. Blocked by external decision or integration; see blocker field."
    : groupedMapping
      ? "2. Partially implemented: explicit grouped-route mapping is source-validated; individual acceptance requirements remain open."
    : !page && !apiCandidates.length && !groupedPages.length
      ? "3. Not started: no exact route, related module page, or candidate API evidence found."
      : !page
        ? "2. Partially implemented / mapping unresolved: related page/API evidence exists, but this screen's controls are not mapped or verified."
        : apiCandidates.length && relatedTests.length
          ? "2. Partially implemented: page, module APIs and related tests exist; requirements still need action-by-action verification."
          : "2. Partially implemented: page source exists, but matching API or test evidence is incomplete for this screen.";
  const acceptance = "Pending: no screen-specific manual desktop/mobile acceptance evidence recorded.";
  const limitation = screen.id === "W010"
    ? "The UUID route displays only a receipt reference and does not query or reveal enquiry details; it does not confirm an appointment, slot or payment. Staff review remains required."
    : groupedMapping
    ? groupedMapping.limitation
    : "API, schema and test lists are module-level candidates derived from file paths/imports; they do not prove every listed requirement or control works. See referenced source/tests before promotion to complete.";
  const hasExactRoute = Boolean(page) && screen.id !== "W015";
  const frontendEvidence = hasExactRoute ? "Canonical page source exists; screen controls and states are not fully reconciled." : "No exact canonical page source evidence; review grouped route mappings.";
  const backendEvidence = apiCandidates.length ? "Candidate API routes listed; screen-specific behavior and transactions are not fully verified." : "No candidate API route mapped.";
  const databaseEvidence = schemaSymbols.size ? "Candidate schema symbols listed; record-level contracts and migration readiness are not fully verified." : "No candidate database schema symbols mapped.";
  const accessEvidence = permissions.size ? "Candidate permission keys listed; live user, role and centre acceptance is pending." : "No API permission key mapped.";
  const integrationEvidence = /metropolis|provider|external|payment|legal|clinical|identity|integration/i.test(blocker) ? "Restricted or unverified; see blocker field." : "No external integration asserted; screen-specific verification pending.";
  const testEvidence = relatedTests.length ? "Related test candidates listed; screen-specific test coverage is not inferred." : "No related automated test candidate found.";
  const generatedRow = [
    screen.id, screen.group, screen.title, screen.route, screen.access, screen.requirements, screen.entities,
    pageRef, groupedPages.join("; "), groupedMappingDescription, imports.join("; "), apiCandidates.join("; "), [...schemaSymbols].sort().join("; "), [...permissions].sort().join("; "),
    relatedTests.join("; "), implementation, acceptance, blocker, limitation,
    "Not independently verified against approved visual references.", frontendEvidence, backendEvidence, databaseEvidence, accessEvidence, integrationEvidence, testEvidence,
    "Pending: no screen-specific manual desktop/mobile acceptance evidence recorded.", "Pending: keyboard, screen-reader, responsive and accessibility acceptance not recorded.", "Pending: no final owner/QA acceptance evidence recorded.", "Not assessed; no deployment readiness or approval event is recorded.",
  ].reduce((record, value, index) => { record[header[index]] = value; return record; }, {});
  output.push(header.map((column) => csv(generatedRow[column])).join(","));
  const sourceFiles = [...new Set([
    page,
    groupedMapping ? path.join(root, groupedMapping.source) : null,
    ...apiSources,
    ...relatedTests.map((file) => path.join(root, file)),
  ].filter(Boolean))].sort((a, b) => rel(a).localeCompare(rel(b)));
  const sourceReferences = await Promise.all(sourceFiles.map(sourceReferenceFor));
  routeEvidenceRecords.push({ id: screen.id, canonicalRoute: screen.route, sourceReferences });
}

function readImports(source, kind) {
  const prefix = kind === "components" ? "@/components/" : "@/server/";
  const values = [];
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) if (match[1].startsWith(prefix)) values.push(match[1]);
  return values;
}

const args = process.argv.slice(2);
const acceptChanges = args.includes("--accept-acceptance-changes");
const reviewIndex = args.indexOf("--review-reference");
const reviewReference = reviewIndex >= 0 ? args[reviewIndex + 1] ?? "" : "";
if (args.some((arg, index) => arg === "--review-reference" || index === reviewIndex + 1 ? false : arg.startsWith("--"))) throw new Error("unknown_inventory_generator_option");
if (acceptChanges && !reviewReference.trim()) throw new Error("acceptance_review_reference_required");

const generated = parseCsv(`${output.join("\n")}\n`);
const existingText = await readFile(outputPath, "utf8");
const existing = parseCsv(existingText);
const merged = mergeGeneratedMatrix({ generated: generated.rows, existing: existing.rows, expectedIds: specIds });
const currentHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
let baselineDocument = null;
try { baselineDocument = JSON.parse(await readFile(acceptanceBaselinePath, "utf8")); }
catch (error) { if (error?.code !== "ENOENT") throw error; }
let baselineNeedsWrite = !baselineDocument;
const acceptanceCheck = checkAcceptanceBaseline({ rows: merged.rows, baseline: baselineDocument, acceptChanges, reviewReference });
const sourceRevision = currentHead;
const changedAcceptance = acceptanceCheck.changed.length > 0;
if (!baselineDocument || changedAcceptance) {
  baselineNeedsWrite = true;
  baselineDocument = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    source: "docs/SCREEN_IMPLEMENTATION_MATRIX.csv",
    sourceSha256: createHash("sha256").update(serializeCsv(merged.headers, merged.rows)).digest("hex"),
    sourceRevision,
    capturePurpose: !baselineDocument ? "initial manual acceptance state baseline" : "explicitly reviewed manual acceptance state change",
    reviewReference: changedAcceptance ? reviewReference.trim() : null,
    reviewedChanges: changedAcceptance ? acceptanceCheck.changed : [],
    entries: acceptanceCheck.baseline,
  };
}

const releaseSummary = {
  screenCount: merged.rows.length,
  exactRouteEvidence: merged.rows.filter((row) => !row["Exact source route"].startsWith("No ")).length,
  missingRouteEvidence: merged.rows.filter((row) => row["Exact source route"].startsWith("No ")).length,
  implementation: { fullyImplemented: 0, partiallyImplemented: 0, restricted: 0, previewOnly: 0, missing: 0 },
  acceptance: { manuallyAccepted: 0, pendingManual: 0 },
  phases: {},
  evidenceSource: { generator: "scripts/reconcile-screen-inventory.mjs", sourceRevision, matrixSha256: createHash("sha256").update(serializeCsv(merged.headers, merged.rows)).digest("hex") },
};
for (const row of merged.rows) {
  const status = row["Implementation status (evidence-based)"] ?? "";
  if (status.startsWith("1.")) releaseSummary.implementation.fullyImplemented += 1;
  else if (status.startsWith("2.")) releaseSummary.implementation.partiallyImplemented += 1;
  else if (status.startsWith("3.")) releaseSummary.implementation.missing += 1;
  else if (status.startsWith("4.")) releaseSummary.implementation.restricted += 1;
  else if (status.startsWith("5.")) releaseSummary.implementation.previewOnly += 1;
  if ((row["Final Owner/QA acceptance"] ?? "").startsWith("Accepted")) releaseSummary.acceptance.manuallyAccepted += 1;
  else releaseSummary.acceptance.pendingManual += 1;
  const phase = row.ID[0];
  releaseSummary.phases[phase] = (releaseSummary.phases[phase] ?? 0) + 1;
}
if (Object.values(releaseSummary.implementation).reduce((sum, count) => sum + count, 0) !== 178
  || releaseSummary.acceptance.manuallyAccepted + releaseSummary.acceptance.pendingManual !== 178) {
  throw new Error("inventory_release_summary_count_conflict");
}
const routeEvidence = {
  schemaVersion: 1,
  generator: "scripts/reconcile-screen-inventory.mjs",
  canonicalSpec: { path: "docs/SCREEN_SPEC_178.md", sha256: createHash("sha256").update(spec).digest("hex") },
  repositoryHead: sourceRevision,
  evidenceScope: "source-reference and route-mapping only; not functional, QA, visual or acceptance proof",
  screens: routeEvidenceRecords,
};

if (merged.rows.length !== 178 || routeEvidence.screens.length !== 178) throw new Error("Expected 178 unique screen records; matrix not written.");
await writeFile(outputPath, serializeCsv(merged.headers, merged.rows), "utf8");
await writeFile(releaseSummaryPath, `${JSON.stringify(releaseSummary, null, 2)}\n`, "utf8");
await writeFile(routeEvidencePath, `${JSON.stringify(routeEvidence, null, 2)}\n`, "utf8");
if (baselineNeedsWrite) {
  await writeFile(acceptanceBaselinePath, `${JSON.stringify(baselineDocument, null, 2)}\n`, "utf8");
}
console.log(`Wrote ${merged.rows.length} canonical rows. Preserved manual evidence and acceptance states; refreshed source-reference evidence.`);
