import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { RelationshipReferenceWorkspace } from "@/components/relationships/relationship-reference-workspace";

const screens = new Set(Array.from({ length: 12 }, (_, index) => `c${String(index + 1).padStart(3, "0")}`));

export default function RelationshipDesignPage({ params }: PageProps<"/relationships/design/[screen]">) {
  return <Suspense fallback={<main role="status">Loading relationship preview…</main>}><RelationshipDesignContent params={params}/></Suspense>;
}

async function RelationshipDesignContent({ params }: { params: PageProps<"/relationships/design/[screen]">["params"] }) {
  const { screen } = await params;
  if (!screens.has(screen.toLowerCase())) notFound();
  return <AdminShell permission="workspace.read" title="Doctors, corporate & partner design preview"><RelationshipReferenceWorkspace screen={screen}/></AdminShell>;
}
