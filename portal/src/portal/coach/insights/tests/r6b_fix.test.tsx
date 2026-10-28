import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("../../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, renderAt, serve, F, http, expectContract } from "./harness";
import { COPY } from "../copy";
import { Ring } from "../../../coachip-ui/Ring";
import { FractionBar } from "../../../coachip-ui/FractionBar";
import { CP_COLOURS } from "../../../coachip-ui/tokens";
import ChapterStrip from "../player/ChapterStrip";
import type { Moment } from "../types";

/**
 * bd-sex15q.46 (R6 fix cycle 1, design/r6/FIX_R6.md PR A) — red-first for every behaviour line of A1–A10. Pixels (CLS,
 * the fold) are design-qa's probe (rig/probe_cls.py, look.5); what jsdom can prove is where each node sits and what it
 * carries:
 *
 *   A1  the app bar draws placeholder bars in the live line boxes while the title is unknown; S1's stale line leaves
 *       the band (so the band never changes height) and sits under the first card
 *   A2  S5: the app bar title is the weakness's short name; the number comes before the intervention title, which is
 *       the ONE MOVE lead; the Surface carries the screen's one action
 *   A3  S4: See the move is the system secondary (navy outline on white), the play stays the primary
 *   A4  a row whose window is the screen's says no range of its own (Schools: one visible range)
 *   A5  a ring or bar carries its tone as data-tone (notice by default; strength on a done count)
 *   A6  the trust line is the band's foot on a phone home; the page-foot copy is the laptop's
 *   A8  one tint: no grey-fill token, no bg-cp-grey-fill class
 *   A9  a strip label wraps at the space only; "Trend ›" carries no second (lucide) chevron in English
 *   A10 a trend with no lesson where the W showed draws no dots, only the hint
 */
type Lang = "en" | "ur";
const W = "W-IP-TIME";
const NOTE_ID = "00000000-0000-4000-8000-060000000001";
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

function laptop(on: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (q: string) => ({ matches: on && /min-width:\s*1024px/.test(q), media: q, addEventListener: () => {}, removeEventListener: () => {}, onchange: null, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
  });
}

/** The visible range texts on a page: the text of every [data-window] node that is not hidden from sight. */
function visibleRanges(root: ParentNode, id: string): number {
  return Array.from(root.querySelectorAll<HTMLElement>(`[data-window="${id}"]`))
    .filter((e) => !e.closest(".sr-only") && (e.textContent || "").trim().length > 0).length;
}

describe.each(["en", "ur"] as Lang[])("R6 fix cycle 1, PR A (%s)", (lang) => {
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

  // ── A1 · the load jump ──────────────────────────────────────────────────────────────────────────────────────────────
  it("A1: while S2's read is in flight the app bar holds placeholder bars in the eyebrow, title and window line boxes", async () => {
    await boot(lang);
    serve({ [`/coachip/w/${W}`]: () => new Promise(() => undefined), "/coachip/home": () => new Promise(() => undefined) });
    await renderAt(`/w/${W}`);
    const bar = screen.getByTestId("insights-appbar");
    const ph = bar.querySelectorAll("[data-cp-ph]");
    expect(Array.from(ph).map((e) => e.getAttribute("data-cp-ph"))).toEqual(["eyebrow", "title", "sub"]);
    ph.forEach((e) => expect(e.className).toContain("cp-skeleton"));
    expect(bar.querySelector("h1")).toBeNull();
  }, 20000);

  it("A1: once S2 lands the placeholders are gone and the title is the short name", async () => {
    await boot(lang);
    serve({ [`/coachip/w/${W}`]: F[`w_${W}`], "/coachip/home": F.home });
    await renderAt(`/w/${W}`);
    const bar = screen.getByTestId("insights-appbar");
    expect(bar.querySelector("[data-cp-ph]")).toBeNull();
    expect(bar.querySelector("h1")?.textContent).toBe(F[`w_${W}`].card.short_name[lang]);
  }, 20000);

  it("A1: S1 stale — the stale line sits outside the band, under the first card and before the open steps", async () => {
    await boot(lang);
    serve({ "/coachip/home": F.home_stale, [`POST /coachip/notes/${NOTE_ID}/status`]: { note: F.home.note } });
    const { container } = await renderAt("");
    const band = screen.getByTestId("insights-band");
    const stale = screen.getByTestId("s1-stale");
    expect(band.contains(stale)).toBe(false);
    expect(stale.className).toContain("text-cp-ink-3");
    const card = screen.queryByTestId("wcard");
    const steps = screen.getByTestId("s1-steps");
    if (card) expect(card.compareDocumentPosition(stale) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stale.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expectContract(container, expect);
  }, 20000);

  it("A1: the band's phone height is one variable, shared by the live band and the skeleton's band", async () => {
    await boot(lang);
    serve({ "/coachip/home": () => new Promise(() => undefined) });
    await renderAt("");
    const band = screen.getByTestId("insights-band");
    expect(band.hasAttribute("data-cp-fixed")).toBe(true);
  }, 20000);

  // ── A2 · S5 hierarchy ──────────────────────────────────────────────────────────────────────────────────────────────
  it("A2: S5's app bar title is the weakness; the number comes first, the intervention title is the ONE MOVE lead", async () => {
    await boot(lang);
    serve({ "/coachip/i/W-IP-TIME": F["i_W-IP-TIME"] });
    const { container } = await renderAt(`/w/${W}/move`);
    const d = F["i_W-IP-TIME"];
    const bar = screen.getByTestId("insights-appbar");
    expect(bar.querySelector("h1")?.textContent).toBe(d.w.short_name[lang]);
    expect(bar.textContent).not.toContain(d.i.title[lang]);
    const lead = screen.getByTestId("s5-lead");
    expect(lead.textContent).toBe(d.i.title[lang]);
    const firstNum = container.querySelector("[data-num]") as HTMLElement;
    expect(firstNum.compareDocumentPosition(lead) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("s5-w").querySelector('[data-ring="card"]')).not.toBeNull();
    expect(screen.getByTestId("s5-w").getAttribute("data-tone")).toBe("notice");
    expectContract(container, expect);
  }, 20000);

  it("A2: the Try this tomorrow Surface carries the screen's one action, the primary", async () => {
    await boot(lang);
    serve({ "/coachip/i/W-IP-TIME": F["i_W-IP-TIME"] });
    await renderAt(`/w/${W}/move`);
    const surface = screen.getByTestId("s5-try-tomorrow");
    const actions = surface.querySelectorAll("a,button");
    expect(actions.length).toBe(1);
    const play = within(surface).getByTestId("s5-play");
    expect(play.className).toContain("bg-cp-green");
    expect(play.getAttribute("href")).toBe(`/portal/coach/insights/w/${W}#moment`);
    expect(screen.getAllByTestId("s5-play").length).toBe(1);
  }, 20000);

  // ── A3 · S4 See the move ───────────────────────────────────────────────────────────────────────────────────────────
  it("A3: See the move is the navy outline secondary, never a navy-filled bar", async () => {
    await boot(lang);
    const ID = F.moment.moment_id as string;
    serve({ [`/coachip/m/${ID}`]: clone(F.moment) });
    await renderAt(`/m/${ID}`);
    const see = screen.getByTestId("see-move");
    expect(see.className).toContain("border-cp-navy");
    expect(see.className).toContain("bg-white");
    expect(see.className).not.toContain("bg-cp-navy");
    expect(see.className).toContain("min-h-[52px]");
  }, 20000);

  // ── A4 · windows once ──────────────────────────────────────────────────────────────────────────────────────────────
  it("A4: Schools states its shared window once (the band); every row's count still resolves", async () => {
    await boot(lang);
    serve({ "/coachip/schools": F.schools });
    const { container } = await renderAt("/schools");
    expect(visibleRanges(container, F.schools.window.id)).toBe(1);
    expect(screen.getByTestId("insights-band").querySelector(`[data-window="${F.schools.window.id}"]`)).not.toBeNull();
    expectContract(container, expect);
  }, 20000);

  // ── A5 · ring and bar tone ─────────────────────────────────────────────────────────────────────────────────────────
  it("A5: a Ring is a notice by default and says so as data-tone; strength on request", () => {
    const a = render(<Ring n={3} d={10} testId="r-a" />);
    expect(a.getByTestId("r-a").getAttribute("data-tone")).toBe("notice");
    const b = render(<Ring n={3} d={10} tone="strength" testId="r-b" />);
    expect(b.getByTestId("r-b").getAttribute("data-tone")).toBe("strength");
  });

  it("A5: a FractionBar fills navy for a notice (the default), green only for a strength", () => {
    const { container } = render(<><FractionBar n={2} d={4} /><FractionBar n={2} d={4} tone="green" /></>);
    const fills = container.querySelectorAll("[data-fill]");
    expect(fills[0].className).toContain("bg-cp-navy");
    expect(fills[1].className).toContain("bg-cp-green");
  });

  it("A5: S1's band ring is a notice ring", async () => {
    await boot(lang);
    serve({ "/coachip/home": F.home, [`POST /coachip/notes/${NOTE_ID}/status`]: { note: F.home.note } });
    await renderAt("");
    expect(screen.getByTestId("insights-band").querySelector('[data-ring="hero"]')?.getAttribute("data-tone")).toBe("notice");
  }, 20000);

  // ── A6 · the trust line on the band's foot ─────────────────────────────────────────────────────────────────────────
  it("A6: on a phone home the trust line is the band's foot, and the page foot does not repeat it", async () => {
    await boot(lang);
    serve({ "/coachip/home": F.home, [`POST /coachip/notes/${NOTE_ID}/status`]: { note: F.home.note } });
    await renderAt("");
    const foot = within(screen.getByTestId("insights-band")).getByTestId("band-foot");
    expect(foot.textContent).toBe(COPY["trust.coach"][lang]);
    // the laptop's rail says it (InsightsNav), so the page foot does not repeat it at either width
    expect(screen.queryByTestId("trust-line")).toBeNull();
  }, 20000);

  it("A6: an inner page keeps its trust line at the foot on a phone (no band, no foot)", async () => {
    await boot(lang);
    serve({ [`/coachip/w/${W}`]: F[`w_${W}`], "/coachip/home": F.home });
    await renderAt(`/w/${W}`);
    expect(screen.queryByTestId("band-foot")).toBeNull();
    expect(screen.getByTestId("trust-line").closest(".hidden")).toBeNull();
  }, 20000);

  // ── A8 · one tint ──────────────────────────────────────────────────────────────────────────────────────────────────
  it("A8: one tint — no grey-fill token and no bg-cp-grey-fill on Schools", async () => {
    expect("grey-fill" in CP_COLOURS).toBe(false);
    await boot(lang);
    const d = clone(F.schools);
    d.schools[0].top_w = null;
    d.schools[0].graded = { ...d.schools[0].graded, n: 0 };
    serve({ "/coachip/schools": d });
    const { container } = await renderAt("/schools");
    expect(container.querySelector('[class*="grey-fill"]')).toBeNull();
    expect(screen.getAllByTestId("schools-top-none")[0].className).toContain("bg-cp-navy-tint");
  }, 20000);

  // ── A9 · nits ──────────────────────────────────────────────────────────────────────────────────────────────────────
  it("A9: a chapter label wraps at the space only (no mid-word break)", () => {
    const m = clone(F.moment) as Moment;
    const { container } = render(<ChapterStrip steps={m.steps} lang={lang} tappable momentAt={m.lesson_s} onStep={() => undefined} legend />);
    const labels = Array.from(container.querySelectorAll('[data-testid="chapter-bar"] + span'));
    expect(labels.length).toBeGreaterThan(0);
    labels.forEach((l) => {
      expect(l.className).not.toContain("overflow-wrap:anywhere");
      expect(l.className).toContain("hyphens:none");
    });
  });

  it("A9: in English the trend toggle's chevron is the copy's own ›, not a second drawn one", async () => {
    await boot(lang);
    serve({ [`/coachip/w/${W}`]: F[`w_${W}`] });
    await renderAt(`/w/${W}/where`);
    const toggle = screen.getAllByTestId("trend-toggle")[0];
    expect(toggle.querySelectorAll("svg").length).toBe(lang === "en" ? 0 : 1);
  }, 20000);

  // ── A10 · S3 trend with nothing to show ────────────────────────────────────────────────────────────────────────────
  it("A10: a trend where the W never showed draws no dots, only the hint", async () => {
    await boot(lang);
    const d = clone(F[`w_${W}`]);
    const code = d.schools.flatMap((s: { codes: { strip: { shows: unknown }[] | null }[] }) => s.codes).find((c: { strip: unknown }) => c.strip);
    code.strip.forEach((h: { shows: unknown }) => { h.shows = false; });
    serve({ [`/coachip/w/${W}`]: d });
    await renderAt(`/w/${W}/where`);
    fireEvent.click(screen.getAllByTestId("trend-toggle")[0]);
    const trend = screen.getByTestId("trend");
    expect(trend.querySelectorAll('[data-testid="trend-dot"]').length).toBe(0);
    expect(within(trend).getByTestId("trend-hint").textContent).toBe(COPY["s3.trend.hint"][lang]);
  }, 20000);
});
