import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children) }));
vi.mock("@/components/ui/action-button", () => ({ ActionButton: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children) }));
vi.mock("@/components/centres/public-centres-directory", () => ({ PublicCentresDirectory: () => createElement("div", { "data-testid": "published-directory" }) }));
vi.mock("@/components/website/public-content-override", () => ({ PublicContentSections: () => null }));
vi.mock("@/server/public-website-content", () => ({ getPublishedWebsiteMetadata: vi.fn() }));

import CentresPage from "./page";

describe("public centre directory route", () => {
  it("uses the published centre directory and avoids claiming availability", () => {
    const html = renderToStaticMarkup(createElement(CentresPage));
    expect(html).toContain("Search published centre information");
    expect(html).toContain("published-directory");
    expect(html).toContain("Contact the centre to confirm before travelling.");
    expect(html).toContain("/home-collection");
    expect(html).not.toContain("map markers");
  });
});
