import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, expectContract, expectNoIdentity, F, http, httpError, renderAt, serve, settle } from "./harness";
import { domContract } from "../count";
import { COPY } from "../copy";

/**
 * bd-sex15q.15 — S2 goldens (G1: one move in one fold). The page reads `GET /coachip/w/:wId` and, from the step card,
 * posts `POST /coachip/steps` with exactly R10's six keys. EN and UR, every state: normal, 201, 409, insufficient,
 * a load failure, and the switch off.
 */
const W = "W-IP-TIME";
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const LANGS = ["en", "ur"] as const;
// G1 one fold: the card, then the moment and the step card above the fold; why, where, good and the method below it.
const SECTIONS = ["w-number", "w-moment", "step-card", "w-split", "w-where", "w-good", "w-method"];

function before(a: Element, b: Element) {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe.each(LANGS)("S2 Weakness (%s)", (lang) => {
  afterEach(() => cleanup());
  beforeEach(async () => {
    http.get.mockReset();
    http.post.mockReset();
    await boot(lang);
  });

  it("normal: the one fold in order, the count contract, no identity, never the word weakness", async () => {
    serve({ [`/coachip/w/${W}`]: F[`w_${W}`] });
    const { container } = await renderAt(`/w/${W}`);
    expect(screen.getByTestId("insights-w")).toBeTruthy();
    const els = SECTIONS.map((id) => screen.getByTestId(id));
    for (let i = 1; i < els.length; i += 1) expect(before(els[i - 1], els[i])).toBe(true);
    expect(container.querySelector("#moment")).toBe(screen.getByTestId("w-moment"));
    expect(screen.getByTestId("moment-slot")).toBeTruthy();
    // the method sheet is collapsed at rest
    expect((screen.getByTestId("w-method") as HTMLDetailsElement).open).toBe(false);
    // three schools on S2, then "All schools"
    expect(screen.getAllByTestId("w-where-row")).toHaveLength(3);
    expect(screen.getByTestId("w-where-all").getAttribute("href")).toBe(`/portal/coach/insights/w/${W}/where`);
    expect(screen.getByTestId("step-full").getAttribute("href")).toContain(`/portal/coach/insights/w/${W}/move?school=`);
    expect(container.textContent!.toLowerCase()).not.toContain("weakness");
    expect(container.textContent).toContain(COPY["s2.method.title"][lang]);
    expectContract(container, expect);
    expectNoIdentity(container, expect);
    expect(container.innerHTML).toMatchSnapshot();
  }, 30000);

  it("Set step: posts exactly the six keys, then shows the step's check date (201)", async () => {
    const posted: unknown[] = [];
    serve({
      [`/coachip/w/${W}`]: F[`w_${W}`],
      "POST /coachip/steps": (_p?: unknown, body?: unknown) => { posted.push(body); return F.steps_post_201; },
    });
    const { container } = await renderAt(`/w/${W}`);
    fireEvent.click(screen.getByTestId("step-set"));
    await settle();
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post.mock.calls[0][0]).toBe("/coachip/steps");
    const body = posted[0] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["code_id", "i_id", "rm_note_id", "school_id", "source_session_id", "w_id"]);
    const sc = F[`w_${W}`].step_card;
    expect(body).toEqual({
      code_id: sc.code.code_id,
      school_id: "00000000-0000-4000-8000-010000000003",
      w_id: W,
      i_id: sc.i_id,
      // the moment is T-07's lesson and the step is for T-12: R10 accepts only that teacher's session, so none is sent
      source_session_id: null,
      rm_note_id: null,
    });
    expect(JSON.stringify(body)).not.toMatch(/teacher_key|name/);
    const done = screen.getByTestId("step-done");
    expect(done.textContent).toContain(COPY["s5.set.done"][lang].split("{date}")[0].trim());
    expect(done.querySelector('[data-date="2026-11-09"]')).toBeTruthy();
    expectContract(container, expect);
    expect(container.innerHTML).toMatchSnapshot();
  }, 30000);

  it("Set step: a 409 says an open step already exists for the code", async () => {
    serve({
      [`/coachip/w/${W}`]: F[`w_${W}`],
      "POST /coachip/steps": () => { throw httpError(409, F.steps_post_409); },
    });
    const { container } = await renderAt(`/w/${W}`);
    fireEvent.click(screen.getByTestId("step-set"));
    await settle();
    const c = screen.getByTestId("step-conflict");
    expect(c.textContent).toContain("T-12");
    expect(screen.queryByTestId("step-done")).toBeNull();
    expectContract(container, expect);
    expect(container.innerHTML).toMatchSnapshot();
  }, 30000);

  it("Set step: any other failure shows the load-failed words", async () => {
    serve({
      [`/coachip/w/${W}`]: F[`w_${W}`],
      "POST /coachip/steps": () => { throw httpError(500, { error: "server_error" }); },
    });
    await renderAt(`/w/${W}`);
    fireEvent.click(screen.getByTestId("step-set"));
    await settle();
    expect(screen.getByTestId("step-failed").textContent).toContain(COPY["e.failed_load"][lang]);
  }, 30000);

  it("insufficient: the not-enough line, the schools still show, no moment", async () => {
    const d = clone(F[`w_${W}`]);
    d.card.status = "insufficient";
    d.moment = null;
    serve({ [`/coachip/w/${W}`]: d });
    const { container } = await renderAt(`/w/${W}`);
    expect(screen.getByTestId("w-insufficient")).toBeTruthy();
    expect(screen.getAllByTestId("w-where-row").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("w-moment")).toBeNull();
    expect(screen.queryByTestId("moment-slot")).toBeNull();
    expect(screen.getByTestId("w-method")).toBeTruthy();
    expectContract(container, expect);
    expectNoIdentity(container, expect);
    expect(container.innerHTML).toMatchSnapshot();
  }, 30000);

  // bd-sex15q.19 (COS 16:44Z): R3 picks the moment (the card's lesson) and the step's code (where-first school, most hits,
  // no open step) independently, so they can be two teachers. When they are, the step card says so under its eyebrow;
  // when they are the same code, it says nothing extra.
  it("step for another code than the moment's: the card says it is a different teacher", async () => {
    const d = F[`w_${W}`];
    expect(d.moment.code.code).not.toBe(d.step_card.code.code); // the fixture's own pairing (T-07 moment, T-12 step)
    serve({ [`/coachip/w/${W}`]: d });
    const { container } = await renderAt(`/w/${W}`);
    const other = screen.getByTestId("step-other");
    expect(screen.getByTestId("step-card").contains(other)).toBe(true);
    expect(other.textContent).toBe(COPY["s2.step.other"][lang]);
    expectContract(container, expect);
  }, 30000);

  it("step for the moment's own code: no different-teacher line", async () => {
    const d = clone(F[`w_${W}`]);
    d.step_card.code = d.moment.code;
    serve({ [`/coachip/w/${W}`]: d });
    await renderAt(`/w/${W}`);
    expect(screen.getByTestId("step-card")).toBeTruthy();
    expect(screen.queryByTestId("step-other")).toBeNull();
  }, 30000);

  it("no step card when step_card is null", async () => {
    const d = clone(F[`w_${W}`]);
    d.step_card = null;
    serve({ [`/coachip/w/${W}`]: d });
    const { container } = await renderAt(`/w/${W}`);
    expect(screen.queryByTestId("step-card")).toBeNull();
    expectContract(container, expect);
  }, 30000);

  // fix-r5 s2 item 8 (qa-coach 073256): the app bar's "Move k of m" counts the moves S1 shows, never a hardcoded 2.
  it("item 8: the app bar says Move 1 of 1 when the coach has one move", async () => {
    const home = clone(F.home);
    home.moves = [home.moves[0]];
    serve({ [`/coachip/w/${W}`]: F[`w_${W}`], "/coachip/home": home });
    await renderAt(`/w/${W}`);
    const crumb = COPY["s2.appbar.sub"][lang];
    const one = lang === "en" ? "Move 1 of 1" : crumb.replace("{m}", "۱").replace("{k}", "۱").split("،")[0];
    const two = lang === "en" ? "Move 1 of 2" : crumb.replace("{m}", "۲").replace("{k}", "۱").split("،")[0];
    const text = screen.getByTestId("insights-w").textContent || "";
    expect(text).toContain(one);
    expect(text).not.toContain(two);
  }, 30000);

  // fix-r5 s2 item 8 (design-qa 072739/073633, qa-coach 073256, panel 094000): when every code already has an open step,
  // R3 sends step_card.code null; S2 draws the card in its done form from the coach's open step (home.steps), never nothing.
  it("item 8: every code stepped: the done card with the step's code, check date, Full step, Play and the tick", async () => {
    const d = clone(F[`w_${W}`]);
    d.step_card.code = null;
    const home = clone(F.home);
    const first = home.steps.find((s: { w_id: string }) => s.w_id === W);
    const posted: unknown[] = [];
    serve({
      [`/coachip/w/${W}`]: d,
      "/coachip/home": home,
      [`POST /coachip/steps/${first.id}/tick`]: (_p?: unknown, body?: unknown) => { posted.push(body); return { step: { ...first, coach_tick: "yes" } }; },
    });
    const { container } = await renderAt(`/w/${W}`);
    const card = screen.getByTestId("step-card");
    expect(card.getAttribute("data-state")).toBe("done");
    expect(card.textContent).toContain("T-31"); // the first open step for this W in home.steps
    const done = screen.getByTestId("step-done");
    expect(done.textContent).toContain(COPY["s5.set.done"][lang].split("{date}")[0].trim());
    expect(done.querySelector(`[data-date="${first.check_by}"]`)).toBeTruthy();
    expect(screen.getByTestId("step-full").getAttribute("href")).toContain(`/portal/coach/insights/w/${W}/move?school=${first.school.school_id}`);
    expect(screen.getByTestId("step-play").getAttribute("href")).toBe(`/portal/coach/insights/w/${W}#moment`);
    expect(screen.getByTestId("step-play").textContent).toBe(COPY["s5.play"][lang]);
    expect(screen.queryByTestId("step-set")).toBeNull();
    // the fold: the step card sits above Why and What good looks like
    for (const id of ["w-split", "w-good"]) expect(before(card, screen.getByTestId(id))).toBe(true);
    fireEvent.click(card.querySelector('[data-testid="step-tick-yes"]') as HTMLElement);
    await settle();
    expect(http.post.mock.calls.map((c) => c[0])).toEqual([`/coachip/steps/${first.id}/tick`]);
    expect(posted).toEqual([{ coach_tick: "yes" }]);
    expect(card.querySelector('[data-testid="step-ticked"]')?.getAttribute("data-tick")).toBe("yes");
    expectContract(container, expect);
  }, 30000);

  it("item 8: after Set (201) the done card keeps Full step and Play, and offers the tick", async () => {
    serve({
      [`/coachip/w/${W}`]: F[`w_${W}`],
      "/coachip/home": F.home,
      "POST /coachip/steps": () => F.steps_post_201,
    });
    await renderAt(`/w/${W}`);
    fireEvent.click(screen.getByTestId("step-set"));
    await settle();
    expect(screen.getByTestId("step-card").getAttribute("data-state")).toBe("done");
    expect(screen.getByTestId("step-full")).toBeTruthy();
    expect(screen.getByTestId("step-play")).toBeTruthy();
    expect(screen.getByTestId("step-tick-yes")).toBeTruthy();
  }, 30000);

  it("item 8: step_card.code null and no open step for this move: no card", async () => {
    const d = clone(F[`w_${W}`]);
    d.step_card.code = null;
    const home = clone(F.home);
    home.steps = home.steps.filter((s: { w_id: string }) => s.w_id !== W);
    serve({ [`/coachip/w/${W}`]: d, "/coachip/home": home });
    await renderAt(`/w/${W}`);
    expect(screen.queryByTestId("step-card")).toBeNull();
  }, 30000);

  // fix-r5 s2 item 6 (red-3 073740, design-qa 072738 (2), qa-coach C3): a `preload="metadata"` clip opens the stream with
  // `bytes=0-`, which the clip route logs as a play (A10). S2's inline player waits for a tap: preload none, no clip read.
  it("item 6: S2's players never fetch the clip before a tap (preload none, no clip request, no load/play)", async () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    try {
      serve({ [`/coachip/w/${W}`]: F[`w_${W}`], "/coachip/home": F.home });
      const { container } = await renderAt(`/w/${W}`);
      const audios = Array.from(container.querySelectorAll("audio"));
      expect(audios.length).toBeGreaterThan(0);
      expect(audios.map((a) => a.getAttribute("preload"))).toEqual(audios.map(() => "none"));
      expect(audios.some((a) => a.hasAttribute("autoplay"))).toBe(false);
      expect(http.get.mock.calls.some((c) => /\/clip|\/audio/.test(String(c[0])))).toBe(false);
      expect(load).not.toHaveBeenCalled();
      expect(play).not.toHaveBeenCalled();
    } finally {
      load.mockRestore();
      play.mockRestore();
    }
  }, 30000);

  // fix-r5 s4 train 7 item 2 (design-qa 172524, lead-final 223944): S4 stays one tap away, but through the moment
  // card's header ("The moment · T-nn at S-nn ›", the S1 "S-01 first ›" pattern), never a row of its own that pushes
  // "Set this step" under the fixed nav on the shortest page.
  it("item 2: the moment card's header is the link to the full player; no separate 'Open the player' row", async () => {
    serve({ [`/coachip/w/${W}`]: F[`w_${W}`], "/coachip/home": F.home });
    await renderAt(`/w/${W}`);
    const card = screen.getByTestId("w-moment");
    expect(screen.queryByTestId("w-moment-open")).toBeNull();
    expect(card.textContent).not.toContain(COPY["s2.moment.open"][lang]);
    const head = screen.getByTestId("w-moment-head");
    expect(head.tagName).toBe("A");
    expect(card.firstElementChild).toBe(head);
    expect(head.getAttribute("href")).toBe(`/portal/coach/insights/m/${F[`w_${W}`].moment.moment_id}`);
    expect(head.textContent).toContain(COPY["s2.moment.title"][lang]);
    expect(head.textContent).toContain(F[`w_${W}`].moment.code.code);
    expect(head.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(head.className).toMatch(/min-h-\[44px\]/);
    // the card holds the header, the player and nothing after it
    expect(card.children).toHaveLength(2);
  }, 30000);

  it("a load failure shows the error block, no bare digit", async () => {
    serve({ [`/coachip/w/${W}`]: () => { throw httpError(500, { error: "server_error" }); } });
    const { container } = await renderAt(`/w/${W}`);
    expect(screen.getByTestId("insights-state").getAttribute("data-state")).toBe("failed");
    expect(domContract(container).bareDigits).toEqual([]);
    expect(container.innerHTML).toMatchSnapshot();
  }, 30000);

  it("switch off: sent elsewhere, the W is never read", async () => {
    await boot(lang, { coachV2: true, coachip: false });
    serve({ [`/coachip/w/${W}`]: F[`w_${W}`] });
    await renderAt(`/w/${W}`);
    expect(screen.getByTestId("elsewhere")).toBeTruthy();
    expect(http.get.mock.calls.some((c) => String(c[0]).startsWith("/coachip/w/"))).toBe(false);
  }, 30000);
});
