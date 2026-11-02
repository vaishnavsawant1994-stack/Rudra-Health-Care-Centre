import { describe, expect, it, vi } from "vitest";

const getPublicCatalogueItem = vi.hoisted(() => vi.fn());
vi.mock("@/server/public-catalogue", () => ({ getPublicCatalogueItem }));

import { generateMetadata } from "./page";

describe("public test detail metadata", () => {
  it("uses only the currently verified public projection", async () => {
    getPublicCatalogueItem.mockResolvedValue({ serviceType: "TEST", displayName: "Synthetic CBC", centreName: "Main Centre" });
    const metadata = await generateMetadata({ params: Promise.resolve({ id: "synthetic-id" }) });
    expect(metadata.title).toBe("Synthetic CBC | Diagnostic test");
    expect(metadata.description).toContain("Main Centre");
    expect(metadata.description).toContain("does not confirm availability");
  });

  it("noindexes unavailable or mismatched service records", async () => {
    getPublicCatalogueItem.mockResolvedValue(null);
    const metadata = await generateMetadata({ params: Promise.resolve({ id: "missing" }) });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
