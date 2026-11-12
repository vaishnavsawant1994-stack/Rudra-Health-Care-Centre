import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const specPath = path.join(root, "docs", "SCREEN_SPEC_178.md");
const outputPath = path.join(root, "docs", "SCREEN_IMPLEMENTATION_MATRIX.csv");

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
  W008: {
    route: "/book/review",
    source: "src/components/public/rudra-booking-flow.tsx",
    pageMarker: "<RudraBookingFlow step=\"review\" />",
    sourceMarkers: ["Send request for staff review", "router.push(\"/book/confirmation\")", "Payment unavailable"],
    note: "The review route preserves the in-memory public request draft and submits it as a staff-reviewed enquiry.",
    limitation: "An accepted enquiry is not an appointment, reserved slot, authorized charge, payment, or confirmed booking.",
  },
  W010: {
    route: "/book/confirmation",
    source: "src/components/public/rudra-booking-flow.tsx",
    pageMarker: "<RudraBookingFlow step=\"confirmation\" />",
    sourceMarkers: ["Request received for review", "This is an enquiry receipt, not an appointment confirmation."],
    note: "The route shows the accepted public-enquiry reference after the API returns success; it is not a booking-success confirmation.",
    limitation: "The specification's /booking/success/[id] route and genuine appointment completion are not implemented; direct loads or reloads cannot recover the in-memory receipt.",
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
};

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
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

const header = ["ID", "Experience group", "Target screen", "Target route", "Access in spec", "Required controls/workflow", "Authoritative objects in spec", "Exact source route", "Potential grouped source routes", "Explicit grouped screen mapping", "Direct page imports", "Candidate API routes by module", "Schema symbols in candidate APIs", "Permission checks found in candidate APIs", "Related test files", "Implementation status (evidence-based)", "Acceptance status", "External or policy blockers", "Evidence limitations"];
const output = [header.map(csv).join(",")];
for (const screen of rows) {
  const candidates = routeCandidates(screen.route);
  const page = candidates.map((candidate) => pageByRoute.get(candidate)).find(Boolean);
  const groupedMapping = explicitGroupedMappings[screen.id];
  let groupedMappingDescription = "";
  if (groupedMapping) {
    const groupedPage = pageByRoute.get(groupedMapping.route);
    const groupedSource = path.join(root, groupedMapping.source);
    if (!groupedPage || !allFiles.includes(groupedSource)) throw new Error(`${screen.id} grouped mapping source is missing.`);
    const [pageText, sourceText] = await Promise.all([readFile(groupedPage, "utf8"), readFile(groupedSource, "utf8")]);
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
    L: ["samples", "collections", "reports", "branch"],
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
  const imports = page ? [...new Set([...readImports(await readFile(page, "utf8"), "components"), ...readImports(await readFile(page, "utf8"), "server")])].sort() : [];
  const schemaSymbols = new Set();
  const permissions = new Set();
  for (const source of apiSources) {
    const text = await readFile(source, "utf8");
    for (const match of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']@\/db\/schema["']/g)) {
      for (const symbol of match[1].split(",").map((part) => part.trim().split(/\s+as\s+/)[0])) if (/^[A-Za-z_$][\w$]*$/.test(symbol)) schemaSymbols.add(symbol);
    }
    for (const match of text.matchAll(/getApiAccess\(\s*["']([^"']+)["']/g)) permissions.add(match[1]);
  }
  const relatedTests = testFiles.filter((file) => {
    const name = rel(file).toLowerCase();
    const pageBase = page ? rel(page).replace(/\.tsx?$/, "").toLowerCase() : "";
    return (pageBase && (name === `${pageBase}.test.ts` || name === `${pageBase}.test.tsx`))
      || imports.some((item) => name.endsWith(`${item.toLowerCase().replace(/^@\//, "src/")}.test.ts`))
      || apiSources.some((source) => path.dirname(source) === path.dirname(file))
      || (routeRoot && name.includes(`/${routeRoot.toLowerCase()}/`));
  }).map(rel).slice(0, 12);
  let blocker = "None identified from route-level inventory; verify screen-specific policy and provider dependencies.";
  if (key === "P" || ["W014", "W015", "W016", "W017"].includes(screen.id)) blocker = "Patient portal account or medical-data access remains disabled pending approved identity proofing.";
  else if (["W023", "W024"].includes(screen.id)) blocker = "Health content requires approved clinical review and source material.";
  else if (screen.id === "W025") blocker = "Promotions require approved pricing, terms and eligibility; none inferred.";
  else if (screen.id === "W026") blocker = "Legal/privacy/accessibility policy text requires Owner/legal approval.";
  else if (screen.id === "W009") blocker = "Live checkout/payment provider and verified-patient delivery are not configured; payment remains unavailable.";
  else if (["A002", "A003", "A004", "A005"].includes(screen.id)) blocker = "Real communications providers and consent/policy approvals are not configured.";
  else if (key === "M") blocker = "Live platform credentials, publication authorization and ad-spend approval are absent.";
  const pageRef = screen.id === "W015" ? "No public report-entry route; /reports currently serves a staff-protected workspace (not equivalent)."
    : page ? `${routeForFile(page)} (${rel(page)})` : "No exact target route file found";
  const implementation = key === "P" || ["W014", "W015", "W016", "W017", "W023", "W024", "W025", "W026", "W009"].includes(screen.id)
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
  const limitation = groupedMapping
    ? groupedMapping.limitation
    : "API, schema and test lists are module-level candidates derived from file paths/imports; they do not prove every listed requirement or control works. See referenced source/tests before promotion to complete.";
  output.push([
    screen.id, screen.group, screen.title, screen.route, screen.access, screen.requirements, screen.entities,
    pageRef, groupedPages.join("; "), groupedMappingDescription, imports.join("; "), apiCandidates.join("; "), [...schemaSymbols].sort().join("; "), [...permissions].sort().join("; "),
    relatedTests.join("; "), implementation, acceptance, blocker, limitation,
  ].map(csv).join(","));
}

function readImports(source, kind) {
  const prefix = kind === "components" ? "@/components/" : "@/server/";
  const values = [];
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) if (match[1].startsWith(prefix)) values.push(match[1]);
  return values;
}

if (rows.length !== 178) throw new Error(`Expected 178 screen records; parsed ${rows.length}. Matrix not written.`);
await writeFile(outputPath, `${output.join("\n")}\n`, "utf8");
console.log(`Wrote ${rows.length} screen rows to ${path.relative(root, outputPath)}.`);
