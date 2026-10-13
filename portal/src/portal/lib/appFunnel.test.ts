import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAppFunnel, normaliseRoute, shouldTrack } from './appFunnel';

/** bd-4r3rei — the page-side funnel client: what it sends, when, and that it can never get in a teacher's way. */

type Sent = { via: 'beacon' | 'fetch'; body: any };

/** jsdom's Blob has no .text(): read it the way a browser's FileReader does. */
const blobText = (b: Blob) => new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(fr.error); fr.readAsText(b); });

function rig(over: Record<string, unknown> = {}) {
  let t = 1_000_000;
  const sent: Sent[] = [];
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let nextId = 1;
  const deps = {
    endpoint: '/api/portal/funnel/events',
    browser: 'android-iab' as const,
    now: () => t,
    sendBeacon: vi.fn((_u: string, blob: Blob) => { sent.push({ via: 'beacon', body: blob }); return true; }),
    fetchFn: vi.fn(async (_u: string, init: any) => { sent.push({ via: 'fetch', body: init.body }); return { status: 204 } as Response; }),
    setTimer: (fn: () => void, ms: number) => { const id = nextId++; timers.push({ fn, at: t + ms, id }); return id as unknown as ReturnType<typeof setTimeout>; },
    clearTimer: (id: unknown) => { const i = timers.findIndex((x) => x.id === (id as number)); if (i >= 0) timers.splice(i, 1); },
    ...over,
  };
  const funnel = createAppFunnel(deps as any);
  return {
    funnel, deps, sent,
    advance(ms: number) { t += ms; for (const x of [...timers]) if (x.at <= t) { timers.splice(timers.indexOf(x), 1); x.fn(); } },
    async bodies() {
      return Promise.all(sent.map(async (s) => JSON.parse(typeof s.body === 'string' ? s.body : await blobText(s.body as Blob))));
    },
    events: async function events() { return (await this.bodies()).flatMap((b: any) => b.ev); },
  };
}

describe('normaliseRoute / shouldTrack', () => {
  it.each([
    ['/portal/teacher/lessons?plan=g612:x#a', '/portal/teacher/lessons'],
    ['/portal/coach/visit/12345/record', '/portal/coach/visit/:id/record'],
    ['/portal/teacher/assessment/request/8c1f0e3a-1111-4222-8333-944455556666', '/portal/teacher/assessment/request/:id'],
    ['/portal/teacher/', '/portal/teacher'],
  ])('%s → %s', (raw, want) => expect(normaliseRoute(raw)).toBe(want));

  it.each([['/'], ['/how-it-works'], ['https://x.test/portal/teacher'], [''], ['/portal/' + 'a'.repeat(300)]])('%s is not a page we report', (raw) =>
    expect(normaliseRoute(raw)).toBeNull());

  it.each([['/portal/login'], ['/portal/setup/abc'], ['/portal/reset-password'], ['/portal/reset-password/verify'], ['/portal/delete-account'], ['/portal/privacy'], ['/']])(
    '%s is never reported (signed out or public)', (p) => expect(shouldTrack(p)).toBe(false));
  it.each([['/portal/teacher'], ['/portal/dashboard'], ['/portal/coach/observe']])('%s is', (p) => expect(shouldTrack(p)).toBe(true));
});

