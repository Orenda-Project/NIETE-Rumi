import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { LiveCard } from "../../services/api";
import type { RecordingSession } from "../../lib/recordingSession";
import type { Plan } from "./useSendFlow";

// bd-v0toag.31 — the hook that ties the live path together: the card for her picked lesson, the Soniox tee
// on the recorder's chunks, a detect call every 60 s, and the record that goes with the lesson when sent.
// It only reads: a refusal, a failed detect or a missing card never touches the recording.

const api = vi.hoisted(() => ({
  liveCard: vi.fn(), liveKey: vi.fn(), liveDetect: vi.fn(), liveEnd: vi.fn(),
}));
vi.mock("../../services/api", () => ({ default: {}, portal: api }));

const tee = vi.hoisted(() => ({
  push: vi.fn(), windowText: vi.fn(() => "open your books"), status: vi.fn(() => "live"),
  stats: vi.fn(() => ({ drops: 1, bytesSent: 2048 })), close: vi.fn(),
  opts: null as null | { getKey: () => Promise<unknown>; lang: string },
}));
vi.mock("../../lib/live/sonioxTee", () => ({
  createSonioxTee: vi.fn((o) => { tee.opts = o; return tee; }),
}));

import { createSonioxTee } from "../../lib/live/sonioxTee";
import { useLiveMoves, forgetLiveHold } from "./useLiveMoves";

const CARD: LiveCard = {
  lessonId: "g4-eng-ch12-seg1", stamp: "s1",
  sections: [
    { sec: "open", minutes: 5, moves: [
      { idx: 0, covers: ["m1"], chip: "HOOK", do: "Hold up the book", say: "What do you see?" },
      { idx: 1, covers: ["m2"], chip: "GOAL", do: "Say the goal", say: "Today we read." },
    ] },
    { sec: "we", minutes: 10, moves: [{ idx: 2, covers: ["m3"], chip: "TOGETHER", do: "Read together", say: "Read with me." }] },
  ],
};
const PICKED: Plan = { kind: "library", pick: { lessonId: "g4-eng-ch12-seg1" }, title: "Reading", chips: [] };

let listener: ((blob: Blob, seq: number, ms: number) => void) | null = null;
function fakeSession(over: Partial<RecordingSession> = {}): RecordingSession {
  return {
    active: true, paused: false, recordingId: "rec-1", elapsedMs: () => 7 * 60_000,
    setChunkListener: vi.fn((fn) => { listener = fn; }),
    ...over,
  } as unknown as RecordingSession;
}
const flush = async () => { await act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); }); };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  forgetLiveHold();
  listener = null;
  tee.status.mockReturnValue("live");
  api.liveCard.mockResolvedValue({ on: true, card: CARD });
  api.liveKey.mockResolvedValue({ ok: true, api_key: "k", ws: "wss://x", model: "m", expires_at: "" });
  api.liveDetect.mockResolvedValue({ ticked: [0] });
  api.liveEnd.mockResolvedValue({ ok: true });
});
afterEach(() => { vi.useRealTimers(); });

