import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import type { StaffContext } from "@/server/access";
import { getVisibleWorkspaceGroups } from "@/server/workspace-links";

export default async function StaffWorkspacePage() {
  return <AdminShell permission="workspace.read" title="Staff workspace">{(staff) => <Workspace staff={staff} />}</AdminShell>;
}

function Workspace({ staff }: { staff: StaffContext }) {
  const visibleGroups = getVisibleWorkspaceGroups(staff.grants);

  return <>
    <section className="workspace-intro admin-card" aria-labelledby="workspace-heading">
      <div>
        <p className="eyebrow">Your authorized work</p>
        <h2 id="workspace-heading">Welcome, {staff.displayName}</h2>
        <p>Choose a workspace below. Each page checks your current permissions and centre access again before showing or changing records.</p>
      </div>
      <p className="workspace-scope"><strong>Account</strong><span>{staff.staffCode}</span><span>{staff.isOwner ? "Owner access" : "Staff access"}</span></p>
    </section>
    {visibleGroups.length ? visibleGroups.map((group) => <section className="workspace-section" key={group.title} aria-labelledby={`workspace-${group.title.replaceAll(" ", "-")}`}>
      <h2 id={`workspace-${group.title.replaceAll(" ", "-")}`}>{group.title}</h2>
      <div className="workspace-grid">
        {group.links.map((item) => <Link className="workspace-card" href={item.href} key={item.href}>
          <span className="workspace-card-title">{item.label}<span aria-hidden="true">→</span></span>
          <span>{item.description}</span>
        </Link>)}
      </div>
    </section>) : <section className="admin-card"><h2>No workspace actions assigned</h2><p>Ask an authorized Rudra owner to review your active role and centre assignments.</p></section>}
  </>;
}
