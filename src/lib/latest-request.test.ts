import { describe, expect, it } from "vitest";
import { beginLatestRequest, invalidateLatestRequest, isLatestRequest } from "./latest-request";

describe("latest request sequence", () => {
  it("rejects an older response after a newer query starts", () => {
    const sequence = { current: 0 };
    const first = beginLatestRequest(sequence);
    const second = beginLatestRequest(sequence);
    expect(isLatestRequest(sequence, first)).toBe(false);
    expect(isLatestRequest(sequence, second)).toBe(true);
  });

  it("invalidates pending responses when the view unmounts", () => {
    const sequence = { current: 0 };
    const request = beginLatestRequest(sequence);
    invalidateLatestRequest(sequence);
    expect(isLatestRequest(sequence, request)).toBe(false);
  });
});
