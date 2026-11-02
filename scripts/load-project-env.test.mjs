import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectEnvironment } from "./load-project-env.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("loadProjectEnvironment", () => {
  it("loads project env files by explicit root and keeps process env precedence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "rudra-env-test-"));
    temporaryDirectories.push(root);
    await writeFile(path.join(root, ".env.local"), "LOCAL_ONLY=local-value\nSHARED=from-local\nPROCESS_PRECEDENCE=from-local\n", "utf8");
    await writeFile(path.join(root, ".env"), "BASE_ONLY=base-value\nSHARED=from-base\nPROCESS_PRECEDENCE=from-base\n", "utf8");
    const environment = { PROCESS_PRECEDENCE: "from-process" };

    loadProjectEnvironment({ root, environment });

    expect(environment).toEqual({
      SHARED: "from-local",
      PROCESS_PRECEDENCE: "from-process",
      LOCAL_ONLY: "local-value",
      BASE_ONLY: "base-value",
    });
  });
});
