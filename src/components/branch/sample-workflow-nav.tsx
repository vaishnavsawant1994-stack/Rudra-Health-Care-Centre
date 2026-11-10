import Link from "next/link";

const stages = [
  { href: "/branch/operations", code: "L001", label: "Branch operations" },
  { href: "/samples", code: "L002", label: "Samples & custody" },
  { href: "/branch/receiving", code: "L003", label: "Rudra receiving" },
  { href: "/samples/exceptions", code: "L004", label: "Quality exceptions" },
  { href: "/branch/dispatch", code: "L005", label: "Dispatch batches" },
];

/** Navigation between operational workflows; counts and status come from each live queue. */
export function SampleWorkflowNav({ current }: { current: string }) {
  return <nav className="sample-workflow-nav" aria-label="Sample operations workflow">
    {stages.map((stage, index) => <Link
      href={stage.href}
      key={stage.code}
      aria-current={stage.code === current ? "page" : undefined}
      className={stage.code === current ? "is-current" : undefined}
    >
      <span className="sample-workflow-code">{stage.code}</span>
      <span>{stage.label}</span>
      {index < stages.length - 1 && <span className="sample-workflow-arrow" aria-hidden="true">?</span>}
    </Link>)}
  </nav>;
}
