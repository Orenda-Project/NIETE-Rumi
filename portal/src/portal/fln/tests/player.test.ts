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
  readyState = 0;
  dataset: Record<string, string> = {};
  playCalls = 0;
  loads = 0;
  /** every src this element was given, in order (the network boundary) */
  srcs: string[] = [];
  play(): Promise<void> { this.paused = false; this.playCalls += 1; playLog.push(this); return Promise.resolve(); }
  pause(): void { this.paused = true; }
  load(): void { this.loads += 1; if (this.src) this.srcs.push(this.src); }
  removeAttribute(name: string): void { if (name === 'src') this.src = ''; }
  fire(type: string): void { this.dispatchEvent(new Event(type)); }
  /** the head arrived: the element can start */
  head(): void { this.readyState = 3; this.fire('loadedmetadata'); this.fire('canplay'); }
}

const clip = (id: string, role: Clip['role'] = 'sound'): Clip => ({
  id, src: `https://m.example/${id}.mp3`, orig: `https://o.example/${id}.mp3`, label: id, role,
});

interface Rig {
  deps: FlnPlayerDeps;
  audios: FakeAudio[];
  idleQ: Array<() => void>;
  events: PlayerEvent[];
}

function rig(timing?: FlnPlayerDeps['timing']): Rig {
  const audios: FakeAudio[] = [];
  const idleQ: Array<() => void> = [];
  const deps: FlnPlayerDeps = {
    createAudio: () => { const a = new FakeAudio(); audios.push(a); return a as unknown as HTMLAudioElement; },
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    requestIdle: (fn) => { idleQ.push(fn); },
    preconnect: () => {},
    ...(timing ? { timing } : {}),
  };
  return { deps, audios, idleQ, events: [] };
}

/** the element the player made for clip `id` */
const elOf = (r: Rig, id: string) => r.audios.find((a) => a.dataset.flnClip === id);
/** every URL the warm loaded, in order */
const loaded = (r: Rig) => r.audios.flatMap((a) => a.srcs);

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

function setup(ids: string[], timing?: FlnPlayerDeps['timing']) {
  const r = rig(timing);
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

  it('play() is called before toggle returns (warmed clip)', async () => {
    const { r, player } = setup(['a']);
    player.warm(['a']);
    await flush();
    elOf(r, 'a')!.head();
    player.toggle('a');
    expect(playLog.length).toBe(1);
    expect(playLog[0]).toBe(elOf(r, 'a'));
  });
});

// ---------------------------------------------------------------- warm

