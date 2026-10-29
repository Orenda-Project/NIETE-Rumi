import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * bd-sex15q.47 (ux-lead-2 171155) — the first card under a band rides 24 px over it (DESIGN_SYSTEM §3). Shell pads the
 * page body 16 px (`pt-4`), so the phone rule must pull the card up 40 px (24 + 16); the laptop (≥ 1024) resets it to 0.
 * vitest runs with css: false, so the rule is read from the file, the way coachipUi.flagOff reads it.
 */
const css = readFileSync(join(__dirname, "..", "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const [phone, laptop] = css.split("@media (min-width: 1024px)");

describe("cp-overlap", () => {
  it("on a phone pulls the card up 40 px: 24 px over the band plus Shell's 16 px pad", () => {
    expect(phone).toMatch(/\.cp-overlap\s*\{[^}]*margin-top:\s*-40px/);
    expect(readFileSync(join(__dirname, "..", "Shell.tsx"), "utf8")).toContain("px-5 pt-4");
  });

  it("on a laptop resets to 0 (the band body is the hero card there)", () => {
    expect(laptop).toMatch(/\.cp-overlap\s*\{[^}]*margin-top:\s*0/);
  });
});
