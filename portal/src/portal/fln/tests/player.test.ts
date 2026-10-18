import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createFlnPlayer } from '../player/FlnPlayer';
import { useFlnPlayer } from '../player/useFlnPlayer';
import type { Clip, FlnPlanLike, FlnPlayerDeps, PlayerEvent, PlayerState } from '../player/types';

// ---------------------------------------------------------------- fakes (network + clock boundary only)

const playLog: FakeAudio[] = []; // every play() call, in order

class FakeAudio extends EventTarget {
  src = '';
  currentTime = 0;
  duration = 10;
  paused = true;
  preload = '';
  loop = false;
  playCalls = 0;
  play(): Promise<void> { this.paused = false; this.playCalls += 1; playLog.push(this); return Promise.resolve(); }
  pause(): void { this.paused = true; }
  load(): void { /* no-op */ }
  removeAttribute(name: string): void { if (name === 'src') this.src = ''; }
  fire(type: string): void { this.dispatchEvent(new Event(type)); }
}

type Script = { ok: number } | { status: number } | 'throw' | 'hang';
const okResponse = (n: number) => ({ ok: true, status: 200, blob: async () => new Blob([new Uint8Array(n)]) });

function makeFetch(scripts: Record<string, Script | Script[]>, calls: string[]) {
  const seen: Record<string, number> = {};
  return ((url: string, init?: { signal?: AbortSignal }) => {
    calls.push(url);
    const s = scripts[url] ?? { ok: 100 };
    const i = (seen[url] = (seen[url] ?? -1) + 1);
    const one = Array.isArray(s) ? s[Math.min(i, s.length - 1)] : s;
    if (one === 'throw') return Promise.reject(new TypeError('Failed to fetch'));
    if (one === 'hang') {
      return new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      });
    }
    if ('status' in one) return Promise.resolve({ ok: false, status: one.status, blob: async () => new Blob([]) });
    return Promise.resolve(okResponse(one.ok));
  }) as unknown as typeof fetch;
}

const clip = (id: string, role: Clip['role'] = 'sound'): Clip => ({
  id, src: `https://m.example/${id}.mp3`, orig: `https://o.example/${id}.mp3`, label: id, role,
});

interface Rig {
  deps: FlnPlayerDeps;
  audios: FakeAudio[];
  fetchCalls: string[];
  idleQ: Array<() => void>;
  revoked: string[];
  created: string[];
  events: PlayerEvent[];
}

function rig(scripts: Record<string, Script | Script[]> = {}, timing?: FlnPlayerDeps['timing']): Rig {
  const audios: FakeAudio[] = [];
  const fetchCalls: string[] = [];
  const idleQ: Array<() => void> = [];
  const revoked: string[] = [];
  const created: string[] = [];
  let n = 0;
  const deps: FlnPlayerDeps = {
    createAudio: () => { const a = new FakeAudio(); audios.push(a); return a as unknown as HTMLAudioElement; },
    fetch: makeFetch(scripts, fetchCalls),
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    requestIdle: (fn) => { idleQ.push(fn); },
    createObjectURL: () => { const u = `blob:${++n}`; created.push(u); return u; },
    revokeObjectURL: (u) => { revoked.push(u); },
    ...(timing ? { timing } : {}),
  };
  return { deps, audios, fetchCalls, idleQ, revoked, created, events: [] };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await vi.advanceTimersByTimeAsync(0);
}
async function flushIdle(r: Rig): Promise<void> {
  const q = r.idleQ.splice(0);
  q.forEach((f) => f());
  await flush();
}
const unpaused = (r: Rig) => r.audios.filter((a) => !a.paused);
const lastPlayed = () => playLog[playLog.length - 1];

function setup(ids: string[], scripts: Record<string, Script | Script[]> = {}, timing?: FlnPlayerDeps['timing']) {
  const r = rig(scripts, timing);
  const player = createFlnPlayer(r.deps);
  const clips = ids.map((i) => clip(i));
  player.register(clips);
  player.onEvent((e) => r.events.push(e));
  const states: Record<string, Array<{ s: PlayerState; p: number; o?: string }>> = {};
  ids.forEach((id) => {
    states[id] = [];
    player.subscribe(id, (s, p, o) => states[id].push({ s, p, o }));
  });
  const last = (id: string) => states[id][states[id].length - 1];
  return { r, player, clips, states, last };
}

