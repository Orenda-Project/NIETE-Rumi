/**
 * bd-fxk3t8 — the page paints before the app's JavaScript arrives.
 *
 * Measured on sandbox: #root was empty until the whole bundle downloaded and ran —
 * 1.7 s of white on a desktop, 6.5 s on a slow phone — and the Google Fonts stylesheet
 * held up even that. index.html now carries a static outline of the app inside #root
 * (React replaces it on its first render) and loads the fonts without blocking.
 *
 * The same file is the Capacitor app's entry, so the outline must work with no network:
 * inline styles only, no URL of any kind.
 */
import fs from "node:fs";
import path from "node:path";

const html = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const FONTS = "https://fonts.googleapis.com/css2";

describe("index.html — the static app shell", () => {
  it("#root is not empty: it holds the shell", () => {
    const root = doc.getElementById("root")!;
    const shell = root.querySelector("[data-app-shell]");
    expect(shell).not.toBeNull();
    expect(shell!.getAttribute("aria-hidden")).toBe("true");
    // an outline of the frame: a menu bar, a phone tab bar, and placeholder blocks
    expect(shell!.querySelectorAll("[data-skeleton]").length).toBeGreaterThanOrEqual(6);
  });

  it("the shell needs nothing from the network (Capacitor-safe)", () => {
    const shellHtml = doc.querySelector("[data-app-shell]")!.outerHTML;
    expect(shellHtml).not.toMatch(/https?:|src=|href=|url\(/i);
    const css = doc.getElementById("app-shell-css")!.textContent!;
    expect(css).not.toMatch(/https?:|url\(|@import/i);
  });

  it("it only shimmers for someone who has not asked for less motion", () => {
    const css = doc.getElementById("app-shell-css")!.textContent!.replace(/\s+/g, " ");
    const gated = css.match(/@media \(prefers-reduced-motion: no-preference\) \{(.*)\}\s*$/);
    expect(gated).not.toBeNull();
    // every animation rule lives inside the gate
    const outside = css.replace(gated![0], "");
    expect(outside).not.toMatch(/animation/);
    expect(gated![1]).toMatch(/animation/);
  });

  it("a sign-in page gets the sign-in outline, chosen before anything paints", () => {
    const script = [...doc.querySelectorAll("head script:not([src])")].map((s) => s.textContent).join("\n");
    expect(script).toMatch(/data-shell/);
    expect(script).toMatch(/\/portal\/login/);
    // must never throw where storage is blocked
    expect(script).toMatch(/try\s*\{/);
  });
});

describe("index.html — fonts", () => {
  it("no render-blocking Google Fonts stylesheet", () => {
    // (a parser without scripting reads <noscript>'s fallback as a real link; a browser running JS does not)
    const blocking = [...doc.querySelectorAll('head link[rel="stylesheet"]')]
      .filter((l) => !l.closest("noscript") && l.getAttribute("href")!.startsWith(FONTS));
    expect(blocking).toHaveLength(0);
  });

  it("the fonts still load: preloaded, switched on when they arrive, and a no-JS fallback", () => {
    const pre = [...doc.querySelectorAll('head link[rel="preload"][as="style"]')].find((l) => l.getAttribute("href")!.startsWith(FONTS));
    expect(pre).toBeDefined();
    expect(pre!.getAttribute("onload")).toMatch(/this\.rel\s*=\s*'stylesheet'/);
    expect(html).toMatch(new RegExp(`<noscript><link rel="stylesheet" href="${FONTS.replace(/[.]/g, "\\.")}`));
  });
});
