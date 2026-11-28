import { redirect } from "next/navigation";
export const instant = false;
export default async function FieldJobAlias({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; redirect(`/collections/${id}`); }