import { AdminShell } from "@/components/admin/admin-shell";
import { ScreenReleaseReadiness } from "@/components/admin/screen-release-readiness";

export default function AdminReleasesPage() {
  return <AdminShell permission="configuration.read" title="Change log, releases and acceptance"><ScreenReleaseReadiness /></AdminShell>;
}
