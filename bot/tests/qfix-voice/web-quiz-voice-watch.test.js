/**
 * The daily voice alarm: the share of web-quiz page sittings that lost >=1 read-aloud clip, per Pakistan day, posted on
 * the existing ops stream (the quiz funnel watcher's Slack DM) when it crosses its line.
 *
 * Bug (Nov 2026): the share rose from ~8% (12-20 Oct) to 23.8% on 19 Nov and nobody was told. The run is executed
 * for real; only its boundaries are fakes that follow the real shapes (Axiom rows, a Redis with setNX/get/set, the
 * Slack post).
 */
const W = require('../../shared/services/monitoring/web-quiz-voice-watch.service');

// Production Axiom, PKT days (axiom/baseline_daily.json in the lane's folder): sittings, sittings that lost a clip,
// and the fallback events by reason.
const DAYS = {
  '2026-10-15': { sit: 1738, hit: 126, fb: 738, stalled: 261, reject: 333, unsupported: 120, error: 24 },
  '2026-11-17': { sit: 1682, hit: 230, fb: 1863, stalled: 491, reject: 658, unsupported: 397, error: 317 },
  '2026-11-18': { sit: 1247, hit: 198, fb: 1544, stalled: 1195, reject: 231, unsupported: 19, error: 99 },
  '2026-11-19': { sit: 1005, hit: 239, fb: 1652, stalled: 862, reject: 435, unsupported: 276, error: 79 },
};
const day = (d, over = {}) => ({ day: d, ...DAYS[d], ...over });

describe('the line', () => {
  test('19 Nov (23.8% of 1,005 sittings) crosses the one-day line', () => {
    const v = W.verdict([day('2026-11-17'), day('2026-11-18'), day('2026-11-19')]);
    expect(v.alert).toBe(true);
    expect(v.why).toBe('day');
    expect(v.share).toBeCloseTo(23.78, 1);
  });

  test('an ordinary mid-October day (7.2%) is quiet', () => {
    const q = { sit: 1700, hit: 125 };
    expect(W.verdict([{ day: '2026-10-13', ...q }, { day: '2026-10-14', ...q }, day('2026-10-15')]).alert).toBe(false);
  });

  test('three days running at 12-14% cross the rolling line though no single day reaches 15%', () => {
    const v = W.verdict([{ day: 'a', sit: 1000, hit: 125 }, { day: 'b', sit: 1000, hit: 130 }, { day: 'c', sit: 1000, hit: 140 }]);
    expect(v).toMatchObject({ alert: true, why: 'rolling' });
  });

  test('a small day (under 300 sittings) never alerts on its own, however high its share', () => {
    expect(W.verdict([{ day: 'a', sit: 900, hit: 60 }, { day: 'b', sit: 900, hit: 60 }, { day: 'c', sit: 120, hit: 40 }]).alert).toBe(false);
  });
});

function fakeRedis() {
  const m = new Map();
  return {
    m,
    isAvailable: () => true,
    setNX: async (k, v) => { if (m.has(k)) return false; m.set(k, v); return true; },
    get: async (k) => (m.has(k) ? m.get(k) : null),
    set: async (k, v) => { m.set(k, v); return 'OK'; },
    del: async (k) => m.delete(k),
  };
}
// Axiom by window: the run asks one PKT day per query (19:00Z the day before to 19:00Z).
const query = (asked) => async (name, apl, start) => {
  asked.push({ name, apl, start });
  const d = new Date(Date.parse(start) + 5 * 3600 * 1000).toISOString().slice(0, 10);
  return DAYS[d] ? [DAYS[d]] : [{ sit: 0, hit: 0 }];
};
const ENV = { WEB_QUIZ_VOICE_WATCH_ENABLED: 'true', AXIOM_TOKEN: 't', QUIZ_FUNNEL_WATCH_SLACK_TOKEN: 's', QUIZ_FUNNEL_WATCH_SLACK_CHANNEL: 'D1', NODE_ENV: 'production' };
const at = (iso) => new Date(iso);

