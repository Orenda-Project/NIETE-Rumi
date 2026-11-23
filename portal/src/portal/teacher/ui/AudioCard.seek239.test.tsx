import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import i18n from "i18next";
import { AudioCard, SPEED_KEY } from "./AudioCard";
import { nearItsEnd, sameRecording } from "./signedLink";

/**
 * bd-r24965 (queue #239; the operator 23 Nov ~19:35: "if I click like 50% of the way ahead, it breaks and does not play
 * the recording ... it goes back to 0:00 and does not play"). The visit page asks for the observation again every 10 s
 * while the Digital Coach works (and whenever the tab comes back), and every answer carries a NEWLY SIGNED link to the
 * same recording. A new `src` makes the browser load the file again: position 0, paused, and no "pause" event, so the
 * round button kept saying Pause and a tap on it only paused a paused player. The player now keeps the link it is
 * playing for as long as the page hands it the same recording, starts over only for a different one, never shows a
 * stuck Pause, picks up the newest link where it was if its own link has expired, and keeps a seek made before the
 * length is known (or while an Infinity-long recording is being measured) instead of sending her back to 0:00.
 */

const SIGNED = (sig: string, key = "classroom_audio/u/2026-11/portal_x.m4a") =>
  `https://acct.r2.cloudflarestorage.com/digital-coach-audio/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=k%2F20261123%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20261123T1406${sig}Z&X-Amz-Expires=3600&X-Amz-Signature=${sig}abc&X-Amz-SignedHeaders=host&x-id=GetObject`;

function stubMedia(el: HTMLAudioElement, duration = 600) {
  let t = 0;
  let paused = true;
  Object.defineProperty(el, "duration", { configurable: true, get: () => duration });
  Object.defineProperty(el, "paused", { configurable: true, get: () => paused });
  Object.defineProperty(el, "currentTime", { configurable: true, get: () => t, set: (v: number) => { t = v; el.dispatchEvent(new Event("timeupdate")); } });
  el.play = vi.fn(async () => { paused = false; el.dispatchEvent(new Event("play")); });
  el.pause = vi.fn(() => { if (paused) return; paused = true; el.dispatchEvent(new Event("pause")); });
  return { now: () => t, isPaused: () => paused, setDuration: (d: number) => { duration = d; } };
}

const audioEl = () => document.querySelector("audio") as HTMLAudioElement;
const roundButton = () => screen.getByRole("button", { name: /^(Play|Pause)$/ });

