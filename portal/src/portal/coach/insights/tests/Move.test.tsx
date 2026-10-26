import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("../../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, renderAt, serve, F, http, httpError, expectContract, expectNoIdentity } from "./harness";
import { COPY } from "../copy";
import { domContract } from "../count";

/**
 * bd-sex15q.15 — S5, the move (`/w/:wId/move`, R9). The library's words verbatim, the check line from
 * `check_by_default.rule` (never from the visit date), evidence as text, and the FLN way out with no recipient.
 */
const MOVE = "/coachip/i/W-IP-TIME";
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** A copy of the fixture whose check is a booked visit 9 days away. */
function visitCase() {
  const d = clone(F["i_W-IP-TIME"]);
  const visit = { date: "2026-11-04", schedule_id: "00000000-0000-4000-8000-080000000009" };
  d.check_by_default = { date: "2026-11-04", rule: "visit", visit };
  return d;
}

/** A copy with an FLN material and the send switched on (or off). */
function flnCase(canSend: boolean) {
  const d = clone(F["i_W-IP-TIME"]);
  d.i.materials.push({ kind: "fln", ref: "fln-ur-g2-sounds-01", title: { en: "Grade 2 Urdu sound plans", ur: "جماعت دو اردو آوازوں کے منصوبے" } });
  d.fln = { can_send: canSend, plan_ids: ["fln-ur-g2-sounds-01"] };
  return d;
}

for (const lang of ["en", "ur"] as const) {
  describe(`S5 Move (${lang})`, () => {
    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
      await boot(lang);
    });
    afterEach(() => { cleanup(); vi.useRealTimers(); });

    it("normal: the library verbatim, the 14-day rule, contract and identity", async () => {
      serve({ [MOVE]: F["i_W-IP-TIME"] });
      const { container } = await renderAt("/w/W-IP-TIME/move");
      const page = screen.getByTestId("insights-move");
      const i = F["i_W-IP-TIME"].i;
      const lib = Array.from(page.querySelectorAll('[data-text="library"]')).map((e) => e.textContent);
      for (const k of ["teacher_action_step", "with_whom", "duration", "rehearsal_script", "listen_for", "check_it_worked"]) {
        expect(lib).toContain(i[k][lang]);
      }
      const rule = screen.getByTestId("s5-check-rule");
      expect(rule.textContent).toContain(lang === "en" ? "No visit is booked within 14 days" : "۱۴ دن کے اندر کوئی دورہ طے نہیں");
      expect(rule.querySelector("[data-date]")?.getAttribute("data-date")).toBe("2026-11-09");
      // the W's count, resolved to its window
      const num = page.querySelector('[data-num="17"]');
      expect(num?.getAttribute("data-den")).toBe("49");
      // evidence is text, never a link
      expect(container.innerHTML).not.toMatch(/<a [^>]*href="http/);
      expect(screen.getByTestId("s5-evidence").textContent).toContain(i.evidence[0].source);
      // alternatives: listed, linking nowhere
      const alts = screen.getByTestId("s5-alternatives");
      expect(alts.querySelectorAll("li")).toHaveLength(2);
      expect(alts.querySelector("a")).toBeNull();
      // play the moment, back on S2
      expect(screen.getByTestId("s5-play").getAttribute("href")).toBe("/portal/coach/insights/w/W-IP-TIME#moment");
      expect(page.textContent).toContain(COPY["s5.footer"][lang]);
      // the payload carries no code_id, so no Set button on S5
      expect(screen.queryByTestId("s5-set")).toBeNull();
      // vidrec renders its title only (minutes are not in the payload)
      expect(screen.getByTestId("s5-materials").textContent).toContain(i.materials[2].title[lang]);
      expect(screen.queryByTestId("s5-fln")).toBeNull();
      expectContract(container, expect);
      expectNoIdentity(container, expect);
      expect(container.innerHTML).toMatchSnapshot();
    }, 20000);

    it("visit rule: the check is the booked visit, days counted from today (Karachi)", async () => {
      serve({ [MOVE]: visitCase() });
      const { container } = await renderAt("/w/W-IP-TIME/move");
      const rule = screen.getByTestId("s5-check-rule");
      expect(rule.textContent).toContain(lang === "en" ? "The check is the visit on" : "جانچ");
      expect(rule.querySelector("[data-date]")?.getAttribute("data-date")).toBe("2026-11-04");
      expect(rule.querySelector("[data-nonum]")?.textContent).toContain(lang === "en" ? "9" : "۹");
      expect(rule.textContent).not.toContain(lang === "en" ? "No visit is booked" : "کوئی دورہ طے نہیں");
      expectContract(container, expect);
      expect(container.innerHTML).toMatchSnapshot();
    }, 20000);

    it("school travels as ?school= to the read", async () => {
      serve({ [MOVE]: F["i_W-IP-TIME"] });
      await renderAt("/w/W-IP-TIME/move?school=00000000-0000-4000-8000-010000000003");
      expect(http.get).toHaveBeenCalledWith(MOVE, { params: { school: "00000000-0000-4000-8000-010000000003" } });
    }, 20000);

    it("FLN on: a link to the send page with no recipient and no query string", async () => {
      serve({ [MOVE]: flnCase(true) });
      const { container } = await renderAt("/w/W-IP-TIME/move");
      const a = screen.getByTestId("s5-fln");
      const href = a.getAttribute("href") || "";
      expect(href.startsWith("/portal/fln")).toBe(true);
      expect(href).not.toContain("?");
      expect(href).not.toMatch(/T-\d|code|0000/);
      expectContract(container, expect);
    }, 20000);

    it("FLN off: the RM line, no link", async () => {
      serve({ [MOVE]: flnCase(false) });
      await renderAt("/w/W-IP-TIME/move");
      const row = screen.getByTestId("s5-fln-off");
      expect(row.textContent).toBe(COPY["s5.fln.off"][lang]);
      expect(row.closest("a")).toBeNull();
      expect(screen.queryByTestId("s5-fln")).toBeNull();
    }, 20000);

    it("a load failure shows the failed state, no digit", async () => {
      serve({ [MOVE]: () => { throw httpError(500, { error: "x" }); } });
      const { container } = await renderAt("/w/W-IP-TIME/move");
      expect(screen.getByTestId("insights-state").getAttribute("data-state")).toBe("failed");
      expect(screen.getByTestId("insights-state").textContent).toBe(COPY["e.failed_load"][lang]);
      expect(domContract(container).bareDigits).toEqual([]);
    }, 20000);

    it("flag off: the coach is sent elsewhere", async () => {
      await boot(lang, { coachV2: true, coachip: false });
      serve({ [MOVE]: F["i_W-IP-TIME"] });
      await renderAt("/w/W-IP-TIME/move");
      expect(screen.getByTestId("elsewhere")).toBeTruthy();
    }, 20000);
  });
}
