import { notFound } from "next/navigation";
import { PlatformReferenceWorkspace } from "@/components/admin/platform-reference-workspace";

export default async function PlatformDesignPreview({ params }: { params: Promise<{ screen: string }> }) {
  const { screen } = await params;
  if (!/^s0(?:0[1-9]|1[0-2])$/i.test(screen)) notFound();
  return <PlatformReferenceWorkspace screen={screen.toUpperCase()} />;
}
