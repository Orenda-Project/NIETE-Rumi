import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * bd-sex15q.46 (R6 fix cycle 2, FIX_R6 §7.2 A11, design-qa 013450) — on a first visit the COACHIP pages draw in a
 * system face until Plus Jakarta Sans lands (`display=swap`), then re-flow: S6 EN cold 0.230. A metric-matched local
 * fallback face, second in the `.cp` stack, makes the swap a repaint instead of a re-flow. jsdom cannot swap fonts
 * (vitest runs with css: false), so the rule is read from the file; design-qa's cold probe is the proof.
 */
const css = readFileSync(join(__dirname, "..", "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const faces = Array.from(css.matchAll(/@font-face\s*\{([^}]*)\}/g)).map((m) => m[1]);
const pct = (body: string, prop: string) => Number((new RegExp(`${prop}:\\s*([\\d.]+)%`).exec(body) || [])[1]);

describe("A11: the Plus Jakarta Sans fallback face", () => {
  it("declares local, metric-adjusted faces named \"Plus Jakarta Sans Fallback\" for 400, 500, 600 and 700", () => {
    const ours = faces.filter((f) => /font-family:\s*"Plus Jakarta Sans Fallback"/.test(f));
    expect(ours.map((f) => (/font-weight:\s*(\d+)/.exec(f) || [])[1]).sort()).toEqual(["400", "500", "600", "700"]);
    for (const f of ours) {
      // local system faces only: no network request, nothing for the flag-off pages to fetch
      expect(f).toMatch(/src:\s*local\("Arial/);
      // regular weights on Arial, bold weights on Arial Bold (no synthetic bold)
      const w = Number((/font-weight:\s*(\d+)/.exec(f) || [])[1]);
      expect(/local\("Arial Bold"\)/.test(f)).toBe(w >= 600);
      expect(f).not.toMatch(/url\(/);
      const sa = pct(f, "size-adjust");
      expect(sa).toBeGreaterThan(95);
      expect(sa).toBeLessThan(115);
      // the webfont's ascent 1038 and descent 222 per 1000, divided by size-adjust (±0.01 %)
      expect(Math.abs(pct(f, "ascent-override") - 10380 / sa)).toBeLessThan(0.01);
      expect(Math.abs(pct(f, "descent-override") - 2220 / sa)).toBeLessThan(0.01);
      expect(f).toMatch(/line-gap-override:\s*0%/);
    }
  });

  it("the .cp stack names it second, straight after the webfont", () => {
    const latin = /--cp-font-latin:\s*([^;]+);/.exec(css)?.[1] ?? "";
    expect(latin.split(",").map((s) => s.trim()).slice(0, 2)).toEqual(['"Plus Jakarta Sans"', '"Plus Jakarta Sans Fallback"']);
  });
});
