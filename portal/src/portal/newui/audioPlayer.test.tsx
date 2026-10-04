import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { AudioPlayer } from "./AudioPlayer";
import { tapProblems } from "./checks/rules";

/**
 * bd-5rz1v.26.4 — the kit's AudioPlayer, in place of the browser's own <audio controls> (Firefox
 * draws a dark bar that clashes with every new-UI screen).
 *
 *   look       a white card row (or the row alone inside a Panel): a 56px round play/pause
 *              button — green filled while it plays — then a progress track (green on the
 *              indigo-light track) that a tap or a drag seeks, then elapsed / total in tabular
 *              numbers. No volume: a phone has buttons for that.
 *   behaviour  RTL mirrors the track and the seek; Space plays and pauses; the arrows seek 5s in
 *              the reading direction, Home and End jump; it shows that it is loading; a file that
 *              will not play says "Can't play"; one kit player plays at a time.
 *
 * jsdom plays nothing: play/pause/load are stubbed and the media events are fired by hand, the
 * way a browser would fire them.
 */

class FakePointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

beforeAll(() => {
  if (!("PointerEvent" in window)) Object.defineProperty(window, "PointerEvent", { value: FakePointerEvent, configurable: true });
});

let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;
let load: ReturnType<typeof vi.fn>;

beforeEach(() => {
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn(function pauseStub(this: HTMLMediaElement) { this.dispatchEvent(new Event("pause")); });
  load = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play as unknown as () => Promise<void>);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause as unknown as () => void);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(load as unknown as () => void);
});

afterEach(() => { vi.restoreAllMocks(); });

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);

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

function setup(props: Partial<Parameters<typeof AudioPlayer>[0]> = {}, wrap?: (ui: React.ReactElement) => React.ReactElement) {
  const ui = <AudioPlayer src="https://r2/debrief.mp3" label="Digital Coach" {...props} />;
  const view = render(wrap ? wrap(ui) : ui);
  const root = screen.getByTestId("newui-audio");
  const audio = root.querySelector("audio") as HTMLAudioElement;
  const button = within(root).getByRole("button");
  const slider = within(root).getByRole("slider");
  const fire = (type: string) => act(() => { audio.dispatchEvent(new Event(type)); });
  return { ...view, root, audio, button, slider, fire };
}

const timeText = (root: HTMLElement) => within(root).getByTestId("newui-audio-time").textContent;
const fill = (root: HTMLElement) => within(root).getByTestId("newui-audio-fill");

describe("the look", () => {
  it("a white card row: a 56px round play button, the track, the time — no native controls, no volume", () => {
    const { root, audio, button } = setup({ durationHint: 296 });
    expect(audio).not.toHaveAttribute("controls");
    expect(audio.getAttribute("src")).toBe("https://r2/debrief.mp3");
    expect(classes(root)).toEqual(expect.arrayContaining(["rounded-2xl", "border-[1.5px]", "border-nu-surface-line", "bg-nu-surface-card"]));
    expect(button).toHaveAccessibleName("Play");
    expect(classes(button)).toEqual(expect.arrayContaining(["h-14", "w-14", "rounded-full"]));
    expect(root.querySelector("input[type=range]")).toBeNull();
    expect(within(root).queryByRole("button", { name: /volume|mute/i })).toBeNull();
    const time = within(root).getByTestId("newui-audio-time");
    expect(time).toHaveTextContent("00:00 / 04:56");
    expect(classes(time)).toContain("tabular-nums");
    // "1:23 / 4:56" reads the same way inside an Urdu page.
    expect(time).toHaveAttribute("dir", "ltr");
    expect(tapProblems(document.body)).toEqual([]);
  });

  it("the track: green on the indigo-light track, filled from the start side (it mirrors in Urdu)", () => {
    const { root } = setup({ durationHint: 100 });
    const track = within(root).getByTestId("newui-audio-track");
    expect(classes(track)).toContain("bg-nu-progress-track");
    expect(classes(fill(root))).toEqual(expect.arrayContaining(["bg-nu-progress", "start-0"]));
    expect(root.innerHTML).not.toMatch(/\b(left|right)-0\b/);
  });

  it("the seek bar itself is a 56px target", () => {
    const { slider } = setup({ durationHint: 100 });
    expect(classes(slider)).toEqual(expect.arrayContaining(["h-14"]));
    expect(slider).toHaveAttribute("tabindex", "0");
    expect(slider).toHaveAccessibleName("Digital Coach");
  });

  it("bare: the row alone, for inside a Panel (already a white card)", () => {
    const { root } = setup({ bare: true });
    expect(classes(root)).not.toContain("border-[1.5px]");
    expect(classes(root)).not.toContain("bg-nu-surface-card");
  });

  it("reads nothing before she taps play unless asked (her data)", () => {
    expect(setup().audio.getAttribute("preload")).toBe("none");
  });
});

