import { Suspense } from "react";
import { redirect } from "next/navigation";
export default function Page({ params }: { params: Promise<{ id: string }> }) { return <Suspense fallback={null}><RouteRedirect params={params} /></Suspense>; }
async function RouteRedirect({ params }: { params: Promise<{ id: string }> }): Promise<never> { const { id } = await params; return redirect(`/patients/${encodeURIComponent(id)}`); }
