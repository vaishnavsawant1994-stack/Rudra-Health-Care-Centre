import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedFingerprints = [
  "4efa93ea5792f52dda6209d91124aa7543d2719f:src/app/api/metropolis/status/route.test.ts:generic-api-key:20",
  "4efa93ea5792f52dda6209d91124aa7543d2719f:src/app/api/business-relationships/[id]/route.test.ts:generic-api-key:19",
  "4efa93ea5792f52dda6209d91124aa7543d2719f:src/app/api/business-relationships/route.test.ts:generic-api-key:24",
  "4efa93ea5792f52dda6209d91124aa7543d2719f:src/app/api/communications/governance/route.test.ts:generic-api-key:9",
  "4efa93ea5792f52dda6209d91124aa7543d2719f:src/app/api/doctors/[id]/route.test.ts:generic-api-key:19",
  "4efa93ea5792f52dda6209d91124aa7543d2719f:src/app/api/doctors/route.test.ts:generic-api-key:24",
  "4efa93ea5792f52dda6209d91124aa7543d2719f:src/app/api/metropolis/references/route.test.ts:generic-api-key:19",
  "4efa93ea5792f52dda6209d91124aa7543d2719f:src/app/api/metropolis/references/route.test.ts:generic-api-key:28",
  "4efa93ea5792f52dda6209d91124aa7543d2719f:src/server/communication-governance-policy.test.ts:generic-api-key:5",
];

describe("historical Gitleaks disposition", () => {
  it("ignores only the nine reviewed full-history fingerprints", async () => {
    const entries = (await readFile(path.join(root, ".gitleaksignore"), "utf8")).trim().split(/\r?\n/);
    expect(entries).toEqual(expectedFingerprints);
    expect(entries).toHaveLength(9);
    expect(entries.every((entry) => /^4efa93ea5792f52dda6209d91124aa7543d2719f:.+\.test\.ts:generic-api-key:\d+$/.test(entry))).toBe(true);
  });
});
