import { describe, expect, it, vi } from "vitest";

const getPublicCatalogueItem = vi.hoisted(() => vi.fn());
vi.mock("@/server/public-catalogue", () => ({ getPublicCatalogueItem }));

import { generateMetadata } from "./page";

describe("public package detail metadata", () => {
  it("uses a currently verified package projection", async () => {
    getPublicCatalogueItem.mockResolvedValue({ serviceType: "PACKAGE", displayName: "Synthetic Wellness Panel", centreName: "Main Centre" });
    const metadata = await generateMetadata({ params: Promise.resolve({ id: "synthetic-id" }) });
    expect(metadata.title).toBe("Synthetic Wellness Panel | Diagnostic package");
    expect(metadata.description).toContain("Main Centre");
  });

  it("fails closed when the catalogue lookup is unavailable", async () => {
    getPublicCatalogueItem.mockRejectedValue(new Error("synthetic database unavailable"));
    const metadata = await generateMetadata({ params: Promise.resolve({ id: "synthetic-id" }) });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
