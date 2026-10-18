import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFlnPlayer } from '../player/FlnPlayer';
import type { Clip, FlnPlayerDeps } from '../player/types';

// Slow-line warming (bench 18 Oct 16:10Z: three parallel prefetches each finish at three times the cost, and a cold
// tap shares a 400 kbps line with them). Network + clock boundary faked; the player runs for real.

class FakeAudio extends EventTarget {
  src = ''; currentTime = 0; duration = 2; paused = true; preload = ''; loop = false;
  play(): Promise<void> { this.paused = false; return Promise.resolve(); }
  pause(): void { this.paused = true; }
  fire(t: string) { this.dispatchEvent(new Event(t)); }
}

const clip = (id: string, host = 'm.example'): Clip => ({
  id, src: `https://${host}/${id}.mp3`, orig: `https://o.example/${id}.mp3`, label: id, role: 'sound',
});

function rig() {
  const calls: string[] = [];
  const open = new Map<string, { resolve: () => void }>();
  const aborted: string[] = [];
  const audios: FakeAudio[] = [];
  const idleQ: Array<() => void> = [];
  const preconnects: string[] = [];
  let n = 0;
  const deps: FlnPlayerDeps = {
    createAudio: () => { const a = new FakeAudio(); audios.push(a); return a as unknown as HTMLAudioElement; },
    fetch: ((url: string, init?: { signal?: AbortSignal }) => {
      calls.push(url);
      return new Promise((res, rej) => {
        open.set(url, { resolve: () => { open.delete(url); res({ ok: true, status: 200, blob: async () => new Blob([new Uint8Array(10)]) }); } });
        init?.signal?.addEventListener('abort', () => { open.delete(url); aborted.push(url); rej(new DOMException('aborted', 'AbortError')); });
      });
    }) as unknown as typeof fetch,
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    requestIdle: (fn) => { idleQ.push(fn); },
    createObjectURL: () => `blob:${++n}`,
    revokeObjectURL: () => {},
    preconnect: (o) => { preconnects.push(o); },
  };
  return { deps, calls, open, aborted, audios, idleQ, preconnects };
}

const flush = async () => { for (let i = 0; i < 6; i += 1) await vi.advanceTimersByTimeAsync(0); };
const u = (id: string) => `https://m.example/${id}.mp3`;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('warm order on a slow line', () => {
  it('never more than 2 prefetches in flight, in grid order', async () => {
    const r = rig();
    const p = createFlnPlayer(r.deps);
    p.register(['a', 'b', 'c', 'd'].map((i) => clip(i)));
    p.warm(['a', 'b', 'c', 'd']);
    await flush();
    expect(r.calls).toEqual([u('a'), u('b')]);
    r.open.get(u('a'))?.resolve();
    await flush();
    expect(r.calls).toEqual([u('a'), u('b'), u('c')]);
  });

  it('the 3rd clip starts when one finishes, without waiting for idle', async () => {
    const r = rig();
    const p = createFlnPlayer(r.deps);
    p.register(['a', 'b', 'c', 'd'].map((i) => clip(i)));
    p.warm(['a', 'b', 'c', 'd']);
    await flush();
    r.open.get(u('b'))?.resolve();
    await flush();
    expect(r.calls).toContain(u('c'));
    expect(r.calls).not.toContain(u('d')); // the rest still wait for idle
  });
});

describe('a cold tap takes the line', () => {
  it('pauses the other prefetches, then resumes them after it plays', async () => {
    const r = rig();
    const p = createFlnPlayer(r.deps);
    p.register(['a', 'b', 'c'].map((i) => clip(i)));
    p.warm(['a', 'b']);
    await flush();
    expect(r.calls).toEqual([u('a'), u('b')]);
    p.toggle('c');
    await flush();
    expect(r.aborted.sort()).toEqual([u('a'), u('b')]);
    expect(r.calls.filter((x) => x === u('a'))).toHaveLength(1); // nothing restarts while c is loading
    const el = r.audios[r.audios.length - 1];
    expect(el.src).toBe(u('c'));
    el.fire('playing');
    await flush();
    expect(r.calls.filter((x) => x === u('a'))).toHaveLength(2);
    expect(r.calls.filter((x) => x === u('b'))).toHaveLength(2);
  });

  it('a tap on a clip that is already warm does not pause anything', async () => {
    const r = rig();
    const p = createFlnPlayer(r.deps);
    p.register(['a', 'b', 'c'].map((i) => clip(i)));
    p.warm(['a', 'b', 'c']);
    await flush();
    r.open.get(u('a'))?.resolve();
    await flush();
    p.toggle('a');
    await flush();
    expect(r.aborted).toEqual([]);
  });
});

describe('preconnect', () => {
  it('once per mirror origin, at register', () => {
    const r = rig();
    const p = createFlnPlayer(r.deps);
    p.register([clip('a'), clip('b'), clip('c', 'other.example')]);
    p.register([clip('d')]);
    expect(r.preconnects).toEqual(['https://m.example', 'https://other.example']);
  });
});
