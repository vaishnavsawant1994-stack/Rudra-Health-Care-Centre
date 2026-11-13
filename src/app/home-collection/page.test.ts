import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children) }));
vi.mock("@/components/website/public-content-override", () => ({ PublicContentOverride: ({ fallback }: { fallback: ReactNode }) => fallback }));
vi.mock("@/components/centres/public-centres-directory", () => ({ PublicCentresDirectory: ({ serviceAreasOnly }: { serviceAreasOnly?: boolean }) => createElement("div", { "data-service-areas-only": serviceAreasOnly }) }));
vi.mock("@/server/public-website-content", () => ({ getPublishedWebsiteMetadata: vi.fn() }));

import HomeCollectionPage from "./page";

describe("home collection public route", () => {
  it("routes home visit requests through the existing staff-reviewed journey", () => {
    const html = renderToStaticMarkup(createElement(HomeCollectionPage));
    expect(html).toContain('href="/book?visitType=HOME_COLLECTION"');
    expect(html).toContain('data-service-areas-only="true"');
    expect(html).toContain("Coverage, service eligibility, staffing and timing are checked before anything is confirmed.");
    expect(html).toContain("No PIN-code availability lookup is currently enabled.");
    expect(html).not.toContain("generated healthcare imagery");
  });
});
