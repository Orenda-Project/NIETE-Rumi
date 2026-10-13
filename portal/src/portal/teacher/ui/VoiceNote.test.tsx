import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VoiceNote } from "./VoiceNote";

/**
 * bd-fmf24g.2.3 — VoiceNote (COMPONENTS.md §7): a WhatsApp-style incoming voice note — the DC's ~90 s voice debrief.
 * With `src` it really plays (one note at a time); the waveform fills as it goes.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function play(this: HTMLMediaElement) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function pause(this: HTMLMediaElement) {
    this.dispatchEvent(new Event("pause"));
  });
});

describe("VoiceNote", () => {
  it("an incoming bubble: sender in the coach's orange, a 56px play, 28 bars, duration and time, the DC avatar with a green mic", () => {
    render(<VoiceNote from="Digital Coach" duration="1:30" time="11:06" src="/v.mp3" />);
    const bubble = screen.getByRole("group", { name: "Digital Coach, 1:30" });
    expect(classes(bubble)).toEqual(expect.arrayContaining(["bg-white", "rounded-[18px]", "rounded-es-[6px]"]));
    expect(screen.getByText("Digital Coach")).toHaveClass("text-[#c2410c]", "font-bold");
    const play = screen.getByRole("button", { name: "Play" });
    expect(classes(play)).toEqual(expect.arrayContaining(["h-14", "w-14"]));
    expect(screen.getAllByTestId("wave-bar")).toHaveLength(28);
    expect(screen.getByText("1:30")).toBeInTheDocument();
    expect(screen.getByText("11:06")).toBeInTheDocument();
    expect(screen.getByTestId("mic-badge")).toHaveClass("bg-[#2f7a52]");
    expect(bubble.querySelector("[data-glyph='coaching']")).not.toBeNull();
  });

  it("a person: indigo initials and an indigo name", () => {
    render(<VoiceNote from="Hataf" avatar="person" initials="HA" duration="0:45" time="9:10" />);
    expect(screen.getByText("HA")).toHaveClass("bg-[#33374a]", "text-white");
    expect(screen.getByText("Hataf")).toHaveClass("text-[#33374a]");
  });

  it("play plays its src (preload none) and turns to Pause; heard turns the mic blue", () => {
    const { container } = render(<VoiceNote from="Digital Coach" duration="1:30" time="11:06" src="/v.mp3" />);
    const audio = container.querySelector("audio")!;
    expect(audio).toHaveAttribute("src", "/v.mp3");
    expect(audio).toHaveAttribute("preload", "none");
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(screen.getByTestId("mic-badge")).toHaveClass("bg-[#3b82c4]");
  });

  it("the waveform fills with what has played", () => {
    const { container } = render(<VoiceNote from="Digital Coach" duration="1:40" time="11:06" src="/v.mp3" />);
    const audio = container.querySelector("audio")!;
    Object.defineProperty(audio, "duration", { value: 100, configurable: true });
    Object.defineProperty(audio, "currentTime", { value: 50, configurable: true, writable: true });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent(audio, new Event("timeupdate"));
    const played = screen.getAllByTestId("wave-bar").filter((b) => classes(b).includes("bg-[#2f7a52]"));
    expect(played).toHaveLength(14);
    expect(screen.getByText("0:50")).toBeInTheDocument();
  });

  it("only one voice note sounds at a time", () => {
    const { container } = render(<>
      <VoiceNote from="A" duration="1:00" time="1" src="/a.mp3" />
      <VoiceNote from="B" duration="1:00" time="2" src="/b.mp3" />
    </>);
    const [a, b] = Array.from(container.querySelectorAll("audio"));
    const [pa, pb] = screen.getAllByRole("button", { name: "Play" });
    fireEvent.click(pa);
    const pauseA = vi.spyOn(a, "pause");
    fireEvent.click(pb);
    expect(pauseA).toHaveBeenCalled();
    expect(b).toBeTruthy();
  });

  it("its words come from props (copy)", () => {
    render(<VoiceNote from="ڈیجیٹل کوچ" duration="1:30" time="11:06" src="/v.mp3" copy={{ play: "چلائیں" }} />);
    expect(screen.getByRole("button", { name: "چلائیں" })).toBeInTheDocument();
  });
});

/**
 * bd-phk3v4 — ICT feedback (IAB Experience View, row 8): in Urdu the voice note starts from the LEFT, as WhatsApp's
 * does — play on the left, the waveform filling left to right — while the sender's name stays in the page's
 * (right-aligned) direction.
 */
describe("VoiceNote in an Urdu page (bd-phk3v4)", () => {
  it("the player runs left to right; the name keeps the page direction", () => {
    const { container } = render(
      <div dir="rtl"><VoiceNote from="ڈیجیٹل کوچ" avatar="dc" duration="1:24" time="10:42" /></div>,
    );
    const play = screen.getByRole("button", { name: /play/i });
    const row = play.parentElement as HTMLElement;
    expect(row.getAttribute("dir")).toBe("ltr");
    expect(play.querySelector("svg")?.getAttribute("class") ?? "").not.toMatch(/scale-x/);
    const name = screen.getByText("ڈیجیٹل کوچ");
    expect(name.closest("[dir=ltr]")).toBeNull();
    expect(container.querySelector("[dir=rtl]")).toBeTruthy();
  });
});
