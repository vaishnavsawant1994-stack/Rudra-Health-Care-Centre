import type { Metadata } from "next";
import "./globals.css";
import "./design-preview/operations-reference-pages.css";
import "./rudra-reference-pages.css";
import "./rudra-access-pages.css";
import "./communications/communications-workspace.css";
import "./relationships/relationships-workspace.css";
import { PublicHeader } from "@/components/layout/public-header";
import { PublicFooter } from "@/components/layout/public-footer";

export const metadata: Metadata = {
  title: { default: "Rudra Health Care Centre | Care, clearly connected", template: "%s | Rudra Health Care Centre" },
  description: "A new, connected home for Rudra Health Care Centre services and patient care.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body><PublicHeader /><main id="main-content">{children}</main><PublicFooter /></body>
    </html>
  );
}
