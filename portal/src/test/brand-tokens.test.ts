import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// bd-2457 — the portal must match the official NIETE brand book (wrt. V.2):
// primary dark = navy-slate #333748 (HSL 229 17% 24%), NOT the neutral charcoal
// #32373C the portal shipped with (a site-extraction drift the book supersedes).
// The favicon must be the book's app icon (navy ground), not a bare transparent
// mark that vanishes on dark browser chrome.

const root = resolve(__dirname, "../..");
const css = readFileSync(resolve(root, "src/index.css"), "utf8");
const html = readFileSync(resolve(root, "index.html"), "utf8");
// bd-fmf24g.64: the login's band (and its lattice) is the shared auth frame now.
const login = readFileSync(resolve(root, "src/portal/auth/AuthFrame.tsx"), "utf8");

describe("NIETE brand tokens (book navy #333748)", () => {
  it("light-theme --primary is the book navy-slate, not charcoal", () => {
    expect(css).toMatch(/--primary:\s*229 17% 24%/);
    expect(css).not.toMatch(/--primary:\s*214 9% 22%/);
  });

  it("the hero gradient starts from the book navy", () => {
    expect(css).toContain("hsl(229 17% 24%)");
    expect(css).not.toContain("hsl(214 9% 22%)");
  });

  it("index.html declares the navy theme-color", () => {
    expect(html).toMatch(/<meta name="theme-color" content="#333748"/);
  });

  it("favicon is the book app icon asset (navy-ground), regenerated for bd-2457", () => {
    const png = readFileSync(resolve(root, "public/favicon.png"));
    // PNG magic + a real payload (the old bare 300px transparent mark was ~34KB;
    // the generated navy-ground icon carries a marker chunk we stamp below).
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.includes(Buffer.from("niete-app-icon-v1"))).toBe(true);
  });

  it("the login screen carries the lattice pattern layer", () => {
    expect(login).toMatch(/NieteLattice|niete-lattice|lattice-pattern/);
  });
});
