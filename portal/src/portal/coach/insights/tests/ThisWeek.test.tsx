import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, renderAt, serve, settle, F, http, httpError, expectContract, expectNoIdentity } from "./harness";
import { domContract } from "../count";

/**
 * bd-sex15q.15 — S1 "This week", the coach's home (DESIGN §3 S1, COPY §S1, API R2/R13). Every state in both languages:
 * snapshot, the DOM count contract, no identity; plus the first card's links, the Listen button, the note's seen/dismissed
 * posts, a strip with no red, no "weakness", and no Arabic-Indic digit in Urdu.
 */

type Lang = "en" | "ur";
const LANGS: Lang[] = ["en", "ur"];
const NOTE_ID = "00000000-0000-4000-8000-060000000001";
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** F.home_insufficient with another Empty status (pending / failed) and that status's COPY message. */
function emptyAs(status: "pending" | "failed") {
  const h = clone(F.home_insufficient);
  h.empty.status = status;
  h.empty.message = status === "pending"
    ? { en: "Being prepared: your first week's moves appear after tonight's run.", ur: "تیاری جاری ہے: آپ کے پہلے ہفتے کے قدم آج رات کے تجزیے کے بعد آئیں گے۔" }
    : { en: "The analysis has not run for 7 days. Your open steps still show. Ask your RM.", ur: "تجزیہ سات دن سے نہیں چلا۔ آپ کے جاری قدم دکھائی دے رہے ہیں۔ اپنے آر ایم سے بات کریں۔" };
  h.empty.detail = { graded: null, widened_to_weeks: null, as_of: null };
  return h;
}

/** F.home with the phonics card live (status ok). */
function phonicsOk() {
  const h = clone(F.home);
  const card = clone(F.home.moves[0]);
  card.w_id = "W-PHON";
  h.phonics = { status: "ok", read: 30, needed: 30, kappa_passed: true, card, reading_hours: { n: 9, d: 14, window_id: "w4-2026-09-28" } };
  return h;
}

/** The states that carry at least one count: the full contract (nums > 0) applies. */
const COUNTED: Record<string, () => unknown> = {
  normal: () => F.home,
  stale: () => F.home_stale,
  insufficient: () => F.home_insufficient,
  phonics_paused: () => F.home_phonics_paused,
  phonics_ok: phonicsOk,
  failed: () => emptyAs("failed"),
};

/** States with no count on screen: still no bare digit, no unresolved window, no half-marked count. */
function expectQuiet(root: HTMLElement) {
  const c = domContract(root);
  expect({ nums: c.nums, unresolved: c.unresolvedWins, bare: c.bareDigits }).toEqual({ nums: c.numsWithDenWin, unresolved: [], bare: [] });
}

function expectCommon(container: HTMLElement, lang: Lang) {
  expectNoIdentity(container, expect);
  expect(/weakness/i.test(container.textContent || "")).toBe(false);
  if (lang === "ur") expect(/[٠-٩]/.test(container.textContent || "")).toBe(false);
}

const page = () => screen.getByTestId("insights-this-week");

