import { Suspense } from "react";
import { notFound } from "next/navigation";
import { CommunicationsReferenceWorkspace } from "@/components/communications/communications-reference-workspace";

export default function CommunicationsLocalPreview({ params }: PageProps<"/design-preview/communications/[screen]">) {
  return <Suspense fallback={<main role="status">Loading communications preview…</main>}><CommunicationsLocalPreviewContent params={params}/></Suspense>;
}

async function CommunicationsLocalPreviewContent({ params }: { params: PageProps<"/design-preview/communications/[screen]">["params"] }) {
  const { screen } = await params;
  const valid = /^a0(?:0[1-9]|1[0-3])$/i.test(screen);
  if (!valid) notFound();
  return <CommunicationsReferenceWorkspace screen={screen}/>;
}