beforeEach(async () => {
  try { window.localStorage.removeItem(SPEED_KEY); } catch { /* none */ }
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("sameRecording (bd-r24965)", () => {
  it("a newly signed link to the same file is the same recording; another file, a blob or a plain link is not", () => {
    expect(sameRecording(SIGNED("01"), SIGNED("02"))).toBe(true);
    expect(sameRecording(SIGNED("01"), SIGNED("01"))).toBe(true);
    expect(sameRecording(SIGNED("01"), SIGNED("02", "classroom_audio/u/2026-11/portal_y.m4a"))).toBe(false);
    expect(sameRecording("blob:https://portal/1", "blob:https://portal/2")).toBe(false);
    expect(sameRecording("https://cdn/a.mp3?v=1", "https://cdn/a.mp3?v=2")).toBe(false); // not a signed link: may differ
    expect(sameRecording(undefined, SIGNED("01"))).toBe(false);
  });

  it("nearItsEnd: a signed link within two minutes of the end it was signed for; never a link with no end", () => {
    expect(nearItsEnd(SIGNED("01"), Date.parse("2026-11-23T15:00:00Z"))).toBe(false); // signed 14:06:01 for an hour
    expect(nearItsEnd(SIGNED("01"), Date.parse("2026-11-23T15:04:30Z"))).toBe(true);
    expect(nearItsEnd(SIGNED("01"), Date.parse("2026-11-23T16:00:00Z"))).toBe(true);
    expect(nearItsEnd("blob:https://portal/1")).toBe(false);
    expect(nearItsEnd("https://cdn/a.mp3")).toBe(false);
  });
});

describe("AudioCard: the page's re-read never resets the player (bd-r24965)", () => {
  for (const controls of [true, false]) {
    const kind = controls ? "full player" : "plain card";

    it(`${kind}: a freshly signed link to the same recording keeps it playing where she is`, async () => {
      const { rerender } = render(<AudioCard title="Class recording" src={SIGNED("01")} controls={controls} />);
      const el = audioEl();
      const m = stubMedia(el, 1698);
      act(() => { el.dispatchEvent(new Event("loadedmetadata")); });
      await act(async () => { fireEvent.click(roundButton()); });
      if (controls) fireEvent.change(screen.getByRole("slider", { name: "Position" }), { target: { value: "849" } });
      else act(() => { el.currentTime = 849; });
      rerender(<AudioCard title="Class recording" src={SIGNED("02")} controls={controls} />);
      expect(audioEl()).toBe(el);
      expect(el.getAttribute("src")).toBe(SIGNED("01"));
      expect(m.now()).toBe(849);
      expect(roundButton()).toHaveAccessibleName("Pause");
      if (controls) expect(screen.getByTestId("audio-time")).toHaveTextContent("14:09");
    });

    it(`${kind}: a different recording starts over and shows Play, never a stuck Pause`, async () => {
      const { rerender } = render(<AudioCard title="Class recording" src={SIGNED("01")} controls={controls} />);
      const el = audioEl();
      stubMedia(el, 600);
      act(() => { el.dispatchEvent(new Event("loadedmetadata")); });
      await act(async () => { fireEvent.click(roundButton()); });
      expect(roundButton()).toHaveAccessibleName("Pause");
      rerender(<AudioCard title="Class recording" src={SIGNED("02", "classroom_audio/u/2026-11/portal_y.m4a")} controls={controls} />);
      expect(audioEl().getAttribute("src")).toBe(SIGNED("02", "classroom_audio/u/2026-11/portal_y.m4a"));
      expect(roundButton()).toHaveAccessibleName("Play");
      if (controls) expect(screen.getByTestId("audio-time")).toHaveTextContent("0:00");
    });

    it(`${kind}: whenever the browser empties the player under her, the button says Play (a tap plays again)`, async () => {
      render(<AudioCard title="Class recording" src={SIGNED("01")} controls={controls} />);
      const el = audioEl();
      const m = stubMedia(el, 600);
      act(() => { el.dispatchEvent(new Event("loadedmetadata")); });
      await act(async () => { fireEvent.click(roundButton()); });
      act(() => { el.dispatchEvent(new Event("emptied")); });
      expect(roundButton()).toHaveAccessibleName("Play");
      await act(async () => { fireEvent.click(roundButton()); });
      expect(el.play).toHaveBeenCalledTimes(2);
      expect(m.isPaused()).toBe(false);
    });
  }

  it("her link expired while the page was open: the newest link takes over at the same point and keeps playing", async () => {
    const { rerender } = render(<AudioCard title="Class recording" src={SIGNED("01")} controls />);
    const el = audioEl();
    const m = stubMedia(el, 1698);
    act(() => { el.dispatchEvent(new Event("loadedmetadata")); });
    await act(async () => { fireEvent.click(roundButton()); });
    fireEvent.change(screen.getByRole("slider", { name: "Position" }), { target: { value: "1528" } });
    rerender(<AudioCard title="Class recording" src={SIGNED("02")} controls />);
    expect(el.getAttribute("src")).toBe(SIGNED("01"));
    // R2 refuses the old link (403) on the next range request: the media element errors.
    act(() => { el.dispatchEvent(new Event("error")); });
    expect(el.getAttribute("src")).toBe(SIGNED("02"));
    act(() => { m.setDuration(1698); el.dispatchEvent(new Event("loadedmetadata")); });
    expect(m.now()).toBe(1528);
    expect(el.play).toHaveBeenCalledTimes(2);
    expect(roundButton()).toHaveAccessibleName("Pause");
  });

  // Chrome never fires "error" for the expired link: R2's 403 is XML, which Chrome's ORB blocks, and the player only
  // stalls (seen in Chromium 149 on a 40 s link). So the player checks the link's own end before it relies on it.
  it("her link is at its end and she seeks: the newest link takes over at the point she asked, still playing", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-23T15:05:30Z")); // SIGNED("01") ends 15:06:01
    try {
      const { rerender } = render(<AudioCard title="Class recording" src={SIGNED("01")} controls />);
      const el = audioEl();
      const m = stubMedia(el, 1698);
      act(() => { el.dispatchEvent(new Event("loadedmetadata")); });
      await act(async () => { fireEvent.click(roundButton()); });
      rerender(<AudioCard title="Class recording" src={SIGNED("02")} controls />);
      fireEvent.change(screen.getByRole("slider", { name: "Position" }), { target: { value: "1528" } });
      expect(el.getAttribute("src")).toBe(SIGNED("02"));
      expect(screen.getByTestId("audio-time")).toHaveTextContent("25:28");
      act(() => { el.dispatchEvent(new Event("loadedmetadata")); });
      expect(m.now()).toBe(1528);
      expect(el.play).toHaveBeenCalledTimes(2);
    } finally { now.mockRestore(); }
  });

  it("her link ran out while it played and the player stalls: the newest link takes over where she was", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-23T14:30:00Z"));
    try {
      const { rerender } = render(<AudioCard title="Class recording" src={SIGNED("01")} controls />);
      const el = audioEl();
      const m = stubMedia(el, 1698);
      act(() => { el.dispatchEvent(new Event("loadedmetadata")); });
      await act(async () => { fireEvent.click(roundButton()); });
      act(() => { el.currentTime = 700; });
      rerender(<AudioCard title="Class recording" src={SIGNED("02")} controls />);
      act(() => { el.dispatchEvent(new Event("waiting")); });
      expect(el.getAttribute("src")).toBe(SIGNED("01")); // a wait on a live link is only the network
      now.mockReturnValue(Date.parse("2026-11-23T15:07:00Z"));
      act(() => { el.dispatchEvent(new Event("waiting")); });
      expect(el.getAttribute("src")).toBe(SIGNED("02"));
      act(() => { el.dispatchEvent(new Event("loadedmetadata")); });
      expect(m.now()).toBe(700);
      expect(el.play).toHaveBeenCalledTimes(2);
    } finally { now.mockRestore(); }
  });

  it("a seek before the length is known waits for it, then lands where she asked", () => {
    render(<AudioCard title="Class recording" src={SIGNED("01")} controls />);
    const el = audioEl();
    let t = 0;
    let dur = NaN;
    Object.defineProperty(el, "duration", { configurable: true, get: () => dur });
    Object.defineProperty(el, "currentTime", { configurable: true, get: () => t, set: (v: number) => { t = v; } });
    fireEvent.click(screen.getByRole("button", { name: "Forward 10 s" }));
    fireEvent.click(screen.getByRole("button", { name: "Forward 10 s" }));
    expect(t).toBe(0); // nothing asked of a player that has not read the file yet
    dur = 600;
    act(() => { el.dispatchEvent(new Event("loadedmetadata")); });
    expect(t).toBe(20);
    expect(screen.getByTestId("audio-time")).toHaveTextContent("0:20");
  });

  it("an Infinity-long recording being measured never sends her back to 0:00 if she moved meanwhile", () => {
    render(<AudioCard title="Class recording" src={SIGNED("01", "classroom_audio/u/2026-11/portal_x.webm")} controls />);
    const el = audioEl();
    let dur = Infinity;
    let t = 0;
    Object.defineProperty(el, "duration", { configurable: true, get: () => dur });
    Object.defineProperty(el, "currentTime", { configurable: true, get: () => t, set: (v: number) => { t = v; } });
    act(() => { el.dispatchEvent(new Event("loadedmetadata")); });
    expect(t).toBeGreaterThan(1e6); // reading to the end to learn the length
    fireEvent.click(screen.getByRole("button", { name: "Forward 10 s" }));
    fireEvent.click(screen.getByRole("button", { name: "Forward 10 s" }));
    fireEvent.click(screen.getByRole("button", { name: "Forward 10 s" }));
    expect(t).toBeGreaterThan(1e6); // the measuring seek is left alone
    dur = 300;
    act(() => { el.dispatchEvent(new Event("durationchange")); });
    expect(t).toBe(30);
    expect(screen.getByTestId("audio-time")).toHaveTextContent("0:30");
  });
});
