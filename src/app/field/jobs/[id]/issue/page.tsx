import { redirect } from "next/navigation";
export const instant = false;
export default async function FieldJobIssueAlias({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; redirect(`/collections/${id}#collection-exception-actions`); }