describe("S1 This week", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    http.get.mockReset();
    http.post.mockReset();
  });

  for (const lang of LANGS) {
    describe(lang, () => {
      for (const [name, payload] of Object.entries(COUNTED)) {
        it(`${name}: renders, keeps the count contract, no identity`, async () => {
          await boot(lang);
          serve({ "/coachip/home": payload(), [`POST /coachip/notes/${NOTE_ID}/status`]: { note: F.home.note } });
          const { container } = await renderAt("");
          expect(page()).toBeTruthy();
          expectContract(container, expect);
          expectCommon(container, lang);
          expect(container.innerHTML).toMatchSnapshot();
        }, 20000);
      }

      for (const [name, payload] of Object.entries({ no_scope: () => F.home_no_scope, pending: () => emptyAs("pending") })) {
        it(`${name}: the empty message, no bare digit`, async () => {
          await boot(lang);
          serve({ "/coachip/home": payload() });
          const { container } = await renderAt("");
          expect(screen.getByTestId("s1-empty").getAttribute("data-status")).toBe(name);
          expectQuiet(container);
          expectCommon(container, lang);
          expect(container.innerHTML).toMatchSnapshot();
        }, 20000);
      }

      it("load failure: the §E block", async () => {
        await boot(lang);
        serve({ "/coachip/home": () => { throw httpError(500); } });
        const { container } = await renderAt("");
        expect(screen.getByTestId("insights-state").getAttribute("data-state")).toBe("failed");
        expectQuiet(container);
        expectCommon(container, lang);
        expect(container.innerHTML).toMatchSnapshot();
      }, 20000);

      it("flag off: nothing of S1, the coach lands on the Training Library", async () => {
        await boot(lang, { coachV2: true, coachip: false });
        serve({ "/coachip/home": F.home });
        const { container } = await renderAt("");
        expect(screen.getByTestId("elsewhere")).toBeTruthy();
        expect(screen.queryByTestId("insights-this-week")).toBeNull();
        expect(http.get.mock.calls.some(([u]) => u === "/coachip/home")).toBe(false);
        expectQuiet(container);
        expectCommon(container, lang);
        expect(container.innerHTML).toMatchSnapshot();
      }, 20000);
    });
  }

  it("normal: the first card's links, the Listen button and Move 2's row", async () => {
    await boot("en");
    serve({ "/coachip/home": F.home, [`POST /coachip/notes/${NOTE_ID}/status`]: { note: F.home.note } });
    await renderAt("");
    const card = screen.getByTestId("wcard");
    const listen = screen.getByTestId("wcard-listen");
    expect(listen.textContent).toBe("Listen 0:38");
    expect(listen.getAttribute("href")).toBe("/portal/coach/insights/w/W-IP-TIME#moment");
    expect(screen.getByTestId("wcard-see").getAttribute("href")).toBe("/portal/coach/insights/w/W-IP-TIME");
    expect(card.querySelector("[data-num]")?.textContent).toBe("17 of 49");
    expect(card.textContent).toContain("Move 1 of 2");
    expect(card.textContent).toContain("Govt. Primary School Fictional-03 first (6 of 9) · visit Wed 28 Oct");
    expect(card.textContent).toContain("then Govt. Primary School Fictional-05, Govt. Primary School Fictional-06");
    const rows = screen.getAllByTestId("wrow");
    expect(rows[0].getAttribute("data-w")).toBe("W-EXIT-NOPLAN");
    expect(rows[0].getAttribute("href")).toBe("/portal/coach/insights/w/W-EXIT-NOPLAN");
    expect(screen.getByTestId("s1-stats-link").getAttribute("href")).toBe("/portal/coach/insights/stats");
  }, 20000);

  it("ur: the Listen button reads سنیں ۰:۳۸", async () => {
    await boot("ur");
    serve({ "/coachip/home": F.home, [`POST /coachip/notes/${NOTE_ID}/status`]: { note: F.home.note } });
    await renderAt("");
    expect(screen.getByTestId("wcard-listen").textContent).toBe("سنیں ۰:۳۸");
  }, 20000);

  it("note: a sent note posts seen once; Done posts dismissed and hides it", async () => {
    await boot("en");
    serve({ "/coachip/home": F.home, [`POST /coachip/notes/${NOTE_ID}/status`]: { note: F.home.note } });
    await renderAt("");
    const banner = screen.getByTestId("s1-note");
    expect(banner.querySelectorAll("li").length).toBe(3);
    expect(screen.getByTestId("s1-note-open").getAttribute("href")).toBe("/portal/coach/insights/w/W-IP-TIME");
    const posts = () => http.post.mock.calls.filter(([u]) => u === `/coachip/notes/${NOTE_ID}/status`).map(([, b]) => b);
    expect(posts()).toEqual([{ status: "seen" }]);
    fireEvent.click(screen.getByTestId("s1-note-dismiss"));
    await settle();
    expect(posts()).toEqual([{ status: "seen" }, { status: "dismissed" }]);
    expect(screen.queryByTestId("s1-note")).toBeNull();
  }, 20000);

  it("steps: the strip is indigo and grey, never red; chips and the legend", async () => {
    await boot("en");
    serve({ "/coachip/home": F.home, [`POST /coachip/notes/${NOTE_ID}/status`]: { note: F.home.note } });
    await renderAt("");
    const strips = screen.getAllByTestId("step-strip");
    expect(strips.length).toBe(3);
    for (const s of strips) {
      expect(s.querySelectorAll("[data-dot]").length).toBe(3);
      expect(/red|#ef4444|#dc2626|#b91c1c|#f87171/i.test(s.outerHTML)).toBe(false);
    }
    expect(strips[0].querySelectorAll('[data-dot="done"]').length).toBe(2);
    expect(strips[1].querySelectorAll('[data-dot="partial"]').length).toBe(1);
    expect(strips[1].querySelectorAll('[data-dot="missing"]').length).toBe(1);
    expect(strips[2].querySelectorAll('[data-dot="missing"]').length).toBe(3);
    const chips = screen.getAllByTestId("step-chip").map((c) => c.textContent);
    expect(chips).toEqual(["It worked", "1 recording to come", "3 recordings to come"]);
    expect(screen.getAllByTestId("s1-steps-legend").length).toBe(1);
  }, 20000);

  it("phonics: testing, paused and ok each draw their own tile", async () => {
    for (const [payload, state] of [[F.home, "testing"], [F.home_phonics_paused, "paused"], [phonicsOk(), "ok"]] as const) {
      await boot("en");
      serve({ "/coachip/home": payload, [`POST /coachip/notes/${NOTE_ID}/status`]: { note: F.home.note } });
      await renderAt("");
      expect(screen.getByTestId("s1-phonics").getAttribute("data-status")).toBe(state);
      if (state === "ok") expect(screen.getByTestId("wcard-phonics").getAttribute("data-w")).toBe("W-PHON");
      cleanup();
    }
  }, 30000);

  it("no_scope: no steps block and no phonics tile", async () => {
    await boot("en");
    serve({ "/coachip/home": F.home_no_scope });
    await renderAt("");
    expect(screen.queryByTestId("s1-steps")).toBeNull();
    expect(screen.queryByTestId("s1-phonics")).toBeNull();
  }, 20000);

  it("insufficient and failed: the open steps still show", async () => {
    for (const payload of [F.home_insufficient, emptyAs("failed")]) {
      await boot("en");
      serve({ "/coachip/home": payload });
      await renderAt("");
      expect(screen.getByTestId("s1-steps")).toBeTruthy();
      expect(screen.getAllByTestId("step-row").length).toBe(1);
      cleanup();
    }
  }, 30000);
});
