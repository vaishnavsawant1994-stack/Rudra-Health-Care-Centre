const STORAGE_KEY = "rudra:appointment-patient-selection:v1";
const MAX_AGE_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AppointmentPatientSelection = { patientId: string; centreId?: string };
type SelectionEnvelope = AppointmentPatientSelection & { savedAt: number };
type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function saveAppointmentPatientSelection(storage: SessionStorageLike, selection: AppointmentPatientSelection, now = Date.now()) {
  if (!UUID.test(selection.patientId) || (selection.centreId && !UUID.test(selection.centreId))) throw new Error("invalid_patient_selection");
  const envelope: SelectionEnvelope = { ...selection, savedAt: now };
  storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
}

export function consumeAppointmentPatientSelection(storage: SessionStorageLike, now = Date.now()): AppointmentPatientSelection | null {
  const serialized = storage.getItem(STORAGE_KEY);
  if (!serialized) return null;
  storage.removeItem(STORAGE_KEY);
  try {
    const value = JSON.parse(serialized) as Partial<SelectionEnvelope>;
    if (typeof value.patientId !== "string" || !UUID.test(value.patientId)
      || (value.centreId !== undefined && (typeof value.centreId !== "string" || !UUID.test(value.centreId)))
      || typeof value.savedAt !== "number" || value.savedAt > now || now - value.savedAt > MAX_AGE_MS) return null;
    return { patientId: value.patientId, ...(value.centreId ? { centreId: value.centreId } : {}) };
  } catch { return null; }
}
