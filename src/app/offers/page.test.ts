import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children) }));
vi.mock("@/components/catalogue/public-catalogue-directory", () => ({ PublicCatalogueDirectory: ({ serviceType }: { serviceType: string }) => createElement("div", { "data-service-type": serviceType }, "Published catalogue") }));
vi.mock("@/components/website/public-content-override", () => ({ PublicContentSections: () => null }));

import OffersPage from "./page";

describe("public offers route", () => {
  it("shows only published package catalogue entries and no unapproved discount claim", () => {
    const html = renderToStaticMarkup(createElement(OffersPage));
    expect(html).toContain('data-service-type="PACKAGE"');
    expect(html).toContain("does not create promotional discounts");
    expect(html).toContain("A listing is not a booking confirmation or offer redemption.");
    expect(html).not.toContain("Save 20%");
  });
});
