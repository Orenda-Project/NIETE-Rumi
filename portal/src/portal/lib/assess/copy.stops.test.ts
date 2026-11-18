import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { COPY } from "./copy";

/**
 * Results' "How it ended" turns a task's stop reason into words with COPY[lang].results.stops, and a code the map does
 * not have is shown raw. This test collects every stop reason that can reach that row and fails on any one either
 * language lacks:
 *   - the child's page: the runner's STOP table (dashboard/sa/sa-core.js), plus any literal reason the runner or the
 *     engine (sa-engine.js) assigns, finishes or skips with;
 *   - the server: the reason a scored task names in place of the phone's (ruleStop in the results read).
 * The engine and the server are separate builds, so the files are read here as they are in the repo.
 */
const ROOT = "../../../../../";
const require = createRequire(import.meta.url);
const core = require(`${ROOT}dashboard/sa/sa-core.js`) as { STOP: Record<string, string> };
const STOP = core.STOP;
const source = (p: string) => readFileSync(require.resolve(`${ROOT}${p}`), "utf8");

const CODE = "'([a-z][a-z0-9_]*)'";
const LITERALS = [
  new RegExp(`stop_reason\\s*:\\s*${CODE}`, "g"),
  new RegExp(`\\bfinish\\(\\s*${CODE}`, "g"),
  new RegExp(`\\bskipRest\\([^,()]+,\\s*${CODE}`, "g"),
  new RegExp(`\\bskip\\s*:\\s*${CODE}`, "g"),
];

/** The reasons one engine file can emit: each STOP.X it names, and each literal it assigns, finishes or skips with. */
function emittedBy(code: string): { reasons: string[]; unknownKeys: string[] } {
  const reasons = new Set<string>();
  const unknownKeys: string[] = [];
  for (const m of code.matchAll(/\bSTOP\.([A-Z][A-Z0-9_]*)/g)) {
    if (typeof STOP[m[1]] === "string") reasons.add(STOP[m[1]]);
    else unknownKeys.push(m[1]);
  }
  for (const re of LITERALS) for (const m of code.matchAll(re)) reasons.add(m[1]);
  return { reasons: [...reasons], unknownKeys };
}

/** The server's ruleStop: the reason a scored task names on Results in place of the phone's. */
function serverStops(): string[] {
  const api = source("bot/shared/services/child-test/app/sa-api.service.js");
  const body = api.match(/function ruleStop\([\s\S]*?\n\}/);
  if (!body) return [];
  return [...body[0].matchAll(new RegExp(`(?:return|\\?|:)\\s*${CODE}`, "g"))].map((m) => m[1]);
}

const engine = ["dashboard/sa/sa-core.js", "dashboard/sa/sa-engine.js"].map((p) => emittedBy(source(p)));
const ALL = [...new Set([...Object.values(STOP), ...engine.flatMap((e) => e.reasons), ...serverStops()])].sort();

describe("every stop reason has words on Results (How it ended)", () => {
  it("the collection itself works: the runner's table, the engine's literals and the server's rule stops are all found", () => {
    expect(engine.flatMap((e) => e.unknownKeys)).toEqual([]);
    for (const code of ["complete", "time_up", "coach_end", "end_section", "skipped_end_section", "skipped_incomplete", "early_stop_silence"]) {
      expect(ALL).toContain(code);
    }
    expect(serverStops().sort()).toEqual(["comprehension_not_asked", "comprehension_voided", "multiplication_not_asked", "stopped_by_rule", "stopped_by_rule_egma"]);
  });

  for (const lang of ["en", "ur"] as const) {
    it(`${lang}: no stop reason falls back to its raw code`, () => {
      const stops = COPY[lang].results.stops as Record<string, string>;
      const missing = ALL.filter((code) => typeof stops[code] !== "string" || !stops[code].trim() || stops[code] === code);
      expect(missing).toEqual([]);
    });
  }

  it("the coach's End this section reuses the existing words: the part ended reads as coach_end, the parts after it as skipped_level2", () => {
    for (const lang of ["en", "ur"] as const) {
      const stops = COPY[lang].results.stops as Record<string, string>;
      expect(stops.end_section).toBe(stops.coach_end);
      expect(stops.skipped_end_section).toBe(stops.skipped_level2);
    }
    expect(COPY.en.results.stops.coach_end).toBe("Ended by the coach");
    expect(COPY.en.results.stops.skipped_level2).toBe("Skipped");
  });
});
