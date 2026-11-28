import { AdminShell } from "@/components/admin/admin-shell";
import { AdminDataPanel } from "@/components/admin/admin-data-panel";
import { Phase10Restricted } from "@/components/operations/phase10-restricted";

export default function AdminRecoveryPage() {
  return <AdminShell permission="configuration.read" title="Backups, exports and recovery"><>
    <p className="admin-card">S010 · The system API reports current configuration checks only. It does not inspect backup contents or prove a restorable recovery point.</p>
    <AdminDataPanel endpoint="/api/admin/system" label="Current system setup checks" />
    <Phase10Restricted screen="S010" title="Backup, export and restore actions are unavailable" reason="The source contains key-recovery and migration qualification tooling, but no verified backup inventory, encrypted-document restore proof or authorized export-request workflow. The configured development database is behind source migrations; this page does not modify it." dependencies={["Migration preflight and approved migration plan for the 0093 to 0100 gap", "Isolated backup and encrypted-document restore evidence", "Key backup/restore and rotation qualification", "Approved export scope, requester authorization, independent approval and audit trail"]} />
  </></AdminShell>;
}
