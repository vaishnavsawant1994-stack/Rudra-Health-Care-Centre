import { getApiAccess } from "@/server/access";
import { checkDatabase } from "@/db/client";
import { getSetupStatus } from "@/lib/phase-one-config";
import { probeLocalClamAv } from "@/server/report-storage";
export async function GET() {
  const access = await getApiAccess("configuration.read");
  if (access.response) return access.response;
  const db = await checkDatabase();
  const reportScanner = await probeLocalClamAv();
  return Response.json({ database: db ? "connected" : "unavailable", authentication: getSetupStatus().authenticationConfigured ? "configured" : "setup_required", reportScanner, environment: getSetupStatus() });
}
