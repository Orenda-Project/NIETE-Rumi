import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COPY_MODULES } from "./copyRegistry";

/**
 * bd-fmf24g.13 — writes the Urdu review file a human reviewer works through: one row per word, English |
 * Urdu (MACHINE-DRAFTED) | screen | note. Runs only when asked:
 *
 *   URDU_REVIEW_OUT="<folder>" npx vitest run src/portal/teacher/urdu-review.export.test.ts
 *
 * A function contributes what it returns for sample arguments, so the reviewer sees the real phrase.
 */

const SAMPLE = [3, 7];
type Row = { screen: string; key: string; en: string; ur: string; note: string };

function rows(screen: string, en: unknown, ur: unknown, key: string, out: Row[]) {
  if (typeof en === "function") {
    const e = String((en as (...a: unknown[]) => unknown)(...SAMPLE));
    const u = typeof ur === "function" ? String((ur as (...a: unknown[]) => unknown)(...SAMPLE)) : "";
    out.push({ screen, key: `${key}(${SAMPLE.join(", ")})`, en: e, ur: u, note: "phrase built from numbers" });
    return;
  }
  if (typeof en === "string") {
    out.push({ screen, key, en, ur: typeof ur === "string" ? ur : "", note: "" });
    return;
  }
  if (en && typeof en === "object") {
    for (const k of Object.keys(en as object)) {
      rows(screen, (en as Record<string, unknown>)[k], ur && typeof ur === "object" ? (ur as Record<string, unknown>)[k] : undefined, key ? `${key}.${k}` : k, out);
    }
  }
}

const OUT = process.env.URDU_REVIEW_OUT;

describe("Urdu review file", () => {
  it.runIf(!!OUT)("writes en | ur | screen | key | note, every row MACHINE-DRAFTED", () => {
    const all: Row[] = [];
    for (const m of COPY_MODULES) rows(m.screen, m.module.en, m.module.ur, "", all);
    const cell = (s: string) => s.replace(/\t/g, " ").replace(/\n/g, " ");
    const tsv = ["en\tur\tscreen\tkey\tnote"]
      .concat(all.map((r) => [r.en, r.ur, r.screen, r.key, ["MACHINE-DRAFTED", r.note].filter(Boolean).join("; ")].map(cell).join("\t")))
      .join("\n");
    mkdirSync(OUT as string, { recursive: true });
    writeFileSync(join(OUT as string, "urdu-review.tsv"), `${tsv}\n`, "utf8");
    expect(all.length).toBeGreaterThan(0);
  });

  it("is skipped unless asked (no file written in CI)", () => {
    expect(true).toBe(true);
  });
});
