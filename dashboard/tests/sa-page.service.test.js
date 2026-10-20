'use strict';
/**
 * The child's page parameters (dashboard/sa/sa-page.js): only a known battery name, a session id of the expected
 * shape and a same-origin way back are taken; the first name comes from the fragment only; a block runs its tasks.
 */
const { params, pick } = require('../sa/sa-page');

test('the page reads its link strictly', () => {
  expect(params('?s=3f1c2d4e-aaaa-4bbb-8ccc-123456789abc&form=sa.coach.G3.A.ur&mode=proctored&block=B2&back=/portal/leader/sa', '#n=Ali%20Testwala')).toEqual({
    session_id: '3f1c2d4e-aaaa-4bbb-8ccc-123456789abc', form: 'sa.coach.G3.A.ur', mode: 'proctored', lang: 'ur', block: 'B2',
    back: '/portal/leader/sa', skin: null, embed: false, drain: false, token: null, first_name: 'Ali Testwala',
  });
  const bad = params('?s=x&form=../../etc&mode=root&block=B99&back=//evil.example/x&n=Name', '');
  expect(bad).toMatchObject({ session_id: null, form: null, mode: 'proctored', block: null, back: null, first_name: null });
  expect(params('?s=abcdef12&form=sa.game.G23.en&mode=game&skin=game', '').lang).toBe('en');
  expect(params('?back=https://evil.example', '').back).toBeNull();
});

test('a block runs its own tasks in its own order; no blocks or "full" runs them all', () => {
  const b = { battery_id: 'x', tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], blocks: { B1: ['c', 'a'] } };
  expect(pick(b, 'B1').tasks.map((t) => t.id)).toEqual(['c', 'a']);
  expect(pick(b, 'B1').battery_id).toBe('x#B1');
  expect(pick(b, 'full')).toBe(b);
  expect(pick(b, 'B4')).toBe(b);
  expect(pick({ tasks: [{ id: 'a' }] }, 'B1').tasks).toHaveLength(1);
});

test('a game island or the tower runs its own tasks', () => {
  const b = { battery_id: 'g', tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], islands: { maths: ['b'] }, tower: ['c', 'a'] };
  expect(pick(b, 'maths').tasks.map((t) => t.id)).toEqual(['b']);
  expect(pick(b, 'tower').tasks.map((t) => t.id)).toEqual(['c', 'a']);
  expect(params('?s=abcdef12&form=sa.game.G23.ur&mode=game&block=maths', '').block).toBe('maths');
});

test('embed=1 is read; anything else is not embedded', () => {
  expect(params('?s=abcdef12&form=sa.coach.G3.A.ur&embed=1', '').embed).toBe(true);
  expect(params('?s=abcdef12&form=sa.coach.G3.A.ur&embed=true', '').embed).toBe(false);
});

test('proctored lock-down: back is caught and logged, the screen kept awake, all released at the hand-back', async () => {
  const { lockDown } = require('../sa/sa-page');
  const listeners = {};
  const docL = {};
  const pushed = [];
  const logged = [];
  let released = 0;
  const doc = {
    visibilityState: 'visible', documentElement: { requestFullscreen: () => Promise.resolve() },
    addEventListener: (t, f) => { docL[t] = f; }, removeEventListener: (t) => { delete docL[t]; },
  };
  const win = {
    document: doc, location: { href: '/sa/play.html?s=x' },
    history: { pushState: (...a) => pushed.push(a) },
    navigator: { wakeLock: { request: async () => ({ release: async () => { released++; } }) } },
    addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener: (t) => { delete listeners[t]; },
  };
  const release = lockDown(win, { runner: { log: (t) => logged.push(t) } });
  expect(pushed).toHaveLength(1);
  listeners.popstate();
  expect(logged).toEqual(['back_blocked']);
  expect(pushed).toHaveLength(2);
  await new Promise((r) => setTimeout(r, 0));
  release();
  await new Promise((r) => setTimeout(r, 0));
  expect(released).toBe(1);
  expect(listeners.popstate).toBeUndefined();
  expect(docL.visibilitychange).toBeUndefined();
});

