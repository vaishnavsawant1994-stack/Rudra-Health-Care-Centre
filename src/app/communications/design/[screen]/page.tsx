import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { CommunicationsReferenceWorkspace } from "@/components/communications/communications-reference-workspace";

const screenIds = new Set(Array.from({ length: 13 }, (_, index) => `a${String(index + 1).padStart(3, "0")}`));

export default function CommunicationsDesignPage({ params }: PageProps<"/communications/design/[screen]">) {
  return <Suspense fallback={<main role="status">Loading communications preview…</main>}><CommunicationsDesignContent params={params}/></Suspense>;
}

async function CommunicationsDesignContent({ params }: { params: PageProps<"/communications/design/[screen]">["params"] }) {
  const { screen } = await params;
  if (!screenIds.has(screen.toLowerCase())) notFound();
  return <AdminShell permission="workspace.read" title="Communications & AI design preview">
    <CommunicationsReferenceWorkspace screen={screen}/>
  </AdminShell>;
}
