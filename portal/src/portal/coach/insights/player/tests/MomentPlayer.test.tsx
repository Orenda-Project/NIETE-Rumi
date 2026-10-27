import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "i18next";

vi.mock("../../../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));

import { MomentPlayer } from "../index";
import { COPY } from "../../copy";
import { domContract } from "../../count";
import FIXTURES from "../../tests/fixtures.json";
import type { Moment } from "../../types";

/**
 * bd-sex15q.16 — the moment player (SPEC v2 §7, DESIGN §3 S4, COPY §S4), muted: jsdom plays nothing, so play/pause/load
 * are stubbed and the media events are fired by hand, the way the kit's own tests do it. Fictional fixtures, codes only.
 *
 *   source     the clip route, never a URL from the payload (B4); a failed/expired clip plays the session's audio from
 *              lesson_s (coach) or shows no player (RM circle form)
 *   tap only   no autoplay attribute, no play() on mount; a tap plays once; two players: starting B pauses A
 *   strip      a tap inside the clip seeks the clip; outside says so; not_reached is grey, never red; no timestamps:
 *              marked, not tappable
 *   clock      "in the lesson" = clip.from_s + currentTime, ASCII, LTR
 */
const F = FIXTURES as unknown as Record<string, Moment>;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const LANGS = ["en", "ur"] as const;

let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn(function pauseStub(this: HTMLMediaElement) { this.dispatchEvent(new Event("pause")); });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play as unknown as () => Promise<void>);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause as unknown as () => void);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

async function inLang(lang: "en" | "ur") {
  await act(async () => { await i18n.changeLanguage(lang); });
}

/** The element's own clock: a settable currentTime and a duration, as a browser keeps them. */
function media(audio: HTMLAudioElement, duration: number) {
  let t = 0;
  Object.defineProperty(audio, "currentTime", { get: () => t, set: (v: number) => { t = v; }, configurable: true });
  Object.defineProperty(audio, "duration", { get: () => duration, configurable: true });
  return {
    at(seconds: number) { t = seconds; act(() => { audio.dispatchEvent(new Event("timeupdate")); }); },
    get time() { return t; },
  };
}

/** This player's own nodes: the pair card carries a nested inline player with the same test ids. */
const own = (root: HTMLElement, id: string) =>
  Array.from(root.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)).filter((e) => !e.closest('[data-testid="pair-card"]'));
