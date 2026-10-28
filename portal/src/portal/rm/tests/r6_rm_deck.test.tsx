import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, expectContract, expectNoTeacher, F, renderRm, rmWorld, serve, settle } from "./harness";
import { RM_COPY } from "../rm.copy";
import { openingParts } from "../components/OpeningCard";

/**
 * bd-sex15q.47 (R6 ux-rm) — the RM deck on the design system (design/r6/SCREENS.md "RM deck", DIRECTION.md delta 6,
 * DESIGN_SYSTEM §5–§7), red-first. jsdom has no layout, so the look is asserted as the classes and attributes the
 * browser lays out from; the fold, the colours and the fidelity are design-qa's on real screenshots.
 *
 *   S8   the band carries the opening as the hero ring (visited schools, n of d) and the floor as a green pill; the
 *        month's weaknesses are the ONE raised surface, riding up over the band; the coach groups are hairline sections
 *        ("Needs me this week" in green-ink, "On track" in grey); Follow-up is the 44 px secondary; the Monday compose
 *        is the one primary
 *   all  a coach row never carries a ring or a bar (DESIGN_SYSTEM §6); no hard-coded hex in any class on an RM page
 *        (design-qa look.1: tokens only), so no red either
 *   S9   Follow-up is the primary; the picker is a bottom sheet with green-selected chips
 *   S10  each moment has a 44 px green play circle; the blocks are hairline sections
 */
