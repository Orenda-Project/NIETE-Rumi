import { describe, it, expect } from "vitest";

/**
 * SPEC_v2 §6 row 30 (client half; the server half is tests/portal/fln-ab-isolation.test.js).
 *
 * The FLN client folder must import nothing from the K-5 lesson-plan code that the ch3–8 A/B test (lp-ab-ch310)
 * reads through: no lp-ab / ab-ch310 module, not the K-5/6–12 `lessonPlansApi`, not `useOpenLesson`. FLN plans
 * have their own kind (`fln`) and their own API (`fln/api.ts`), so an FLN open can never be counted as an A/B
 * open. Every .ts/.tsx under fln/ is read as text (tests excluded — the goldens import the K-5 code on purpose).
 */

const FORBIDDEN = ["lp-ab", "ab-ch310", "lessonPlansApi", "useOpenLesson"] as const;

const sources = import.meta.glob<string>("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });

/** Every module path a source names: static/side-effect imports, re-exports, dynamic import(), require(). */
export function importPaths(src: string): string[] {
  const out: string[] = [];
  const res = [
    /\b(?:import|export)\s+(?:type\s+)?[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    /\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
  ];
  for (const re of res) for (const m of src.matchAll(re)) out.push(m[1]);
  return out;
}

const forbiddenIn = (src: string) => importPaths(src).filter((p) => FORBIDDEN.some((f) => p.includes(f)));

describe("FLN client ↔ K-5 A/B isolation", () => {
  const files = Object.entries(sources).filter(([path]) => !path.startsWith("./") && !path.includes("/tests/") && !path.startsWith("../tests/"));

  it("reads the whole fln/ folder (not an empty glob)", () => {
    const names = files.map(([p]) => p);
    expect(names).toContain("../api.ts");
    expect(names).toContain("../strings.ts");
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it("the scanner catches every import form (proves a hit would fail)", () => {
    const bad = [
      "import { lessonPlans } from '../../newui/lessons/lessonPlansApi';",
      "import type { X } from \"../teacher/lessons/useOpenLesson\";",
      "export { groupFor } from '../../../bot/lp-ab-ch310.service';",
      "const m = await import('../ab-ch310/x');",
      "import '../lp-ab/side-effect';",
      "const s = require('lp-ab-ch310');",
    ].join("\n");
    expect(forbiddenIn(bad)).toHaveLength(6);
    expect(forbiddenIn("import { flnApi } from './api';\n// lessonPlansApi is not used here")).toEqual([]);
  });

  it.each(FORBIDDEN)("no fln/ file imports anything matching %s", (needle) => {
    const hits = files.flatMap(([path, src]) => importPaths(src).filter((p) => p.includes(needle)).map((p) => `${path} → ${p}`));
    expect(hits).toEqual([]);
  });
});
