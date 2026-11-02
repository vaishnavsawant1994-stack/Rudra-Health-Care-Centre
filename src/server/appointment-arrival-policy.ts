export function canReceptionCheckIn(status: string) {
  return ["CONFIRMED", "ASSIGNED", "RESCHEDULED"].includes(status);
}
