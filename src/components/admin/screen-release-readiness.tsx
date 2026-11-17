import Link from "next/link";
import summary from "@/server/screen-implementation-summary.json";

const groups: Record<string, string> = {
  W: "Public website", P: "Patient portal", R: "Reception and CRM", F: "Field collection", L: "Branch and reports",
  B: "Billing and finance", C: "Doctor, corporate and partner relationships", S: "Platform administration",
  A: "Communications and AI", M: "Marketing", O: "Owner operations",
};

export function ScreenReleaseReadiness() {
  return <>
    <section className="admin-card"><p className="eyebrow">S012 · Read-only source summary</p><h2>Release is not approved</h2><p>This dashboard reads the generated local screen matrix. It is not connected to CI, Git release tags, deployment records or an owner approval workflow. Route evidence and a passing build do not count as screen acceptance.</p></section>
    <dl className="sample-stat-grid" aria-label="178-screen source and acceptance counts">
      <div className="admin-card"><dt>Canonical screens</dt><dd><strong>{summary.screenCount}</strong></dd></div>
      <div className="admin-card"><dt>Exact route source evidence</dt><dd><strong>{summary.exactRouteEvidence}</strong></dd></div>
      <div className="admin-card"><dt>Partially implemented</dt><dd><strong>{summary.implementation.partiallyImplemented}</strong></dd></div>
      <div className="admin-card"><dt>Restricted</dt><dd><strong>{summary.implementation.restricted}</strong></dd></div>
      <div className="admin-card"><dt>Finally accepted</dt><dd><strong>{summary.acceptance.manuallyAccepted}</strong></dd></div>
      <div className="admin-card"><dt>Manual acceptance pending</dt><dd><strong>{summary.acceptance.pendingManual}</strong></dd></div>
    </dl>
    <section className="admin-card"><h2>Source route gaps</h2><p>{summary.missingRouteEvidence} screen route(s) do not have an exact canonical source match. Review the 178-row implementation matrix; grouped mappings and route aliases are recorded separately.</p></section>
    <section className="admin-card"><h2>Inventory by screen ID family</h2><ul>{Object.entries(summary.phases).sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => <li key={key}>{groups[key] ?? key}: {count}</li>)}</ul></section>
    <section className="admin-card"><h2>Separate acceptance evidence</h2><ul>
      <li>Approved visual reference and pixel comparison: not independently verified by this matrix summary.</li>
      <li>Frontend, API, database and permission entries are source candidates; each screen's controls and live authorization still require verification.</li>
      <li>Automated tests may cover module APIs; screen-specific coverage is not inferred from file association.</li>
      <li>Manual desktop/mobile, accessibility and responsive acceptance remain pending.</li>
      <li>Owner release approval, deployment and rollback readiness are not recorded here.</li>
    </ul><p><Link href="/manage/health">Review configuration readiness</Link> · <Link href="/manage/audit">Review authorized audit history</Link></p></section>
    <p className="setup-notice">Summary source: generated `docs/SCREEN_IMPLEMENTATION_MATRIX.csv`. Refresh with `node scripts/reconcile-screen-inventory.mjs`. This page creates no release, approval or deployment event.</p>
  </>;
}
