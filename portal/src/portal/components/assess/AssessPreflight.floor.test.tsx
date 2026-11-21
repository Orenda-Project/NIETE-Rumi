import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// sa_r28_mic_unknown (floor): the pre-flight's "I heard it" proves a level. It is offered only when the meter's peak is
// above 0.01 (unrounded; silence is one 8-bit step, 1/128 ≈ 0.0078, which the old 2-dp store wrote as 0.01). The peak
// is stored to 4 dp. A phone with no meter passes on "I heard it" alone, stored with mic_rms null, how 'unmeasured'.
// Off: today's card (the 2-dp store, "I heard it" whatever the meter read).

import AssessPreflight from "./AssessPreflight";
import { COPY } from "../../lib/assess/copy";

const working = () => Object.defineProperty(navigator, "mediaDevices", {
  configurable: true, value: { getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }) },
});
/** An analyser whose 8-bit samples sit `step` above the midline: RMS = step / 128. */
const meter = (step: number) => {
  (window as any).AudioContext = class {
    state = "running";
    close() { return Promise.resolve(); }
    resume() { return Promise.resolve(); }
    createMediaStreamSource() { return { connect: () => {} }; }
    createAnalyser() { return { fftSize: 1024, getByteTimeDomainData: (b: Uint8Array) => b.fill(128 + step) }; }
  };
};

function setup(floor: boolean) {
  const onMic = vi.fn();
  render(<AssessPreflight copy={COPY.en} onMic={onMic} onReady={vi.fn()} floor={floor} />);
  fireEvent.click(screen.getByRole("button", { name: /Check the microphone/ }));
  return { onMic };
}

afterEach(() => { delete (navigator as any).mediaDevices; delete (window as any).AudioContext; });

describe("AssessPreflight with sa_r28_mic_unknown", () => {
  it("M8: silence (one 8-bit step) offers no 'I heard it'; it says no sound came through, and Try again", async () => {
    working(); meter(1);
    setup(true);
    expect(await screen.findByTestId("assess-mic-none", {}, { timeout: 4000 })).toHaveTextContent("No sound came through.");
    expect(screen.queryByRole("button", { name: "I heard it" })).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("a level above the floor: 'I heard it' passes, the peak stored to 4 dp with how auto", async () => {
    working(); meter(13); // 13/128 = 0.1016
    const { onMic } = setup(true);
    fireEvent.click(await screen.findByRole("button", { name: "I heard it" }, { timeout: 4000 }));
    expect(onMic).toHaveBeenLastCalledWith(expect.objectContaining({ mic_ok: true, mic_rms: 0.1016, how: "auto" }));
  });

  it("no meter on this phone: 'I heard it' alone passes, stored unmeasured", async () => {
    working();
    const { onMic } = setup(true);
    fireEvent.click(await screen.findByRole("button", { name: "I heard it" }, { timeout: 4000 }));
    expect(onMic).toHaveBeenLastCalledWith(expect.objectContaining({ mic_ok: true, mic_rms: null, how: "unmeasured" }));
  });

  it("OFF-identity: silence still offers 'I heard it' and stores 2 dp, as today", async () => {
    working(); meter(1);
    const { onMic } = setup(false);
    fireEvent.click(await screen.findByRole("button", { name: "I heard it" }, { timeout: 4000 }));
    expect(onMic).toHaveBeenLastCalledWith({ mic_ok: true, mic_rms: 0.01, at: expect.any(Number) });
  });
});

describe("M9 (b): the pre-flight's write keeps one level per browser", () => {
  it("ON (oneLevel): the engine's older sa:mic_rms is removed with the new check", async () => {
    const { saveMic } = await import("../../lib/assess/visitStore");
    window.localStorage.setItem("sa:mic_rms", "0.0056");
    saveMic({ mic_ok: true, mic_rms: 0.31, at: 1, how: "auto" }, true);
    expect(window.localStorage.getItem("sa:mic_rms")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem("sa:mic_ok") as string)).toMatchObject({ mic_ok: true, mic_rms: 0.31 });
  });
  it("OFF-identity: the game's sa:mic_rms is left as today", async () => {
    const { saveMic } = await import("../../lib/assess/visitStore");
    window.localStorage.setItem("sa:mic_rms", "0.08");
    saveMic({ mic_ok: true, mic_rms: 0.31, at: 1 });
    expect(window.localStorage.getItem("sa:mic_rms")).toBe("0.08");
  });
});
