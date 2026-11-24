import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";

/**
 * Tombstone for CVE-2025-53967 / CVE-2025-15061: both were a `curl` fallback
 * built with `child_process.exec` in the fetch path, i.e. command injection in
 * the server process. The code is gone (fetch goes through `undici` now); this
 * test keeps it gone, including through cherry-picks from upstream, where a
 * shell-out can slip back in unnoticed.
 */
const SRC_ROOT = join(__dirname, "..");

// The import pattern also matches `require("child_process")` and dynamic
// `import("child_process")`. The call pattern is restricted to bare calls so a
// destructured `exec` is caught while `RegExp.prototype.exec` (`re.exec(...)`)
// is not; a `cp.exec(...)` style call needs the import and is caught there.
const FORBIDDEN = [
  { name: "child_process import", pattern: /["'](?:node:)?child_process["']/ },
  { name: "bare exec()/execSync() call", pattern: /(?<![.\w$])exec(?:Sync)?\s*\(/ },
];

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return full === join(SRC_ROOT, "tests") ? [] : listSourceFiles(full);
    }
    return /\.(ts|js|mjs|cjs)$/.test(entry) ? [full] : [];
  });
}

describe("no shell execution in src/", () => {
  it("never imports child_process or calls exec()/execSync()", () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC_ROOT)) {
      const contents = readFileSync(file, "utf8");
      for (const { name, pattern } of FORBIDDEN) {
        if (pattern.test(contents)) {
          offenders.push(`${relative(SRC_ROOT, file)}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