test('a linked phone token is read only in its expected shape', () => {
  expect(params('?s=abcdef12&form=sa.coach.G3.A.ur&t=abcdefghijklmnop.QRS-_', '').token).toBe('abcdefghijklmnop.QRS-_');
  expect(params('?s=abcdef12&form=sa.coach.G3.A.ur&t=short', '').token).toBeNull();
  expect(params('?s=abcdef12&form=sa.coach.G3.A.ur&t=abcdefghijklmnop%2F..', '').token).toBeNull();
});

test('embedded in the coach page: no full-screen request, so the coach page\'s own end-test hold stays on top', () => {
  const { lockDown } = require('../sa/sa-page');
  const asked = [];
  const docL = {};
  const doc = {
    visibilityState: 'visible',
    documentElement: { requestFullscreen: () => { asked.push('fs'); return Promise.resolve(); } },
    addEventListener: (t, f) => { docL[t] = f; }, removeEventListener: (t) => { delete docL[t]; },
  };
  const win = { document: doc, location: { href: '/sa/play.html' }, history: { pushState() {} }, navigator: {},
    addEventListener() {}, removeEventListener() {} };
  lockDown(win, { runner: { log() {} } }, { embed: true });
  if (docL.pointerdown) docL.pointerdown();
  expect(asked).toEqual([]);
  lockDown(win, { runner: { log() {} } }, { embed: false });
  docL.pointerdown();
  expect(asked).toEqual(['fs']);
});

describe('drain: a finished child whose network came back after the hand-back still syncs', () => {
  const storeMod = require('../sa/sa-store');
  const syncMod = require('../sa/sa-sync');
  const { drain } = require('../sa/sa-page');
  const timers = { set: () => 0, clear() {} };

  async function phone() {
    const s = await storeMod.open({ idb: null });
    for (const [id, mode] of [['child-1', 'proctored'], ['child-2', 'proctored'], ['child-3', 'proctored'], ['game-1', 'game']]) {
      await s.putSession({ session_id: id, mode, battery_id: 'b' });
      if (id !== 'child-3') for (let seq = 1; seq <= 3; seq++) await s.appendEvent({ session_id: id, seq, type: 'tap' });
      if (id !== 'child-3') await s.putResult(id, { task_id: 't1', correct: 1 });
    }
    return s;
  }

  test('every pending proctored session is flushed through the coach sink, one after another; the rest is left', async () => {
    const s = await phone();
    const sent = [];
    const sink = { putBatch: async (b) => { sent.push([b.session_id, b.seq_from, b.seq_to]); return { ok: true, acked_to: b.seq_to }; },
      presignAudio: async () => ({ skip: true }), registerAudio: async () => ({}) };
    const out = await drain({ store: s, sync: syncMod, sink: () => sink, exclude: 'child-2', online: () => true, timers });
    expect(sent).toEqual([['child-1', 1, 3]]);
    expect(out).toEqual([{ s: 'child-1', state: 'synced', pending_events: 0, pending_audio: 0 }]);
    expect((await s.pending('child-2')).events).toHaveLength(3); // the one this page runs syncs itself
    expect((await s.pending('game-1')).events).toHaveLength(3); // game runs need their run token: not drained here
  });

  test('offline: nothing is lost, the report says offline, and a later drain sends it', async () => {
    const s = await phone();
    let net = false;
    const sent = [];
    const sink = { putBatch: async (b) => { sent.push(b.session_id); return { ok: true, acked_to: b.seq_to }; }, presignAudio: async () => ({ skip: true }), registerAudio: async () => ({}) };
    const first = await drain({ store: s, sync: syncMod, sink: () => sink, online: () => net, timers });
    expect(first.map((x) => [x.s, x.state])).toEqual([['child-1', 'offline'], ['child-2', 'offline']]);
    expect(sent).toEqual([]);
    net = true;
    await drain({ store: s, sync: syncMod, sink: () => sink, online: () => net, timers });
    expect(sent).toEqual(['child-1', 'child-2']);
  });

  test('the drain page is asked for by drain=1 (no session needed)', () => {
    expect(params('?drain=1&embed=1', '')).toMatchObject({ drain: true, embed: true, session_id: null });
    expect(params('?s=abcdef12&form=sa.coach.G3.A.en', '').drain).toBe(false);
  });
});
