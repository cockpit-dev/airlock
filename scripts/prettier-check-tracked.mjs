import { execFileSync, spawnSync } from "node:child_process";

const supportedExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".svelte",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml"
]);

const supportedBasenames = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "eslint.config.mjs",
  "tsconfig.json",
  "tsconfig.base.json",
  "svelte.config.js",
  "vite.config.ts",
  "playwright.config.ts"
]);

function getTrackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], {
    encoding: "utf8"
  });
  return output
    .split("\0")
    .filter(Boolean)
    .filter((file) => {
      if (file === "apps/console/src/routeTree.gen.ts") {
        return false;
      }
      const basename = file.split("/").pop() ?? file;
      if (supportedBasenames.has(basename)) {
        return true;
      }
      for (const extension of supportedExtensions) {
        if (file.endsWith(extension)) {
          return true;
        }
      }
      return false;
    });
}

const files = getTrackedFiles();

if (files.length === 0) {
  console.log("No tracked files matched Prettier extensions.");
  process.exit(0);
}

const result = spawnSync("pnpm", ["exec", "prettier", "--check", ...files], {
  stdio: "inherit",
  shell: process.platform === "win32"
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
