import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, expectContract, F, renderRm, rmWorld, serve, settle } from "./harness";
import { RM_COPY } from "../rm.copy";

/**
 * fix-r5 s2 items 18 + 17 (RM half) + 15 (RM half): design-qa 20261027T073629 / 073628 §5 / §S8 d1 phone.
 * jsdom has no layout, so the layout asks are asserted as the classes and attributes the browser lays out from.
 */
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const C03 = "00000000-0000-4000-8000-070000000003";
const cls = (el: Element | null) => (el?.getAttribute("class") || "").split(/\s+/);

describe.each(["en", "ur"] as const)("RM layout fixes (%s)", (lang) => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
    await boot(lang);
    serve(rmWorld());
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

  it("item 18: S8 coach rows stack (label, lines, button) under 640 px and sit in a row from sm", async () => {
    await renderRm("");
    const row = screen.getAllByTestId("coach-row")[0];
    expect(cls(row)).toEqual(expect.arrayContaining(["flex-col", "sm:flex-row"]));
    const link = row.querySelector("a") as HTMLElement;
    expect(cls(link)).toEqual(expect.arrayContaining(["flex-col", "sm:flex-row"]));
    expect(cls(within(row).getByTestId("follow-up"))).toContain("self-start");
  });

  it("item 17: the picker's other-language lines are bidi plaintext, aligned to their own start", async () => {
    await renderRm("");
    await act(async () => { fireEvent.click(screen.getAllByTestId("follow-up")[0]); });
    await settle();
    const other = screen.getByTestId(`picker-preview-${lang === "en" ? "ur" : "en"}`);
    const items = Array.from(other.querySelectorAll("li"));
    expect(items.length).toBeGreaterThan(0);
    for (const li of items) {
      expect(cls(li)).toEqual(expect.arrayContaining(["[unicode-bidi:plaintext]", "text-start"]));
    }
  });

  it("item 17: S10 row's coach and school are ONE isolated LTR run in Urdu (the comma between them sits right)", async () => {
    await renderRm("/circle");
    const line = within(screen.getAllByTestId("circle-row")[0]).getByTestId("circle-line");
    const pair = line.querySelector("[data-testid='circle-pair']") as HTMLElement | null;
    if (lang === "ur") {
      expect(pair).toBeTruthy();
      expect(pair!.getAttribute("dir")).toBe("ltr");
      expect(pair!.textContent!.startsWith("⁦") && pair!.textContent!.endsWith("⁩")).toBe(true);
      const m = F.rm_circle.moments[0];
      expect(pair!.textContent!.replace(/[⁦-⁩]/g, "")).toBe(`${m.coach_label}، ${m.school.school_name}`);
    } else {
      expect(pair).toBeNull();
    }
  });

  // item 11 later removed the date row and its Save (the step is set today in one tap): the one control is >= 44 px
  it("item 17: S10 'Set this sector step' is at least 44 px", async () => {
    await renderRm("/circle");
    const move = screen.getAllByTestId("sector-move")[0];
    expect(cls(within(move).getByTestId("sector-move-set"))).toContain("min-h-[44px]");
  });

  it("item 17: RM Stats with no scoring_changed_on has no card holding only the window; the window folds into the band sub", async () => {
    const h = clone(F.rm_home); h.window.scoring_changed_on = null;
    serve(rmWorld({ "/coachip/rm/home": h }));
    await renderRm("/stats");
    expect(screen.queryByTestId("rm-stats-window")).toBeNull();
    const sub = screen.getByTestId("rm-page-sub");
    expect(sub.querySelector(`[data-window="${h.window.id}"]`)).toBeTruthy();
    expect(sub.textContent).toContain(RM_COPY["stats.sub"][lang]);
    expectContract(screen.getByTestId("rm-stats"), expect);
  });

  it("item 17: RM Stats with a marker keeps the window card and the marker", async () => {
    await renderRm("/stats");
    expect(screen.getByTestId("rm-stats-window")).toBeTruthy();
    expect(screen.getByTestId("rm-stats-marker")).toBeTruthy();
  });

  it("items 15 + 17: S9 with every school unvisited says it ONCE above the rows, and its 4 is data-nonum (no bare digit)", async () => {
    const c = clone(F.rm_coach);
    c.schools = c.schools.map((s: Record<string, unknown>) => ({ ...s, last_visit: null, weeks_since_visit: null, next_visit: null }));
    serve(rmWorld({ [`/coachip/rm/coach/${C03}`]: c }));
    await renderRm(`/coach/${C03}`);
    const card = screen.getByTestId("s9-schools");
    const never = RM_COPY["s9.schools.never"][lang];
    expect((card.textContent || "").split(never).length - 1).toBe(1);
    const note = within(card).getByTestId("s9-no-visits");
    expect(note.querySelector("[data-nonum]")?.textContent).toBe(never);
    expectContract(screen.getByTestId("rm-coach"), expect);
  });
});
