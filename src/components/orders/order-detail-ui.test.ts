import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrderDetail } from "./order-workbench";

describe("order detail recovery controls", () => {
  it("renders a retry action when order details are not available yet", () => {
    const markup = renderToStaticMarkup(createElement(OrderDetail, { id: "00000000-0000-4000-8000-000000000001" }));
    expect(markup).toContain("Retry loading order");
    expect(markup).toContain('role="status"');
  });
});