describe('page views', () => {
  it('the first view and each move are queued with the page she came from; nothing is sent yet', async () => {
    const r = rig();
    r.funnel.view('/portal/teacher');
    r.advance(1000);
    r.funnel.view('/portal/teacher/lessons?x=1');
    expect(r.sent).toHaveLength(0);
    r.funnel.flush();
    const ev = await r.events();
    expect(ev.map((e: any) => e.k)).toEqual(['view', 'leave', 'view']);
    expect(ev[0]).toEqual(expect.objectContaining({ r: '/portal/teacher', pr: null }));
    expect(ev[1]).toEqual(expect.objectContaining({ r: '/portal/teacher', why: 'nav', d: 1000 }));
    expect(ev[2]).toEqual(expect.objectContaining({ r: '/portal/teacher/lessons', pr: '/portal/teacher' }));
  });

  it('a query-only change on the same page is not a new view', async () => {
    const r = rig();
    r.funnel.view('/portal/teacher/lessons?a=1'); r.funnel.view('/portal/teacher/lessons?a=2'); r.funnel.flush();
    expect((await r.events()).map((e: any) => e.k)).toEqual(['view']);
  });

  it('login and public pages are never queued, and leaving a tracked page for one still closes it', async () => {
    const r = rig();
    r.funnel.view('/portal/login'); r.funnel.view('/portal/teacher'); r.advance(500); r.funnel.view('/portal/login'); r.funnel.flush();
    expect((await r.events()).map((e: any) => [e.k, e.r])).toEqual([['view', '/portal/teacher'], ['leave', '/portal/teacher']]);
  });

  it('every event carries its age at send time, so the server can place it (not the page clock)', async () => {
    const r = rig();
    r.funnel.view('/portal/teacher'); r.advance(3000); r.funnel.view('/portal/teacher/classes'); r.advance(2000); r.funnel.flush();
    const ev = await r.events();
    expect(ev[0].age).toBe(5000);
    expect(ev[ev.length - 1].age).toBe(2000);
  });

  it('batches are flushed on a timer (5 s after the first queued event) and at 10 events', async () => {
    const r = rig();
    r.funnel.view('/portal/teacher');
    r.advance(4999); expect(r.sent).toHaveLength(0);
    r.advance(2); expect(r.sent).toHaveLength(1);
    for (let i = 0; i < 6; i += 1) { r.funnel.view(`/portal/teacher/${i % 2 ? 'classes' : 'lessons'}`); }
    expect(r.sent.length).toBeGreaterThanOrEqual(2);
  });
});

describe('leaving', () => {
  it('hidden → one leave with the time she was actually looking, flushed AT ONCE by beacon (not left for the 5 s timer)', async () => {
    const r = rig();
    r.funnel.view('/portal/teacher/classes'); r.advance(3000);
    r.funnel.hidden('hidden');
    expect(r.deps.sendBeacon).toHaveBeenCalledTimes(1);
    expect(r.deps.fetchFn).not.toHaveBeenCalled();
    const ev = await r.events();
    expect(ev[ev.length - 1]).toEqual(expect.objectContaining({ k: 'leave', r: '/portal/teacher/classes', why: 'hidden', d: 3000 }));
  });

  it('time spent hidden does not count: back after 10 minutes, then 5 s more, then pagehide → dwell 30 s + 5 s', async () => {
    const r = rig();
    r.funnel.view('/portal/teacher/classes'); r.advance(30000);
    r.funnel.hidden('hidden'); r.advance(600000); r.funnel.visible(); r.advance(5000);
    r.funnel.hidden('pagehide');
    const ev = await r.events();
    const leaves = ev.filter((e: any) => e.k === 'leave');
    expect(leaves.map((e: any) => [e.why, e.d])).toEqual([['hidden', 30000], ['pagehide', 5000]]);
    expect(ev.filter((e: any) => e.k === 'resume')).toHaveLength(1);
  });

  it('hidden twice in a row (hidden then pagehide) closes the page once', async () => {
    const r = rig();
    r.funnel.view('/portal/teacher'); r.advance(1000); r.funnel.hidden('hidden'); r.funnel.hidden('pagehide');
    expect((await r.events()).filter((e: any) => e.k === 'leave')).toHaveLength(1);
  });

  it('visible without a page, or without having been hidden, does nothing', async () => {
    const r = rig();
    r.funnel.visible(); r.funnel.view('/portal/teacher'); r.funnel.visible(); r.funnel.flush();
    expect((await r.events()).map((e: any) => e.k)).toEqual(['view']);
  });
});

