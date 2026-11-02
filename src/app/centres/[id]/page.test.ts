import { describe, expect, it, vi } from "vitest";

const listPublicCentres = vi.hoisted(() => vi.fn());
vi.mock("@/server/public-enquiry-centres", () => ({ listPublicCentres }));

import { generateMetadata } from "./page";

describe("public centre detail metadata", () => {
  it("uses a centre that has published eligible catalogue services", async () => {
    listPublicCentres.mockResolvedValue([{ id: "123e4567-e89b-42d3-a456-426614174000", name: "Synthetic Main Centre" }]);
    const metadata = await generateMetadata({ params: Promise.resolve({ id: "123e4567-e89b-42d3-a456-426614174000" }) });
    expect(metadata.title).toBe("Synthetic Main Centre | Rudra centre");
  });

  it("does not query invalid or unpublished centre identifiers", async () => {
    vi.clearAllMocks();
    const metadata = await generateMetadata({ params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(listPublicCentres).not.toHaveBeenCalled();
  });
});