const kitAudio = (root: HTMLElement) => own(root, "moment-kit")[0].querySelector("audio") as HTMLAudioElement;
const segments = (root: HTMLElement) => own(root, "chapter-seg") as HTMLButtonElement[];
const RED = /(^|[-:[])(red|rose)-|#(dc2626|ef4444|b91c1c|f87171|e11d48|fecaca|fee2e2)/i;

describe.each(LANGS)("MomentPlayer (%s)", (lang) => {
  beforeEach(async () => { await inLang(lang); });

  it("plays the clip route, never a URL from the payload, and never on its own", async () => {
    const m = clone(F.moment) as Moment & { url?: string };
    m.url = "https://bucket.example/should-never-play.mp3";
    const { container } = render(<MomentPlayer moment={m} variant="full" />);
    const audio = kitAudio(container);
    expect(audio.getAttribute("src")).toBe(`/api/portal/coachip/m/${m.moment_id}/clip`);
    expect(container.innerHTML).not.toContain("bucket.example");
    expect(audio.hasAttribute("autoplay")).toBe(false);
    expect(audio.getAttribute("preload")).toBe("metadata");
    for (const a of Array.from(container.querySelectorAll("audio"))) expect(a.hasAttribute("autoplay")).toBe(false);
    await act(async () => { await Promise.resolve(); });
    expect(play).not.toHaveBeenCalled();
    // the kit row is LTR in Urdu too
    expect(within(own(container, "moment-kit")[0]).getByTestId("newui-audio").getAttribute("dir")).toBe("ltr");
    // a tap plays, once
    fireEvent.click(within(own(container, "moment-kit")[0]).getByRole("button"));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("two players: starting B pauses A (one kit player sounding at a time)", async () => {
    const a = clone(F.moment);
    const b = clone(F.moment_clip_failed);
    render(<><div data-testid="A"><MomentPlayer moment={a} variant="inline" /></div><div data-testid="B"><MomentPlayer moment={b} variant="inline" /></div></>);
    const A = screen.getByTestId("A");
    const B = screen.getByTestId("B");
    const btn = (el: HTMLElement) => within(within(el).getByTestId("moment-kit")).getByRole("button");
    fireEvent.click(btn(A));
    act(() => { kitAudio(A).dispatchEvent(new Event("playing")); });
    expect(btn(A).getAttribute("aria-label")).not.toBe(btn(B).getAttribute("aria-label"));
    pause.mockClear();
    fireEvent.click(btn(B));
    expect(play).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(pause.mock.contexts[0]).toBe(kitAudio(A));
  });

  it("opens at the moment, and the clock reads clip.from_s + currentTime, ASCII and LTR", () => {
    const m = clone(F.moment);
    const { container } = render(<MomentPlayer moment={m} variant="inline" />);
    const opens = within(container).getByTestId("moment-opens");
    expect(opens.textContent).toContain("18:42");
    expect(opens.textContent).toContain(lang === "en" ? "Plays on tap only" : "آپ کے ٹیپ کرنے پر ہی چلے گا");
    const clock = within(container).getByTestId("lesson-clock");
    expect(clock.textContent).toContain("18:42");
    const el = media(kitAudio(container), 38);
    el.at(7);
    expect(clock.textContent).toContain("18:49");
    expect(clock.querySelector("[data-clock]")!.textContent).not.toMatch(/[۰-۹]/);
    expect(clock.querySelector("[data-clock]")!.getAttribute("dir")).toBe("ltr");
  });

  it("chapter strip: a tap inside the clip seeks to from_s - clip.from_s; outside says so", () => {
    const m = clone(F.moment);
    m.clip = { ...m.clip, from_s: 1100, to_s: 1160 };
    const { container } = render(<MomentPlayer moment={m} variant="full" />);
    const el = media(kitAudio(container), 60);
    const segs = segments(container);
    expect(segs).toHaveLength(5);
    // Practice starts at 1122, inside [1100, 1160)
    fireEvent.click(segs[3]);
    expect(el.time).toBe(22);
    expect(within(container).queryByTestId("outside-clip")).toBeNull();
    // Warm-up at 0 is outside the clip
    fireEvent.click(segs[0]);
    expect(el.time).toBe(22);
    expect(within(container).getByTestId("outside-clip").textContent).toBe(COPY["s4.outside_clip"][lang]);
    // each segment is a button named by its label and verdict word
    expect(segs[0].getAttribute("aria-label")).toContain(m.steps[0].label[lang]);
    expect(segs[0].getAttribute("aria-label")).toContain(lang === "en" ? "done" : "ہوا");
    expect(segs[2].getAttribute("aria-label")).toContain(lang === "en" ? "partial" : "ادھورا");
  });

  it("fix-r5 5c: not_adjudicable and substituted segments are named by COPY's verdict words", () => {
    const m = clone(F.moment);
    m.steps[3].verdict = "not_adjudicable";
    m.steps[4].verdict = "substituted";
    const { container } = render(<MomentPlayer moment={m} variant="full" />);
    const segs = segments(container);
    expect(segs[3].getAttribute("aria-label")).toBe(`${m.steps[3].label[lang]}: ${COPY["s4.verdict.not_adjudicable"][lang]}`);
    expect(segs[4].getAttribute("aria-label")).toBe(`${m.steps[4].label[lang]}: ${COPY["s4.verdict.substituted"][lang]}`);
  });

  it("marks ✓ ½ ✗, and not_reached is grey, never red; no red anywhere on a step", () => {
    const m = clone(F.moment);
    m.steps[4].verdict = "not_reached";
    const { container } = render(<MomentPlayer moment={m} variant="full" />);
    const segs = segments(container);
    expect(segs.map((s) => s.getAttribute("data-verdict"))).toEqual(["executed", "executed", "partial", "not_done", "not_reached"]);
    expect(segs[0].textContent).toContain("✓");
    expect(segs[2].textContent).toContain("½");
    expect(segs[3].textContent).toContain("✗");
    const grey = segs[4];
    expect(grey.querySelector('[data-testid="chapter-bar"]')!.getAttribute("class")).toContain("chapter-grey");
    for (const s of segs) {
      for (const node of [s, ...Array.from(s.querySelectorAll("*"))]) expect(node.getAttribute("class") || "").not.toMatch(RED);
    }
    expect(within(container).getByTestId("chapter-legend").textContent).toContain(COPY["s4.legend"][lang]);
    expect(within(container).getByTestId("chapter-legend").textContent).toContain(COPY["s4.tap_step"][lang]);
  });

  it("confidence none: the steps are marked but not tappable, and the line says the second is not", () => {
    const m = clone(F.moment);
    m.confidence = "none";
    m.clip = { from_s: 0, to_s: 1660, duration_s: 1660, status: "ready" };
    m.steps = m.steps.map((s) => ({ ...s, from_s: null, to_s: null }));
    m.gloss = null;
    m.lesson_s = null;
    const { container } = render(<MomentPlayer moment={m} variant="full" />);
    const el = media(kitAudio(container), 1660);
    const segs = segments(container);
    for (const s of segs) expect(s.disabled).toBe(true);
    fireEvent.click(segs[3]);
    expect(el.time).toBe(0);
    expect(within(container).getByTestId("no-timestamp").textContent).toBe(COPY["s4.no_timestamp"][lang]);
    expect(within(container).queryByTestId("outside-clip")).toBeNull();
    expect(own(container, "lesson-clock")[0].textContent).toContain("0:00");
  });

  it("clip failed (coach): the session's audio from lesson_s, said with the time; never 'being prepared'", () => {
    const m = clone(F.moment_clip_failed);
    const { container } = render(<MomentPlayer moment={m} variant="full" />);
    const audio = kitAudio(container);
    expect(audio.getAttribute("src")).toBe(`/api/portal/coachip/session/${m.session.session_id}/audio`);
    const el = media(audio, 1710);
    act(() => { audio.dispatchEvent(new Event("loadedmetadata")); });
    expect(el.time).toBe(1250);
    act(() => { audio.dispatchEvent(new Event("loadedmetadata")); el.at(1260); audio.dispatchEvent(new Event("loadedmetadata")); });
    expect(el.time).toBe(1260); // seeks once, never again
    const line = within(container).getByTestId("clip-failed");
    expect(line.textContent).toContain("20:50");
    expect(line.textContent).toContain(lang === "en" ? "The clip could not be made" : "کلپ نہیں بن سکا");
    expect(container.textContent).not.toMatch(/being prepared|تیاری/i);
    expect(within(container).getByTestId("lesson-clock").textContent).toContain("21:00");
    expect(play).not.toHaveBeenCalled();
  });

  it("RM circle form: no player when the clip failed, the RM line, no full link, no code", () => {
    const rm = clone(F.moment_rm) as unknown as Moment;
    rm.clip = { ...rm.clip, status: "expired" };
    const { container } = render(<MomentPlayer moment={rm} variant="full" />);
    expect(container.querySelector("audio")).toBeNull();
    expect(within(container).getByTestId("clip-failed-rm").textContent).toBe(COPY["e.503_clip.rm"][lang]);
    // never e.503_clip: it promises a full recording the RM cannot get
    expect(container.textContent).not.toContain(lang === "en" ? "the full recording plays" : "پوری ریکارڈنگ");
    expect(within(container).queryByTestId("full-recording")).toBeNull();
    expect(container.textContent).not.toMatch(/T-\d+/);
  });

  it("RM circle form, clip ready: the clip plays, no full recording, no code", () => {
    const rm = clone(F.moment_rm) as unknown as Moment;
    const { container } = render(<MomentPlayer moment={rm} variant="full" />);
    expect(kitAudio(container).getAttribute("src")).toBe(`/api/portal/coachip/m/${rm.moment_id}/clip`);
    expect(within(container).queryByTestId("full-recording")).toBeNull();
    expect(container.textContent).not.toMatch(/T-\d+/);
  });

  it("gloss: ok shows 'At minute 19:' + the words; blocked shows the none line, never raw text", () => {
    const ok = render(<MomentPlayer moment={clone(F.moment)} variant="full" />);
    const box = within(ok.container).getByTestId("gloss");
    expect(box.textContent).toContain(F.moment.gloss![lang]);
    // COPY §0.2: only codes and the player clock stay ASCII in Urdu; the gloss minute takes the page's digits
    expect(box.querySelector("[data-clock]")!.textContent).toBe(lang === "en" ? "19" : "۱۹");
    cleanup();
    const m = clone(F.moment);
    m.gloss_status = "blocked";
    const blocked = render(<MomentPlayer moment={m} variant="full" />);
    expect(within(blocked.container).getByTestId("gloss").textContent).toBe(COPY["s4.gloss.none"][lang]);
    expect(blocked.container.textContent).not.toContain(F.moment.gloss![lang]);
  });

  it("the question, the pair (a nested moment with its own player) and See the move", () => {
    const onSeeMove = vi.fn();
    const { container } = render(<MomentPlayer moment={clone(F.moment)} variant="full" onSeeMove={onSeeMove} />);
    expect(within(container).getByTestId("moment-question").textContent).toContain(COPY["s4.question.title"][lang]);
    expect(within(container).getByTestId("moment-question").textContent).toContain(F.moment.question[lang]);
    const pair = within(container).getByTestId("pair-card");
    expect(pair.textContent).toContain(COPY["s4.pair.title"][lang]);
    expect(pair.textContent).toContain("T-22");
    const pairAudio = pair.querySelector("audio")!;
    expect(pairAudio.getAttribute("src")).toBe("/api/portal/coachip/m/00000000-0000-4000-8000-040000000002/clip");
    // the pair fetches nothing until it is tapped: one clip's data per page, and no audited "play" for a clip nobody chose
    expect(pairAudio.getAttribute("preload")).toBe("none");
    fireEvent.click(within(container).getByTestId("see-move"));
    expect(onSeeMove).toHaveBeenCalledTimes(1);
  });

  it("pair fallback: the library's example, with its title", () => {
    const m = clone(F.moment_clip_failed);
    const { container } = render(<MomentPlayer moment={m} variant="full" />);
    const pair = within(container).getByTestId("pair-card");
    expect(pair.textContent).toContain(COPY["s4.pair.none"][lang]);
    const lib = (m.pair as { library_clip: { title: { en: string; ur: string } } }).library_clip;
    expect(pair.textContent).toContain(lib.title[lang]);
    expect(pair.textContent).toContain(lang === "en" ? "From the library" : "لائبریری سے");
  });

  it("the full recording waits behind a tap, then mounts a preload=none player on the session's audio", () => {
    const m = clone(F.moment);
    const { container } = render(<MomentPlayer moment={m} variant="full" />);
    const link = within(container).getByTestId("full-recording");
    expect(within(link).queryByTestId("full-player")).toBeNull();
    expect(container.querySelectorAll(`audio[src="/api/portal/coachip/session/${m.session.session_id}/audio"]`)).toHaveLength(0);
    const open = within(link).getByRole("button", { name: new RegExp(lang === "en" ? "Open the full recording" : "پوری ریکارڈنگ کھولیں") });
    expect(open.textContent).toContain("27:40");
    fireEvent.click(open);
    const full = within(link).getByTestId("full-player");
    const a = full.querySelector("audio")!;
    expect(a.getAttribute("src")).toBe(`/api/portal/coachip/session/${m.session.session_id}/audio`);
    expect(a.getAttribute("preload")).toBe("none");
    expect(link.textContent).toContain(COPY["s4.full.hint"][lang]);
    expect(play).not.toHaveBeenCalled();
  });

  it("offline before play: says the clip needs a connection", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const { container } = render(<MomentPlayer moment={clone(F.moment)} variant="inline" />);
    expect(within(container).getByTestId("moment-offline").textContent).toBe(COPY["s4.offline"][lang]);
  });

  it("inline: the kit player, the opens-at line, the clock and the strip only", () => {
    const { container } = render(<MomentPlayer moment={clone(F.moment)} variant="inline" />);
    expect(container.querySelectorAll("audio")).toHaveLength(1);
    expect(within(container).getByTestId("moment-slot")).toBeTruthy();
    expect(within(container).queryByTestId("gloss")).toBeNull();
    expect(within(container).queryByTestId("pair-card")).toBeNull();
    expect(within(container).queryByTestId("full-recording")).toBeNull();
    expect(within(container).queryByTestId("moment-question")).toBeNull();
    expect(segments(container)).toHaveLength(5);
  });

  it("the DOM contract: no bare digit outside a marked node; no middle dot beside an Urdu digit", () => {
    const { container } = render(<MomentPlayer moment={clone(F.moment)} variant="full" onSeeMove={() => undefined} />);
    fireEvent.click(within(container).getByTestId("full-recording").querySelector("button")!);
    const c = domContract(container);
    expect({ bare: c.bareDigits, nums: c.nums - c.numsWithDenWin }).toEqual({ bare: [], nums: 0 });
    expect(/·\s*[۰-۹]|[۰-۹]\s*·/.test(container.textContent || "")).toBe(false);
  });
});
