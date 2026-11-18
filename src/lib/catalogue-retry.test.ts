import { describe, expect, it } from "vitest";
import { catalogueRetryRequest } from "./catalogue-retry";

describe("public catalogue retry target", () => {
  it("retries a failed first-page request from page one", () => {
    expect(catalogueRetryRequest(1, false)).toEqual({ page: 1, append: false });
  });

  it("continues from the next page after a failed append", () => {
    expect(catalogueRetryRequest(4, true)).toEqual({ page: 5, append: true });
  });

  it("does not request a page below one", () => {
    expect(catalogueRetryRequest(0, true)).toEqual({ page: 1, append: true });
  });
});
