import { describe, expect, it } from "vitest";
import { consumeAppointmentPatientSelection, saveAppointmentPatientSelection } from "./appointment-patient-selection";

const patientId = "8a422f2c-7da8-4630-b4da-9d4101a8d908";
const centreId = "2c61e074-b10e-42be-a8d3-b2f9cf9c081d";

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe("appointment patient selection handoff", () => {
  it("stores an opaque selection for one use and consumes it", () => {
    const tab = storage();
    saveAppointmentPatientSelection(tab, { patientId, centreId }, 1000);
    expect(consumeAppointmentPatientSelection(tab, 2000)).toEqual({ patientId, centreId });
    expect(consumeAppointmentPatientSelection(tab, 2000)).toBeNull();
  });

  it("expires, removes, and rejects malformed selections", () => {
    const tab = storage();
    saveAppointmentPatientSelection(tab, { patientId }, 1000);
    expect(consumeAppointmentPatientSelection(tab, 602_000)).toBeNull();
    expect(tab.values.size).toBe(0);
    tab.setItem("rudra:appointment-patient-selection:v1", JSON.stringify({ patientId: "not-a-uuid", savedAt: 2000 }));
    expect(consumeAppointmentPatientSelection(tab, 2000)).toBeNull();
    expect(tab.values.size).toBe(0);
  });

  it("rejects invalid identifiers before storing them", () => {
    const tab = storage();
    expect(() => saveAppointmentPatientSelection(tab, { patientId: "not-a-uuid" })).toThrow("invalid_patient_selection");
    expect(tab.values.size).toBe(0);
  });
});
