import Link from "next/link";
import type { ReactNode } from "react";

export function ActionButton({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  return <Link className={`button button-${variant}`} href={href}>{children}<span aria-hidden="true">→</span></Link>;
}
