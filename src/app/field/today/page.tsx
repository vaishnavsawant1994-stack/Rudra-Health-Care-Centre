import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { CollectionOperations } from "@/components/samples/sample-workbench";

export default function FieldTodayPage() {
  return <AdminShell permission="collections.read" title="My collection assignments">{(staff) => <><p className="setup-notice">This view is limited to your assigned jobs unless your role includes collection assignment management.</p><CollectionOperations grants={staff.grants} showDailySchedule /><Link href="/field/handover">Open my collected specimens</Link></>}</AdminShell>;
}
