import { AdminShell } from "@/components/admin/admin-shell";
import { SpecimenDetail } from "@/components/samples/sample-workbench";

export const instant = false;
export default async function SampleDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminShell permission="samples.read" title="Specimen chain of custody">{(staff) => <SpecimenDetail id={id} grants={staff.grants} />}</AdminShell>;
}
