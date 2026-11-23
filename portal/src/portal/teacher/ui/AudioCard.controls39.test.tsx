import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import i18n from "i18next";
import { AudioCard, PLAYBACK_RATES, SPEED_KEY } from "./AudioCard";

/**
 * bd-o15qnr.39 (queue #204; the operator 22 Nov ~00:47-00:48: "both these audios should be skippable and 2x able" — skip
 * means jump AHEAD anywhere) — the class and debrief recordings play in place with `controls`: a bar she can drag to any
 * point, back and forward 10 s, and the speed (1x / 1.5x / 2x) kept between plays and between the two players. The plain
 * AudioCard (no `controls`) stays exactly as it was: one play button, nothing fetched before the tap.
 */

function stubMedia(el: HTMLAudioElement, duration = 600) {
  let t = 0;
  Object.defineProperty(el, "duration", { configurable: true, get: () => duration });
  Object.defineProperty(el, "currentTime", { configurable: true, get: () => t, set: (v: number) => { t = v; el.dispatchEvent(new Event("timeupdate")); } });
  el.play = vi.fn(async () => { el.dispatchEvent(new Event("play")); });
  el.pause = vi.fn(() => { el.dispatchEvent(new Event("pause")); });
  return { now: () => t };
}

const audioEl = () => document.querySelector("audio") as HTMLAudioElement;

beforeEach(async () => {
  try { window.localStorage.removeItem(SPEED_KEY); } catch { /* none */ }
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("AudioCard controls (bd-o15qnr.39)", () => {
  it("plain: one play button, no bar, nothing fetched before the tap", () => {
    render(<AudioCard title="Class recording" src="https://r2/x.webm" />);
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByRole("button", { name: /10 s/ })).toBeNull();
    expect(audioEl().getAttribute("preload")).toBe("none");
  });

  it("the bar: once the length is known she can drag to any point, and the times show", () => {
    render(<AudioCard title="Class recording" src="https://r2/x.webm" controls />);
    const el = audioEl();
    const m = stubMedia(el, 600);
    act(() => { el.dispatchEvent(new Event("loadedmetadata")); });
    const bar = screen.getByRole("slider", { name: "Position" });
    expect(bar).not.toBeDisabled();
    expect(bar).toHaveAttribute("max", "600");
    fireEvent.change(bar, { target: { value: "425" } });
    expect(m.now()).toBe(425);
    expect(screen.getByTestId("audio-time")).toHaveTextContent("7:05");
    expect(screen.getByTestId("audio-length")).toHaveTextContent("10:00");
  });

  it("forward and back 10 s, never past either end", () => {
    render(<AudioCard title="Debrief recording" src="https://r2/t.webm" controls />);
    const el = audioEl();
    const m = stubMedia(el, 25);
    act(() => { el.dispatchEvent(new Event("loadedmetadata")); });
    const fwd = screen.getByRole("button", { name: "Forward 10 s" });
    const back = screen.getByRole("button", { name: "Back 10 s" });
    fireEvent.click(fwd); expect(m.now()).toBe(10);
    fireEvent.click(fwd); fireEvent.click(fwd); expect(m.now()).toBe(25);
    fireEvent.click(back); expect(m.now()).toBe(15);
    fireEvent.click(back); fireEvent.click(back); expect(m.now()).toBe(0);
  });

  // bd-o15qnr.40.2 (queue #229, the operator 23 Nov: "speeds incl. 2x and add 4x"): 4× after 2×, then back to 1×.
  it("speed: 1× → 1.5× → 2× → 4× → 1×, applied to the audio and kept for the next player", () => {
    expect(PLAYBACK_RATES).toEqual([1, 1.5, 2, 4]);
    const { unmount } = render(<AudioCard title="Class recording" src="https://r2/x.webm" controls />);
    const speed = screen.getByRole("button", { name: /speed/i });
    expect(speed).toHaveTextContent("1×");
    fireEvent.click(speed);
    expect(speed).toHaveTextContent("1.5×");
    expect(audioEl().playbackRate).toBe(1.5);
    fireEvent.click(speed);
    expect(speed).toHaveTextContent("2×");
    expect(audioEl().playbackRate).toBe(2);
    unmount();
    render(<AudioCard title="Debrief recording" src="https://r2/t.webm" controls />);
    expect(screen.getByRole("button", { name: /speed/i })).toHaveTextContent("2×");
    expect(audioEl().playbackRate).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: /speed/i }));
    expect(screen.getByRole("button", { name: /speed/i })).toHaveTextContent("4×");
    expect(audioEl().playbackRate).toBe(4);
    fireEvent.click(screen.getByRole("button", { name: /speed/i }));
    expect(screen.getByRole("button", { name: /speed/i })).toHaveTextContent("1×");
  });

  it("a recording whose length the phone reports as Infinity is still seekable once the real length is read", () => {
    render(<AudioCard title="Class recording" src="https://r2/x.webm" controls />);
    const el = audioEl();
    let dur = Infinity;
    let t = 0;
    Object.defineProperty(el, "duration", { configurable: true, get: () => dur });
    Object.defineProperty(el, "currentTime", { configurable: true, get: () => t, set: (v: number) => { t = v; } });
    act(() => { el.dispatchEvent(new Event("loadedmetadata")); });
    expect(t).toBeGreaterThan(1e6); // asked to read to the end
    dur = 300;
    act(() => { el.dispatchEvent(new Event("durationchange")); });
    expect(t).toBe(0);
    expect(screen.getByRole("slider", { name: "Position" })).toHaveAttribute("max", "300");
  });

  it("Urdu: the controls' words are Urdu; the times stay left to right", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    render(<AudioCard title="ریکارڈنگ" src="https://r2/x.webm" controls />);
    expect(screen.getByRole("button", { name: "10 سیکنڈ آگے" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "10 سیکنڈ پیچھے" })).toBeInTheDocument();
    expect(screen.getByTestId("audio-time").getAttribute("dir")).toBe("ltr");
  });
});
