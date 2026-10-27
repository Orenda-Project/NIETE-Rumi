import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("../../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, renderAt, serve, F, httpError, expectContract, expectNoIdentity } from "./harness";
import { COPY } from "../copy";
import { domContract } from "../count";

/**
 * bd-sex15q.15 — S6, Stats (`/stats`, R14): rows in the payload's order, the opening by `opening.state`, a pill only
 * when `change` is set, the FICO panel on its own window, the weekly sparkline, and the way to Results.
 */
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** A two-windows copy of the marker fixture: every ok row has a `before` and a `change`. */
function twoWindows() {
  const d = clone(F.stats_marker);
  d.opening.state = "two_windows";
  const changes = ["fewer", "more", "same", "fewer", "same"];
  d.rows.forEach((r: { status: string; before: unknown; change: unknown; now: { n: number; d: number } }, i: number) => {
    if (r.status !== "ok") return;
    r.before = { n: r.now.n + 2, d: r.now.d + 1, window_id: "w4-2026-08-31" };
    r.change = changes[i];
  });
  return d;
}

const pills = (lang: "en" | "ur") => [COPY["s6.pill.fewer"][lang], COPY["s6.pill.more"][lang], COPY["s6.pill.same"][lang]];

for (const lang of ["en", "ur"] as const) {
  describe(`S6 Stats (${lang})`, () => {
    beforeEach(async () => { await boot(lang); });
    afterEach(() => cleanup());

    it("first window: the opening line, rows in payload order, no pill", async () => {
      serve({ "/coachip/stats": F.stats });
      const { container } = await renderAt("/stats");
      const page = screen.getByTestId("insights-stats");
      expect(screen.getByTestId("s6-opening").querySelector('[data-date="2026-11-22"]')).toBeTruthy();
      const rows = Array.from(page.querySelectorAll('[data-testid="s6-row"]')).map((e) => e.getAttribute("data-w"));
      expect(rows).toEqual(F.stats.rows.map((r: { w_id: string }) => r.w_id));
      expect(page.querySelectorAll('[data-testid="s6-pill"]')).toHaveLength(0);
      for (const p of pills(lang)) expect(page.textContent).not.toContain(p);
      expect(screen.queryByTestId("s6-marker")).toBeNull();
      // insufficient row: the sentence, not a bare count
      const warm = page.querySelector('[data-w="W-WARM"]') as HTMLElement;
      expect(warm.getAttribute("data-status")).toBe("insufficient");
      // graded = the row's in-denominator lessons (now.d) against the floor of 20, one count node
      const floor = warm.querySelector('[data-den="20"]') as HTMLElement;
      expect(floor.getAttribute("data-num")).toBe(String(F.stats.rows.find((r: { w_id: string }) => r.w_id === "W-WARM").now.d));
      // fico window marked once, sparkline drawn, link to results
      expect(page.querySelectorAll('[data-window="fico17-w4-2026-09-28"]')).toHaveLength(1);
      expect(screen.getByTestId("s6-sparkline").getAttribute("aria-hidden")).toBe("true");
      expect(screen.getByTestId("s6-results-link").getAttribute("href")).toBe("/portal/coach/insights/stats/results");
      expect(container.innerHTML).not.toContain("%");
      expectContract(container, expect);
      expectNoIdentity(container, expect);
      expect(container.innerHTML).toMatchSnapshot();
    }, 20000);

    // fix-r5 s2 item 15 (design-qa 073628 §3-4, qa-coach 073257 (2)): a W with no sentence (or a sentence that is its
    // short name) is one line, never "Practice cut short / Practice cut short"; the count is one atom (nowrap) in a column
    // wide enough for "۴۶ میں سے ۲۸" at 15 px.
    it("item 15: no repeated short name; the count atom never splits", async () => {
      const d = clone(F.stats);
      const ok = d.rows.filter((r: { status: string }) => r.status === "ok");
      ok[0].sentence = clone(ok[0].short_name);
      ok[1].sentence = { en: "", ur: "" };
      serve({ "/coachip/stats": d });
      const { container } = await renderAt("/stats");
      const row0 = container.querySelector(`[data-w="${ok[0].w_id}"]`) as HTMLElement;
      const row1 = container.querySelector(`[data-w="${ok[1].w_id}"]`) as HTMLElement;
      const row2 = container.querySelector(`[data-w="${ok[2].w_id}"]`) as HTMLElement;
      expect(row0.querySelector('[data-testid="s6-sentence"]')).toBeNull();
      expect(row0.textContent!.split(ok[0].short_name[lang]).length - 1).toBe(1);
      expect(row1.querySelector('[data-testid="s6-sentence"]')).toBeNull();
      expect(row2.querySelector('[data-testid="s6-sentence"]')?.textContent).toBe(ok[2].sentence[lang]);
      for (const n of Array.from(container.querySelectorAll('[data-testid="s6-row"] [data-num]'))) {
        if (n.closest('[data-status="insufficient"]')) continue;
        expect(n.className).toContain("whitespace-nowrap");
        expect(n.className).toContain("w-[96px]");
      }
      expectContract(container, expect);
    }, 20000);

    it("marker: the full-width marker row, no pill anywhere", async () => {
      serve({ "/coachip/stats": F.stats_marker });
      const { container } = await renderAt("/stats");
      const marker = screen.getByTestId("s6-marker");
      expect(marker.querySelector('[data-date="2026-09-28"]')).toBeTruthy();
      expect(screen.queryByTestId("s6-opening")).toBeNull();
      expect(container.querySelectorAll('[data-testid="s6-pill"]')).toHaveLength(0);
      for (const p of pills(lang)) expect(container.textContent).not.toContain(p);
      expectContract(container, expect);
      expect(container.innerHTML).toMatchSnapshot();
    }, 20000);

    it("two windows: both counts per row and the pill", async () => {
      const d = twoWindows();
      serve({ "/coachip/stats": d });
      const { container } = await renderAt("/stats");
      expect(screen.getByTestId("s6-col-before").textContent).toContain(COPY["s6.col.before"][lang]);
      expect(screen.queryByTestId("s6-marker")).toBeNull();
      const pillsShown = Array.from(container.querySelectorAll('[data-testid="s6-pill"]')).map((e) => e.textContent);
      expect(pillsShown).toEqual([COPY["s6.pill.fewer"][lang], COPY["s6.pill.more"][lang], COPY["s6.pill.same"][lang], COPY["s6.pill.fewer"][lang], COPY["s6.pill.same"][lang]]);
      expect(container.querySelectorAll('[data-win="w4-2026-08-31"]').length).toBe(5);
      expectContract(container, expect);
      expect(container.innerHTML).toMatchSnapshot();
    }, 20000);

    it("a load failure shows the failed state", async () => {
      serve({ "/coachip/stats": () => { throw httpError(500, { error: "x" }); } });
      const { container } = await renderAt("/stats");
      expect(screen.getByTestId("insights-state").getAttribute("data-state")).toBe("failed");
      expect(domContract(container).bareDigits).toEqual([]);
    }, 20000);

    it("flag off: the coach is sent elsewhere", async () => {
      await boot(lang, { coachV2: true, coachip: false });
      serve({ "/coachip/stats": F.stats });
      await renderAt("/stats");
      expect(screen.getByTestId("elsewhere")).toBeTruthy();
    }, 20000);
  });
}