describe("useLiveMoves", () => {
  it("a picked grades 1-5 lesson: its card, every move to come, the stream live while recording", async () => {
    const session = fakeSession();
    const { result } = renderHook(() => useLiveMoves({ session, plan: PICKED, recording: true }));
    await flush();
    expect(api.liveCard).toHaveBeenCalledWith("g4-eng-ch12-seg1");
    expect(result.current.state?.moves.map((m) => m.idx)).toEqual([0, 1, 2]);
    expect(createSonioxTee).toHaveBeenCalledTimes(1);
    await tee.opts!.getKey();
    expect(api.liveKey).toHaveBeenCalledWith("rec-1");
    expect(result.current.status).toBe("live");
  });

  it("no card → no stream and no key request", async () => {
    api.liveCard.mockResolvedValue({ on: true });
    const session = fakeSession();
    const { result } = renderHook(() => useLiveMoves({ session, plan: PICKED, recording: true }));
    await flush();
    expect(result.current.state).toBeNull();
    expect(createSonioxTee).not.toHaveBeenCalled();
    expect(api.liveKey).not.toHaveBeenCalled();
    expect(session.setChunkListener).toHaveBeenLastCalledWith(null);   // chunk 0 was held only until the card said no
  });

  it("no plan, a file plan or a grades 6-12 plan → no card asked for", async () => {
    for (const plan of [null, { kind: "library", pick: { segmentId: "g7", lang: "ur" }, title: "x", chips: [] } as Plan]) {
      renderHook(() => useLiveMoves({ session: fakeSession(), plan, recording: true }));
    }
    await flush();
    expect(api.liveCard).not.toHaveBeenCalled();
  });

  it("a card that fails to load → nothing, and nothing thrown", async () => {
    api.liveCard.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useLiveMoves({ session: fakeSession(), plan: PICKED, recording: true }));
    await flush();
    expect(result.current.state).toBeNull();
  });

  it("chunk 0 that came before the card is still sent first", async () => {
    let resolveCard: (v: unknown) => void = () => {};
    api.liveCard.mockReturnValue(new Promise((r) => { resolveCard = r; }));
    const session = fakeSession();
    renderHook(() => useLiveMoves({ session, plan: PICKED, recording: true }));
    await flush();
    const hdr = new Blob(["HDR"]);
    listener!(hdr, 0, 0);
    resolveCard({ on: true, card: CARD });
    await flush();
    expect(tee.push).toHaveBeenCalledWith(hdr, 0);
    listener!(new Blob(["c1"]), 1, 1000);
    expect(tee.push).toHaveBeenCalledTimes(2);
  });

  it("every 60 s: detect on the window and the unticked moves, then the ticks", async () => {
    const { result } = renderHook(() => useLiveMoves({ session: fakeSession(), plan: PICKED, recording: true }));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(api.liveDetect).toHaveBeenCalledWith({
      liveId: "rec-1", lessonId: "g4-eng-ch12-seg1", window: "open your books", unticked: [0, 1, 2],
    });
    expect(result.current.state?.moves[0]).toMatchObject({ ticked: true, tickedAtMs: 7 * 60_000 });
    expect(result.current.now).toBe(1);
  });

  it("detect failure → status paused, recording continues", async () => {
    api.liveDetect.mockRejectedValueOnce(new Error("502"));
    const session = fakeSession();
    const { result } = renderHook(() => useLiveMoves({ session, plan: PICKED, recording: true }));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(result.current.status).toBe("paused");
    expect(() => listener!(new Blob(["c"]), 3, 1)).not.toThrow();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(result.current.status).toBe("live");
  });

  it("a stream turned off (cap) → status off, no detect calls", async () => {
    tee.status.mockReturnValue("off");
    const { result } = renderHook(() => useLiveMoves({ session: fakeSession(), plan: PICKED, recording: true }));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(result.current.status).toBe("off");
    expect(api.liveDetect).not.toHaveBeenCalled();
  });

  it("a tap is kept; toRecord carries ticks, taps and the stream's stats", async () => {
    const { result } = renderHook(() => useLiveMoves({ session: fakeSession(), plan: PICKED, recording: true }));
    await flush();
    act(() => { result.current.tap(2, "did"); });
    expect(result.current.state?.moves[2].lastTap).toBe("did");
    expect(result.current.toRecord()).toMatchObject({
      lessonId: "g4-eng-ch12-seg1", liveId: "rec-1", drops: 1, bytesSent: 2048,
      taps: [expect.objectContaining({ idx: 2, choice: "did", live_state: "unticked" })],
    });
  });

  it("no card → toRecord is null", async () => {
    api.liveCard.mockResolvedValue({ on: false });
    const { result } = renderHook(() => useLiveMoves({ session: fakeSession(), plan: PICKED, recording: true }));
    await flush();
    expect(result.current.toRecord()).toBeNull();
  });

  it("finish → the stream closes, the listener goes and the slot is given back once", async () => {
    const session = fakeSession();
    const { rerender } = renderHook((p: { recording: boolean }) => useLiveMoves({ session, plan: PICKED, recording: p.recording }), {
      initialProps: { recording: true },
    });
    await flush();
    rerender({ recording: false });
    await flush();
    expect(tee.close).toHaveBeenCalled();
    expect(session.setChunkListener).toHaveBeenLastCalledWith(null);
    expect(api.liveEnd).toHaveBeenCalledTimes(1);
    expect(api.liveEnd).toHaveBeenCalledWith({ liveId: "rec-1", drops: 1, bytesSent: 2048 });
  });

  it("finish clears the session's recording id → the slot is still given back and the record still goes", async () => {
    const live = fakeSession();
    const idle = fakeSession({ active: false, recordingId: null } as Partial<RecordingSession>);
    const { result, rerender } = renderHook((p: { s: RecordingSession; recording: boolean }) => useLiveMoves({ session: p.s, plan: PICKED, recording: p.recording }), {
      initialProps: { s: live, recording: true },
    });
    await flush();
    rerender({ s: idle, recording: false });
    await flush();
    expect(api.liveEnd).toHaveBeenCalledWith({ liveId: "rec-1", drops: 1, bytesSent: 2048 });
    expect(result.current.toRecord()).toMatchObject({ lessonId: "g4-eng-ch12-seg1", liveId: "rec-1", drops: 1 });
  });

  it("leaving the page while still recording keeps the ticks for her return, and does not end the slot", async () => {
    const session = fakeSession();
    const first = renderHook(() => useLiveMoves({ session, plan: PICKED, recording: true }));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    first.unmount();
    expect(tee.close).toHaveBeenCalled();
    expect(api.liveEnd).not.toHaveBeenCalled();
    const again = renderHook(() => useLiveMoves({ session, plan: PICKED, recording: true }));
    await flush();
    expect(again.result.current.state?.moves[0].ticked).toBe(true);
    expect(api.liveCard).toHaveBeenCalledTimes(1);
  });
});
