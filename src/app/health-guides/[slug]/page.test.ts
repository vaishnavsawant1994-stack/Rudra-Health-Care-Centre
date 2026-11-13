import { describe, expect, it, vi } from "vitest";

const notFound = vi.hoisted(() => vi.fn(() => { throw new Error("not found"); }));
vi.mock("next/navigation", () => ({ notFound }));

import HealthGuidePage from "./page";
import { metadata, generateStaticParams } from "./page";

describe("public health guide detail route", () => {
  it("allows only the existing general-information article", async () => {
    await expect(HealthGuidePage({ params: Promise.resolve({ slug: "preventive-checkups" }) })).resolves.toBeDefined();
    await expect(HealthGuidePage({ params: Promise.resolve({ slug: "unreviewed-clinical-advice" }) })).rejects.toThrow("not found");
    expect(notFound).toHaveBeenCalledOnce();
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(generateStaticParams()).toEqual([{ slug: "preventive-checkups" }]);
  });
});
