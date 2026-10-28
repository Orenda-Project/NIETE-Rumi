/**
 * bd-fxk3t8 — the first screen waits only for the code the first screen needs.
 *
 * Measured on sandbox: one 2.3 MB chunk held every page — coach, leader, the old
 * teacher pages — so a teacher's phone downloaded and ran all of it before anything
 * was interactive. Every page that is not an entry point (sign-in, "/", today's Home,
 * the teacher v2 pages) is now its own chunk:
 *  - opened from the menu, the router's transition keeps the current page on screen
 *    until the new one is ready (v7_startTransition) — no blank, no spinner;
 *  - opened cold (a bookmark, a link), its outline shows while the chunk arrives;
 *  - once the app is idle every chunk is fetched in the background.
 */
import fs from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { vi } from "vitest";

const app = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");
const ENTRY = ["NotFound", "PortalLogin", "PortalRoot", "LegacyAttendanceRedirect", "AppLinkListener", "BackButtonHandler"];

describe("route chunks", () => {
  it("entry points are in the first chunk", () => {
    for (const name of ENTRY) expect(app).toMatch(new RegExp(`^import ${name} from "\\./`, "m"));
  });

  it("every other page is its own chunk", () => {
    const eager = [...app.matchAll(/^import ([A-Z][A-Za-z]+) from "\.\/(?:pages|portal\/(?:pages|coach\/pages|components))\/[A-Za-z]+";$/gm)].map((m) => m[1]);
    expect(eager.filter((n) => !ENTRY.includes(n))).toEqual([]);
    const lazy = [...app.matchAll(/^const ([A-Z][A-Za-z]+) = page\(\(\) => import\("\.\/[^"]+"\)\);$/gm)].map((m) => m[1]);
    expect(lazy.length).toBeGreaterThan(40);
    for (const name of ["PortalCurriculum", "PortalTraining", "PortalCoaching", "LeaderHome", "CoachHome", "PortalPrivacy"]) {
      expect(lazy).toContain(name);
    }
  });

  // bd-sex15q.34 — the teacher dashboard left the first chunk (its charts were a third of what every coach waited
  // for); a teacher's first screen is asked for at boot instead (lib/firstScreen), and the size is held by
  // budget/coachEntry.budget.test.ts.
  it("the teacher dashboard is its own chunk, asked for at boot on a teacher's first screen", () => {
    expect(app).not.toMatch(/^import PortalDashboard from/m);
    expect(app).toMatch(/^const loadDashboard = \(\) => import\("\.\/portal\/pages\/PortalDashboard"\);$/m);
    expect(app).toMatch(/^const PortalDashboard = page\(loadDashboard\);$/m);
    expect(app).toMatch(/warmFirstScreen\(window\.location\.pathname, readShellHint\(\), \{\s*dashboard: loadDashboard,/);
  });

  it("moving between pages keeps the current one on screen while the next loads", () => {
    expect(app).toMatch(/<BrowserRouter future=\{\{ v7_startTransition: true \}\}>/);
  });

  it("the chunks are fetched in the background once the app is idle", () => {
    expect(app).toMatch(/useEffect\(\(\) => \{\s*prefetchPages\(\);\s*\}, \[\]\);/);
    const lib = fs.readFileSync(path.resolve(__dirname, "../lib/lazyPage.ts"), "utf8");
    expect(lib).toMatch(/requestIdleCallback/);
    expect(app).toMatch(/import \{ lazyPage as page, prefetchPages \} from "\.\/lib\/lazyPage";/);
  });
});

vi.mock("@/portal/services/api", async (orig) => {
  const real = await orig<typeof import("@/portal/services/api")>();
  return { ...real, portal: { ...real.portal, getDashboard: vi.fn(() => new Promise(() => {})), getConfig: vi.fn(() => new Promise(() => {})) } };
});

describe("a page opened cold shows its outline while its chunk arrives", () => {
  it("a public page: the card outline (no spinner, never blank)", { timeout: 30_000 }, async () => {
    if (!window.matchMedia) {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
          matches: false, media: query, onchange: null,
          addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
        }),
      });
    }
    window.history.pushState({}, "", "/portal/privacy");
    const { default: App } = await import("@/App");
    const { container } = render(<App />);
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(container.querySelector("[data-frame]")).not.toBeNull();
  });
});
