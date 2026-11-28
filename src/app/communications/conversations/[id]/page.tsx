import { AdminShell } from "@/components/admin/admin-shell";
import { Phase08CapabilityBoundary, Phase08RouteNavigation } from "@/components/communications/phase08-route-support";

export const instant = false;

export default async function ConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await params;
  return <AdminShell permission="leads.read" title="Conversation detail">{() => <>
    <Phase08RouteNavigation current="A005" />
    <Phase08CapabilityBoundary title="Conversation record unavailable" state="No conversation store connected">
      <p>No verified external conversation history is stored by this application. A URL identifier does not establish a conversation, contact identity, consent or permission to access patient information.</p>
      <p>Authorized staff can review recorded website enquiries and unsent lead drafts in the <a href="/communications/inbox">internal inbox</a>. That record history is not a chat transcript.</p>
    </Phase08CapabilityBoundary>
  </>}</AdminShell>;
}