describe("playing", () => {
  it("loading first, then the green Pause; Pause pauses it", async () => {
    const { root, button, fire } = setup({ durationHint: 296 });
    fireEvent.click(button);
    expect(play).toHaveBeenCalledTimes(1);
    // Loading: the spinner (turning only when motion is allowed) and aria-busy.
    expect(root).toHaveAttribute("aria-busy", "true");
    const spinner = button.querySelector("svg")!;
    expect(classes(spinner)).toContain("motion-safe:animate-spin");
    expect(classes(spinner)).not.toContain("animate-spin");

    fire("playing");
    expect(root).toHaveAttribute("aria-busy", "false");
    expect(button).toHaveAccessibleName("Pause");
    expect(classes(button)).toEqual(expect.arrayContaining(["bg-nu-button", "text-white"]));

    fireEvent.click(button);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(button).toHaveAccessibleName("Play");
    expect(classes(button)).not.toContain("bg-nu-button");
  });

  it("the time and the track follow the sound", () => {
    const { root, audio, slider, fire } = setup();
    const clock = media(audio, 120);
    fire("loadedmetadata");
    expect(timeText(root)).toBe("00:00 / 02:00");
    clock.at(30);
    expect(timeText(root)).toBe("00:30 / 02:00");
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "120");
    expect(slider).toHaveAttribute("aria-valuenow", "30");
    expect(slider).toHaveAttribute("aria-valuetext", "00:30 / 02:00");
    expect(fill(root).style.width).toBe("25%");
  });

  it("a recording the browser cannot measure (a recorder's webm says Infinity) uses the length it was given", () => {
    const { root, audio, fire } = setup({ durationHint: 1680 });
    media(audio, Infinity);
    fire("loadedmetadata");
    fire("durationchange");
    expect(timeText(root)).toBe("00:00 / 28:00");
  });

  it("no length at all: the total is — and the track does not seek", () => {
    const { root, audio, slider } = setup();
    const clock = media(audio, NaN);
    expect(timeText(root)).toBe("00:00 / —");
    expect(slider).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(clock.time).toBe(0);
  });

  it("when it ends, the button is Play again", () => {
    const { button, fire } = setup({ durationHint: 10 });
    fireEvent.click(button);
    fire("playing");
    fire("ended");
    expect(button).toHaveAccessibleName("Play");
  });
});

describe("seeking: a tap or a drag on the track", () => {
  function rectOf(el: Element, left: number, width: number) {
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ left, right: left + width, width, top: 0, bottom: 56, height: 56, x: left, y: 0, toJSON: () => ({}) } as DOMRect);
  }

  it("a tap goes to that point", () => {
    const { root, audio, slider } = setup();
    const clock = media(audio, 120);
    fireEvent(audio, new Event("loadedmetadata"));
    rectOf(within(root).getByTestId("newui-audio-track"), 100, 200);
    fireEvent.pointerDown(slider, { clientX: 150, pointerId: 1 });
    fireEvent.pointerUp(slider, { clientX: 150, pointerId: 1 });
    expect(clock.time).toBe(30);
  });

  it("a drag moves the fill with her finger, and seeks where she lets go", () => {
    const { root, audio, slider } = setup();
    const clock = media(audio, 120);
    fireEvent(audio, new Event("loadedmetadata"));
    rectOf(within(root).getByTestId("newui-audio-track"), 100, 200);
    fireEvent.pointerDown(slider, { clientX: 120, pointerId: 1 });
    fireEvent.pointerMove(slider, { clientX: 250, pointerId: 1 });
    expect(fill(root).style.width).toBe("75%");
    // The sound playing on does not pull the fill back while she drags.
    clock.at(5);
    expect(fill(root).style.width).toBe("75%");
    fireEvent.pointerUp(slider, { clientX: 250, pointerId: 1 });
    expect(clock.time).toBe(90);
  });

  it("in Urdu the track runs right to left: a tap near the right edge is near the start", () => {
    const { root, audio, slider } = setup({}, (ui) => <div dir="rtl">{ui}</div>);
    const clock = media(audio, 120);
    fireEvent(audio, new Event("loadedmetadata"));
    rectOf(within(root).getByTestId("newui-audio-track"), 100, 200);
    fireEvent.pointerDown(slider, { clientX: 250, pointerId: 1 });
    fireEvent.pointerUp(slider, { clientX: 250, pointerId: 1 });
    expect(clock.time).toBe(30);
  });
});

