export type RosterWorkloadRow = {
  id: string;
  name: string;
  staffCode: string;
  appointments: number;
  collections: number;
  openTasks: number;
  scheduledMinutes: number;
  unavailablePeriods: number;
  appointmentsOutsideRoster: number;
  collectionsOutsideRoster: number;
  assignmentsDuringUnavailability: number;
};

export type RosterDailyWorkload = { staffId: string; day: string; appointments: number; collections: number };

export async function fetchRosterWorkload(
  centreId: string,
  from: Date,
  to: Date,
  fetcher: typeof fetch = fetch,
): Promise<{ staff: RosterWorkloadRow[]; dailyWorkload: RosterDailyWorkload[] }> {
  const query = new URLSearchParams({ centreId, from: from.toISOString(), to: to.toISOString() });
  const response = await fetcher(`/api/roster/workload?${query}`, { cache: "no-store" });
  if (!response.ok) throw new Error("roster_workload_unavailable");
  const payload: unknown = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object" || !("staff" in payload) || !Array.isArray(payload.staff) || !("dailyWorkload" in payload) || !Array.isArray(payload.dailyWorkload)) {
    throw new Error("roster_workload_invalid_response");
  }
  return payload as { staff: RosterWorkloadRow[]; dailyWorkload: RosterDailyWorkload[] };
}
