import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, expectContract, F, renderRm, rmWorld, serve, settle } from "./harness";
import { RM_COPY } from "../rm.copy";
import { range } from "../../coach/insights/format";

/**
 * bd-sex15q.47 (R6 fix cycle 1, design/r6/FIX_R6.md §3, PR B) — red-first for B1–B7. jsdom has no layout, so "visible"
 * is the text outside `.sr-only` and the look is the classes and attributes the browser paints from; the CLS, the fold
 * and the colours are design-qa's on real screenshots.
 *
 *   B1  S8 states each window once: the visit window in the floor pill, the fidelity window once as the weaknesses'
 *       hint, the circle row its own week only, the coaches' hint none; Coaches and RM Stats one line per window.
 *       Every `data-win` still resolves (the contract golden).
 *   B2  no `cp-grey-fill` on any RM page or the picker (the one tint is `cp-navy-tint`)
 *   B3  the initials circles are 13/600
 *   B4  the S8 floor ring is a strength count, the weakness rows' rings and bars notice counts
 *   B5  S8's trust line is the band's foot on a phone; the page-foot copy is laptop-only there
 *   B6  Urdu per-school row: the school on its own line, the count under it
 *   B7  S9 Urdu: the Latin coach label is one `bdi` LTR run
 */
type Lang = "en" | "ur";
const C03 = "00000000-0000-4000-8000-070000000003";
const cls = (el: Element | null) => (el?.getAttribute("class") || "").split(/\s+/);
const win = (id: string) => (F.rm_home.windows as { id: string; from: string; to: string }[]).find((w) => w.id === id)!;
const FID = "w4-2026-09-28", VISIT = "act-4w-2026-10-26", MONTH = "act-m-2026-10", WEEK = "week-2026-10-19";

/** The text a sighted reader sees: everything outside `.sr-only`. */
function visible(root: Element): string {
  const c = root.cloneNode(true) as Element;
  c.querySelectorAll(".sr-only").forEach((e) => e.remove());
  return c.textContent || "";
}
const times = (hay: string, needle: string) => hay.split(needle).length - 1;
const rangeOf = (id: string, lang: Lang) => range(win(id).from, win(id).to, lang);

