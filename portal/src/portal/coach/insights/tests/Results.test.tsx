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

    // fix-r5 s2 item 14 (design-qa 092007): the send's sentence is one inline run (the {g} node is not a flex item that
    // splits "Send the grade" / "2" / "…"), and the cell title says the language word ("English"), never "Eng".
    it("item 14: the send is one inline run; the title says English", async () => {
      const d = clone(F.results);
      d.cells[0].language = "en";
      serve({ "/coachip/results": d });
      const { container } = await renderAt("/stats/results");
      const full = container.querySelector<HTMLElement>('[data-testid="s7-cell"]')!;
      const send = full.querySelector('[data-testid="s7-send"]') as HTMLElement;
      // the flex link holds exactly one child, an element, so its words wrap as one sentence
      expect(send.childNodes).toHaveLength(1);
      expect(send.firstChild!.nodeType).toBe(Node.ELEMENT_NODE);
      expect(send.textContent!.replace(/[\u2066-\u2069]/g, "")).toBe(
        COPY["s7.send"][lang].replace("{g}", lang === "en" ? "2" : "۲").replace("{language}", COPY["s4.subject.english"][lang]),
      );
      const title = full.querySelector("h2")!.textContent || "";
      expect(title).toContain(COPY["s4.subject.english"][lang]);
      if (lang === "en") expect(title).not.toMatch(/\bEng\b/);
      expectContract(container, expect);
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

    // R6 (bd-sex15q.46, SCREENS S7): the window line is the app bar's; the cells are a grid of flat white tiles (radius 20,
    // hairline, no shadow); "not yet" is a grey pill; the before-first-visit note is navy tint; the send is secondary.
    it("R6: app bar window line, a grid of flat tiles, grey not-yet, secondary send", async () => {
      serve({ "/coachip/results": F.results });
      const { container } = await renderAt("/stats/results");
      const bar = screen.getByTestId("insights-appbar");
      expect(bar.querySelector(`[data-window="${F.results.window.id}"]`)).not.toBeNull();
      const grid = screen.getByTestId("s7-grid");
      expect(grid.className).toContain("grid");
      const cells = Array.from(grid.querySelectorAll<HTMLElement>('[data-testid="s7-cell"]'));
      expect(cells).toHaveLength(2);
      for (const c of cells) {
        expect(c.className).toContain("rounded-[20px]");
        expect(c.className).toContain("bg-cp-surface");
        expect(c.className).toContain("border-cp-hairline");
        expect(c.className).not.toContain("shadow");
      }
      const notYet = cells[0].querySelector('[data-status="not_measured"] [data-pill="not-yet"]') as HTMLElement;
      expect(notYet.className).toContain("bg-cp-grey-fill");
      expect(screen.getByTestId("s7-send").className).toContain("border-cp-navy");
      expect(container.querySelectorAll("[data-surface]")).toHaveLength(0);
      expectContract(container, expect);
    }, 20000);

    it("R6: the before-first-visit note is a navy-tint note", async () => {
      const d = clone(F.results);
      d.cells = [];
      d.empty = { status: "pending", message: { en: "x", ur: "x" }, detail: { graded: null, widened_to_weeks: null, as_of: "2026-10-27" } };
      serve({ "/coachip/results": d });
      await renderAt("/stats/results");
      expect(screen.getByTestId("s7-empty").className).toContain("bg-cp-navy-tint");
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
