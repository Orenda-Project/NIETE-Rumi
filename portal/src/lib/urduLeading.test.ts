import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * bd-fmf24g.24 — Urdu (Noto Nastaliq) was cut off at the bottom wherever a box clips it. jsdom cannot lay text out,
 * so this guards the RULES; the measurement itself (the real ink of every clipping box, in Chromium) is
 * `node scripts/urdu-fit/run.mjs` from portal/. Both are the bead's proof.
 */
const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");

/** The declarations of the first rule whose selector (whitespace squashed) contains `selector`. */
function rule(selector: string): string | null {
  const squashed = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
  const at = squashed.indexOf(selector);
  if (at < 0) return null;
  const open = squashed.indexOf("{", at);
  const close = squashed.indexOf("}", open);
  return squashed.slice(open + 1, close).trim();
}

describe("Urdu typography (index.css)", () => {
  it("every Urdu line is 2: more specific than a leading-* utility, Urdu only, headings and prose keep their own", () => {
    const body = rule('html[lang="ur"] body *:not(svg)');
    expect(body).not.toBeNull();
    expect(body).toMatch(/line-height:\s*2\s*;?$/);
    expect(css).toMatch(/html\[lang="ur"\] body \*:not\(svg\):not\(svg \*\):not\(h1\):not\(h2\):not\(h3\):not\(p\)/);
  });

  it("a box that clips Urdu (truncate, line-clamp-N) gets 0.3em of room above and below, pulled back by a negative margin", () => {
    const clip = rule(':where(html[lang="ur"]) :is(.truncate, [class*="line-clamp-"])');
    expect(clip).not.toBeNull();
    expect(clip).toMatch(/padding-block:\s*0\.3em/);
    expect(clip).toMatch(/margin-block:\s*-0\.3em/);
  });

  it("Urdu is never smaller than 13px: the kit's small Latin sizes are raised", () => {
    const small = rule('html[lang="ur"] :is(.text-xs,');
    expect(small).toMatch(/font-size:\s*13px/);
    for (const px of ["10px", "11px", "11\\.5px", "12px", "12\\.5px"]) expect(css).toContain(`.text-\\[${px}\\]`);
  });

  it("nothing outside html[lang=\"ur\"] gets the Urdu leading: English is untouched", () => {
    const block = css.slice(css.indexOf("bd-fmf24g.24"));
    const rules = block.split("}").slice(0, 3).map((r) => r.replace(/\/\*[\s\S]*?\*\//g, "").trim()).filter((r) => r.includes("{"));
    for (const r of rules) expect(r.split("{")[0]).toContain('html[lang="ur"]');
  });
});
