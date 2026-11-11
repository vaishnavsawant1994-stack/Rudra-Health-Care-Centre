import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { Phase09OperationsReference } from "@/components/marketing/phase09-operations-reference";

const validScreens = new Set(Array.from({ length: 16 }, (_, index) => `o${String(index + 1).padStart(3, "0")}`));
export default function OwnerOperationsDesignPage({params}:{params:Promise<{screen:string}>}) {
  return <Suspense fallback={<main role="status">Loading centre preview…</main>}><OwnerOperationsDesignContent params={params}/></Suspense>;
}
async function OwnerOperationsDesignContent({params}:{params:Promise<{screen:string}>}) {
  const {screen}=await params;
  if(!validScreens.has(screen.toLowerCase())) notFound();
  return <AdminShell permission="organization.read" title="Owner & centre operations design preview"><Phase09OperationsReference screen={screen}/></AdminShell>;
}