describe('the run (once per Pakistan day, after 09:00 PKT, one replica)', () => {
  test('the morning after 19 Nov it posts one alert naming the share, the count, the baseline and the reasons', async () => {
    const posted = []; const asked = [];
    const out = await W.run({ now: at('2026-11-20T04:30:00Z'), env: ENV, redis: fakeRedis(), query: query(asked), post: async (t) => posted.push(t) });
    expect(out).toMatchObject({ outcome: 'alert', day: '2026-11-19' });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatch(/23\.8%/);
    expect(posted[0]).toMatch(/239 of 1,005/);
    expect(posted[0]).toMatch(/stalled 862/);
    expect(asked[0].apl).toMatch(/\['niete-logs'\] \| where env == 'production'/);
    expect(asked.map((a) => a.start)).toEqual(['2026-11-18T19:00:00.000Z', '2026-11-17T19:00:00.000Z', '2026-11-16T19:00:00.000Z']);
  });

  test('a second tick the same day posts nothing (the day\'s marker)', async () => {
    const posted = []; const redis = fakeRedis();
    await W.run({ now: at('2026-11-20T04:30:00Z'), env: ENV, redis, query: query([]), post: async (t) => posted.push(t) });
    redis.m.delete('web_quiz_voice_watch:tick');
    const out = await W.run({ now: at('2026-11-20T05:30:00Z'), env: ENV, redis, query: query([]), post: async (t) => posted.push(t) });
    expect(out.outcome).toBe('done_already');
    expect(posted).toHaveLength(1);
  });

  test('a quiet day is checked and marked, and nothing is posted', async () => {
    const posted = [];
    const out = await W.run({ now: at('2026-10-16T04:30:00Z'), env: ENV, redis: fakeRedis(), query: query([]), post: async (t) => posted.push(t) });
    expect(out).toMatchObject({ outcome: 'quiet', day: '2026-10-15' });
    expect(posted).toEqual([]);
  });

  test('before 09:00 PKT it waits; switched off or unconfigured it never asks Axiom', async () => {
    const asked = [];
    expect((await W.run({ now: at('2026-11-20T03:00:00Z'), env: ENV, redis: fakeRedis(), query: query(asked), post: async () => {} })).outcome).toBe('not_due');
    expect((await W.run({ now: at('2026-11-20T04:30:00Z'), env: { ...ENV, WEB_QUIZ_VOICE_WATCH_ENABLED: '' }, redis: fakeRedis(), query: query(asked), post: async () => {} })).outcome).toBe('off');
    expect((await W.run({ now: at('2026-11-20T04:30:00Z'), env: { ...ENV, QUIZ_FUNNEL_WATCH_SLACK_TOKEN: '', PROD_DIGEST_SLACK_TOKEN: '' }, redis: fakeRedis(), query: query(asked), post: async () => {} })).outcome).toBe('unconfigured');
    expect(asked).toEqual([]);
  });

  test('inside the week after a 3-day post, a day 5 points above the posted share posts again', async () => {
    const rolling = { '2026-11-11': { sit: 1300, hit: 170 }, '2026-11-12': { sit: 1300, hit: 170 }, '2026-11-13': { sit: 1300, hit: 170 }, '2026-11-14': { sit: 1300, hit: 170 } };
    const q = async (name, apl, start) => { const d = new Date(Date.parse(start) + 5 * 3600 * 1000).toISOString().slice(0, 10); return [rolling[d] || DAYS[d] || { sit: 0, hit: 0 }]; };
    const posted = []; const redis = fakeRedis();
    const tick = async (iso) => { redis.m.delete('web_quiz_voice_watch:tick'); return W.run({ now: at(iso), env: ENV, redis, query: q, post: async (t) => posted.push(t) }); };
    expect((await tick('2026-11-14T04:30:00Z')).outcome).toBe('alert');
    expect((await tick('2026-11-15T04:30:00Z')).outcome).toBe('quiet_repeat');
    expect(posted).toHaveLength(1);
    rolling['2026-11-15'] = { sit: 1300, hit: 260 }; // 20%: over the one-day line
    expect((await tick('2026-11-16T04:30:00Z')).outcome).toBe('alert');
    expect(posted).toHaveLength(2);
  });

  test('a cache that is down is a skip, never a post', async () => {
    const posted = [];
    const redis = { ...fakeRedis(), isAvailable: () => false };
    const out = await W.run({ now: at('2026-11-20T04:30:00Z'), env: ENV, redis, query: query([]), post: async (t) => posted.push(t) });
    expect(out).toMatchObject({ outcome: 'skipped', reason: 'unavailable' });
    expect(posted).toEqual([]);
  });
});

