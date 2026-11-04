import { Suspense } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { PersonalSchedule } from "@/components/roster/personal-schedule";

async function FieldScheduleContent({ searchParams }: { searchParams: Promise<{ centreId?: string }> }) {
  const params = await searchParams;
  return <AdminShell permission="roster.read" title="My schedule and availability">
    {(staff) => <><p className="setup-notice">This view displays planned shifts and recorded unavailability for your account only. Attendance, leave approval and payroll are not represented here.</p><PersonalSchedule staffId={staff.staffUserId} initialCentreId={params.centreId} /></>}
  </AdminShell>;
}

export default function FieldSchedulePage({ searchParams }: { searchParams: Promise<{ centreId?: string }> }) {
  return <Suspense fallback={<section className="admin-card" role="status">Loading your schedule…</section>}><FieldScheduleContent searchParams={searchParams} /></Suspense>;
}
