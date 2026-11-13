import { describe, expect, it, vi } from "vitest";

const notFound = vi.hoisted(() => vi.fn(() => { throw new Error("not found"); }));
vi.mock("next/navigation", () => ({ notFound }));

import PublicLegalPage from "./page";

describe("public legal route", () => {
  it("serves only allow-listed policy drafts and rejects unknown pages", async () => {
    await expect(PublicLegalPage({ params: Promise.resolve({ page: "privacy" }) })).resolves.toBeDefined();
    await expect(PublicLegalPage({ params: Promise.resolve({ page: "made-up" }) })).rejects.toThrow("not found");
    expect(notFound).toHaveBeenCalledOnce();
  });
});
