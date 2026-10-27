import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, expectContract, F, renderRm, rmWorld, serve } from "./harness";
import { RM_COPY } from "../rm.copy";

/**
 * fix-r5 s3 (qa-rm 171001, the two rows left after #3808), each red on the reporter's reproduction:
 * B10: S8's circle card printed "… · 0 of 0 checks due this week" (UR "۰ میں سے ۰ جانچیں") when no check is due.
 * B5: S9 for a coach with no moves (Fixture Coach 02) drew "n of n recordings graded" with `data-win` and no element
 * carrying that window, because the only legend for it was inside the moves block.
 */
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const C03 = "00000000-0000-4000-8000-070000000003";
const ZERO_OF_ZERO = /\b0 of 0\b|۰ میں سے ۰/;
const strip = (s: string | null | undefined) => (s || "").replace(/[⁦-⁩]/g, "");

describe.each(["en", "ur"] as const)("qa-rm 171001 rows (%s)", (lang) => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
    await boot(lang);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

  it("B10: S8 circle card with checks_due d = 0 says 'no checks due', never '0 of 0'", async () => {
    const h = clone(F.rm_home);
    h.circle.checks_due = { n: 0, d: 0, window_id: h.circle.checks_due.window_id };
    serve(rmWorld({ "/coachip/rm/home": h }));
    await renderRm("");
    const card = screen.getByTestId("rm-circle-card");
    expect(ZERO_OF_ZERO.test(card.textContent || "")).toBe(false);
    expect(card.querySelector('[data-num][data-den="0"]')).toBeNull();
    const tail = RM_COPY["s8.circle.sub.no_checks"][lang].split(lang === "ur" ? "، " : " · ")[1];
    expect(strip(card.textContent)).toContain(tail);
    expect(card.querySelector(`[data-num="${h.circle.moments.n}"][data-den="${h.circle.moments.d}"]`)).toBeTruthy();
    expectContract(screen.getByTestId("rm-home"), expect);
  });

  it("B10: S8 circle card with checks due: unchanged ({n} of {d})", async () => {
    serve(rmWorld());
    await renderRm("");
    const card = screen.getByTestId("rm-circle-card");
    const c = F.rm_home.circle.checks_due;
    expect(card.querySelector(`[data-num="${c.n}"][data-den="${c.d}"]`)).toBeTruthy();
  });

  it("B5: S9 for a coach with no moves: every data-win on the page resolves to a drawn window", async () => {
    const c = clone(F.rm_coach);
    c.moves = [];
    serve(rmWorld({ [`/coachip/rm/coach/${C03}`]: c }));
    await renderRm(`/coach/${C03}`);
    const page = screen.getByTestId("rm-coach");
    expect(screen.queryByTestId("s9-moves")).toBeNull();
    const wins = [...page.querySelectorAll("[data-win]")].map((e) => e.getAttribute("data-win")!);
    expect(wins.length).toBeGreaterThan(0);
    const unresolved = [...new Set(wins)].filter((id) => !page.querySelector(`[data-window="${id}"]`));
    expect(unresolved).toEqual([]);
    const schools = screen.getByTestId("s9-schools");
    for (const id of new Set([...schools.querySelectorAll("[data-win]")].map((e) => e.getAttribute("data-win")!))) {
      expect(schools.querySelector(`[data-window="${id}"]`)).toBeTruthy();
    }
    expectContract(page, expect);
  });
});
