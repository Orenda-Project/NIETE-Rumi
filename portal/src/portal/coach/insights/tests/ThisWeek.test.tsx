import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, renderAt, serve, settle, F, http, httpError, expectContract, expectNoIdentity } from "./harness";
import { domContract } from "../count";
import { dateShort, todayKarachi } from "../format";
import { COPY } from "../copy";

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

/** fix-r5 item 5g: band.sub is `{date_short}` only (COPY v1.1 §8): the band's second line is the date and no number. */
function expectBandDateOnly(lang: Lang) {
  const band = screen.getByTestId("s1-today");
  expect(band.textContent).toBe(dateShort(todayKarachi(), lang));
  expect(band.querySelector("[data-num]")).toBeNull();
  const date = band.querySelector("[data-date]") as HTMLElement;
  expect(date.textContent).toBe(band.textContent);
}

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
          expectBandDateOnly(lang);
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
    // R6 (bd-sex15q.46): the headline count and "Move 1 of 2" live in the band (wcard-hero); the card under it holds
    // where-first and the two actions
    const hero = screen.getByTestId("wcard-hero");
    expect(hero.querySelector("[data-num]")?.textContent).toBe("17 of 49");
    expect(hero.textContent).toContain("Move 1 of 2");
    expect(card.textContent).toContain("Govt. Primary School Fictional-03 first (6 of 9) · visit Wed 28 Oct");
    expect(card.textContent).toContain("then Govt. Primary School Fictional-05, Govt. Primary School Fictional-06");
    const rows = screen.getAllByTestId("wrow");
    expect(rows[0].getAttribute("data-w")).toBe("W-EXIT-NOPLAN");
    expect(rows[0].getAttribute("href")).toBe("/portal/coach/insights/w/W-EXIT-NOPLAN");
    expect(screen.getByTestId("s1-stats-link").getAttribute("href")).toBe("/portal/coach/insights/stats");
  }, 20000);

  // bd-sex15q.19 (COS 16:44Z): the button is a flex box, and a flex box trims the space at the edge of each bare text
  // run, so "Listen " + <span>0:38</span> drew as "Listen0:38" in the browser while textContent kept the space. The
  // label is one inline run inside the button: no bare text node may sit beside an element as the button's own child.
  it.each(["en", "ur"] as const)("%s: the Listen label is one inline run, so the flex button keeps its space", async (lang) => {
    await boot(lang);
    serve({ "/coachip/home": F.home, [`POST /coachip/notes/${NOTE_ID}/status`]: { note: F.home.note } });
    await renderAt("");
    const listen = screen.getByTestId("wcard-listen");
    const kids = Array.from(listen.childNodes);
    expect(kids.some((n) => n.nodeType === Node.TEXT_NODE)).toBe(false);
    expect(listen.textContent).toBe(lang === "en" ? "Listen 0:38" : "سنیں ۰:۳۸");
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
    expect(banner.querySelectorAll("[data-line]").length).toBe(3);
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

  // fix-r5 s2 item 7b (qa-coach 073255, panel 094000/094002): the coach ticks a step from its S1 row. Two chips on an
  // open, unticked step post R11 `/steps/:id/tick`; the row then shows the tick from the response, then the chip as today.
  it.each([["en", "yes"], ["ur", "no"]] as const)("%s item 7b: tick %s posts R11 with the step id and re-renders the row", async (lang, tick) => {
    await boot(lang);
    const step = F.home.steps[1];
    const ticked = { ...clone(step), coach_tick: tick };
    const posted: unknown[] = [];
    serve({
      "/coachip/home": F.home,
      [`POST /coachip/notes/${NOTE_ID}/status`]: { note: F.home.note },
      [`POST /coachip/steps/${step.id}/tick`]: (_p?: unknown, body?: unknown) => { posted.push(body); return { step: ticked, computed_at: "2026-10-26T05:12:00Z" }; },
    });
    const { container } = await renderAt("");
    const row = screen.getAllByTestId("step-row").find((r) => r.getAttribute("data-step") === step.id)!;
    const yes = row.querySelector('[data-testid="step-tick-yes"]') as HTMLButtonElement;
    const no = row.querySelector('[data-testid="step-tick-no"]') as HTMLButtonElement;
    expect(yes.textContent).toBe(COPY["s5.tick.yes"][lang]);
    expect(no.textContent).toBe(COPY["s5.tick.no"][lang]);
    fireEvent.click(tick === "yes" ? yes : no);
    await settle();
    const tickPosts = http.post.mock.calls.filter(([u]) => String(u).includes("/tick"));
    expect(tickPosts.map(([u]) => u)).toEqual([`/coachip/steps/${step.id}/tick`]);
    expect(posted).toEqual([{ coach_tick: tick }]);
    const after = screen.getAllByTestId("step-row").find((r) => r.getAttribute("data-step") === step.id)!;
    expect(after.querySelector('[data-testid="step-tick-yes"]')).toBeNull();
    const label = after.querySelector('[data-testid="step-ticked"]')!;
    expect(label.getAttribute("data-tick")).toBe(tick);
    expect(label.textContent).toContain(COPY[tick === "yes" ? "s5.tick.yes" : "s5.tick.no"][lang]);
    // the strip's chip stays as today
    expect(after.querySelector('[data-testid="step-chip"]')).toBeTruthy();
    expectContract(container, expect);
  }, 20000);

  it("item 7b: a step already ticked shows its tick, never the chips", async () => {
    await boot("en");
    const h = clone(F.home);
    h.steps[0].coach_tick = "yes";
    serve({ "/coachip/home": h, [`POST /coachip/notes/${NOTE_ID}/status`]: { note: F.home.note } });
    await renderAt("");
    const rows = screen.getAllByTestId("step-row");
    expect(rows[0].querySelector('[data-testid="step-tick-yes"]')).toBeNull();
    expect(rows[0].querySelector('[data-testid="step-ticked"]')?.getAttribute("data-tick")).toBe("yes");
    expect(rows[1].querySelector('[data-testid="step-tick-yes"]')).toBeTruthy();
  }, 20000);

  // fix-r5 s2 item 17, coach half (design-qa 073629): in Urdu "T-04، S-01" drew as "S-01 ،T-04" (the comma attached to
  // the wrong atom). The two LTR atoms and their comma are ONE isolated run; English is unchanged.
  it.each(["en", "ur"] as const)("%s item 17: the open-step row's code and school are one LTR run with their comma", async (lang) => {
    await boot(lang);
    serve({ "/coachip/home": F.home, [`POST /coachip/notes/${NOTE_ID}/status`]: { note: F.home.note } });
    await renderAt("");
    const step = F.home.steps[0];
    const row = screen.getAllByTestId("step-row")[0];
    const sub = row.querySelector('[data-testid="step-sub"]') as HTMLElement;
    const atoms = Array.from(sub.querySelectorAll("[data-code]"));
    if (lang === "ur") {
      expect(atoms).toHaveLength(1);
      expect(atoms[0].textContent).toBe(`\u2066${step.code.code}، ${step.school.school_name}\u2069`);
      expect(atoms[0].getAttribute("dir")).toBe("ltr");
      expect(sub.textContent!.replace(/[\u2066-\u2069]/g, "").startsWith(`${step.code.code}، ${step.school.school_name}، `)).toBe(true);
      expect(sub.textContent).not.toContain("، ، ");
    } else {
      expect(atoms.map((a) => a.textContent)).toEqual([step.code.code, step.school.school_name]);
      expect(sub.textContent!.startsWith(`${step.code.code} · ${step.school.school_name} · set`)).toBe(true);
    }
  }, 20000);

  // fix-r5 s2 item 20 (panel 094004, design-qa 073634): while the detector is being tested, the phonics tile is ONE line.
  it.each(["en", "ur"] as const)("%s item 20: the testing phonics tile is one line", async (lang) => {
    await boot(lang);
    serve({ "/coachip/home": F.home, [`POST /coachip/notes/${NOTE_ID}/status`]: { note: F.home.note } });
    await renderAt("");
    const tile = screen.getByTestId("s1-phonics");
    expect(tile.getAttribute("data-status")).toBe("testing");
    expect(tile.querySelector("h2")).toBeNull();
    const line = tile.querySelector('[data-testid="s1-phonics-line"]') as HTMLElement;
    const read = F.home.phonics.read as number;
    expect(line.textContent).toBe(COPY["s1.phonics.line"][lang].replace("{read}", lang === "en" ? String(read) : String(read).replace(/[0-9]/g, (c) => "۰۱۲۳۴۵۶۷۸۹"[Number(c)])));
    expect(tile.textContent).toBe(line.textContent);
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
