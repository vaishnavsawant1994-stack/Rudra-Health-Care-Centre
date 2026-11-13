import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PackagesPage from "./page";

describe("public diagnostic package directory", () => {
  it("renders the live published catalogue directory instead of illustrative package prices", () => {
    const markup = renderToStaticMarkup(createElement(PackagesPage));
    expect(markup).toContain("Health Checkup Packages");
    expect(markup).toContain("Loading currently published services");
    expect(markup).not.toContain("Full Body Checkup");
    expect(markup).not.toContain("â‚¹ 1,999");
  });
});
