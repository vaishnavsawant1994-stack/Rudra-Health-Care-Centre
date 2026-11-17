import { redirect } from "next/navigation";
export const instant = false;
export default async function FieldJobCompleteAlias({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; redirect(`/collections/${id}#collection-complete`); }