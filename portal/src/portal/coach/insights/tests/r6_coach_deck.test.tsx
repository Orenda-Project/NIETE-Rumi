import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";

vi.mock("../../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, renderAt, serve, F, http, expectContract } from "./harness";
import { COPY } from "../copy";

/**
 * bd-sex15q.46 (R6 ux-coach) — the coach deck on the design system, red-first (design/r6/SCREENS.md, DIRECTION.md,
 * DESIGN_SYSTEM.md). What a restyle must hold as behaviour, not as pixels:
 *
 *   S1  the headline number lives in the band: the eyebrow, ONE count node in a hero ring, the sentence, the window as
 *       the band's pill (the element the count's data-win resolves to); the overlapping card holds where-first and the
 *       two actions (Listen secondary, See the move the ONE primary); Move 2 is a row, never a second band; the open
 *       steps are a hairline section; the stats link is a row.
 *   S2  no band: the app bar carries the window line; the number is a card-size ring on white; the step card is the
 *       ONE raised surface with the ONE primary; Why and Where carry fraction bars.
 *   all no hex colour in any class on any coach page (DESIGN_SYSTEM: tokens only, design-qa look.1 "strangers").
 */
type Lang = "en" | "ur";
const NOTE_ID = "00000000-0000-4000-8000-060000000001";
const W = "W-IP-TIME";
const HEX = /\[#[0-9a-fA-F]{3,8}\]/;

/** S3's trend dots keep their literal indigo (ux-lead-2 ruling 164235: Where.test:63-64 unchanged); every other node is tokens. */
function hexClasses(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[class]"))
    .filter((e) => e.getAttribute("data-testid") !== "trend-dot")
    .flatMap((e) => (e.getAttribute("class") || "").split(/\s+/))
    .filter((c) => HEX.test(c));
}

const PRIMARY = ["bg-cp-green", "text-cp-navy"];

/** useLaptop() reads matchMedia(min-width: 1024px); jsdom has none, so a test says which width it is. */
function laptop(on: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (q: string) => ({ matches: on && /min-width:\s*1024px/.test(q), media: q, addEventListener: () => {}, removeEventListener: () => {}, onchange: null, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
  });
}

/** ux-lead-2 174713 (1): a school name inside an Urdu sentence is one atomic isolated run, and a count never breaks. */
const ISOLATED = (el: Element) => (el.closest("[class]")?.closest('[class*="[&_[data-code]]:inline-block"]') ?? null) !== null;
const isPrimary = (el: Element) => PRIMARY.every((c) => el.classList.contains(c));

describe.each(["en", "ur"] as Lang[])("R6 coach deck (%s)", (lang) => {
  beforeEach(() => {
    laptop(false);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    http.get.mockReset();
    http.post.mockReset();
  });

  it("S1: the band carries the eyebrow, a hero ring with the ONE headline count, the sentence and the window pill", async () => {
    await boot(lang);
    serve({ "/coachip/home": F.home, [`POST /coachip/notes/${NOTE_ID}/status`]: { note: F.home.note } });
    const { container } = await renderAt("");
    const band = screen.getByTestId("insights-band");
    const hero = within(band).getByTestId("wcard-hero");
    expect(hero.textContent).toContain(COPY["eyebrow.notice"][lang]);
    expect(hero.querySelector('[data-ring="hero"]')).not.toBeNull();
    const nums = hero.querySelectorAll("[data-num]");
    expect(nums.length).toBe(1);
    const card = F.home.moves[0];
    expect(nums[0].getAttribute("data-num")).toBe(String(card.count.n));
    expect(hero.textContent).toContain(card.sentence[lang]);
    // the cause is S2's Why, not the band's (merged_S1_390): the band stays short so the primary stays in the fold
    expect(hero.querySelector("[data-stat]")).toBeNull();
    expect(hero.textContent).not.toContain(card.cause.text[lang]);
    // the pill IS the window element the count resolves to, and it sits in the band
    const win = hero.querySelector(`[data-window="${card.window.id}"]`) as HTMLElement;
    expect(win).not.toBeNull();
    expect(win.className).toContain("rounded-full");
    expectContract(container, expect);
  }, 20000);

  it("S1: the overlapping card holds where-first and the two actions; See the move is the ONE primary", async () => {
    await boot(lang);
    serve({ "/coachip/home": F.home, [`POST /coachip/notes/${NOTE_ID}/status`]: { note: F.home.note } });
    const { container } = await renderAt("");
    const surface = screen.getByTestId("wcard");
    expect(surface.hasAttribute("data-surface")).toBe(true);
    expect(surface.className).toContain("cp-overlap");
    // where-first goes to S3, as it does on S2 (the chevron row of the mockup)
    expect(within(surface).getByTestId("wcard-where").getAttribute("href")).toBe(`/portal/coach/insights/w/${W}/where`);
    const see = within(surface).getByTestId("wcard-see");
    const listen = within(surface).getByTestId("wcard-listen");
    expect(isPrimary(see)).toBe(true);
    expect(isPrimary(listen)).toBe(false);
    expect(listen.className).toContain("border-cp-navy");
    // one primary on the screen
    const page = screen.getByTestId("insights-this-week");
    expect(Array.from(page.querySelectorAll("a,button")).filter(isPrimary).length).toBe(1);
    // the surface is the first thing under the band: nothing between the band and it
    const body = surface.closest(".cp-enter") as HTMLElement;
    expect(body.firstElementChild?.contains(surface)).toBe(true);
    expect(container.querySelectorAll("[data-surface]").length).toBe(1);
  }, 20000);

  it("S1: Move 2 is a row (no second band, no second ring), open steps a hairline section, stats a row", async () => {
    await boot(lang);
    serve({ "/coachip/home": F.home, [`POST /coachip/notes/${NOTE_ID}/status`]: { note: F.home.note } });
    await renderAt("");
    expect(screen.getAllByTestId("insights-band").length).toBe(1);
    expect(document.querySelectorAll('[data-ring="hero"]').length).toBe(1);
    const row = screen.getAllByTestId("wrow")[0];
    expect(row.getAttribute("data-wrow")).toBe("coach");
    const steps = screen.getByTestId("s1-steps");
    expect(steps.hasAttribute("data-section")).toBe(true);
    expect(steps.textContent).toContain(COPY["s1.steps.title"][lang]);
    const stats = screen.getByTestId("s1-stats-link");
    expect(stats.getAttribute("href")).toBe("/portal/coach/insights/stats");
    expect(stats.className).toContain("text-cp-green-ink");
  }, 20000);

  it("S1 loading: the band paints an empty hero ring before the data lands (no jump)", async () => {
    await boot(lang);
    serve({ "/coachip/home": () => new Promise(() => undefined) });
    await renderAt("");
    const band = screen.getByTestId("insights-band");
    expect(band.querySelector('[data-ring="hero"]')).not.toBeNull();
    expect(band.querySelector("[data-arc]")).toBeNull();
  }, 20000);

  it("S1 empty (insufficient): the band says the empty sentence beside an empty ring; the window is its pill", async () => {
    await boot(lang);
    serve({ "/coachip/home": F.home_insufficient });
    const { container } = await renderAt("");
    const band = screen.getByTestId("insights-band");
    const empty = within(band).getByTestId("s1-empty");
    expect(empty.querySelector('[data-ring="hero"]')).not.toBeNull();
    expect(empty.querySelector("[data-arc]")).toBeNull();
    expect(empty.querySelector(`[data-window="${F.home_insufficient.window.id}"]`)).not.toBeNull();
    expectContract(container, expect);
  }, 20000);

  it("S2: no band; the app bar carries the window line; a card ring; the step card is the ONE raised surface and holds the ONE primary", async () => {
    await boot(lang);
    serve({ "/coachip/home": F.home, [`/coachip/w/${W}`]: F[`w_${W}`] });
    const { container } = await renderAt(`/w/${W}`);
    const page = screen.getByTestId("insights-w");
    expect(within(page).queryByTestId("insights-band")).toBeNull();
    const bar = within(page).getByTestId("insights-appbar");
    const d = F[`w_${W}`];
    expect(bar.querySelector(`[data-window="${d.card.window.id}"]`)).not.toBeNull();
    const num = screen.getByTestId("w-number");
    expect(num.querySelector('[data-ring="card"]')).not.toBeNull();
    const step = screen.getByTestId("step-card");
    expect(step.hasAttribute("data-surface")).toBe(true);
    expect(container.querySelectorAll("[data-surface]").length).toBe(1);
    const set = within(step).getByTestId("step-set");
    expect(isPrimary(set)).toBe(true);
    expect(Array.from(page.querySelectorAll("a,button")).filter(isPrimary).length).toBe(1);
    expectContract(container, expect);
  }, 20000);

  it("S2: Why and Where carry 4 px fraction bars beside their counts; sections, not boxed cards", async () => {
    await boot(lang);
    serve({ "/coachip/home": F.home, [`/coachip/w/${W}`]: F[`w_${W}`] });
    await renderAt(`/w/${W}`);
    for (const id of ["w-split", "w-where", "w-good"]) {
      expect(screen.getByTestId(id).hasAttribute("data-section")).toBe(true);
    }
    const split = screen.getByTestId("w-split");
    expect(split.querySelectorAll("[data-bar]").length).toBe(split.querySelectorAll("li [data-num]").length);
    const rows = screen.getAllByTestId("w-where-row");
    for (const r of rows) expect(r.querySelector("[data-bar]")).not.toBeNull();
  }, 20000);

  it("Urdu bidi: every school name and count in the where-first lines sits in an atomic isolating line (S1 card, S2 row); English lines wrap freely", async () => {
    await boot(lang);
    serve({ "/coachip/home": F.home, [`POST /coachip/notes/${NOTE_ID}/status`]: { note: F.home.note }, [`/coachip/w/${W}`]: F[`w_${W}`] });
    await renderAt("");
    const where = screen.getByTestId("wcard-where");
    const atoms = Array.from(where.querySelectorAll("[data-code],[data-num]"));
    expect(atoms.length).toBeGreaterThan(3);
    for (const a of atoms) expect(ISOLATED(a)).toBe(lang === "ur");
    cleanup();
    await renderAt(`/w/${W}`);
    for (const id of ["w-where-first", "w-moment-head"]) {
      const el = screen.getByTestId(id);
      for (const a of Array.from(el.querySelectorAll("[data-code],[data-num]"))) expect(ISOLATED(a)).toBe(lang === "ur");
    }
    for (const r of screen.getAllByTestId("w-where-row")) {
      for (const a of Array.from(r.querySelectorAll("[data-code],[data-num]"))) expect(ISOLATED(a)).toBe(lang === "ur");
    }
  }, 30000);

  it("S1 laptop: where-first and the actions sit INSIDE the hero card (the band), no second raised card; the moment player tops the right column", async () => {
    laptop(true);
    await boot(lang);
    const mid = F.home.moves[0].moment_id;
    serve({ "/coachip/home": F.home, [`POST /coachip/notes/${NOTE_ID}/status`]: { note: F.home.note }, [`/coachip/m/${mid}`]: F.moment });
    await renderAt("");
    const band = screen.getByTestId("insights-band");
    const card = within(band).getByTestId("wcard");
    expect(within(card).getByTestId("wcard-see")).toBeTruthy();
    expect(document.querySelectorAll("[data-surface]").length).toBe(0);
    // the right column is its own lazy chunk (the coach-entry budget): wait for it
    const slot = await screen.findByTestId("moment-slot", {}, { timeout: 5000 });
    const aside = document.querySelector("[data-cp-aside]") as HTMLElement;
    expect(aside.contains(slot)).toBe(true);
    const steps = within(aside).getByTestId("s1-steps");
    expect(Boolean(slot.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(http.get.mock.calls.some(([u]) => u === `/coachip/m/${mid}`)).toBe(true);
    // no clip before a tap
    expect(http.get.mock.calls.some(([u]) => String(u).includes("/clip"))).toBe(false);
  }, 20000);

  it("S1 phone: no moment read (the player is the laptop's right column only)", async () => {
    await boot(lang);
    serve({ "/coachip/home": F.home, [`POST /coachip/notes/${NOTE_ID}/status`]: { note: F.home.note } });
    await renderAt("");
    expect(http.get.mock.calls.some(([u]) => String(u).startsWith("/coachip/m/"))).toBe(false);
  }, 20000);

  it("S2 laptop: the right column holds the step card (the primary) then the moment; Why and Where stay in the main column", async () => {
    laptop(true);
    await boot(lang);
    serve({ "/coachip/home": F.home, [`/coachip/w/${W}`]: F[`w_${W}`] });
    await renderAt(`/w/${W}`);
    const aside = document.querySelector("[data-cp-aside]") as HTMLElement;
    expect(aside).not.toBeNull();
    const step = within(aside).getByTestId("step-card");
    const moment = within(aside).getByTestId("w-moment");
    expect(Boolean(step.compareDocumentPosition(moment) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    for (const id of ["w-number", "w-split", "w-where", "w-good", "w-method"]) expect(aside.contains(screen.getByTestId(id))).toBe(false);
  }, 20000);

  const PAGES: [string, string, Record<string, unknown>][] = [
    ["S1", "", { "/coachip/home": F.home, [`POST /coachip/notes/${NOTE_ID}/status`]: { note: F.home.note } }],
    ["S2", `/w/${W}`, { "/coachip/home": F.home, [`/coachip/w/${W}`]: F[`w_${W}`] }],
    ["S3", `/w/${W}/where`, { [`/coachip/w/${W}`]: F[`w_${W}`] }],
    ["S5", `/w/${W}/move`, { [`/coachip/i/${W}`]: F[`i_${W}`] }],
    ["S6", "/stats", { "/coachip/stats": F.stats }],
    ["S7", "/stats/results", { "/coachip/results": F.results }],
    ["Listen", "/listen", { "/coachip/moments": F.moments }],
    ["Schools", "/schools", { "/coachip/schools": F.schools }],
  ];
  it.each(PAGES)("%s: no hex colour in any class (tokens only)", async (_name, path, answers) => {
    await boot(lang);
    serve(answers);
    const { container } = await renderAt(path);
    expect(hexClasses(container)).toEqual([]);
  }, 20000);
});
