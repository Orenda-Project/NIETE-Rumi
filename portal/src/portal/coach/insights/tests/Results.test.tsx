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
 * bd-sex15q.15 — S7, Results (`/stats/results`, R15): one card per school-grade cell, counts only at 5 tested, the
 * sound/story send with no recipient, the debrief line verbatim, and the two empty states.
 */
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

for (const lang of ["en", "ur"] as const) {
  describe(`S7 Results (${lang})`, () => {
    beforeEach(async () => { await boot(lang); });
    afterEach(() => cleanup());

    it("normal: a full cell with counts, a filling cell without", async () => {
      serve({ "/coachip/results": F.results });
      const { container } = await renderAt("/stats/results");
      const cells = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="s7-cell"]'));
      expect(cells).toHaveLength(2);
      const [full, filling] = cells;
      // full cell: rows counted, the sound send, the debrief line
      expect(full.querySelector('[data-testid="s7-rows"] [data-num="7"]')?.getAttribute("data-den")).toBe("12");
      expect(full.textContent).toContain(COPY["s7.not_measured"][lang]);
      const send = full.querySelector('[data-testid="s7-send"]') as HTMLAnchorElement;
      expect(send.getAttribute("href")).toBe("/portal/fln/send");
      expect(send.textContent).toContain(lang === "en" ? "sound plans" : "آوازوں");
      expect(full.querySelector('[data-text="library"]')?.textContent).toBe(F.results.cells[0].debrief_line[lang]);
      const tested = full.querySelector('[data-testid="s7-tested"] [data-num]') as HTMLElement;
      expect(tested.getAttribute("data-num")).toBe("12");
      expect(tested.getAttribute("data-den")).toBe("5");
      // filling cell: "n tested of 5 needed", no row counts, no send
      const fill = filling.querySelector('[data-testid="s7-tested"] [data-num]') as HTMLElement;
      expect(fill.textContent).toContain(lang === "en" ? "tested of 5 needed" : "درکار");
      expect(fill.getAttribute("data-num")).toBe("3");
      expect(filling.querySelectorAll("[data-num]")).toHaveLength(1);
      expect(filling.querySelector('[data-testid="s7-send"]')).toBeNull();
      expect(container.innerHTML).not.toContain("%");
      expectContract(container, expect);
      expectNoIdentity(container, expect);
      expect(container.innerHTML).toMatchSnapshot();
    }, 20000);

    it("send off: the RM line, no link", async () => {
      const d = clone(F.results);
      d.cells[0].fln.can_send = false;
      serve({ "/coachip/results": d });
      const { container } = await renderAt("/stats/results");
      const full = container.querySelector('[data-testid="s7-cell"]') as HTMLElement;
      expect(full.querySelector('[data-testid="s7-send"]')).toBeNull();
      expect(full.querySelector('[data-testid="s7-send-off"]')?.textContent).toBe(COPY["s5.fln.off"][lang]);
    }, 20000);

    it("story rows get the story send", async () => {
      const d = clone(F.results);
      d.cells[0].rows = [{ ...d.cells[0].rows[0], w_id: "W-RC" }];
      serve({ "/coachip/results": d });
      const { container } = await renderAt("/stats/results");
      const send = container.querySelector('[data-testid="s7-send"]') as HTMLElement;
      expect(send.textContent).toContain(lang === "en" ? "story plans" : "کہانیوں");
    }, 20000);

    it("empty, none: the plain line", async () => {
      const d = clone(F.results);
      d.cells = [];
      d.empty = { status: "no_scope", message: { en: "x", ur: "x" }, detail: { graded: null, widened_to_weeks: null, as_of: null } };
      serve({ "/coachip/results": d });
      const { container } = await renderAt("/stats/results");
      expect(screen.getByTestId("s7-empty").textContent).toBe(COPY["s7.empty.none"][lang]);
      expect(domContract(container).bareDigits).toEqual([]);
      expect(container.innerHTML).toMatchSnapshot();
    }, 20000);

    it("empty, before the first visit: the start date", async () => {
      const d = clone(F.results);
      d.cells = [];
      d.empty = { status: "pending", message: { en: "x", ur: "x" }, detail: { graded: null, widened_to_weeks: null, as_of: "2026-10-27" } };
      serve({ "/coachip/results": d });
      const { container } = await renderAt("/stats/results");
      expect(screen.getByTestId("s7-empty").querySelector('[data-date="2026-10-27"]')).toBeTruthy();
      expect(domContract(container).bareDigits).toEqual([]);
      expect(container.innerHTML).toMatchSnapshot();
    }, 20000);

    it("a load failure shows the failed state", async () => {
      serve({ "/coachip/results": () => { throw httpError(500, { error: "x" }); } });
      const { container } = await renderAt("/stats/results");
      expect(screen.getByTestId("insights-state").getAttribute("data-state")).toBe("failed");
      expect(domContract(container).bareDigits).toEqual([]);
    }, 20000);

    it("flag off: the coach is sent elsewhere", async () => {
      await boot(lang, { coachV2: true, coachip: false });
      serve({ "/coachip/results": F.results });
      await renderAt("/stats/results");
      expect(screen.getByTestId("elsewhere")).toBeTruthy();
    }, 20000);
  });
}
