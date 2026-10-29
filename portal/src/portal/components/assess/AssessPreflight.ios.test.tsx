import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// The microphone check on an iPhone. iOS starts an AudioContext made outside a
// tap "suspended" (its meter then reads silence), and refuses to play a sound
// that no tap started (the play-back after the 2 s recording). With
// sa_r8_ios_mic (iosMic) the context is made inside the tap and resumed, and the
// recording can be played again by a tap. Every check reports what the phone
// did (mic-check telemetry), switch or not.

import AssessPreflight from "./AssessPreflight";
import { COPY } from "../../lib/assess/copy";

type Ctx = { state: string; resume: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; createAnalyser: () => unknown; createMediaStreamSource: () => unknown };
let made: { ctx: Ctx; order: number }[];
let order: number;
let gumOrder: number;
let resolveGum: (s: unknown) => void;
let played: string[];
let playRejects: boolean;
let sent: { url: string; body: any }[];

const track = { stop: vi.fn(), getSettings: () => ({ sampleRate: 48000, channelCount: 1, echoCancellation: true, autoGainControl: true, noiseSuppression: true, deviceId: "secret-device" }) };
const stream = { getTracks: () => [track], getAudioTracks: () => [track] };

class FakeAC {
  state = "suspended";
  resume = vi.fn(() => { this.state = "running"; return Promise.resolve(); });
  close = vi.fn(() => Promise.resolve());
  constructor() { made.push({ ctx: this as unknown as Ctx, order: (order += 1) }); }
  createAnalyser() { return { fftSize: 1024, getByteTimeDomainData: (b: Uint8Array) => b.fill(this.state === "running" ? 200 : 128) }; }
  createMediaStreamSource() { return { connect: () => {} }; }
}

class FakeRecorder {
  static isTypeSupported = (t: string) => t === "audio/mp4";
  state = "inactive";
  mimeType = "audio/mp4";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["x".repeat(3000)], { type: "audio/mp4" }) }); this.onstop?.(); }
}

beforeEach(() => {
  vi.useFakeTimers();
  made = []; order = 0; gumOrder = 0; played = []; playRejects = true; sent = [];
  (window as any).AudioContext = FakeAC;
  (globalThis as any).MediaRecorder = FakeRecorder;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
    getUserMedia: () => { gumOrder = (order += 1); return new Promise((r) => { resolveGum = r; }); },
  } });
  (URL as any).createObjectURL = () => "blob:rec-1";
  (URL as any).revokeObjectURL = () => {};
  (window as any).Audio = function Audio(this: any, src?: string) {
    this.src = src;
    this.play = () => { played.push(this.src); return playRejects ? Promise.reject(Object.assign(new Error("no gesture"), { name: "NotAllowedError" })) : Promise.resolve(); };
  };
  (globalThis as any).fetch = vi.fn((url: string, init: RequestInit) => { sent.push({ url, body: JSON.parse(String(init.body)) }); return Promise.resolve({ status: 204 }); });
});
afterEach(() => {
  vi.useRealTimers();
  delete (navigator as any).mediaDevices;
  delete (window as any).AudioContext;
  delete (globalThis as any).MediaRecorder;
});

function setup(iosMic: boolean) {
  render(<AssessPreflight copy={COPY.en} onMic={vi.fn()} onReady={vi.fn()} iosMic={iosMic} />);
}

async function record() {
  fireEvent.click(screen.getByRole("button", { name: /Check the microphone/ }));
  await act(async () => { resolveGum(stream); });
  await act(async () => { vi.advanceTimersByTime(2100); });
}

const reports = () => sent.filter((s) => /\/funnel\/mic-check$/.test(s.url)).map((s) => s.body);

describe("AssessPreflight on an iPhone, sa_r8_ios_mic on", () => {
  it("makes the AudioContext inside the tap, before the microphone answers, and resumes it", async () => {
    setup(true);
    await record();
    expect(made).toHaveLength(1);
    expect(made[0].order).toBeLessThan(gumOrder);
    expect(made[0].ctx.resume).toHaveBeenCalled();
    expect(Number(screen.queryByTestId("assess-mic-level")?.getAttribute("aria-valuenow") ?? 0)).toBeGreaterThanOrEqual(0);
  });

  it("the play-back the phone refused can be played by a tap", async () => {
    setup(true);
    await record();
    expect(played).toEqual(["blob:rec-1"]); // tried at once; iOS refuses it
    playRejects = false;
    fireEvent.click(screen.getByRole("button", { name: COPY.en.micPlayAgain }));
    expect(played).toEqual(["blob:rec-1", "blob:rec-1"]);
  });
});

describe("AssessPreflight with sa_r8_ios_mic off (today)", () => {
  it("the context is made after the microphone answers, and there is no play-again button", async () => {
    setup(false);
    await record();
    expect(made[0].order).toBeGreaterThan(gumOrder);
    expect(screen.queryByRole("button", { name: COPY.en.micPlayAgain })).toBeNull();
  });
});

describe("mic-check telemetry (no switch)", () => {
  it.each([false, true])("reports what the phone did, then the coach's answer (iosMic %s)", async (iosMic) => {
    setup(iosMic);
    await record();
    await act(async () => { await Promise.resolve(); });
    const probe = reports().find((r) => r.phase === "probe");
    expect(probe).toEqual(expect.objectContaining({
      mimeType: "audio/mp4", recorder: true, bytes: 3000, chunks: 1, play: "blocked", playError: "NotAllowedError",
      ctxStart: "suspended", sampleRate: 48000, channelCount: 1, echoCancellation: true, iosMic,
    }));
    expect(probe.ctxEnd).toBe(iosMic ? "running" : "suspended");
    expect(typeof probe.peak).toBe("number");
    expect(JSON.stringify(probe)).not.toMatch(/secret-device|blob:/);
    fireEvent.click(screen.getByRole("button", { name: COPY.en.tryAgain }));
    expect(reports().find((r) => r.phase === "answer")).toEqual(expect.objectContaining({ answer: "again" }));
  });

  it("a refused microphone reports the browser's reason", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      getUserMedia: () => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })),
    } });
    setup(false);
    fireEvent.click(screen.getByRole("button", { name: /Check the microphone/ }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(reports()).toEqual([expect.objectContaining({ phase: "probe", gum: "NotAllowedError", recorder: false, bytes: 0 })]);
  });
});