describe("the keyboard", () => {
  it("Space plays and pauses; the arrows seek 5 seconds; Home and End jump", () => {
    const { root, audio, slider, fire } = setup();
    const clock = media(audio, 120);
    fire("loadedmetadata");
    slider.focus();
    fireEvent.keyDown(slider, { key: " " });
    expect(play).toHaveBeenCalledTimes(1);
    fire("playing");
    fireEvent.keyDown(slider, { key: " " });
    expect(pause).toHaveBeenCalledTimes(1);

    clock.at(30);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(clock.time).toBe(35);
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(clock.time).toBe(30);
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(clock.time).toBe(35);
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(clock.time).toBe(30);
    fireEvent.keyDown(slider, { key: "End" });
    expect(clock.time).toBe(120);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(clock.time).toBe(120);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(clock.time).toBe(0);
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(clock.time).toBe(0);
    expect(timeText(root)).toBe("00:00 / 02:00");
  });

  it("in Urdu the left arrow goes forward (the reading direction)", () => {
    const { audio, slider, fire } = setup({}, (ui) => <div dir="rtl">{ui}</div>);
    const clock = media(audio, 120);
    fire("loadedmetadata");
    clock.at(30);
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(clock.time).toBe(35);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(clock.time).toBe(30);
  });
});

describe("a file that will not play", () => {
  it("says Can't play, as a short red chip; Play tries again", () => {
    const { root, button, fire } = setup();
    fire("error");
    const chip = within(root).getByText("Can't play").closest("[data-chip]")!;
    expect(classes(chip)).toContain("bg-nu-chip-error-bg");
    expect(button).toHaveAccessibleName("Play");
    fireEvent.click(button);
    expect(load).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("a refused play() is Can't play too; an interrupted one (Pause before it started) is not", async () => {
    play.mockImplementationOnce(() => Promise.reject(Object.assign(new Error("x"), { name: "NotSupportedError" })));
    const { root, button } = setup();
    await act(async () => { fireEvent.click(button); });
    expect(within(root).getByText("Can't play")).toBeInTheDocument();

    play.mockImplementationOnce(() => Promise.reject(Object.assign(new Error("x"), { name: "AbortError" })));
    const other = render(<AudioPlayer src="https://r2/b.mp3" label="Your recording" testId="second" />);
    await act(async () => { fireEvent.click(within(other.getByTestId("second")).getByRole("button")); });
    expect(within(other.getByTestId("second")).queryByText("Can't play")).toBeNull();
  });
});

describe("one at a time", () => {
  it("playing one kit player pauses the other", () => {
    render(
      <>
        <AudioPlayer src="https://r2/a.mp3" label="Digital Coach" testId="a" />
        <AudioPlayer src="https://r2/b.mp3" label="Your recording" testId="b" />
      </>,
    );
    const a = screen.getByTestId("a");
    const b = screen.getByTestId("b");
    const audioA = a.querySelector("audio")!;
    fireEvent.click(within(a).getByRole("button"));
    act(() => { audioA.dispatchEvent(new Event("play")); audioA.dispatchEvent(new Event("playing")); });
    expect(within(a).getByRole("button")).toHaveAccessibleName("Pause");

    fireEvent.click(within(b).getByRole("button"));
    act(() => { b.querySelector("audio")!.dispatchEvent(new Event("play")); });
    expect(pause.mock.contexts).toContain(audioA);
    expect(within(a).getByRole("button")).toHaveAccessibleName("Play");
  });
});
