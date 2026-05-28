import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workspaceRoot = resolve(import.meta.dirname, "../../../..");

function readWorkspaceFile(path: string) {
  return readFileSync(resolve(workspaceRoot, path), "utf8");
}

describe("workspace docs and scripts", () => {
  it("points console-facing commands and docs at apps/console instead of apps/dashboard", () => {
    const files = [
      "GOALS.md",
      "README.md",
      "README.zh-CN.md",
      "docs/superpowers/implementations/2026-05-18-production-deployment-and-config.md",
      "docs/superpowers/specs/control-plane-dashboard.md",
    ];

    const offenders = files.filter((file) => {
      const source = readWorkspaceFile(file);
      return /apps\/dashboard|@airlock\/dashboard/.test(source);
    });

    expect(offenders).toEqual([]);
  });

  it("does not keep the legacy apps/dashboard workspace around", () => {
    expect(existsSync(resolve(workspaceRoot, "apps/dashboard"))).toBe(false);
  });
});
