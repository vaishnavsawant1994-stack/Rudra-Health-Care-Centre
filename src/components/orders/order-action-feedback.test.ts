import { describe, expect, it } from "vitest";
import { orderActionFeedback } from "./order-action-feedback";

describe("order action feedback", () => {
  it("reports success only when saved order details were refreshed", () => {
    expect(orderActionFeedback("saved", true)).toBe("Order updated successfully.");
  });

  it("distinguishes a saved mutation from a failed details refresh", () => {
    expect(orderActionFeedback("saved", false)).toContain("Order action was saved");
    expect(orderActionFeedback("saved", false)).toContain("Refresh the order before taking another action");
  });

  it("requires a refresh when the mutation result is unknown", () => {
    expect(orderActionFeedback("unconfirmed", false)).toContain("could not be confirmed");
    expect(orderActionFeedback("unconfirmed", false)).toContain("Refresh the order before retrying");
  });
});
