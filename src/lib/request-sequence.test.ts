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

  it("does not let a late response from a previous centre replace the current queue", async () => {
    const requests = new RequestSequence();
    const visible: string[] = [];
    const olderCentreRequest = requests.next();
    let releaseOlder!: (value: string) => void;
    const olderResponse = new Promise<string>((resolve) => { releaseOlder = resolve; });
    const publishIfCurrent = async (requestId: number, response: Promise<string>) => {
      const value = await response;
      if (requests.isCurrent(requestId)) visible.push(value);
    };
    const olderUpdate = publishIfCurrent(olderCentreRequest, olderResponse);

    const selectedCentreRequest = requests.next();
    await publishIfCurrent(selectedCentreRequest, Promise.resolve("centre-b jobs"));
    releaseOlder("centre-a jobs");
    await olderUpdate;

    expect(visible).toEqual(["centre-b jobs"]);
  });

  it("invalidates in-flight requests when a screen is disposed", () => {
    const requests = new RequestSequence();
    const pending = requests.next();

    requests.invalidate();

    expect(requests.isCurrent(pending)).toBe(false);
  });
});
