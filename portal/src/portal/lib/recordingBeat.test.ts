import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecordingHeart, cutOf, encodeBatch, sendLeftoverBeats, COLUMNS, type BeatEnv } from "./recordingBeat";

/**
 * bd-ma9jiy (queue #262) — the heartbeat: a sample on every save (online, visible, focus, bytes, storage, battery,
 * network, recorder state, the save's answer), kept with the piece on the phone and sent in SMALL BATCHES (30 samples or
 * 30 s), never one request per second; held while offline; a cut (kill) is the time from the last sample to the reopen.
 */
function env(over: Partial<BeatEnv> = {}) {
  let now = 1_700_000_000_000;
  const posts: { body: Record<string, unknown>; keepalive: boolean }[] = [];
  let online = true;
  const e: BeatEnv & { tick: (ms: number) => void; posts: typeof posts; setOnline: (v: boolean) => void } = {
    now: () => now,
    online: () => online,
    visible: () => true,
    focused: () => false,
    net: () => "cellular/3g",
    battery: async () => ({ level: 0.42, charging: false }),
    storageLeftMb: async () => 812,
    post: vi.fn(async (body: string, keepalive: boolean) => { posts.push({ body: JSON.parse(body), keepalive }); return true; }),
    setInterval: () => 1,
    clearInterval: () => undefined,
    onHide: () => () => undefined,
    ...over,
    tick: (ms: number) => { now += ms; },
    posts,
    setOnline: (v: boolean) => { online = v; },
  };
  return e;
}
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { window.localStorage.clear(); });

describe("RecordingHeart", () => {
  it("a sample carries the phone's state; 29 saves send nothing, the 30th sends ONE batch of 30 rows", async () => {
    const e = env();
    const heart = new RecordingHeart({ recordingId: "r1", ctx: { kind: "obs", visitId: "v9", teacherExtId: "t1" }, env: e });
    await settle();
    const first = heart.sample({ seq: 0, ms: 1000, size: 4096, state: "recording" });
    expect(first).toMatchObject({ s: 0, ms: 1000, sz: 4096, kb: 4, st: "r", on: 1, vis: 1, foc: 0, q: 812, b: 42, c: 0, n: "cellular/3g" });
    heart.saved(first, true);
    for (let i = 1; i < 29; i += 1) { e.tick(1000); heart.saved(heart.sample({ seq: i, ms: 1000 * (i + 1), size: 4000, state: "recording" }), true); }
    await settle();
    expect(e.posts).toHaveLength(0);
    e.tick(1000);
    heart.saved(heart.sample({ seq: 29, ms: 30_000, size: 4000, state: "recording" }), true);
    await settle();
    expect(e.posts).toHaveLength(1);
    const body = e.posts[0].body as { rid: string; kind: string; visitId: string; cols: string[]; rows: unknown[][] };
    expect(body).toMatchObject({ rid: "r1", kind: "obs", visitId: "v9" });
    expect(body.cols).toEqual([...COLUMNS]);
    expect(body.rows).toHaveLength(30);
    expect(body.rows[29][0]).toBe(29_000); // dt from the batch's first sample
  });

  it("offline: samples are held, then sent when online again", async () => {
    const e = env();
    const heart = new RecordingHeart({ recordingId: "r2", ctx: { kind: "dc" }, env: e });
    e.setOnline(false);
    for (let i = 0; i < 40; i += 1) { e.tick(1000); heart.saved(heart.sample({ seq: i, ms: i * 1000, size: 4000, state: "recording" }), true); }
    await settle();
    expect(e.posts).toHaveLength(0);
    e.setOnline(true);
    e.tick(1000);
    heart.saved(heart.sample({ seq: 40, ms: 41_000, size: 4000, state: "recording" }), true);
    await settle();
    expect(e.posts).toHaveLength(1);
    expect((e.posts[0].body as { rows: unknown[] }).rows).toHaveLength(41);
    const off = (e.posts[0].body as { rows: unknown[][] }).rows.filter((r) => r[6] === 0);
    expect(off).toHaveLength(40);
  });

  it("a failed save is marked in its row (ok 0, the error's name) and is an event of its own", async () => {
    const e = env();
    const heart = new RecordingHeart({ recordingId: "r3", ctx: { kind: "dbrf", observationId: "o1" }, env: e });
    const b = heart.sample({ seq: 0, ms: 1000, size: 10, state: "recording" });
    heart.saved(b, false, Object.assign(new Error("x"), { name: "QuotaExceededError" }));
    await heart.dispose();
    const body = e.posts[e.posts.length - 1].body as { rows: unknown[][]; ev: { k: string }[]; final: boolean };
    expect(body.rows[0][9]).toBe(0);
    expect(body.rows[0][10]).toBe("QuotaExceededError");
    expect(e.posts.some((p) => (p.body as { ev: { k: string }[] }).ev.some((x) => x.k === "save_failed"))).toBe(true);
  });

  it("cutOf: the gap from the last kept sample to now, and the phone's state then", () => {
    const beats = [{ t: 1000, s: 0, vis: 1, on: 1 }, { t: 2000, s: 1, vis: 0, on: 0, b: 15, c: 0, st: "r", ms: 2000 }];
    expect(cutOf(beats, 62_000)).toMatchObject({ gapS: 60, lastS: 1, lastVis: 0, lastOn: 0, lastBattery: 15, hiddenSamples: 1, offlineSamples: 1, samples: 2 });
    expect(cutOf([], 5)).toBeNull();
  });

  it("sendLeftoverBeats: only the samples that never went, then forgets the recording", async () => {
    const e = env();
    const heart = new RecordingHeart({ recordingId: "r4", ctx: { kind: "obs" }, env: e });
    const b0 = heart.sample({ seq: 0, ms: 1000, size: 1, state: "recording" });
    heart.saved(b0, true);
    await heart.flush();
    expect(e.posts).toHaveLength(1);
    const kept = [b0, { ...b0, s: 1, t: b0.t + 1000 }, { ...b0, s: 2, t: b0.t + 2000 }];
    await sendLeftoverBeats("r4", kept, e);
    const last = e.posts[e.posts.length - 1].body as { rows: unknown[][]; final: boolean; kind: string };
    expect(last.rows.map((r) => r[1])).toEqual([1, 2]);
    expect(last).toMatchObject({ final: true, kind: "obs" });
    expect(window.localStorage.getItem("niete.rec.beats.r4")).toBeNull();
  });

  it("encodeBatch is compact: under 70 bytes a sample", () => {
    const beats = Array.from({ length: 60 }, (_, i) => ({ t: 1_700_000_000_000 + i * 1000, s: i, ms: i * 1000, sz: 4100, kb: i * 4, st: "r" as const, on: 1 as const, vis: 1 as const, foc: 1 as const, ok: 1 as const, q: 812, b: 42, c: 0 as const, n: "4g" }));
    const body = encodeBatch("r5", { kind: "dc" }, beats, []);
    expect(body.length / 60).toBeLessThan(70);
  });
});