describe('transport', () => {
  it('the beacon body is text/plain (no CORS preflight in the app) JSON with a version and the browser class', async () => {
    const r = rig();
    r.funnel.view('/portal/teacher'); r.funnel.hidden('hidden');
    const blob = r.sent[0].body as Blob;
    expect(blob.type).toMatch(/^text\/plain/);
    const body = JSON.parse(await blobText(blob));
    expect(body).toEqual(expect.objectContaining({ v: 1, b: 'android-iab' }));
    expect(r.deps.sendBeacon.mock.calls[0][0]).toBe('/api/portal/funnel/events');
  });

  it('beacon refused (returns false) → fetch with keepalive, credentials included, same body', async () => {
    const r = rig({ sendBeacon: vi.fn(() => false) });
    r.funnel.view('/portal/teacher'); r.funnel.hidden('hidden');
    expect(r.deps.fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = (r.deps.fetchFn as any).mock.calls[0];
    expect(url).toBe('/api/portal/funnel/events');
    expect(init).toEqual(expect.objectContaining({ method: 'POST', keepalive: true, credentials: 'include' }));
    expect(init.headers['Content-Type']).toMatch(/^text\/plain/);
  });

  it('no sendBeacon at all (an old WebView) → fetch', () => {
    const r = rig({ sendBeacon: undefined });
    r.funnel.view('/portal/teacher'); r.funnel.hidden('hidden');
    expect(r.deps.fetchFn).toHaveBeenCalledTimes(1);
  });

  it('sendBeacon throws, fetch throws, fetch rejects: nothing ever escapes', async () => {
    const r = rig({ sendBeacon: vi.fn(() => { throw new Error('x'); }), fetchFn: vi.fn(() => { throw new Error('y'); }) });
    expect(() => { r.funnel.view('/portal/teacher'); r.funnel.hidden('hidden'); r.funnel.flush(); }).not.toThrow();
    const r2 = rig({ sendBeacon: undefined, fetchFn: vi.fn(() => Promise.reject(new Error('offline'))) });
    expect(() => { r2.funnel.view('/portal/teacher'); r2.funnel.hidden('hidden'); }).not.toThrow();
    await Promise.resolve();
  });

  it('a 401 from the fetch path stops reporting for 5 minutes (signed out: no spam), then resumes', async () => {
    const fetchFn = vi.fn(async () => ({ status: 401 } as Response));
    const r = rig({ sendBeacon: undefined, fetchFn });
    r.funnel.view('/portal/teacher'); r.funnel.flush();
    await Promise.resolve(); await Promise.resolve();
    r.funnel.view('/portal/teacher/classes'); r.funnel.flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    r.advance(5 * 60 * 1000 + 1);
    r.funnel.view('/portal/teacher/lessons'); r.funnel.flush();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('the queue is capped: a page that never flushes cannot grow without bound', async () => {
    const r = rig({ fetchFn: vi.fn(async () => ({ status: 204 } as Response)), sendBeacon: undefined });
    // 300 distinct routes with the flush timer never firing and the size trigger blocked by a 401 pause
    (r.deps.fetchFn as any).mockImplementation(async () => ({ status: 401 }));
    r.funnel.view('/portal/teacher'); r.funnel.flush(); await Promise.resolve(); await Promise.resolve();
    for (let i = 0; i < 300; i += 1) r.funnel.view(`/portal/teacher/${i % 2 ? 'classes' : 'lessons'}`);
    expect(r.funnel._queueLength()).toBeLessThanOrEqual(100);
  });

  it('an empty queue sends nothing', () => {
    const r = rig();
    r.funnel.flush(); r.funnel.hidden('hidden'); r.funnel.visible();
    expect(r.sent).toHaveLength(0);
  });
});

describe('what is never sent', () => {
  it('no user id, no journey id, no query string, no ids: the page only says where she was', async () => {
    const r = rig();
    r.funnel.view('/portal/teacher/assessment/request/8c1f0e3a-1111-4222-8333-944455556666?token=abc#x'); r.funnel.hidden('hidden');
    const dump = JSON.stringify(await r.bodies());
    expect(dump).not.toMatch(/8c1f0e3a|token|abc|userId|journey/i);
  });
});
