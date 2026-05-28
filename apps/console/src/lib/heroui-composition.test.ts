import { describe, expect, it } from "vitest";

const sourceModules = import.meta.glob("../{components,routes}/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
});

function matchingFiles(pattern: RegExp): string[] {
  return Object.entries(sourceModules)
    .filter(([, source]) => pattern.test(String(source)))
    .map(([file]) => file.replace("../", "src/"))
    .sort();
}

describe("HeroUI composition", () => {
  it("does not hand-apply HeroUI internal button classes", () => {
    expect(matchingFiles(/button--(?:ghost|primary|secondary|tertiary|sm|md|lg|icon-only)/)).toEqual([]);
  });

  it("uses HeroUI field labeling primitives instead of styled native labels", () => {
    expect(matchingFiles(/<label\s+className=/)).toEqual([]);
  });

  it("uses HeroUI EmptyState composition instead of the legacy console-empty shell", () => {
    expect(matchingFiles(/console-empty/)).toEqual([]);
  });
});
