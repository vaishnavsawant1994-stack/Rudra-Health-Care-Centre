import Link from "next/link";

const links = [
  { href: "/patients", code: "01", label: "Patient search & records" },
  { href: "/patients/new", code: "02", label: "Register patient" },
  { href: "/appointments", code: "03", label: "Appointments" },
  { href: "/appointments/new", code: "04", label: "New booking" },
  { href: "/appointments/arrivals", code: "05", label: "Reception & check-in" },
  { href: "/appointments/calendar", code: "06", label: "Calendar & schedule" },
  { href: "/orders", code: "07", label: "Diagnostic orders" },
  { href: "/catalogue/tests", code: "08", label: "Approved catalogue" },
  { href: "/staff/quotes", code: "09", label: "Quotations" },
  { href: "/leads", code: "10", label: "Leads & enquiries" },
  { href: "/communications", code: "11", label: "Communications" },
  { href: "/roster/handovers", code: "12", label: "Shift handover" },
];

export function ReceptionWorkflowNav({ current }: { current: string }) {
  return <nav className="reception-workflow-nav" aria-label="Reception and patient operations">
    {links.map((item) => <Link key={item.code} href={item.href} aria-current={current === item.code ? "page" : undefined} className={current === item.code ? "is-current" : undefined}>
      <span>{item.code}</span>{item.label}
    </Link>)}
  </nav>;
}