// Production Axiom, the 42 PKT days 10 Oct - 20 Nov 2026 (axiom/baseline_daily.json in the lane's folder): page
// sittings, and sittings that lost >=1 clip. 25 of the 42 cross a line, so a post per crossing is wallpaper.
const HISTORY = {
  '2026-10-10': [345, 56], '2026-10-11': [581, 67], '2026-10-12': [1026, 92], '2026-10-13': [1215, 88], '2026-10-14': [2247, 189],
  '2026-10-15': [1738, 126], '2026-10-16': [1143, 94], '2026-10-17': [514, 41], '2026-10-18': [427, 33], '2026-10-19': [1330, 101],
  '2026-10-20': [1541, 128], '2026-10-21': [1635, 192], '2026-10-22': [1394, 208], '2026-10-23': [962, 120], '2026-10-24': [768, 97],
  '2026-10-25': [625, 110], '2026-10-26': [1204, 162], '2026-10-27': [1417, 191], '2026-10-28': [1555, 217], '2026-10-29': [1299, 234],
  '2026-10-30': [996, 134], '2026-10-31': [837, 155], '2026-11-01': [788, 118], '2026-11-02': [1289, 181], '2026-11-03': [1227, 136],
  '2026-11-04': [1422, 142], '2026-11-05': [1085, 150], '2026-11-06': [761, 89], '2026-11-07': [404, 61], '2026-11-08': [333, 60],
  '2026-11-09': [295, 36], '2026-11-10': [933, 131], '2026-11-11': [1300, 189], '2026-11-12': [1495, 198], '2026-11-13': [1116, 148],
  '2026-11-14': [840, 94], '2026-11-15': [584, 73], '2026-11-16': [992, 125], '2026-11-17': [1682, 230], '2026-11-18': [1247, 198],
  '2026-11-19': [1005, 239], '2026-11-20': [630, 88],
};
// A Redis that keeps TTLs against the run's own clock (the marker's week is what is under test).
function clockRedis() {
  const m = new Map();
  let now = 0;
  const live = (k) => { const e = m.get(k); if (e && e.until !== null && now >= e.until) m.delete(k); return m.get(k); };
  return {
    m,
    at: (d) => { now = d.getTime(); },
    isAvailable: () => true,
    setNX: async (k, v, ttl) => { if (live(k)) return false; m.set(k, { v, until: ttl ? now + ttl * 1000 : null }); return true; },
    get: async (k) => { const e = live(k); return e ? e.v : null; },
    set: async (k, v, ttl) => { m.set(k, { v, until: ttl ? now + ttl * 1000 : null }); return 'OK'; },
  };
}
const historyQuery = async (name, apl, start) => {
  const d = new Date(Date.parse(start) + 5 * 3600 * 1000).toISOString().slice(0, 10);
  const h = HISTORY[d];
  return [h ? { sit: h[0], hit: h[1], fb: h[1] * 6, stalled: h[1] * 2, reject: h[1] * 2, unsupported: h[1], error: h[1] } : { sit: 0, hit: 0 }];
};
async function replay() {
  const redis = clockRedis(); const posted = []; const outcomes = [];
  for (const d of Object.keys(HISTORY)) {
    const now = new Date(Date.parse(`${d}T04:30:00Z`) + 86400000); // 09:30 PKT the morning after
    redis.at(now);
    redis.m.delete('web_quiz_voice_watch:tick');
    const out = await W.run({ now, env: ENV, redis, query: historyQuery, post: async (t) => posted.push({ day: d, text: t }) });
    outcomes.push(out);
  }
  return { posted, outcomes };
}

