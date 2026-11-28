import { describe, expect, it } from "vitest";
import { LatestRequestSequence } from "./latest-request-sequence";

describe("LatestRequestSequence", () => {
  it("aborts the older request and accepts only the newest response", () => {
    const requests = new LatestRequestSequence();
    const first = requests.begin();
    const second = requests.begin();

    expect(first.signal.aborted).toBe(true);
    expect(requests.isCurrent(first)).toBe(false);
    expect(requests.isCurrent(second)).toBe(true);
  });

  it("cancels the active request during effect cleanup", () => {
    const requests = new LatestRequestSequence();
    const active = requests.begin();

    requests.cancel();

    expect(active.signal.aborted).toBe(true);
    expect(requests.isCurrent(active)).toBe(false);
  });
});