beforeEach(() => { vi.useFakeTimers(); playLog.length = 0; });
afterEach(() => { vi.useRealTimers(); });

// ---------------------------------------------------------------- A4 one at a time

describe('A4 one at a time', () => {
  it('toggle(a) then toggle(b): a is paused and idle, b is loading then playing', () => {
    const { r, player, last } = setup(['a', 'b']);
    player.toggle('a');
    const elA = lastPlayed();
    elA.fire('playing');
    expect(last('a').s).toBe('playing');
    player.toggle('b');
    const elB = lastPlayed();
    if (elA !== elB) expect(elA.paused).toBe(true);
    expect(last('a').s).toBe('idle');
    expect(last('b').s).toBe('loading');
    elB.fire('playing');
    expect(last('b').s).toBe('playing');
    expect(unpaused(r)).toHaveLength(1);
  });

  it('50 seeded-random toggles across 6 clips never leave two elements playing', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const { r, player } = setup(ids);
    let seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    for (let i = 0; i < 50; i += 1) {
      player.toggle(ids[Math.floor(rnd() * ids.length)]);
      expect(unpaused(r).length).toBeLessThanOrEqual(1);
      const el = lastPlayed();
      if (el && !el.paused) el.fire('playing');
      expect(unpaused(r).length).toBeLessThanOrEqual(1);
    }
    // not vacuous: taps really started playback (a stub that plays nothing must fail here)
    expect(playLog.length).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------- A5 restart / repeat

describe('A5 restart and repeat', () => {
  it('after ended the clip is idle and a new tap restarts from 0 with a fresh play()', () => {
    const { player, last } = setup(['a']);
    player.toggle('a');
    const el = lastPlayed();
    el.fire('playing');
    expect(last('a').s).toBe('playing');
    el.currentTime = 7;
    el.fire('ended');
    expect(last('a').s).toBe('idle');
    const before = playLog.length;
    player.toggle('a');
    expect(playLog.length).toBe(before + 1);
    expect(lastPlayed().currentTime).toBe(0);
  });

  it('20 of 20 consecutive tap/ended cycles reach playing', () => {
    const { player, last } = setup(['a']);
    let reached = 0;
    for (let i = 0; i < 20; i += 1) {
      player.toggle('a');
      const el = lastPlayed();
      el.currentTime = 5;
      el.fire('playing');
      if (last('a').s === 'playing') reached += 1;
      el.fire('ended');
      expect(last('a').s).toBe('idle');
    }
    expect(reached).toBe(20);
  });

  it('toggle while playing stops it', () => {
    const { r, player, last } = setup(['a']);
    player.toggle('a');
    lastPlayed().fire('playing');
    player.toggle('a');
    expect(last('a').s).toBe('idle');
    expect(unpaused(r)).toHaveLength(0);
  });

  it('two owners on one clip: the subscriber receives the owner that tapped', () => {
    const { player, last } = setup(['a']);
    player.toggle('a', 'repeat-1');
    expect(last('a').o).toBe('repeat-1');
    lastPlayed().fire('playing');
    expect(last('a').o).toBe('repeat-1');
    lastPlayed().fire('ended');
    player.toggle('a', 'repeat-2');
    expect(last('a').s).toBe('loading');
    expect(last('a').o).toBe('repeat-2');
  });
});

// ---------------------------------------------------------------- A3 synchronous feedback, gesture rule

describe('A3 synchronous feedback and the gesture rule', () => {
  it('the subscriber has already received loading when toggle returns (cold)', () => {
    const { player, states } = setup(['a']);
    expect(states.a.map((x) => x.s)).toEqual(['idle']); // subscribe calls back at once with the current state
    player.toggle('a');
    expect(states.a.some((x) => x.s === 'loading')).toBe(true);
  });

  it('play() is called before toggle returns (cold)', () => {
    const { r, player } = setup(['a']);
    player.toggle('a');
    expect(playLog.length).toBe(1);
    expect(r.audios.some((a) => a.playCalls === 1)).toBe(true);
  });

  it('play() is called before toggle returns (warmed clip, blob src)', async () => {
    const { r, player } = setup(['a']);
    player.warm(['a']);
    await flush();
    player.toggle('a');
    expect(playLog.length).toBe(1);
    expect(r.audios.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- warm

describe('warm', () => {
  const five = ['a', 'b', 'c', 'd', 'e'];

  it('fetches the first 3 at once and the rest only after the idle callback', async () => {
    const { r, player } = setup(five);
    player.warm(five);
    await flush();
    expect(r.fetchCalls).toEqual(['a', 'b', 'c'].map((i) => `https://m.example/${i}.mp3`));
    await flushIdle(r);
    expect(r.fetchCalls).toEqual(five.map((i) => `https://m.example/${i}.mp3`));
  });

  it('stops when the byte budget is spent', async () => {
    const scripts: Record<string, Script> = {};
    five.forEach((i) => { scripts[`https://m.example/${i}.mp3`] = { ok: 1000 }; });
    const { r, player } = setup(five, scripts, { budgetBytes: 2500 });
    player.warm(five);
    await flush();
    await flushIdle(r);
    await flushIdle(r);
    expect(r.fetchCalls).toEqual(['a', 'b', 'c'].map((i) => `https://m.example/${i}.mp3`));
  });

  it('a warmed clip plays from a blob: src and the audio_play result is ok-mirror', async () => {
    const { r, player } = setup(['a']);
    player.warm(['a']);
    await flush();
    player.toggle('a');
    const el = lastPlayed();
    expect(el.src).toMatch(/^blob:\d+$/);
    expect(r.created.length).toBeGreaterThan(0);
    el.fire('playing');
    const play = r.events.find((e) => e.kind === 'audio_play');
    expect(play).toMatchObject({ clip: 'a', result: 'ok-mirror' });
  });

  it('warm alone never plays, and a hanging prefetch does not block another clip', async () => {
    const { r, player } = setup(['a', 'b'], { 'https://m.example/a.mp3': 'hang' });
    player.warm(['a']);
    await flush();
    expect(playLog).toHaveLength(0);
    player.toggle('b');
    expect(playLog).toHaveLength(1);
    expect(r.audios.every((x) => x.loop === false)).toBe(true);
  });
});

describe('warm fallback: the mirror fails, the original is fetched at once', () => {
  const cases: Array<[string, Script]> = [['429', { status: 429 }], ['503', { status: 503 }], ['network error', 'throw']];
  it.each(cases)('mirror %s then orig, plays the orig blob with ok-orig', async (_n, script) => {
    const { r, player } = setup(['a'], { 'https://m.example/a.mp3': script });
    player.warm(['a']);
    await flush();
    expect(r.fetchCalls).toEqual(['https://m.example/a.mp3', 'https://o.example/a.mp3']);
    player.toggle('a');
    const el = lastPlayed();
    expect(el.src).toMatch(/^blob:\d+$/);
    el.fire('playing');
    expect(r.events.find((e) => e.kind === 'audio_play')).toMatchObject({ clip: 'a', result: 'ok-orig' });
  });
});

// ---------------------------------------------------------------- cold switch

describe('cold tap switch at 1.5 s', () => {
  it('no first byte within 1500 ms: the same element switches to orig and plays again, never two playing', () => {
    const { r, player } = setup(['a']);
    player.toggle('a');
    const el = lastPlayed();
    expect(el.src).toBe('https://m.example/a.mp3');
    expect(el.playCalls).toBe(1);
    vi.advanceTimersByTime(1499);
    expect(el.src).toBe('https://m.example/a.mp3');
    vi.advanceTimersByTime(1);
    expect(el.src).toBe('https://o.example/a.mp3');
    expect(el.playCalls).toBe(2);
    expect(unpaused(r).filter((x) => x !== el)).toHaveLength(0);
    el.fire('playing');
    expect(r.events.find((e) => e.kind === 'audio_play')).toMatchObject({ clip: 'a', result: 'ok-orig' });
  });

  it('loadedmetadata before 1500 ms: no switch, ok-mirror', () => {
    const { r, player } = setup(['a']);
    player.toggle('a');
    const el = lastPlayed();
    vi.advanceTimersByTime(800);
    el.fire('loadedmetadata');
    vi.advanceTimersByTime(1500);
    expect(el.src).toBe('https://m.example/a.mp3');
    expect(el.playCalls).toBe(1);
    el.fire('playing');
    expect(r.events.find((e) => e.kind === 'audio_play')).toMatchObject({ result: 'ok-mirror' });
  });

  it('a progress event before 1500 ms also counts as first byte', () => {
    const { player } = setup(['a']);
    player.toggle('a');
    const el = lastPlayed();
    el.fire('progress');
    vi.advanceTimersByTime(2000);
    expect(el.src).toBe('https://m.example/a.mp3');
  });

  it('an error on src before 1.5 s switches to orig immediately', () => {
    const { player } = setup(['a']);
    player.toggle('a');
    const el = lastPlayed();
    vi.advanceTimersByTime(300);
    el.fire('error');
    expect(el.src).toBe('https://o.example/a.mp3');
    expect(el.playCalls).toBe(2);
  });
});

// ---------------------------------------------------------------- A6 error state

describe('A6 error state', () => {
  it('orig also errors: state error and an audio_error event with an error- result', () => {
    const { r, player, last } = setup(['a']);
    player.toggle('a');
    const el = lastPlayed();
    el.fire('error'); // src -> orig
    el.fire('error'); // orig failed too
    expect(last('a').s).toBe('error');
    const ev = r.events.find((e) => e.kind === 'audio_error');
    expect(ev).toBeDefined();
    expect(ev!.clip).toBe('a');
    expect(ev!.result).toMatch(/^error-/);
  });

  it('no playing within 6000 ms of the tap: error, never a spinner forever', () => {
    const { r, player, last } = setup(['a']);
    player.toggle('a');
    vi.advanceTimersByTime(5999);
    expect(last('a').s).toBe('loading');
    vi.advanceTimersByTime(1);
    expect(last('a').s).toBe('error');
    expect(r.events.some((e) => e.kind === 'audio_error' && /^error-/.test(e.result || ''))).toBe(true);
    expect(unpaused(r)).toHaveLength(0);
  });

  it('a clip that reaches playing in time never times out', () => {
    const { player, last } = setup(['a']);
    player.toggle('a');
    vi.advanceTimersByTime(1000);
    lastPlayed().fire('playing');
    vi.advanceTimersByTime(10000);
    expect(last('a').s).toBe('playing');
  });

  it('from error, toggle retries (loading again)', () => {
    const { player, last } = setup(['a']);
    player.toggle('a');
    vi.advanceTimersByTime(6000);
    expect(last('a').s).toBe('error');
    player.toggle('a');
    expect(last('a').s).toBe('loading');
    expect(playLog.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------- stop on hide

describe('stop on hide', () => {
  it('stopAll() leaves every clip idle and every element paused (playing and loading)', () => {
    const { r, player, last } = setup(['a', 'b']);
    player.toggle('a');
    lastPlayed().fire('playing');
    player.stopAll();
    expect(last('a').s).toBe('idle');
    expect(unpaused(r)).toHaveLength(0);
    player.toggle('b');
    expect(last('b').s).toBe('loading');
    player.stopAll();
    expect(last('b').s).toBe('idle');
    expect(unpaused(r)).toHaveLength(0);
  });
});

describe('stop on hide: the hook binds the events', () => {
  const plan: FlnPlanLike = {
    lang: 'en',
    sections: [{ kind: 's', groups: [{ items: [{ text: '**a**', media: [{ kind: 'audio', src: 'https://m.example/a.mp3', orig: 'https://o.example/a.mp3', sha8: 'a' }] }] }] }],
  };
  let vis: 'visible' | 'hidden' = 'visible';

  beforeEach(() => {
    vis = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis });
  });
  afterEach(() => { delete (document as unknown as Record<string, unknown>).visibilityState; });

  function mount() {
    const r = rig();
    const { result, unmount } = renderHook(() => useFlnPlayer(plan, r.deps));
    const states: PlayerState[] = [];
    result.current.subscribe('a', (s) => states.push(s));
    act(() => { result.current.toggle('a'); });
    expect(states[states.length - 1]).toBe('loading'); // the hook registered the plan's clip
    lastPlayed().fire('playing');
    expect(states[states.length - 1]).toBe('playing');
    return { r, states, unmount };
  }

  it('pagehide on window stops', () => {
    const { r, states, unmount } = mount();
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(states[states.length - 1]).toBe('idle');
    expect(unpaused(r)).toHaveLength(0);
    unmount();
  });

  it('visibilitychange to hidden stops, but to visible does not', () => {
    const { r, states, unmount } = mount();
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(states[states.length - 1]).toBe('playing');
    vis = 'hidden';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(states[states.length - 1]).toBe('idle');
    expect(unpaused(r)).toHaveLength(0);
    unmount();
  });

  it('freeze on document stops', () => {
    const { r, states, unmount } = mount();
    act(() => { document.dispatchEvent(new Event('freeze')); });
    expect(states[states.length - 1]).toBe('idle');
    expect(unpaused(r)).toHaveLength(0);
    unmount();
  });
});

// ---------------------------------------------------------------- no autoplay / loop, src as given, telemetry, dispose

describe('no autoplay and no loop', () => {
  it('register and warm never call play(); loop is never true', async () => {
    const { r, player } = setup(['a', 'b', 'c', 'd']);
    player.register([clip('e')]);
    player.warm(['a', 'b', 'c', 'd']);
    await flush();
    await flushIdle(r);
    expect(playLog).toHaveLength(0);
    player.toggle('a');
    lastPlayed().fire('playing');
    expect(r.audios.every((x) => x.loop === false)).toBe(true);
  });
});

describe('src exactly as given', () => {
  it('a + in the URL stays a + (cold)', () => {
    const r = rig();
    const player = createFlnPlayer(r.deps);
    const c: Clip = { id: 'p', src: 'https://m.example/a+b%20c.mp3?x=1+2', orig: 'https://o.example/a+b.mp3', label: 'p', role: 'sound' };
    player.register([c]);
    player.toggle('p');
    expect(lastPlayed().src).toBe('https://m.example/a+b%20c.mp3?x=1+2');
    vi.advanceTimersByTime(1500);
    expect(lastPlayed().src).toBe('https://o.example/a+b.mp3');
  });

  it('the warm fetch uses the URL untouched', async () => {
    const r = rig();
    const player = createFlnPlayer(r.deps);
    player.register([{ id: 'p', src: 'https://m.example/a+b.mp3', orig: 'https://o.example/a+b.mp3', label: 'p', role: 'sound' }]);
    player.warm(['p']);
    await flush();
    expect(r.fetchCalls).toEqual(['https://m.example/a+b.mp3']);
  });
});

describe('audio_play.ms', () => {
  it('is the time from the tap to playing, measured with now()', () => {
    const { r, player } = setup(['a']);
    player.toggle('a');
    vi.advanceTimersByTime(700);
    lastPlayed().fire('playing');
    const ev = r.events.find((e) => e.kind === 'audio_play');
    expect(ev).toBeDefined();
    expect(ev!.ms).toBe(700);
  });

  it('onEvent returns an unsubscribe', () => {
    const r = rig();
    const player = createFlnPlayer(r.deps);
    player.register([clip('a')]);
    const got: PlayerEvent[] = [];
    const off = player.onEvent((e) => got.push(e));
    off();
    player.toggle('a');
    lastPlayed().fire('playing');
    expect(got).toHaveLength(0);
  });
});

describe('dispose', () => {
  it('revokes every blob URL it created', async () => {
    const { r, player } = setup(['a', 'b']);
    player.warm(['a', 'b']);
    await flush();
    expect(r.created.length).toBe(2);
    player.dispose();
    expect([...r.revoked].sort()).toEqual([...r.created].sort());
  });
});
