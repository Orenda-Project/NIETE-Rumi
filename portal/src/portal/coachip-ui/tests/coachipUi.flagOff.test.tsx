import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * bd-sex15q.42 — B7/B8 for the design system: nothing in coachip-ui reaches a switched-off path. Its only importers are
 * the COACHIP trees (coach/insights, rm) and itself; every other file in the portal is untouched by it, so a coach,
 * teacher or leader with the switch off loads none of it except through InsightsNav, which PortalNavigation draws only
 * when `coachV2 && coachip` (its own golden: routing.flagOff "the menu is …" + PortalNavigation*.flagOff). The tokens are
 * scoped under `.cp`, and only the COACHIP chrome carries that class.
 */
const SRC = join(__dirname, "../../..");
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== "node_modules") walk(p, out); }
    else if (/\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

describe("coachip-ui is reachable only from COACHIP", () => {
  const files = walk(SRC).map((p) => ({ rel: relative(SRC, p), text: readFileSync(p, "utf8") }));
  const ALLOWED = /^portal\/(coachip-ui|coach\/insights|rm)\//;

  it("no file outside coach/insights, rm and coachip-ui imports coachip-ui", () => {
    const importers = files.filter((f) => /from\s+["'][^"']*coachip-ui[^"']*["']|import\s+["'][^"']*coachip-ui/.test(f.text)).map((f) => f.rel);
    expect(importers.length).toBeGreaterThan(0);
    expect(importers.filter((r) => !ALLOWED.test(r))).toEqual([]);
  });

  it("every rule in tokens.css is scoped under .cp (no :root, no bare element selector)", () => {
    const css = readFileSync(join(SRC, "portal/coachip-ui/tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = Array.from(css.matchAll(/([^{}@]+)\{/g)).map((m) => m[1].trim())
      .filter((s) => s && !/^(from|to|\d+%)$/.test(s) && !/^(media|keyframes)\b/.test(s));
    expect(selectors.length).toBeGreaterThan(10);
    for (const sel of selectors) for (const one of sel.split(",")) expect(one.trim()).toMatch(/\.cp/);
    expect(css).not.toMatch(/:root/);
  });

  it("index.css, index.html and the shell files are not changed to carry it", () => {
    const indexCss = readFileSync(join(SRC, "index.css"), "utf8");
    expect(indexCss).not.toMatch(/--cp-|coachip-ui/);
  });
});
