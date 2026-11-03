import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseCsvRow(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { values.push(value); value = ""; }
    else value += char;
  }
  values.push(value);
  return values;
}

describe("178-screen inventory reconciliation", () => {
  it("validates W008 as an embedded review state without treating it as a separate route", async () => {
    const run = spawnSync(process.execPath, [path.join(root, "scripts", "reconcile-screen-inventory.mjs")], { cwd: root, encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    const csv = await readFile(path.join(root, "docs", "SCREEN_IMPLEMENTATION_MATRIX.csv"), "utf8");
    const lines = csv.trimEnd().split(/\r?\n/);
    const header = parseCsvRow(lines[0]);
    const row = parseCsvRow(lines.find((line) => line.startsWith('"W008",')));
    expect(lines).toHaveLength(179);
    expect(row[header.indexOf("Exact source route")]).toBe("No exact target route file found");
    expect(row[header.indexOf("Explicit grouped screen mapping")]).toContain("/book (src/app/book/page.tsx)");
    expect(row[header.indexOf("Explicit grouped screen mapping")]).toContain("not a separate route");
    expect(row[header.indexOf("Implementation status (evidence-based)")]).toContain("explicit grouped-route mapping is source-validated");
    expect(row[header.indexOf("Evidence limitations")]).toContain("does not prove every W008 requirement");
  });

  it("maps M017 to campaign and linked appointment aggregates without claiming payment or platform attribution", async () => {
    const run = spawnSync(process.execPath, [path.join(root, "scripts", "reconcile-screen-inventory.mjs")], { cwd: root, encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    const csv = await readFile(path.join(root, "docs", "SCREEN_IMPLEMENTATION_MATRIX.csv"), "utf8");
    const lines = csv.trimEnd().split(/\r?\n/);
    const header = parseCsvRow(lines[0]);
    const row = parseCsvRow(lines.find((line) => line.startsWith('"M017",')));
    expect(row[header.indexOf("Exact source route")]).toBe("No exact target route file found");
    expect(row[header.indexOf("Explicit grouped screen mapping")]).toContain("/marketing/campaigns (src/app/marketing/campaigns/page.tsx)");
    expect(row[header.indexOf("Explicit grouped screen mapping")]).toContain("payment attribution and external platform data are not part of this mapping");
    expect(row[header.indexOf("Implementation status (evidence-based)")]).toContain("explicit grouped-route mapping is source-validated");
    expect(row[header.indexOf("Evidence limitations")]).toContain("does not provide payment/revenue attribution, platform data");
  });
});
