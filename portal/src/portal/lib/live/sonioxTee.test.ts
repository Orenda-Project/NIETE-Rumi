import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSonioxTee } from "./sonioxTee";

// bd-v0toag.31 — the second reader of each recorded chunk: a Soniox real-time stream for live moves.
// It only reads; a stream that drops, stalls or is refused never touches the recording.

class FakeWS {
  static instances: FakeWS[] = [];
  sent: unknown[] = [];
  bufferedAmount = 0;
  throwOnSend = false;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeWS.instances.push(this); }
  send(d: unknown) { if (this.throwOnSend) throw new Error("socket gone"); this.sent.push(d); }
  close() { this.closed = true; }
  open() { this.onopen?.(); }
  tokens(tokens: Array<{ text: string; is_final: boolean; start_ms?: number }>) {
    this.onmessage?.({ data: JSON.stringify({ tokens }) });
  }
  drop() { this.onclose?.({ code: 1006 }); }
}

const KEY = { ok: true, api_key: "temp-key-1", ws: "wss://stt-rt.soniox.com/transcribe-websocket", model: "stt-rt-v5" };
const blob = (text: string) => new Blob([text]);
const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

let clock = 0;
const now = () => clock;

beforeEach(() => {
  FakeWS.instances = [];
  clock = 1_000_000;
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });

function make(getKey = vi.fn().mockResolvedValue(KEY)) {
  const tee = createSonioxTee({ getKey, lang: "ur", WebSocketImpl: FakeWS as unknown as typeof WebSocket, now });
  return { tee, getKey };
}

describe("createSonioxTee", () => {
  it("first message carries key and model, not URL", async () => {
    make();
    await flush();
    const ws = FakeWS.instances[0];
    expect(ws.url).toBe(KEY.ws);
    expect(ws.url).not.toContain("temp-key-1");
    ws.open();
    expect(JSON.parse(ws.sent[0] as string)).toEqual({
      api_key: "temp-key-1", model: "stt-rt-v5", audio_format: "auto", language_hints: ["ur", "en"],
    });
  });

  it("final tokens build windowText; non-final replaced", async () => {
    const { tee } = make();
    await flush();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.tokens([{ text: "Open", is_final: true, start_ms: 0 }, { text: " your", is_final: false }]);
    ws.tokens([{ text: " books", is_final: false }, { text: "<fin>", is_final: true }]);
    expect(tee.windowText()).toBe("Open books");
    clock += 200_000;
    ws.tokens([{ text: " page", is_final: true, start_ms: 9_000 }, { text: "<end>", is_final: true }]);
    expect(tee.windowText()).toBe(" page");
    expect(tee.windowText(400_000)).toBe("Open page");
  });

  it("reconnect re-sends chunk 0 then live chunks", async () => {
    const { tee, getKey } = make();
    await flush();
    const first = FakeWS.instances[0];
    first.open();
    tee.push(blob("HDR"), 0);
    tee.push(blob("c1"), 1);
    expect(tee.status()).toBe("live");

    first.drop();
    expect(tee.status()).toBe("paused");
    expect(tee.stats().drops).toBe(1);
    tee.push(blob("c2"), 2);                          // the gap: not queued
    expect(FakeWS.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(getKey).toHaveBeenCalledTimes(2);          // a fresh key per stream
    const second = FakeWS.instances[1];
    second.open();
    expect(tee.status()).toBe("live");
    tee.push(blob("c3"), 3);
    expect(second.sent.slice(1)).toEqual([expect.any(Blob), expect.any(Blob)]);
    expect(second.sent.slice(1).map((b) => (b as Blob).size)).toEqual([3, 2]);
    expect(tee.stats().bytesSent).toBe(3 + 2 + 3 + 2);
  });

  it("backs off 5 s, 15 s, 30 s, then every 60 s", async () => {
    const getKey = vi.fn().mockResolvedValueOnce(KEY).mockResolvedValue({ ok: false, reason: "soniox" });
    make(getKey);
    await flush();
    FakeWS.instances[0].open();
    FakeWS.instances[0].drop();
    for (const [wait, calls] of [[4_999, 1], [1, 2], [15_000, 3], [30_000, 4], [60_000, 5], [60_000, 6]]) {
      await vi.advanceTimersByTimeAsync(wait);
      expect(getKey).toHaveBeenCalledTimes(calls);
    }
  });

  it.each(["cap", "off"])("cap refusal → off, no retries (reason %s — the kill switch stops it too)", async (reason) => {
    const getKey = vi.fn().mockResolvedValue({ ok: false, reason });
    const { tee } = make(getKey);
    await flush();
    expect(tee.status()).toBe("off");
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(getKey).toHaveBeenCalledTimes(1);
    expect(FakeWS.instances).toHaveLength(0);
    expect(() => tee.push(blob("a"), 0)).not.toThrow();
  });

  it("push never throws when socket throws", async () => {
    const { tee } = make();
    await flush();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.throwOnSend = true;
    expect(() => tee.push(blob("a"), 0)).not.toThrow();
    expect(() => tee.push(null as unknown as Blob, 1)).not.toThrow();
  });

  it("backlog over 64 KB skips chunks", async () => {
    const { tee } = make();
    await flush();
    const ws = FakeWS.instances[0];
    ws.open();
    tee.push(blob("HDR"), 0);
    ws.bufferedAmount = 64 * 1024 + 1;
    tee.push(blob("c1"), 1);
    ws.bufferedAmount = 0;
    tee.push(blob("c2"), 2);
    expect(ws.sent.slice(1).map((b) => (b as Blob).size)).toEqual([3, 2]);
    expect(tee.status()).toBe("live");
  });

  it("close stops the stream and every retry", async () => {
    const { tee, getKey } = make();
    await flush();
    const ws = FakeWS.instances[0];
    ws.open();
    tee.close();
    expect(ws.closed).toBe(true);
    expect(tee.status()).toBe("off");
    ws.drop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(getKey).toHaveBeenCalledTimes(1);
    expect(tee.stats().drops).toBe(0);
  });
});