describe('warm', () => {
  const five = ['a', 'b', 'c', 'd', 'e'];
  const m = (i: string) => `https://m.example/${i}.mp3`;

  it('one <audio preload=auto> per clip, in order, 2 at a time; the next starts when a head arrives', async () => {
    const { r, player } = setup(five);
    player.warm(five);
    await flush();
    expect(loaded(r)).toEqual([m('a'), m('b')]);
    expect(r.audios.every((a) => a.preload === 'auto')).toBe(true);
    elOf(r, 'a')!.head();
    await flush();
    expect(loaded(r)).toEqual([m('a'), m('b'), m('c')]);
  });

  it('the first 3 start without idle; the rest wait for the idle callback', async () => {
    const { r, player } = setup(five);
    player.warm(five);
    await flush();
    elOf(r, 'a')!.head();
    elOf(r, 'b')!.head();
    elOf(r, 'c')?.head();
    await flush();
    expect(loaded(r)).toEqual([m('a'), m('b'), m('c')]);
    await flushIdle(r);
    expect(loaded(r)).toEqual([m('a'), m('b'), m('c'), m('d'), m('e')]);
  });

  it('a head that never arrives stops holding the queue after warmStepMs', async () => {
    const { r, player } = setup(five, { warmStepMs: 8000 });
    player.warm(five);
    await flush();
    vi.advanceTimersByTime(7999);
    expect(loaded(r)).toHaveLength(2);
    vi.advanceTimersByTime(1);
    await flush();
    expect(loaded(r)).toEqual([m('a'), m('b'), m('c')]);
  });

  it('stops when the byte budget is spent', async () => {
    const r = rig({ budgetBytes: 2500 });
    const player = createFlnPlayer(r.deps);
    player.register(five.map((i) => ({ ...clip(i), bytes: 1000 })));
    player.warm(five);
    await flush();
    r.audios.forEach((a) => a.head());
    await flush();
    await flushIdle(r);
    r.audios.forEach((a) => a.head());
    await flush();
    expect(loaded(r)).toEqual([m('a'), m('b')]);
  });

  it('a tap on a warmed clip plays the same element from what it has: no reload, no 2.5 s switch, ok-mirror', async () => {
    const { r, player } = setup(['a']);
    player.warm(['a']);
    await flush();
    const el = elOf(r, 'a')!;
    el.head();
    const loads = el.loads;
    player.toggle('a');
    expect(lastPlayed()).toBe(el);
    expect(el.loads).toBe(loads);
    vi.advanceTimersByTime(2000);
    expect(el.src).toBe(m('a'));
    el.fire('playing');
    expect(r.events.find((e) => e.kind === 'audio_play')).toMatchObject({ clip: 'a', result: 'ok-mirror' });
  });

  it('a tap on a clip whose head is still on its way keeps that download (no restart)', async () => {
    const { r, player } = setup(['a']);
    player.warm(['a']);
    await flush();
    const el = elOf(r, 'a')!;
    el.readyState = 1; // metadata only
    player.toggle('a');
    expect(el.loads).toBe(1);
    expect(el.srcs).toEqual([m('a')]);
  });

  it('warm alone never plays', async () => {
    const { r, player } = setup(['a', 'b']);
    player.warm(['a', 'b']);
    await flush();
    r.audios.forEach((a) => a.head());
    await flushIdle(r);
    expect(playLog).toHaveLength(0);
    expect(r.audios.every((x) => x.loop === false)).toBe(true);
  });

  it('a cold tap holds the queue until it plays', async () => {
    const { r, player } = setup(['a', 'b', 'c', 'd']);
    player.warm(['a', 'b', 'c', 'd']);
    await flush();
    player.toggle('d');
    elOf(r, 'a')!.head();
    elOf(r, 'b')!.head();
    await flush();
    expect(loaded(r)).not.toContain(m('c'));
    lastPlayed().fire('playing');
    await flush();
    expect(loaded(r)).toContain(m('c'));
  });

  it('the element keeps the URL as given even when the browser re-encodes src (an Urdu filename)', async () => {
    const r = rig();
    r.deps.createAudio = () => {
      const a = new FakeAudio();
      let raw = '';
      Object.defineProperty(a, 'src', { get: () => encodeURI(raw), set: (v: string) => { raw = v; } });
      r.audios.push(a);
      return a as unknown as HTMLAudioElement;
    };
    const player = createFlnPlayer(r.deps);
    const url = 'https://m.example/4037_ب.mp3';
    player.register([{ id: 'u', src: url, orig: url, label: 'ب', role: 'sound' }]);
    player.warm(['u']);
    await flush();
    const el = elOf(r, 'u')!;
    el.head();
    player.toggle('u');
    expect(el.loads).toBe(1); // the tap did not reset src and start the download again
  });
});

describe('warm fallback: the mirror errors, the element moves to the original at once', () => {
  it('mirror error during the warm → orig loaded before any tap; the tap plays it with ok-orig', async () => {
    const { r, player } = setup(['a']);
    player.warm(['a']);
    await flush();
    const el = elOf(r, 'a')!;
    el.fire('error');
    expect(el.srcs).toEqual(['https://m.example/a.mp3', 'https://o.example/a.mp3']);
    el.head();
    player.toggle('a');
    expect(el.loads).toBe(2);
    el.fire('playing');
    expect(r.events.find((e) => e.kind === 'audio_play')).toMatchObject({ clip: 'a', result: 'ok-orig' });
  });

  it('both fail during the warm: the tap still tries (from orig) and ends in error, never a spinner', async () => {
    const { r, player, last } = setup(['a']);
    player.warm(['a']);
    await flush();
    const el = elOf(r, 'a')!;
    el.fire('error');
    el.fire('error');
    player.toggle('a');
    vi.advanceTimersByTime(6000);
    expect(last('a').s).toBe('error');
    expect(r.events.some((e) => e.kind === 'audio_error')).toBe(true);
  });
});

describe('preconnect', () => {
  it('once per mirror origin, at register', () => {
    const got: string[] = [];
    const r = rig();
    r.deps.preconnect = (o) => { got.push(o); };
    const player = createFlnPlayer(r.deps);
    player.register([clip('a'), clip('b'), { ...clip('c'), src: 'https://other.example/c.mp3' }]);
    player.register([clip('d')]);
    expect(got).toEqual(['https://m.example', 'https://other.example']);
  });
});

// ---------------------------------------------------------------- cold switch

