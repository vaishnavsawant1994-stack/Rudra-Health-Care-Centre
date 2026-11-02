import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

import PartnerEnquiryAliasPage from "./page";

describe("public partner enquiry alias", () => {
  it("routes the proposed singular URL to the canonical reviewed partner enquiry page", () => {
    redirect.mockClear();
    renderToStaticMarkup(createElement(PartnerEnquiryAliasPage));
    expect(redirect).toHaveBeenCalledOnce();
    expect(redirect).toHaveBeenCalledWith("/partners");
  });
});
