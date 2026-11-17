import { afterEach, describe, expect, it } from "vitest";
import { blindIndexMetropolisReference } from "./metropolis-crypto";

const originalKey = process.env.RUDRA_BLIND_INDEX_KEY;
afterEach(() => { if (originalKey === undefined) delete process.env.RUDRA_BLIND_INDEX_KEY; else process.env.RUDRA_BLIND_INDEX_KEY = originalKey; });

describe("Metropolis external reference blind index", () => {
  it("normalizes case and whitespace before collision checks", () => {
    process.env.RUDRA_BLIND_INDEX_KEY = Buffer.alloc(32, 7).toString("base64");
    expect(blindIndexMetropolisReference(" ext  123 ")).toBe(blindIndexMetropolisReference("EXT 123"));
  });

  it("uses a secret key and rejects missing or invalid keys", () => {
    process.env.RUDRA_BLIND_INDEX_KEY = Buffer.alloc(32, 8).toString("base64");
    const first = blindIndexMetropolisReference("EXT-123");
    process.env.RUDRA_BLIND_INDEX_KEY = Buffer.alloc(32, 9).toString("base64");
    expect(blindIndexMetropolisReference("EXT-123")).not.toBe(first);
    delete process.env.RUDRA_BLIND_INDEX_KEY;
    expect(() => blindIndexMetropolisReference("EXT-123")).toThrow("blind_index_key_unavailable");
  });
});
