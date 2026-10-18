import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * FLN A11 (qa-audio 202011, COS ruling 204311): the Google Fonts <link> in index.html must not request "Noto Nastaliq
 * Urdu". Google answers WhatsApp's Android in-app browser with full TrueType files for it (~744 KB on an Urdu page),
 * which competed with a plan's audio on a slow line, and the face is never the one that draws Urdu: index.css's own
 * "NIETE Nastaliq" (one woff2, Arabic-script unicode-range) is first in --font-urdu. This reads the shipped page head
 * and stylesheet, which are the artifacts themselves.
 */
const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");
const googleCss = [...html.matchAll(/https:\/\/fonts\.googleapis\.com\/css2\?[^"']+/g)].map((m) => m[0]);

describe("index.html font link", () => {
  it("still loads the Latin brand fonts", () => {
    expect(googleCss.length).toBeGreaterThan(0);
    for (const u of googleCss) expect(u).toMatch(/family=Plus\+Jakarta\+Sans/);
  });

  it("never requests Noto Nastaliq Urdu from Google (the TTFs for WhatsApp's browser)", () => {
    for (const u of googleCss) expect(u).not.toMatch(/Nastaliq/i);
  });

  it("the Urdu face that draws is index.css's own woff2, first in --font-urdu, covering Arabic script", () => {
    const face = css.match(/@font-face\s*\{[^}]*font-family:\s*"NIETE Nastaliq"[^}]*\}/)?.[0] ?? "";
    expect(face).toMatch(/format\("woff2"\)/);
    expect(face).toMatch(/font-weight:\s*400 700/);
    expect(face).toMatch(/U\+0600-06FF/);
    expect(css).toMatch(/--font-urdu:\s*"NIETE Nastaliq",/);
  });
});
