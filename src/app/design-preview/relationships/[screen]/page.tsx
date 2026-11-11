import { Suspense } from "react";
import { notFound } from "next/navigation";
import { RelationshipReferenceWorkspace } from "@/components/relationships/relationship-reference-workspace";

export default function RelationshipLocalPreview({ params }: PageProps<"/design-preview/relationships/[screen]">) {
  return <Suspense fallback={<main role="status">Loading relationship preview…</main>}><RelationshipLocalPreviewContent params={params}/></Suspense>;
}

async function RelationshipLocalPreviewContent({ params }: { params: PageProps<"/design-preview/relationships/[screen]">["params"] }) {
  const { screen } = await params;
  if (!/^c0(?:0[1-9]|1[0-2])$/i.test(screen)) notFound();
  return <RelationshipReferenceWorkspace screen={screen}/>;
}