describe.each(["en", "ur"] as Lang[])("R6 fix cycle 1, RM deck (%s)", (lang) => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
    await boot(lang);
    serve(rmWorld());
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

  it("B1 S8: the fidelity window once (the weaknesses' hint), the visit window once (the floor pill), the circle its own week", async () => {
    await renderRm("");
    const page = screen.getByTestId("rm-home");
    const text = visible(page);
    expect(times(text, rangeOf(FID, lang))).toBe(1);
    expect(times(text, rangeOf(VISIT, lang))).toBe(1);
    expect(times(text, rangeOf(MONTH, lang))).toBe(0);
    expect(times(text, rangeOf(WEEK, lang))).toBe(1);
    expect(times(text, F.rm_home.windows[0].grader_label[lang])).toBe(1);
    // where each one is said
    expect(visible(within(page).getByTestId("rm-floor"))).toContain(rangeOf(VISIT, lang));
    expect(visible(within(page).getByTestId("rm-moves-window"))).toContain(rangeOf(FID, lang));
    const circle = visible(within(page).getByTestId("rm-circle-card"));
    expect(circle).toContain(rangeOf(WEEK, lang));
    expect(circle).not.toContain(rangeOf(VISIT, lang));
    const hint = visible(within(page).getByTestId("coach-groups").querySelector("p.mt-1")!);
    expect(hint).toContain(RM_COPY["s8.needs.sub"][lang]);
    for (const id of [FID, VISIT, MONTH]) expect(hint).not.toContain(rangeOf(id, lang));
    for (const row of within(page).getAllByTestId("sector-wrow")) expect(visible(row)).not.toContain(rangeOf(FID, lang));
    expectContract(page, expect);
  });

  it("B1 Coaches: each distinct window stated once", async () => {
    await renderRm("/coaches");
    const text = visible(screen.getByTestId("rm-coaches"));
    expect(times(text, rangeOf(VISIT, lang))).toBe(1);
    expect(times(text, rangeOf(MONTH, lang))).toBe(1);
    expectContract(screen.getByTestId("rm-coaches"), expect);
  });

  it("B1 RM Stats: one line per distinct window (the rows do not repeat the card's)", async () => {
    await renderRm("/stats");
    const page = screen.getByTestId("rm-stats");
    expect(times(visible(page), rangeOf(FID, lang))).toBe(1);
    for (const row of within(page).getAllByTestId("rm-stats-row")) expect(visible(row)).not.toContain(rangeOf(FID, lang));
    expect(times(visible(page), F.rm_home.windows[0].grader_label[lang])).toBe(1);
    expectContract(page, expect);
  });

  it.each([["", "rm-home"], ["/coaches", "rm-coaches"], ["/circle", "rm-circle"], ["/stats", "rm-stats"], [`/coach/${C03}`, "rm-coach"]])(
    "B2 %s: one tint, no cp-grey-fill", async (sub, id) => {
      await renderRm(sub);
      expect(screen.getByTestId(id).innerHTML).not.toContain("grey-fill");
    });

  it("B2 S9: the open note's status pill and the picker's preview are navy tint", async () => {
    await renderRm(`/coach/${C03}`);
    const note = screen.getAllByTestId("s9-note")[0];
    expect(note.innerHTML).toContain("bg-cp-navy-tint");
    await act(async () => { fireEvent.click(screen.getByTestId("s9-follow-up")); });
    await settle();
    const sheet = screen.getByTestId("follow-up-picker");
    expect(sheet.innerHTML).not.toContain("grey-fill");
    expect(sheet.innerHTML).toContain("bg-cp-navy-tint");
  });

  it("B3: the initials circles are 13/600 (on the type scale)", async () => {
    await renderRm("");
    for (const r of screen.getAllByTestId("coach-row")) {
      const circle = r.querySelector('[data-testid="coach-initials"]');
      expect(cls(circle)).toEqual(expect.arrayContaining(["text-[13px]", "font-semibold"]));
      expect(cls(circle)).not.toContain("text-[14px]");
    }
  });

  it("B4: the floor ring is a strength count; the weakness rows' rings and bars are notice counts", async () => {
    await renderRm("");
    const hero = screen.getByTestId("rm-opening").querySelector('[data-ring="hero"]')!;
    expect(hero.closest("[data-tone]")?.getAttribute("data-tone")).toBe("strength");
    for (const row of screen.getAllByTestId("sector-wrow")) {
      for (const ring of Array.from(row.querySelectorAll("[data-ring]"))) expect(ring.closest("[data-tone]")?.getAttribute("data-tone")).toBe("notice");
      for (const bar of Array.from(row.querySelectorAll("[data-bar]"))) expect(bar.closest("[data-tone]")?.getAttribute("data-tone")).toBe("notice");
    }
  });

  it("B5: S8's trust line is the band's foot on a phone; the page foot is laptop-only on S8", async () => {
    await renderRm("");
    const foot = within(screen.getByTestId("rm-band")).getByTestId("rm-band-foot");
    expect(foot.textContent).toBe(RM_COPY["s8.trust"][lang]);
    expect(cls(foot)).toContain("lg:hidden");
    expect(cls(screen.getByTestId("rm-trust"))).toEqual(expect.arrayContaining(["hidden", "lg:block"]));
  });

  it("B5: other RM pages keep the page-foot trust line at every width", async () => {
    await renderRm("/coaches");
    expect(cls(screen.getByTestId("rm-trust"))).not.toContain("hidden");
    expect(screen.queryByTestId("rm-band-foot")).toBeNull();
  });

  it("B6: the per-school row: EN one line; UR the school on its own line and the count under it", async () => {
    await renderRm("");
    for (const row of screen.getAllByTestId("by-school-row")) {
      const line = row.firstElementChild!;
      if (lang === "en") {
        expect(line.querySelector("[data-code]")).not.toBeNull();
        expect(line.textContent).toContain(" · ");
      } else {
        const [name, count] = Array.from(line.children);
        expect(cls(name)).toContain("block");
        expect(name.querySelector("[data-code]") ?? (name.hasAttribute("data-code") ? name : null)).not.toBeNull();
        expect(name.querySelector("[data-num]")).toBeNull();
        expect(cls(count)).toContain("block");
        expect(count.querySelector("[data-num]")).not.toBeNull();
        expect(count.querySelector("[data-code]")).toBeNull();
      }
    }
  });

  it("B7: S9's title is the coach label as one bdi run (LTR in Urdu)", async () => {
    await renderRm(`/coach/${C03}`);
    const h1 = screen.getByTestId("rm-band").querySelector("h1")!;
    const bdi = h1.querySelector("bdi")!;
    expect(bdi).not.toBeNull();
    expect(bdi.textContent).toBe(F.rm_coach.coach.coach_label);
    if (lang === "ur") expect(bdi.getAttribute("dir")).toBe("ltr");
    expect(cls(bdi)).toContain("[overflow-wrap:normal]");
  });
});
