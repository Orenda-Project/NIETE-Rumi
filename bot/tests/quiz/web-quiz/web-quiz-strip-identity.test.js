'use strict';
/**
 * Two identity lines on the weekly health numbers (web-quiz-strip.js), each written only when its input exists:
 *   - the reply-cap histogram: phone-days by reply count from the Redis counters `wq:reply_cap:<PKT day>:<hash>`
 *     (counts only: no key or hash leaves the read, none is written or logged), with the cap from app_settings
 *     `web_quiz_reply_cap_per_phone` (default 8), the cap hits, and the days the week's numbers cover. The counters
 *     live 24 h, so the daily job snapshots yesterday (`replyCapSnapshot`) and the weekly run sums the snapshots,
 *     reading Redis live only for a day whose counters can still be there;
 *   - the teacher-accepted share per identity tier (the Wilson 95% lower bound of the teacher's "Same child" taps,
 *     from the join queue's precisionByTier()), and whether the tier is auto-held.
 * Faked boundaries only: Supabase (the in-memory fake), the Redis service, the logger. The join queue module is
 * mocked here (its reads are the boundary), and absent in an isolated registry.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  const state = { up: true, failOn: null };
  const glob = (m) => new RegExp(`^${m.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return {
    __store: store,
    __state: state,
    isAvailable: jest.fn(() => state.up),
    scanValues: jest.fn(async (match) => {
      if (!state.up || (state.failOn && match.includes(state.failOn))) return null;
      const rx = glob(match);
      return [...store.entries()].filter(([k]) => rx.test(k)).map(([, v]) => v);
    }),
  };
});
// global.__absent names the module an isolated registry must not find (the module not deployed)
jest.mock('../../../shared/services/quiz/web-quiz-join-queue', () => {
  if (global.__absent === 'web-quiz-join-queue') throw new Error("Cannot find module './web-quiz-join-queue'");
  return ({ precisionByTier: jest.fn(async () => []) });
});

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const Redis = require('../../../shared/services/cache/railway-redis.service');
const { logToFile, logError } = require('../../../shared/utils/logger');
const Queue = require('../../../shared/services/quiz/web-quiz-join-queue');
const Strip = require('../../../shared/services/quiz/web-quiz-strip');

const WEEK = '2026-W42';                                  // Mon 12 Oct – Sun 18 Oct 2026, PKT
const NOW = Date.parse('2026-10-19T06:00:00Z');           // Monday 11:00 PKT: only Sunday's counters can still live
const HASH = (i) => `9f${String(i).padStart(4, '0')}c0ffee7d1e`;
const capKey = (day, i) => `wq:reply_cap:${day}:${HASH(i)}`;

let db;
const install = (extra = {}) => {
  db = { web_quiz_challenge_runs: [], web_quiz_strip_weekly: [], child_rungs: [], message_ledger: [], app_settings: [], ...extra };
  Object.assign(supabase, makeFake(db, { uniques: { web_quiz_strip_weekly: ['week', 'line', 'cell'] } }));
};
const line = (name, cell = '') => db.web_quiz_strip_weekly.find((r) => r.line === name && r.cell === cell);
const lines = (name) => db.web_quiz_strip_weekly.filter((r) => r.line === name);
let seq = 0;
const putCounts = (day, counts) => counts.forEach((c) => { seq += 1; Redis.__store.set(capKey(day, seq), String(c)); });
const everything = () => JSON.stringify([db, logToFile.mock.calls, logError.mock.calls]);

beforeEach(() => { Redis.__store.clear(); Redis.__state.up = true; Redis.__state.failOn = null; Queue.precisionByTier.mockImplementation(async () => []); });
afterEach(() => { jest.clearAllMocks(); });

describe('reply-cap histogram (counts only)', () => {
  test('phone-days by reply count in bins 1, 2, 3-4, 5-8 and capped (> cap, default 8); hits = phone-days over the cap', async () => {
    install();
    putCounts('2026-10-18', [1, 2, 3, 4, 5, 8, 9, 12]);
    putCounts('2026-10-19', [30]);                          // today, outside the week
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    const bins = Object.fromEntries(lines('reply_cap_phones').map((r) => [r.cell, r.value]));
    expect(bins).toEqual({ 1: 1, 2: 1, '3-4': 2, '5-8': 2, capped: 2 });
    expect(lines('reply_cap_phones').every((r) => r.n === 8)).toBe(true);
    expect(line('reply_cap_hits')).toMatchObject({ value: 2, n: 8 });
    expect(line('reply_cap_days_covered')).toMatchObject({ value: 1, n: 7 });
  });

  test('no key or hash leaves the read: nothing written or logged carries one', async () => {
    install();
    putCounts('2026-10-18', [1, 9]);
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    const all = everything();
    expect(all).not.toMatch(/wq:reply_cap/);
    expect(all).not.toMatch(/c0ffee7d1e/);
    expect(Redis.scanValues.mock.calls.every(([m]) => /^wq:reply_cap:\d{4}-\d{2}-\d{2}:\*$/.test(m))).toBe(true);
  });

  test('the cap comes from app_settings web_quiz_reply_cap_per_phone (3 → a 4th reply is a hit)', async () => {
    install({ app_settings: [{ key: 'web_quiz_reply_cap_per_phone', value: 3 }] });
    putCounts('2026-10-18', [1, 3, 4, 6]);
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    const bins = Object.fromEntries(lines('reply_cap_phones').map((r) => [r.cell, r.value]));
    expect(bins).toEqual({ 1: 1, 2: 0, '3-4': 1, '5-8': 0, capped: 2 });
    expect(line('reply_cap_hits')).toMatchObject({ value: 2, n: 4 });
  });

  test('a bad cap value is the default 8', async () => {
    install({ app_settings: [{ key: 'web_quiz_reply_cap_per_phone', value: 'lots' }] });
    putCounts('2026-10-18', [8, 9]);
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(line('reply_cap_hits')).toMatchObject({ value: 1, n: 2 });
  });

  test('Redis down: no reply-cap line, one log line says so, the other lines are written', async () => {
    install({ message_ledger: [{ day: '2026-10-14', trigger: 'home_reply', initiated: 'user', recipient: 'family', count: 1, usd: 0.015 }] });
    Redis.__state.up = false;
    putCounts('2026-10-18', [9]);
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(db.web_quiz_strip_weekly.filter((r) => r.line.startsWith('reply_cap'))).toEqual([]);
    expect(line('sends_total')).toMatchObject({ value: 1 });
    const said = logToFile.mock.calls.filter((c) => /reply-cap/i.test(c[0]));
    expect(said).toHaveLength(1);
  });

  test('the daily snapshot keeps yesterday\'s histogram past the 24-h counters, and the weekly run sums the snapshots', async () => {
    install();
    putCounts('2026-10-14', [1, 2, 9]);
    // Thursday 00:30 PKT: the daily job snapshots Wednesday while its counters still live
    const out = await Strip.replyCapSnapshot({ now: Date.parse('2026-10-14T19:30:00Z') });
    expect(out).toMatchObject({ day: '2026-10-14', phones: 3 });
    expect(Object.fromEntries(lines('reply_cap_day').map((r) => [r.cell, r.value])))
      .toEqual({ '2026-10-14|1': 1, '2026-10-14|2': 1, '2026-10-14|3-4': 0, '2026-10-14|5-8': 0, '2026-10-14|capped': 1 });
    expect(lines('reply_cap_day').every((r) => r.week === WEEK && r.n === 3)).toBe(true);
    // the counters expire; on Monday only Sunday's are live
    Redis.__store.clear();
    putCounts('2026-10-18', [12]);
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(line('reply_cap_hits')).toMatchObject({ value: 2, n: 4 });
    expect(line('reply_cap_days_covered')).toMatchObject({ value: 2, n: 7 });
    expect(everything()).not.toMatch(/c0ffee7d1e/);
  });

  test('a day already snapshotted is not read live again; a day past the counters\' life is not scanned', async () => {
    install();
    putCounts('2026-10-18', [2]);
    await Strip.replyCapSnapshot({ now: Date.parse('2026-10-18T19:10:00Z') });   // Monday 00:10 PKT
    Redis.scanValues.mockClear();
    Redis.__store.set(capKey('2026-10-18', 777), '9');                            // would change Sunday if read again
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(Redis.scanValues).not.toHaveBeenCalled();
    expect(line('reply_cap_hits')).toMatchObject({ value: 0, n: 1 });
    expect(line('reply_cap_days_covered')).toMatchObject({ value: 1, n: 7 });
  });

  test('the snapshot with Redis down writes nothing and says so once', async () => {
    install();
    Redis.__state.up = false;
    const out = await Strip.replyCapSnapshot({ now: Date.parse('2026-10-14T19:30:00Z') });
    expect(out).toMatchObject({ skipped: true });
    expect(db.web_quiz_strip_weekly).toEqual([]);
    expect(logToFile.mock.calls.filter((c) => /reply-cap/i.test(c[0]))).toHaveLength(1);
  });
});

describe('teacher-accepted share per tier (never called precision)', () => {
  const tiers = () => [
    { tier: 'roster_unique_with_loose', n: 60, same: 56, no: 6, undo: 2, precision: 0.9, wilson_lower_95: 0.7995, held: true },
    { tier: 'probable', n: 0, same: 0, no: 0, undo: 0, precision: null, wilson_lower_95: null, held: false },
  ];

  test('one accepted-share line (the Wilson 95% lower bound, n) and one held line (0/1) per tier', async () => {
    install();
    Queue.precisionByTier.mockImplementation(async () => tiers());
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(Queue.precisionByTier).toHaveBeenCalledTimes(1);
    expect(line('teacher_accepted_share', 'roster_unique_with_loose')).toMatchObject({ value: 0.7995, n: 60 });
    expect(line('teacher_accepted_held', 'roster_unique_with_loose')).toMatchObject({ value: 1, n: 60 });
    expect(line('teacher_accepted_share', 'probable')).toMatchObject({ value: null, n: 0 });
    expect(line('teacher_accepted_held', 'probable')).toMatchObject({ value: 0, n: 0 });
    expect(db.web_quiz_strip_weekly.some((r) => /precision/i.test(r.line))).toBe(false);
  });

  test('a failed queue read (error rows, held fail-closed) writes no accepted-share line and logs once', async () => {
    install();
    Queue.precisionByTier.mockImplementation(async () => tiers().map((t) => ({ ...t, held: true, error: true })));
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(lines('teacher_accepted_share')).toEqual([]);
    expect(lines('teacher_accepted_held')).toEqual([]);
    expect(logToFile.mock.calls.filter((c) => /accepted share/i.test(c[0]))).toHaveLength(1);
  });

  test('a throwing queue read never breaks the strip', async () => {
    install({ message_ledger: [{ day: '2026-10-14', trigger: 'home_reply', initiated: 'user', recipient: 'family', count: 2, usd: 0.03 }] });
    Queue.precisionByTier.mockImplementation(async () => { throw new Error('pooler down'); });
    await expect(Strip.weeklyStrip({ week: WEEK, now: NOW })).resolves.toBeDefined();
    expect(lines('teacher_accepted_share')).toEqual([]);
    expect(line('sends_total')).toMatchObject({ value: 2 });
  });

  test('the join queue module absent: no accepted-share line, one log line', async () => {
    // a fresh registry where the join queue module cannot be found
    global.__absent = 'web-quiz-join-queue';
    jest.resetModules();
    try {
      const sb = require('../../../shared/config/supabase');
      const lg = require('../../../shared/utils/logger');
      const S2 = require('../../../shared/services/quiz/web-quiz-strip');
      db = { web_quiz_challenge_runs: [], web_quiz_strip_weekly: [], child_rungs: [], message_ledger: [], app_settings: [] };
      Object.assign(sb, makeFake(db, { uniques: { web_quiz_strip_weekly: ['week', 'line', 'cell'] } }));
      await S2.weeklyStrip({ week: WEEK, now: NOW });
      expect(db.web_quiz_strip_weekly.filter((r) => r.line.startsWith('teacher_accepted'))).toEqual([]);
      expect(lg.logToFile.mock.calls.filter((c) => /accepted share/i.test(c[0]))).toHaveLength(1);
    } finally { delete global.__absent; jest.resetModules(); }
    expect(Queue.precisionByTier).not.toHaveBeenCalled();
  });
});