describe('cold tap switch at 2.5 s', () => {
  it('a 400 kbps line: the first byte at 1.7 s is not a stall — no switch, ok-mirror (bench 18 Oct: 9/60 cold loads at 1,654 ms)', () => {
    const { r, player } = setup(['a']);
    player.toggle('a');
    const el = lastPlayed();
    vi.advanceTimersByTime(1700);
    expect(el.src).toBe('https://m.example/a.mp3');
    el.fire('loadedmetadata');
    vi.advanceTimersByTime(3000);
    expect(el.playCalls).toBe(1);
    el.fire('playing');
    expect(r.events.find((e) => e.kind === 'audio_play')).toMatchObject({ result: 'ok-mirror' });
  });

  it('no first byte within 2500 ms: the same element switches to orig and plays again, never two playing', () => {
    const { r, player } = setup(['a']);
    player.toggle('a');
    const el = lastPlayed();
    expect(el.src).toBe('https://m.example/a.mp3');
    expect(el.playCalls).toBe(1);
    vi.advanceTimersByTime(2499);
    expect(el.src).toBe('https://m.example/a.mp3');
    vi.advanceTimersByTime(1);
    expect(el.src).toBe('https://o.example/a.mp3');
    expect(el.playCalls).toBe(2);
    expect(unpaused(r).filter((x) => x !== el)).toHaveLength(0);
    el.fire('playing');
    expect(r.events.find((e) => e.kind === 'audio_play')).toMatchObject({ clip: 'a', result: 'ok-orig' });
  });

  it('loadedmetadata before 2500 ms: no switch, ok-mirror', () => {
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

  it('a progress event before 2500 ms also counts as first byte', () => {
    const { player } = setup(['a']);
    player.toggle('a');
    const el = lastPlayed();
    el.fire('progress');
    vi.advanceTimersByTime(2000);
    expect(el.src).toBe('https://m.example/a.mp3');
  });

  it('an error on src before 2.5 s switches to orig immediately', () => {
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

  it('a retry after both sources failed starts from the mirror again (the mirror may be back)', () => {
    const { r, player, last } = setup(['a']);
    player.toggle('a');
    const el = lastPlayed();
    el.fire('error'); // mirror failed -> orig
    el.fire('error'); // orig failed -> error
    expect(last('a').s).toBe('error');
    player.toggle('a');
    expect(el.src).toBe('https://m.example/a.mp3');
    el.fire('playing');
    expect(r.events.filter((e) => e.kind === 'audio_play').pop()).toMatchObject({ result: 'ok-mirror' });
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
    vi.advanceTimersByTime(2500);
    expect(lastPlayed().src).toBe('https://o.example/a+b.mp3');
  });

  it('the warm load uses the URL untouched', async () => {
    const r = rig();
    const player = createFlnPlayer(r.deps);
    player.register([{ id: 'p', src: 'https://m.example/a+b.mp3', orig: 'https://o.example/a+b.mp3', label: 'p', role: 'sound' }]);
    player.warm(['p']);
    await flush();
    expect(loaded(r)).toEqual(['https://m.example/a+b.mp3']);
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
  it('releases every element: src removed and load() called, so the browser drops the buffer and the connection', async () => {
    const { r, player } = setup(['a', 'b']);
    player.warm(['a', 'b']);
    await flush();
    expect(r.audios).toHaveLength(2);
    player.dispose();
    expect(r.audios.every((a) => a.src === '' && a.loads === 2)).toBe(true);
  });
});

describe('no needless seek', () => {
  it('a first tap on a warmed element at 0 does not assign currentTime (a seek costs ~200 ms on some mp3s)', async () => {
    const { r, player } = setup(['a']);
    player.warm(['a']);
    await flush();
    const el = elOf(r, 'a')!;
    el.head();
    let seeks = 0;
    let t = 0;
    Object.defineProperty(el, 'currentTime', { get: () => t, set: (v: number) => { seeks += 1; t = v; } });
    player.toggle('a');
    expect(seeks).toBe(0);
    el.fire('playing');
    t = 1.2; // it played some
    player.toggle('a'); // stop
    player.toggle('a'); // restart from 0 (A5)
    expect(t).toBe(0);
  });
});

describe('narrations warm their head only (voice 163503, red-team-pr 164215)', () => {
  const narr = (id: string, bytes: number): Clip => ({ ...clip(id, 'narration'), bytes });

  it('a narration warms with preload=metadata and costs the sound budget nothing', async () => {
    const r = rig({ budgetBytes: 2500 });
    const player = createFlnPlayer(r.deps);
    player.register([{ ...clip('a'), bytes: 1000 }, narr('n', 2_500_000), { ...clip('b'), bytes: 1000 }]);
    player.warm(['a', 'n', 'b']);
    await flush();
    const n = elOf(r, 'n')!;
    expect(n.preload).toBe('metadata');
    n.readyState = 1;
    n.fire('loadedmetadata');
    elOf(r, 'a')!.head();
    await flush();
    expect(loaded(r)).toContain('https://m.example/b.mp3'); // b still fits: the 2.5 MB narration was not counted
    expect(elOf(r, 'a')!.preload).toBe('auto');
  });

  it('a sound clip over the remaining budget never gets a src', async () => {
    const r = rig({ budgetBytes: 1500 });
    const player = createFlnPlayer(r.deps);
    player.register([{ ...clip('a'), bytes: 1000 }, { ...clip('b'), bytes: 1000 }]);
    player.warm(['a', 'b']);
    await flush();
    elOf(r, 'a')!.head();
    await flush();
    expect(elOf(r, 'b')?.src ?? '').toBe('');
  });
});
