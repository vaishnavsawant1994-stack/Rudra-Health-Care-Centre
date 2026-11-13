import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PublicCheckoutPage from "./page";

describe("public payment restriction", () => {
  it("makes no payment request or confirmation claim", () => {
    const markup = renderToStaticMarkup(createElement(PublicCheckoutPage));
    expect(markup).toContain("Online payment is unavailable");
    expect(markup).toContain("No payment has been started, captured or confirmed");
    expect(markup).not.toContain("Pay now");
    expect(markup).not.toContain("Payment successful");
  });
});
