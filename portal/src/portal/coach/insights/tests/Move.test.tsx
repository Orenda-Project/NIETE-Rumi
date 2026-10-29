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
      expect((screen.getByTestId("s5-materials").textContent || "").replace(/[\u2066-\u2069]/g, "")).toContain(i.materials[2].title[lang]);
      expect(screen.queryByTestId("s5-fln")).toBeNull();
      expectContract(container, expect);
      expectNoIdentity(container, expect);
      expect(container.innerHTML).toMatchSnapshot();
    }, 20000);

    it("fix-r5 5e: in Urdu every Latin-script run of a material title sits in LRI…PDI; English is untouched", async () => {
      serve({ [MOVE]: F["i_W-IP-TIME"] });
      await renderAt("/w/W-IP-TIME/move");
      const items = Array.from(screen.getByTestId("s5-materials").querySelectorAll("li")).map((li) => li.textContent || "");
      const titles = (F["i_W-IP-TIME"].i.materials as { title: Record<string, string> }[]).map((m) => m.title[lang]);
      expect(items.map((x) => x.replace(/[\u2066-\u2069]/g, ""))).toEqual(titles);
      if (lang === "en") {
        expect(items.some((x) => /[\u2066-\u2069]/.test(x))).toBe(false);
      } else {
        expect(items[2]).toContain("\u2066Five step lesson plan\u2069");
        expect(items[1]).toContain("\u2066NIETE\u2069");
        expect(items[1]).toContain("\u2066manage\u2069");
        // no Latin letter outside an isolate
        for (const x of items) expect(/[A-Za-z]/.test(x.replace(/\u2066[^\u2069]*\u2069/g, ""))).toBe(false);
      }
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

    // fix-r5 s2 item 7a (qa-coach 073254, panel 094000/094003): the library's debrief line, said tomorrow, is S5's first
    // block under the step, inside COPY d.try_tomorrow; then the panel's order, "Why this works" a closed disclosure.
    it("item 7a: debrief_script inside d.try_tomorrow, first under the step; the panel's order", async () => {
      const d = clone(F["i_W-IP-TIME"]);
      // the library's own shape (INTERVENTIONS.json debrief_script_en/_ur carry no frame; the client frames it)
      d.i.debrief_script = {
        en: "at minute 10 say the stop line, then move to 'we do' with the time on the board.",
        ur: "دسویں منٹ پر رکنے والا جملہ کہیں، پھر بورڈ پر وقت کے ساتھ «ہم کریں» شروع کریں۔",
      };
      serve({ [MOVE]: d });
      const { container } = await renderAt("/w/W-IP-TIME/move");
      const tt = screen.getByTestId("s5-try-tomorrow");
      const [pre, post] = COPY["d.try_tomorrow"][lang].split("{step}");
      // the Surface's line (its button, FIX_R6 A2, is the play, not part of the sentence)
      expect(tt.querySelector("p")?.textContent).toBe(`${pre}${d.i.debrief_script[lang]}${post}`);
      expect(tt.querySelector('[data-text="library"]')?.textContent).toBe(d.i.debrief_script[lang]);
      // the step is the library's words alone (the frame now carries the debrief line, never the step twice)
      expect(screen.getByTestId("s5-step").textContent).toContain(d.i.teacher_action_step[lang]);
      expect(screen.getByTestId("s5-step").textContent).not.toContain(pre.trim());
      // the order: step, try tomorrow (+ play, FIX_R6 A2), rehearsal, with whom/how long, materials, listen for, check, why, others
      const order = ["s5-step", "s5-try-tomorrow", "s5-play", "s5-rehearsal", "s5-facts", "s5-materials", "s5-listen-for", "s5-check", "s5-evidence", "s5-alternatives"];
      const els = order.map((id) => screen.getByTestId(id));
      for (let k = 1; k < els.length; k += 1) {
        expect(Boolean(els[k - 1].compareDocumentPosition(els[k]) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
      }
      // "Why this works": a closed disclosure holding the citations at body size
      const why = screen.getByTestId("s5-evidence") as HTMLDetailsElement;
      expect(why.tagName).toBe("DETAILS");
      expect(why.open).toBe(false);
      expect(why.querySelector("summary")?.textContent).toContain(COPY["s5.why.title"][lang]);
      expect(why.querySelector("li")?.className).toContain("text-[15px]");
      expectContract(container, expect);
    }, 20000);

    it("item 7a: a debrief line that already opens with the frame is not framed twice", async () => {
      serve({ [MOVE]: F["i_W-IP-TIME"] });
      await renderAt("/w/W-IP-TIME/move");
      const pre = COPY["d.try_tomorrow"][lang].split("{step}")[0];
      const text = screen.getByTestId("s5-try-tomorrow").textContent || "";
      expect(text.split(pre.trim()).length - 1).toBe(1);
      expect(text).toContain(F["i_W-IP-TIME"].i.debrief_script[lang]);
    }, 20000);

    // R6 (bd-sex15q.46, SCREENS S5): the window line is the app bar's; "Try this tomorrow" is the ONE raised surface; the
    // blocks under it are hairline sections; the FLN send and the play link are secondary (navy outline), never a fill.
    it("R6: app bar window line, try-tomorrow the ONE surface, hairline sections, secondary buttons", async () => {
      serve({ [MOVE]: flnCase(true) });
      const { container } = await renderAt("/w/W-IP-TIME/move");
      const bar = screen.getByTestId("insights-appbar");
      expect(bar.querySelector(`[data-window="${F["i_W-IP-TIME"].w.window.id}"]`)).not.toBeNull();
      expect(screen.getByTestId("s5-try-tomorrow").hasAttribute("data-surface")).toBe(true);
      expect(container.querySelectorAll("[data-surface]")).toHaveLength(1);
      for (const id of ["s5-step", "s5-rehearsal", "s5-facts", "s5-materials", "s5-listen-for", "s5-check", "s5-alternatives"]) {
        expect(screen.getByTestId(id).hasAttribute("data-section")).toBe(true);
      }
      // FIX_R6 A2: the play is the Surface's primary now; the FLN send stays the secondary
      const fln = screen.getByTestId("s5-fln");
      expect(fln.className).toContain("border-cp-navy");
      expect(fln.className).not.toContain("bg-cp-green");
      expect(screen.getByTestId("s5-play").className).toContain("bg-cp-green");
      expect(screen.getByTestId("s5-try-tomorrow").contains(screen.getByTestId("s5-play"))).toBe(true);
      expectContract(container, expect);
    }, 20000);

    it("flag off: the coach is sent elsewhere", async () => {
      await boot(lang, { coachV2: true, coachip: false });
      serve({ [MOVE]: F["i_W-IP-TIME"] });
      await renderAt("/w/W-IP-TIME/move");
      expect(screen.getByTestId("elsewhere")).toBeTruthy();
    }, 20000);
  });
}
