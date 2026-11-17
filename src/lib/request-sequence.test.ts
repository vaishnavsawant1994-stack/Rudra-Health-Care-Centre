import { describe, expect, it } from "vitest";
import { RequestSequence } from "./request-sequence";

describe("RequestSequence", () => {
  it("only allows the newest request to publish its result", () => {
    const requests = new RequestSequence();
    const older = requests.next();
    const newer = requests.next();

    expect(requests.isCurrent(older)).toBe(false);
    expect(requests.isCurrent(newer)).toBe(true);
  });

  it("invalidates in-flight requests when a screen is disposed", () => {
    const requests = new RequestSequence();
    const pending = requests.next();

    requests.invalidate();

    expect(requests.isCurrent(pending)).toBe(false);
  });
});
