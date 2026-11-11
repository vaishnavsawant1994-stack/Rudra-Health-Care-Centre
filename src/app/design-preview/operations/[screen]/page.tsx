import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Phase09OperationsReference } from "@/components/marketing/phase09-operations-reference";

export default function OperationsLocalPreview({params}:{params:Promise<{screen:string}>}) {
 return <Suspense fallback={<main role="status">Loading operations preview…</main>}><OperationsLocalPreviewContent params={params}/></Suspense>;
}
async function OperationsLocalPreviewContent({params}:{params:Promise<{screen:string}>}) {
 const {screen}=await params;
 if(!/^o0(?:0[1-9]|1[0-6])$/i.test(screen)) notFound();
 return <Phase09OperationsReference screen={screen} local/>;
}
