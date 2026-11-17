import Link from "next/link";

const stages = [
  { href: "/field/today", code: "F001", label: "My jobs" },
  { href: "/ops/collections/dispatch", code: "F002", label: "Assign & schedule" },
  { href: "/field/today", code: "F003-F004", label: "Job details & response" },
  { href: "/field/route", code: "F005-F006", label: "Route & travel" },
  { href: "/field/today", code: "F007-F010", label: "Readiness, collection & close" },
  { href: "/field/handover", code: "F011", label: "Specimen handover" },
  { href: "/field/exceptions", code: "F012", label: "Field exceptions" },
  { href: "/field/support", code: "F013", label: "Field support" },
  { href: "/field/schedule", code: "F014", label: "My schedule" },
  { href: "/field/offline", code: "F015", label: "Offline mode" },
];

/** Trace the screenshot IDs to the existing permission-checked field workflows. */
export function FieldWorkflowNav({ current }: { current: string }) {
  return <nav className="field-workflow-nav" aria-label="Field collection workflow">
    {stages.map((stage) => <Link
      href={stage.href}
      key={stage.code}
      aria-current={stage.code === current ? "page" : undefined}
      className={stage.code === current ? "is-current" : undefined}
    >
      <span className="field-workflow-code">{stage.code}</span>
      <span>{stage.label}</span>
    </Link>)}
  </nav>;
}

