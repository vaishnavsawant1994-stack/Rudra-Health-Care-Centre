import Link from "next/link";

const stages = [
  { href: "/field/today", code: "F001", label: "My jobs" },
  { href: "/collections", code: "F002", label: "Assign & schedule" },
  { href: "/collections", code: "F003-F004", label: "Job details & response" },
  { href: "/field/route", code: "F005-F006", label: "Route & travel" },
  { href: "/collections", code: "F007-F010", label: "Readiness, collection & close" },
  { href: "/field/handover", code: "F011", label: "Specimen handover" },
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