describe('A69: one 7-day marker for both lines; inside the week only a day 5 points above the posted share posts again', () => {
  test('over the 42 days of production history it posts on 7 mornings, the 19 Nov spike among them', async () => {
    const { posted, outcomes } = await replay();
    const days = posted.map((p) => p.day);
    console.log(`A69 posting days (42-day replay): ${days.join(' ')}`); // eslint-disable-line no-console
    expect(days).toEqual(['2026-10-10', '2026-10-23', '2026-10-25', '2026-11-01', '2026-11-08', '2026-11-15', '2026-11-19']);
    expect(outcomes.filter((o) => o.outcome === 'alert')).toHaveLength(7);
  });

  test('18 Nov (15.9%, over the one-day line) stays quiet: under 5 points above the 12.5% posted on 15 Nov', async () => {
    const { outcomes } = await replay();
    expect(outcomes.find((o) => o.day === '2026-11-18')).toMatchObject({ outcome: 'quiet_repeat', why: 'day' });
  });

  test('the re-post says how far the share rose since the last post', async () => {
    const { posted } = await replay();
    const p = posted.find((x) => x.day === '2026-11-19');
    expect(p.text).toMatch(/23\.8% of page sittings lost a read-aloud clip on 2026-11-19 \(239 of 1,005\)/);
    expect(p.text).toMatch(/up 11\.3 points since the last post \(12\.5% on 2026-11-15\)/);
  });

  test('the weekly 3-day post names each day\'s share, so chronic and spike read apart without a second query', async () => {
    const { posted } = await replay();
    const p = posted.find((x) => x.day === '2026-11-15');
    expect(p.text).toMatch(/2026-11-13 13\.3%, 2026-11-14 11\.2%, 2026-11-15 12\.5%/);
  });
});

describe('the schedule', () => {
  const fakeTimers = () => {
    const calls = { intervals: [], timeouts: [] };
    return { calls, setIntervalFn: (fn, ms) => { calls.intervals.push({ fn, ms }); return { unref() {} }; }, setTimeoutFn: (fn, ms) => { calls.timeouts.push({ fn, ms }); return { unref() {} }; } };
  };
  test('a main-queue replica ticks it hourly from a boot run; another replica never does', async () => {
    const { scheduleWebQuizVoiceWatch, FIRST_MS, TICK_MS } = require('../../workers/web-quiz-voice-watch-schedule');
    const t = fakeTimers(); let ran = 0;
    expect(scheduleWebQuizVoiceWatch({ hasMainQueue: false, ...t })).toBeNull();
    const out = scheduleWebQuizVoiceWatch({ hasMainQueue: true, ...t, run: async () => { ran += 1; return { outcome: 'quiet' }; } });
    expect(t.calls.timeouts).toEqual([{ fn: expect.any(Function), ms: FIRST_MS }]);
    await t.calls.timeouts[0].fn();
    expect(t.calls.intervals).toEqual([{ fn: expect.any(Function), ms: TICK_MS }]);
    expect(ran).toBe(1);
    expect(out).not.toBeNull();
  });
  test('a run that throws is said at error level and the tick lives on', async () => {
    const { scheduleWebQuizVoiceWatch } = require('../../workers/web-quiz-voice-watch-schedule');
    const t = fakeTimers();
    const out = scheduleWebQuizVoiceWatch({ hasMainQueue: true, ...t, run: async () => { throw new Error('axiom 500'); } });
    await expect(out.tick()).resolves.toBeNull();
  });
});
