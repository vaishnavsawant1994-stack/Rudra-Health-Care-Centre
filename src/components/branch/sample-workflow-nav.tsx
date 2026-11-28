import Link from "next/link";

const stages = [
  { href: "/branch", code: "L001", label: "Branch operations" },
  { href: "/branch/samples", code: "L002", label: "Samples queue" },
  { href: "/branch/receive", code: "L003", label: "Rudra receiving" },
  { href: "/branch/quality-check", code: "L004", label: "Quality review" },
  { href: "/branch/dispatch", code: "L005", label: "Dispatch batches" },
  { href: "/branch/handover", code: "L006", label: "Courier handover" },
  { href: "/branch/transit", code: "L007", label: "Transit evidence" },
  { href: "/integrations/metropolis/links", code: "L008", label: "Reference links" },
  { href: "/integrations/metropolis/status", code: "L009", label: "Manual status" },
  { href: "/branch/recollection", code: "L010", label: "Recollection queue" },
  { href: "/branch/lab-progress", code: "L011", label: "Lab progress" },
  { href: "/integrations/metropolis/imports", code: "L012", label: "Import review" },
  { href: "/branch/reports/intake", code: "L013", label: "Report intake" },
  { href: "/branch/reports/deliver", code: "L014", label: "Report delivery" },
  { href: "/branch/reports/exceptions", code: "L015", label: "Report corrections" },
  { href: "/staff/orders", code: "L016", label: "Order journey" },
  { href: "/branch/critical-alerts", code: "L017", label: "Critical alerts" },
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
      {index < stages.length - 1 && <span className="sample-workflow-arrow" aria-hidden="true">→</span>}
    </Link>)}
  </nav>;
}
