import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const specPath = path.join(root, "docs", "SCREEN_SPEC_178.md");
const outputPath = path.join(root, "docs", "SCREEN_IMPLEMENTATION_MATRIX.csv");

// Explicit mappings are for a proposed screen implemented as a distinct state
// inside another route. Each entry is validated against live source markers so
// the inventory does not silently treat a matching module as screen evidence.
const explicitGroupedMappings = {
  W008: {
    route: "/book",
    source: "src/components/leads/public-enquiry-workbench.tsx",
    pageMarker: "<PublicEnquiryForm mode=\"booking\" />",
    sourceMarkers: ["id=\"booking-review-title\"", "Edit request", "Send request for staff review"],
    note: "Booking review is an in-form state in /book; it is not a separate route and does not confirm or reserve an appointment.",
    limitation: "The explicit mapping proves the review state is embedded in the listed page/component; it does not prove every W008 requirement, confirmation, slot reservation, pricing, or appointment creation.",
  },
  M017: {
    route: "/marketing/campaigns",
    source: "src/components/marketing/campaign-workbench.tsx",
    pageMarker: "<CampaignWorkbench managedCentreIds=",
    sourceMarkers: ["aria-label=\"Campaign attribution date filter\"", "Counts leads created", "Read-only campaign attribution access."],
    note: "Consent-safe campaign and CRM lead-cohort aggregates are rendered in the campaign workbench; booking/payment attribution is not part of this mapping.",
    limitation: "The mapping proves campaign cohort filtering and aggregate lead/conversion display in the listed component; it does not provide booking/payment funnel attribution, platform data, revenue or every M017 requirement.",
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
    if (!pageText.includes(groupedMapping.pageMarker) || groupedMapping.sourceMarkers.some((marker) => !sourceText.includes(marker))) {
      throw new Error(`${screen.id} grouped mapping markers no longer match the implementation.`);
    }
    groupedMappingDescription = `${groupedMapping.route} (${rel(groupedPage)}); ${groupedMapping.source}; ${groupedMapping.note}`;
  }
  const routeRoot = screen.route.split("/").filter(Boolean)[0] ?? "";
  const key = screen.id[0];
  const moduleRoots = {
    W: ["public", "catalogue", "admin/website-content", "public/content"],
    P: ["patient-portal", "account", "public/account"],
    R: ["patients", "families", "appointments", "leads", "orders", "tasks", "roster", "public/enquiries"],
    F: ["collections", "samples", "roster", "tasks"],
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
  const apiCandidates = [...apiByPath.entries()].filter(([apiPath]) => moduleRoots.some((rootName) => apiPath === `/api/${rootName}` || apiPath.startsWith(`/api/${rootName}/`))).map(([apiPath]) => apiPath).sort();
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
  else if (["W009", "W010"].includes(screen.id)) blocker = "Live checkout/payment provider and verified-patient delivery are not configured.";
  else if (["A002", "A003", "A004", "A005"].includes(screen.id)) blocker = "Real communications providers and consent/policy approvals are not configured.";
  else if (key === "M") blocker = "Live platform credentials, publication authorization and ad-spend approval are absent.";
  const pageRef = screen.id === "W015" ? "No public report-entry route; /reports currently serves a staff-protected workspace (not equivalent)."
    : page ? `${routeForFile(page)} (${rel(page)})` : "No exact target route file found";
  const implementation = key === "P" || ["W014", "W015", "W016", "W017", "W023", "W024", "W025", "W026", "W009", "W010"].includes(screen.id)
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