type Lang = "en" | "ur";
const C03 = "00000000-0000-4000-8000-070000000003";
const cls = (el: Element | null) => (el?.getAttribute("class") || "").split(/\s+/);
const hexClasses = (root: Element) =>
  [root, ...Array.from(root.querySelectorAll("[class]"))]
    .flatMap((e) => cls(e))
    .filter((c) => /#[0-9a-fA-F]{3,8}\b/.test(c));

describe.each(["en", "ur"] as Lang[])("R6 RM deck (%s)", (lang) => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
    await boot(lang);
    serve(rmWorld());
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

  it("S8: the band carries the opening as a hero ring of visited schools and the floor as a green pill", async () => {
    await renderRm("");
    const band = screen.getByTestId("rm-band");
    const opening = within(band).getByTestId("rm-opening");
    const ring = opening.querySelector('[data-ring="hero"]');
    expect(ring).not.toBeNull();
    const o = F.rm_home.opening.visited;
    const node = within(opening).getByTestId("rm-opening-sentence").querySelector("[data-num]") as HTMLElement;
    expect(`${node.getAttribute("data-num")}/${node.getAttribute("data-den")}`).toBe(`${o.n}/${o.d}`);
    expect(node.contains(ring)).toBe(true);
    const floor = within(band).getByTestId("rm-floor");
    expect(cls(floor)).toEqual(expect.arrayContaining(["rounded-full", "bg-cp-green"]));
    expect(floor.textContent).toContain(RM_COPY["s8.floor"][lang]);
    expectContract(screen.getByTestId("rm-home"), expect);
  });

  it("S8: the month's weaknesses are the one raised surface, overlapping the band", async () => {
    await renderRm("");
    const moves = screen.getByTestId("rm-moves");
    expect(moves.hasAttribute("data-surface")).toBe(true);
    expect(cls(moves)).toContain("cp-overlap");
    const page = screen.getByTestId("rm-home");
    expect(page.querySelectorAll("[data-surface]")).toHaveLength(1);
  });

  it("S8: the coach groups are labelled sections, 'Needs me this week' in green-ink and 'On track' in grey", async () => {
    await renderRm("");
    const needs = within(screen.getByTestId("group-needs_me")).getByText(RM_COPY["s8.group.needs_me"][lang]);
    expect(cls(needs)).toContain("text-cp-green-ink");
    const ok = within(screen.getByTestId("group-on_track")).getByText(RM_COPY["s8.group.on_track"][lang]);
    expect(cls(ok)).toContain("text-cp-ink-3");
  });

  it("S8: Follow-up is the 44 px navy-outline secondary; the Monday compose is the one 52 px green primary", async () => {
    await renderRm("");
    for (const b of screen.getAllByTestId("follow-up")) {
      expect(cls(b)).toEqual(expect.arrayContaining(["min-h-[44px]", "border-cp-navy"]));
    }
    const monday = screen.getByTestId("rm-monday");
    expect(cls(monday)).toEqual(expect.arrayContaining(["min-h-[52px]", "bg-cp-green", "text-cp-navy"]));
    expect(screen.getByTestId("rm-home").querySelectorAll(".bg-cp-green.min-h-\\[52px\\]")).toHaveLength(1);
  });

  it.each(["", "/coaches"])("%s: a coach row carries no ring and no bar, and no colour of its own", async (sub) => {
    await renderRm(sub);
    const rows = screen.getAllByTestId("coach-row");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.querySelector("[data-ring]")).toBeNull();
      expect(r.querySelector("[data-bar]")).toBeNull();
      expect(r.querySelector("svg circle")).toBeNull();
    }
  });

  it.each([["", "rm-home"], ["/coaches", "rm-coaches"], ["/circle", "rm-circle"], ["/stats", "rm-stats"], [`/coach/${C03}`, "rm-coach"]])(
    "%s: no hard-coded hex in any class (tokens only, so no red either)", async (sub, id) => {
      await renderRm(sub);
      expect(hexClasses(screen.getByTestId(id))).toEqual([]);
      expectNoTeacher(screen.getByTestId(id), expect);
    });

  it("S9: Follow-up is the primary; the picker is a bottom sheet, chips selected in green, no hex", async () => {
    await renderRm(`/coach/${C03}`);
    const fu = screen.getByTestId("s9-follow-up");
    expect(cls(fu)).toEqual(expect.arrayContaining(["min-h-[52px]", "bg-cp-green"]));
    await act(async () => { fireEvent.click(fu); });
    await settle();
    const sheet = screen.getByTestId("follow-up-picker");
    expect(cls(sheet)).toContain("cp-sheet");
    const chosen = (screen.getAllByTestId(/^picker-template-/) as HTMLInputElement[]).find((i) => i.checked)!;
    expect(cls(chosen.closest("label"))).toContain("bg-cp-green");
    expect(hexClasses(sheet)).toEqual([]);
  });

  it("S10: each moment has a 44 px green play circle; the moments are a hairline section", async () => {
    await renderRm("/circle");
    expect(screen.getByTestId("s10-moments").hasAttribute("data-section")).toBe(true);
    for (const row of screen.getAllByTestId("circle-row")) {
      const play = within(row).getByTestId("circle-play");
      expect(cls(play)).toContain("min-h-[44px]");
      const disc = play.querySelector(".bg-cp-green");
      expect(disc).not.toBeNull();
      expect(cls(disc)).toEqual(expect.arrayContaining(["h-11", "w-11"]));
    }
  });

  it("ux-lead-2 164236: a dual gets 'This week' as the phone bar's first item (lucide Home); an RM-only user keeps four", async () => {
    serve(rmWorld({ "/coachip/me": { ...F.me_rm, coach: { schoolCount: 6, teacherCount: 41 } } }));
    await renderRm("");
    const bar = screen.getByTestId("rm-nav");
    const first = bar.querySelector("a") as HTMLElement;
    expect(first.getAttribute("data-nav")).toBe("this_week");
    expect(bar.querySelectorAll("a")).toHaveLength(5);
    expect(first.querySelector("svg.lucide-house, svg.lucide-home")).not.toBeNull();
    cleanup();
    serve(rmWorld());
    await renderRm("");
    const only = screen.getByTestId("rm-nav");
    expect(only.querySelector('[data-nav="this_week"]')).toBeNull();
    expect(only.querySelectorAll("a")).toHaveLength(4);
  });

  it("S8: the two pieces of s8.opening rebuild the COPY string (only the ring's n of d is taken out)", () => {
    const { lead, rest } = openingParts(lang);
    const whole = RM_COPY["s8.opening"][lang].replace(lang === "ur" ? "{d} میں سے {n}" : "{n} of {d}", "").replace(/\s+/g, " ").trim();
    expect(`${lead} ${rest}`).toBe(whole);
    expect(rest.length).toBeGreaterThan(0);
  });

  it("ux-lead-2 183234 #1: the agenda row keeps data-agenda but carries no green rail (no rails, DIRECTION delta 2)", async () => {
    await renderRm("");
    const agenda = screen.getAllByTestId("sector-wrow").find((r) => r.getAttribute("data-agenda") === "1")!;
    expect(agenda).toBeTruthy();
    expect(cls(agenda).filter((c) => /^border-s/.test(c))).toEqual([]);
  });

  it("ux-lead-2 183234 #2: a per-school row stacks: the sentence full width, then the bar full width", async () => {
    await renderRm("");
    for (const row of screen.getAllByTestId("by-school-row")) {
      expect(cls(row)).toEqual(expect.arrayContaining(["flex", "flex-col"]));
      expect(cls(row).some((c) => c.startsWith("grid-cols"))).toBe(false);
      const bar = row.querySelector("[data-bar]");
      expect(cls(bar)).toContain("w-full");
    }
  });

  it("ux-lead-2 183234 #3: the two coverage notes sit under the weaknesses card, not in the band", async () => {
    await renderRm("");
    const band = screen.getByTestId("rm-band");
    const cov = screen.getByTestId("rm-coverage");
    expect(band.contains(cov)).toBe(false);
    const nums = Array.from(cov.querySelectorAll("[data-num]")).map((e) => `${e.getAttribute("data-num")}/${e.getAttribute("data-den")}`);
    expect(nums).toEqual(["2/62", "1/10"]);
    const moves = screen.getByTestId("rm-moves");
    expect(moves.compareDocumentPosition(cov) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
