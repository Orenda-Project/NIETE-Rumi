'use strict';
/**
 * The quiz funnel watcher — ONE stream to the operator, and no spam.
 *
 * Operator, 24 Sep 2026: "remove old watchers for quiz that spam by DM, and set
 * up a watcher that tracks both these quiz streams … notify me if something goes
 * wrong, otherwise once every 2 hours a quick summarized status view of the
 * funnel and whether it's flowing correctly."
 *
 * The hourly digest it replaces posted ~13 times a day (100 `prod_digest.reported`
 * in 7 days): chronic families — observation reports without notes, undelivered
 * child media — were non-zero in 40+ hours a week and each one was an "alert".
 * What this file holds:
 *
 *   1  counting    — the funnel per stream, from `quiz_funnel.*` rows; the
 *                    video-lesson quiz that shares the child engine is not counted
 *   2  verdicts    — flowing / stalled / idle, per stream
 *   3  alerts      — each rule's threshold, calibrated on prod (FINDINGS §2)
 *   4  quiet hours — summaries at the even PKT hours 08–22 only; alerts any hour
 *   5  dedup       — the same incident at most once per 2 h (a stuck quiz once a day)
 *   6  one replica — ~10 worker replicas, exactly one speaks per tick; a lock that
 *                    cannot be read is a SKIP, never ten DMs
 *   7  kill switch — nothing at all until QUIZ_FUNNEL_WATCH_ENABLED=true
 *   8  the stall rules are confirmed against the quiz row before they are sent:
 *                    Axiom drops ~0.2% of batches, and a lost `sent` line must not
 *                    page the operator about a quiz the teacher already has
 *   9  the render-gate trap stays out (lp612.render.failed is the author's own
 *                    quality gate, ~329/day, never a delivery failure)
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { logEvent } = require('../../bot/shared/utils/structured-logger');
const W = require('../../bot/shared/services/monitoring/quiz-funnel-watch.service');

const MIN = 60 * 1000;
const H = 60 * MIN;
/** A PKT wall-clock time on 24 Sep 2026 (a Thursday), as a Date. PKT = UTC+5, no DST. */
const pkt = (h, m = 0, day = 24) => new Date(Date.UTC(2026, 8, day, h - 5, m));
const iso = (d) => new Date(d).toISOString();
const Q = (n) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const S = (n) => `${String(n).padStart(8, '0')}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;

// ── fixtures: what the Axiom queries return ───────────────────────────────────

const sumRow = (stage, source, extra = {}) => ({
  stage, source, channel: '', choice: '', ok: '', kind: '', delivered: '', c: 1, q: 1, s: 0, n: 0, f: 0, k: 0, ...extra,
});
const WINDOW_ROWS = [
  sumRow('offer_made', 'transcript', { channel: 'coaching_offer', delivered: 'true', c: 40, q: 40 }),
  sumRow('offer_made', 'transcript', { channel: 'coaching_offer', delivered: 'false', c: 2, q: 2 }),
  sumRow('offer_answered', 'transcript', { channel: 'coaching_offer', choice: 'yes', c: 12, q: 12 }),
  sumRow('offer_answered', 'transcript', { channel: 'coaching_offer', choice: 'no', c: 8, q: 8 }),
  sumRow('accepted', 'transcript', { channel: 'coaching_offer', c: 11, q: 11 }),
  sumRow('accepted', 'transcript', { channel: 'quiz_menu', c: 3, q: 3 }),
  sumRow('generation_started', 'transcript', { c: 16, q: 14 }),
  sumRow('generated', 'transcript', { c: 13, q: 13 }),
  sumRow('generation_failed', 'transcript', { c: 1, q: 1 }),
  sumRow('sent', 'transcript', { c: 13, q: 13 }),
  sumRow('child_joined', 'transcript', { c: 85, q: 9, s: 85 }),
  sumRow('child_completed', 'transcript', { c: 61, q: 9, s: 61 }),
  sumRow('scorecard_sent', 'transcript', { ok: 'true', c: 60, s: 60 }),
  sumRow('scorecard_sent', 'transcript', { ok: 'false', c: 1, s: 1 }),
  sumRow('class_cards', 'transcript', { c: 5, n: 40, f: 1, k: 2 }),
  sumRow('report_sent', 'transcript', { kind: 'report', c: 7, q: 7 }),
  sumRow('report_sent', 'transcript', { kind: 'no_one', c: 2, q: 2 }),
  // the lesson-plan stream, and a video-lesson quiz that must not be counted anywhere
  sumRow('offer_made', 'lp_v8', { channel: 'lp_offer', delivered: 'true', c: 5, q: 0 }),
  sumRow('offer_answered', 'lp_v8', { channel: 'lp_offer', choice: 'class:g4_urdu', c: 2 }),
  sumRow('accepted', 'lp_v8', { channel: 'lp_offer', c: 2, q: 2 }),
  sumRow('child_joined', 'video', { c: 500, q: 30, s: 500 }),
];

function world({
  lifecycle = [], children = [], reports = [], counters = [], lpToday = [], window = WINDOW_ROWS, today = WINDOW_ROWS, other = [],
} = {}) {
  const byName = { lifecycle, children, reports, counters, lp_today: lpToday, summary: window, summary_today: today, other };
  const calls = [];
  const query = jest.fn(async (name, apl, start, end) => {
    calls.push({ name, apl, start, end });
    if (!(name in byName)) throw new Error(`unexpected query ${name}`);
    return byName[name];
  });
  query.calls = calls;
  return query;
}

function fakeRedis() {
  const m = new Map();
  return {
    m,
    isAvailable: () => true,
    setNX: jest.fn(async (k, v) => { if (m.has(k)) return false; m.set(k, v); return true; }),
    get: jest.fn(async (k) => (m.has(k) ? m.get(k) : null)),
    set: jest.fn(async (k, v) => { m.set(k, v); return true; }),
    delete: jest.fn(async (k) => m.delete(k)),
  };
}

const CFG = W.config({});
const life = (q, stage, source, at, reasons = []) => ({ q, stage, source, t: iso(at), reasons });

beforeEach(() => { jest.clearAllMocks(); });

// ── 1 · counting ─────────────────────────────────────────────────────────────

describe('1 · the funnel, counted per stream from quiz_funnel rows', () => {
  test('every stage of the transcript stream', () => {
    const c = W.streamCounts(WINDOW_ROWS).transcript;
    expect(c).toEqual(expect.objectContaining({
      offers: 42, undelivered: 2, yes: 12, no: 8, accepted: 14, menu: 3, generated: 13, failed: 1, sent: 13,
      joined: 85, completed: 61, scorecards: 60, scorecardFallback: 1, classCards: 40, classCardFailed: 1,
      reports: 7, reportsNoOne: 2,
    }));
  });

  // Staging E2E, 25 Sep: "children 2 joined → 1 finished" on a quiz ONE child
  // took — the second join was the teacher testing their own class link.
  test('the teacher\'s own test run (kind self_test) is not a child: not joined, not finished, no scorecard', () => {
    const rows = [
      sumRow('child_joined', 'lp_v8', { c: 1, q: 1, s: 1 }),
      sumRow('child_joined', 'lp_v8', { kind: 'self_test', c: 1, q: 1, s: 1 }),
      sumRow('child_completed', 'lp_v8', { c: 1, q: 1, s: 1 }),
      sumRow('child_completed', 'lp_v8', { kind: 'self_test', c: 1, q: 1, s: 1 }),
      sumRow('scorecard_sent', 'lp_v8', { ok: 'true', c: 1, s: 1 }),
      sumRow('scorecard_sent', 'lp_v8', { ok: 'true', kind: 'self_test', c: 1, s: 1 }),
    ];
    expect(W.streamCounts(rows).lp).toEqual(expect.objectContaining({ joined: 1, completed: 1, scorecards: 1 }));
    expect(W.buildSummary({
      label: 'Last 2 h', window: W.streamCounts(rows), today: null, other: [], incidents: [], cfg: CFG,
    })).toMatch(/children 1 joined → 1 finished/);
  });

  test('a class picked from the lesson-plan list is a yes', () => {
    expect(W.streamCounts(WINDOW_ROWS).lp).toEqual(expect.objectContaining({ offers: 5, yes: 2, accepted: 2 }));
  });

  test('the video-lesson quiz shares the child engine and is counted in neither stream', () => {
    const c = W.streamCounts(WINDOW_ROWS);
    expect(c.transcript.joined).toBe(85);
    expect(c.lp.joined).toBe(0);
    expect(Object.keys(c)).toEqual(['transcript', 'lp']);
  });
});

// ── 2 · verdicts ─────────────────────────────────────────────────────────────

describe('2 · the verdict per stream', () => {
  test('traffic and no open incident is flowing', () => {
    expect(W.verdictFor(W.streamCounts(WINDOW_ROWS).transcript, [])).toBe('flowing');
  });
  test('no traffic at all is idle — the lesson-plan stream before it is switched on', () => {
    expect(W.verdictFor(W.streamCounts([]).lp, [])).toBe('idle');
  });
  test('an open incident on the stream is stalled, whatever the counts', () => {
    const counts = W.streamCounts(WINDOW_ROWS).transcript;
    expect(W.verdictFor(counts, [{ kind: 'gen_stall', stream: 'transcript', ids: [Q(1)] }], 'transcript')).toBe('stalled');
    expect(W.verdictFor(counts, [{ kind: 'gen_stall', stream: 'lp', ids: [Q(1)] }], 'transcript')).toBe('flowing');
  });
});

// ── 3 · alert rules ──────────────────────────────────────────────────────────

describe('3 · what counts as something wrong', () => {
  const now = pkt(11, 15);
  const kinds = (data) => W.findIncidents(data, now, CFG).map((i) => i.kind);

  test('generation failures: 2 of 12 in the hour is noise, 3 is an alert, 2 of 4 is an alert', () => {
    const made = (n) => Array.from({ length: n }, (_, i) => life(Q(100 + i), 'generated', 'transcript', now - 20 * MIN));
    const failed = (n) => Array.from({ length: n }, (_, i) => life(Q(i + 1), 'generation_failed', 'transcript', now - 10 * MIN, ['validator_failed']));
    expect(kinds({ lifecycle: [...made(10), ...failed(2)] })).not.toContain('gen_failures');
    expect(kinds({ lifecycle: [...made(10), ...failed(3)] })).toContain('gen_failures');
    expect(kinds({ lifecycle: [...made(2), ...failed(2)] })).toContain('gen_failures');
  });

  test('a failure older than the hour is not counted again', () => {
    const old = [1, 2, 3].map((i) => life(Q(i), 'generation_failed', 'transcript', now - 90 * MIN, ['model_failed']));
    expect(kinds({ lifecycle: old })).not.toContain('gen_failures');
  });

  test('generation stall: accepted over an hour ago with no outcome (prod p99 is 59 min)', () => {
    const inc = W.findIncidents({ lifecycle: [life(Q(1), 'accepted', 'transcript', now - 70 * MIN)] }, now, CFG);
    expect(inc).toEqual([expect.objectContaining({ kind: 'gen_stall', stream: 'transcript', ids: [Q(1)] })]);
    expect(kinds({ lifecycle: [life(Q(1), 'accepted', 'transcript', now - 50 * MIN)] })).toEqual([]);
    expect(kinds({ lifecycle: [
      life(Q(1), 'accepted', 'transcript', now - 70 * MIN), life(Q(1), 'sent', 'transcript', now - 5 * MIN),
    ] })).toEqual([]);
    expect(kinds({ lifecycle: [
      life(Q(1), 'accepted', 'transcript', now - 70 * MIN), life(Q(1), 'generation_failed', 'transcript', now - 5 * MIN),
    ] })).toEqual([]);
  });

  test('send stall: made over 15 minutes ago and never sent', () => {
    expect(kinds({ lifecycle: [life(Q(1), 'generated', 'lp_v8', now - 20 * MIN)] })).toEqual(['send_stall']);
    expect(kinds({ lifecycle: [life(Q(1), 'generated', 'lp_v8', now - 5 * MIN)] })).toEqual([]);
  });

  test('a link that did not reach the teacher is an alert, naming the quiz', () => {
    const inc = W.findIncidents({ lifecycle: [
      life(Q(1), 'generated', 'transcript', now - 30 * MIN), life(Q(1), 'sent', 'transcript', now - 29 * MIN),
      life(Q(1), 'send_failed', 'transcript', now - 29 * MIN, ['link_not_delivered']),
    ] }, now, CFG);
    expect(inc).toEqual([expect.objectContaining({ kind: 'send_failed', ids: [Q(1)] })]);
  });

  test('a finished child with no scorecard after 10 minutes', () => {
    const done = { s: S(1), q: Q(1), stage: 'child_completed', source: 'transcript', t: iso(now - 15 * MIN), oks: [] };
    const card = { s: S(1), q: Q(1), stage: 'scorecard_sent', source: 'transcript', t: iso(now - 15 * MIN), oks: ['true'] };
    expect(kinds({ children: [done] })).toEqual(['scorecard_missing']);
    expect(kinds({ children: [done, card] })).toEqual([]);
  });

  test('a report owed: a child joined over 22 hours ago and the teacher has had no report', () => {
    const joined = (q, ago, source = 'transcript') => ({ q, stage: 'child_joined', source, t: iso(now - ago) });
    const reported = (q) => ({ q, stage: 'report_sent', source: 'transcript', t: iso(now - 2 * H) });
    expect(kinds({ reports: [joined(Q(1), 23 * H)] })).toEqual(['report_owed']);
    expect(kinds({ reports: [joined(Q(1), 10 * H)] })).toEqual([]);
    expect(kinds({ reports: [joined(Q(1), 23 * H), reported(Q(1))] })).toEqual([]);
    expect(kinds({ reports: [joined(Q(1), 23 * H, 'video')] })).toEqual([]);
    // Only the teacher's own test run joined: no child, so no class report is owed.
    expect(kinds({ reports: [{ ...joined(Q(1), 23 * H), kind: 'self_test' }] })).toEqual([]);
    // The reports query brings the kind back, so the rule can see it.
    expect(W.aplFor({ env: 'production', dataset: 'niete-logs', now: pkt(12) }).reports).toMatch(/kind = tostring\(d\.kind\)/);
  });

  test('Meta rate limits: a send given up on is always an alert; retried refusals only when Meta is throttling hard', () => {
    // whatsapp.rate_limited is logged on every refusal: warn while the pacer retries, gaveUp:true when it stops.
    expect(kinds({ counters: [{ k: 'rate_limited_gave_up', c60: 1, c120: 1, lag: 0 }] })).toEqual(['rate_limited']);
    expect(kinds({ counters: [{ k: 'rate_limited_retried', c60: 5, c120: 5, lag: 0 }] })).toEqual([]);
    expect(kinds({ counters: [{ k: 'rate_limited_retried', c60: 40, c120: 40, lag: 0 }] })).toEqual(['rate_limited']);
  });

  test('coaching ran but no quiz was offered, in school hours', () => {
    const c = (analyses, offers) => [
      { k: 'analysis_completed', c60: analyses, c120: analyses, lag: 0 },
      { k: 'coaching_offers', c60: offers, c120: offers, lag: 0 },
    ];
    expect(kinds({ counters: c(12, 0) })).toEqual(['zero_offers']);
    expect(kinds({ counters: c(12, 3) })).toEqual([]);
    expect(kinds({ counters: c(3, 0) })).toEqual([]);                                   // too little coaching to expect one
    expect(W.findIncidents({ counters: c(12, 0) }, pkt(20, 0), CFG)).toEqual([]);         // outside school hours
  });

  test('the lesson-plan offer: a cohort was built today and no offer went out by 16:30', () => {
    const lp = (inserted, offers, skipped = 0) => [{ inserted, offers, skipped }];
    expect(W.findIncidents({ lpToday: lp(40, 0) }, pkt(16, 45), CFG).map((i) => i.kind)).toEqual(['lp_offers_missing']);
    expect(W.findIncidents({ lpToday: lp(40, 0) }, pkt(15, 45), CFG)).toEqual([]);
    expect(W.findIncidents({ lpToday: lp(40, 12) }, pkt(16, 45), CFG)).toEqual([]);
    expect(W.findIncidents({ lpToday: lp(40, 0, 40) }, pkt(16, 45), CFG)).toEqual([]);  // all skipped for a reason
    expect(W.findIncidents({ lpToday: lp(0, 0) }, pkt(16, 45), CFG)).toEqual([]);
  });

  test('the old digest\'s families are spikes, not every non-zero hour', () => {
    const k = (key, c60, extra = {}) => ({ k: key, c60, c120: c60, lag: 0, ...extra });
    expect(kinds({ counters: [k('lp612_failed', 1)] })).toEqual([]);
    expect(kinds({ counters: [k('lp612_failed', 3)] })).toEqual(['lp612_failed']);
    expect(kinds({ counters: [k('coaching_errors', 3)] })).toEqual(['coaching_errors']);
    expect(kinds({ counters: [k('observe_degraded', 3), k('observe_delivered', 20)] })).toEqual([]);
    expect(kinds({ counters: [k('observe_degraded', 3), k('observe_delivered', 1)] })).toEqual(['observe_degraded']);
    expect(kinds({ counters: [k('media_not_delivered', 12)] })).toEqual([]);
    expect(kinds({ counters: [k('media_not_delivered', 40)] })).toEqual(['media_not_delivered']);
    expect(kinds({ counters: [
      k('analysis_started', 0, { lag: 20 }), k('analysis_completed', 12), k('coaching_offers', 5),
    ] })).toEqual(['coaching_lost']);
  });

  test('an alert names the quizzes, never a teacher or child', () => {
    const inc = W.findIncidents({ lifecycle: [life(Q(1), 'accepted', 'transcript', now - 70 * MIN)] }, now, CFG);
    const text = W.buildAlert(inc, now);
    expect(text).toContain(Q(1).slice(0, 8));
    expect(text).not.toMatch(/\b92\d{9,}\b/);
  });
});

// ── 4 · quiet hours ──────────────────────────────────────────────────────────

describe('4 · summaries at the even PKT hours 08–22, never overnight', () => {
  test.each([
    [pkt(7, 30), null],
    [pkt(8, 5), '08'],
    [pkt(9, 59), '08'],
    [pkt(10, 0), '10'],
    [pkt(22, 10), '22'],
    [pkt(23, 50), '22'],
    [pkt(0, 30, 25), null],
  ])('%s → slot %s', (now, hour) => {
    const slot = W.slotFor(now);
    expect(slot ? slot.hour : null).toBe(hour);
  });

  test('the 08:00 summary covers the night since 22:00; every other covers two hours', () => {
    const morning = W.slotFor(pkt(8, 5));
    expect(morning.end - morning.start).toBe(10 * H);
    const noon = W.slotFor(pkt(12, 20));
    expect(noon.end - noon.start).toBe(2 * H);
    expect(noon.end.getTime()).toBe(pkt(12, 0).getTime());
  });
});

// ── 5–8 · run(): one replica, dedup, kill switch, DB confirmation ────────────

const ENV = {
  QUIZ_FUNNEL_WATCH_ENABLED: 'true', QUIZ_FUNNEL_WATCH_SLACK_TOKEN: 'x', QUIZ_FUNNEL_WATCH_SLACK_CHANNEL: 'D1', AXIOM_TOKEN: 'a',
};
function deps({ redis = fakeRedis(), query = world(), confirm = jest.fn(async (ids) => ids.map((id) => ({ id, status: 'generating' }))) } = {}) {
  return { redis, query, confirm, post: jest.fn(async () => 'ts'), env: ENV };
}

describe('7 · the kill switch', () => {
  test('unset: nothing is queried, nothing is posted, nothing is locked', async () => {
    const d = deps();
    const out = await W.run({ now: pkt(10, 5), ...d, env: {} });
    expect(out).toEqual({ skipped: 'disabled' });
    expect(d.query).not.toHaveBeenCalled();
    expect(d.post).not.toHaveBeenCalled();
    expect(d.redis.setNX).not.toHaveBeenCalled();
  });

  test('armed but with nowhere to post: skipped as unconfigured, and says so', async () => {
    const d = deps();
    const out = await W.run({ now: pkt(10, 5), ...d, env: { QUIZ_FUNNEL_WATCH_ENABLED: 'true', AXIOM_TOKEN: 'a' } });
    expect(out).toEqual({ skipped: 'unconfigured' });
    expect(d.post).not.toHaveBeenCalled();
  });

  test('the old digest\'s Slack settings are used when the watcher has none of its own', () => {
    expect(W.slackTarget({ PROD_DIGEST_SLACK_TOKEN: 't', PROD_DIGEST_SLACK_CHANNEL: 'C' })).toEqual({ token: 't', channel: 'C' });
    expect(W.slackTarget({ ...ENV, PROD_DIGEST_SLACK_CHANNEL: 'C' }).channel).toBe('D1');
  });
});

describe('6 · exactly one replica speaks per tick', () => {
  test('ten replicas ticking together: one summary', async () => {
    const redis = fakeRedis();
    const query = world();
    const posts = [];
    const replicas = Array.from({ length: 10 }, () => ({ ...deps({ redis, query }), post: jest.fn(async (t) => { posts.push(t); return 'ts'; }) }));
    const outs = await Promise.all(replicas.map((d) => W.run({ now: pkt(10, 5), ...d })));
    expect(posts).toHaveLength(1);
    expect(outs.filter((o) => o.skipped === 'another_replica')).toHaveLength(9);
    expect(logEvent.mock.calls.filter((c) => c[0] === 'quiz_funnel_watch.skipped' && c[1].why === 'another_replica')).toHaveLength(9);
  });

  test('a lock that cannot be read is a skip, never a post — ten replicas would all post', async () => {
    const redis = fakeRedis();
    redis.get.mockResolvedValue(null);          // Redis down: the old lock failed OPEN here
    const d = deps({ redis });
    const out = await W.run({ now: pkt(10, 5), ...d });
    expect(out).toEqual({ skipped: 'lock_unavailable' });
    expect(d.post).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith('quiz_funnel_watch.skipped', { why: 'lock_unavailable' });
  });
});

describe('5 · the same incident is sent once', () => {
  const stalled = world({ lifecycle: [life(Q(1), 'accepted', 'transcript', pkt(3, 0) - 70 * MIN)] });

  test('a stuck quiz is alerted once, overnight included; a new one is alerted when it appears', async () => {
    const redis = fakeRedis();
    const d1 = deps({ redis, query: stalled });
    await W.run({ now: pkt(3, 0), ...d1 });
    expect(d1.post).toHaveBeenCalledTimes(1);
    expect(d1.post.mock.calls[0][0]).toContain(Q(1).slice(0, 8));

    redis.m.delete(W.TICK_KEY);                // the next tick, 15 minutes on
    const d2 = deps({ redis, query: stalled });
    await W.run({ now: pkt(3, 15), ...d2 });
    expect(d2.post).not.toHaveBeenCalled();

    redis.m.delete(W.TICK_KEY);
    const two = world({ lifecycle: [
      life(Q(1), 'accepted', 'transcript', pkt(3, 0) - 70 * MIN), life(Q(2), 'accepted', 'transcript', pkt(3, 30) - 65 * MIN),
    ] });
    const d3 = deps({ redis, query: two });
    await W.run({ now: pkt(3, 30), ...d3 });
    expect(d3.post).toHaveBeenCalledTimes(1);
    expect(d3.post.mock.calls[0][0]).toContain(Q(2).slice(0, 8));
    expect(d3.post.mock.calls[0][0]).not.toContain(Q(1).slice(0, 8));
  });

  test('a rate alert is sent at most once in two hours', async () => {
    const redis = fakeRedis();
    const q = world({ counters: [{ k: 'rate_limited_gave_up', c60: 5, c120: 5, lag: 0 }] });
    const d1 = deps({ redis, query: q });
    await W.run({ now: pkt(3, 0), ...d1 });
    redis.m.delete(W.TICK_KEY);
    const d2 = deps({ redis, query: q });
    await W.run({ now: pkt(3, 45), ...d2 });
    expect(d1.post).toHaveBeenCalledTimes(1);
    expect(d2.post).not.toHaveBeenCalled();
  });

  test('a post that fails is not marked as sent, so the next tick tries again', async () => {
    const redis = fakeRedis();
    const d1 = deps({ redis, query: stalled });
    d1.post.mockRejectedValue(new Error('slack 500'));
    await W.run({ now: pkt(3, 0), ...d1 });
    redis.m.delete(W.TICK_KEY);
    const d2 = deps({ redis, query: stalled });
    await W.run({ now: pkt(3, 15), ...d2 });
    expect(d2.post).toHaveBeenCalledTimes(1);
  });
});

describe('4b · summaries: once per slot, never overnight, alerts folded in', () => {
  test('one summary per slot however many ticks fall inside it', async () => {
    const redis = fakeRedis();
    const d1 = deps({ redis });
    await W.run({ now: pkt(10, 5), ...d1 });
    redis.m.delete(W.TICK_KEY);
    const d2 = deps({ redis });
    await W.run({ now: pkt(10, 20), ...d2 });
    expect(d1.post).toHaveBeenCalledTimes(1);
    expect(d2.post).not.toHaveBeenCalled();
    expect(d1.post.mock.calls[0][0]).toMatch(/08:00–10:00 PKT/);
  });

  test('overnight: no summary, and a clean tick posts nothing at all', async () => {
    const d = deps();
    const out = await W.run({ now: pkt(3, 0), ...d });
    expect(d.post).not.toHaveBeenCalled();
    expect(out).toEqual(expect.objectContaining({ summary: false, alerts: 0 }));
    expect(logEvent).toHaveBeenCalledWith('quiz_funnel_watch.tick', expect.objectContaining({ alerts: 0, summary: false }));
  });

  test('an alert due in the same tick as a summary rides in it — one message, not two', async () => {
    const d = deps({ query: world({ lifecycle: [life(Q(1), 'accepted', 'transcript', pkt(10, 5) - 70 * MIN)] }) });
    await W.run({ now: pkt(10, 5), ...d });
    expect(d.post).toHaveBeenCalledTimes(1);
    const text = d.post.mock.calls[0][0];
    expect(text).toContain(Q(1).slice(0, 8));
    expect(text).toMatch(/From recordings/);
  });

  test('the summary shows both streams, their verdicts, and the chain', async () => {
    const d = deps();
    await W.run({ now: pkt(12, 5), ...d });
    const text = d.post.mock.calls[0][0];
    expect(text).toMatch(/From recordings.*flowing/);
    expect(text).toMatch(/From lesson plans/);
    expect(text).toMatch(/offers 42/);
    expect(text).toMatch(/61 finished/);
    expect(text).toMatch(/reports 7/);
    expect(text).not.toMatch(/\b92\d{9,}\b/);
  });
});

describe('8 · a stall is confirmed against the quiz row before it is sent', () => {
  test('a quiz Axiom lost the `sent` line for, but the row says sent, is not alerted', async () => {
    const d = deps({
      query: world({ lifecycle: [life(Q(1), 'accepted', 'transcript', pkt(3, 0) - 70 * MIN), life(Q(2), 'accepted', 'transcript', pkt(3, 0) - 70 * MIN)] }),
      confirm: jest.fn(async () => [{ id: Q(1), status: 'sent' }, { id: Q(2), status: 'generating' }]),
    });
    await W.run({ now: pkt(3, 0), ...d });
    expect(d.confirm).toHaveBeenCalledWith(expect.arrayContaining([Q(1), Q(2)]));
    const text = d.post.mock.calls[0][0];
    expect(text).toContain(Q(2).slice(0, 8));
    expect(text).not.toContain(Q(1).slice(0, 8));
  });

  test('the confirmation read is bounded: at most 25 ids, one call, only when there is a candidate', async () => {
    const many = Array.from({ length: 40 }, (_, i) => life(Q(i + 1), 'accepted', 'transcript', pkt(3, 0) - 70 * MIN));
    const d = deps({ query: world({ lifecycle: many }) });
    await W.run({ now: pkt(3, 0), ...d });
    expect(d.confirm).toHaveBeenCalledTimes(1);
    expect(d.confirm.mock.calls[0][0].length).toBeLessThanOrEqual(25);

    const quiet = deps();
    await W.run({ now: pkt(3, 0), ...quiet });
    expect(quiet.confirm).not.toHaveBeenCalled();
  });

  test('a confirmation that errors keeps the alert and says it is unconfirmed', async () => {
    const d = deps({
      query: world({ lifecycle: [life(Q(1), 'accepted', 'transcript', pkt(3, 0) - 70 * MIN)] }),
      confirm: jest.fn(async () => { throw new Error('db down'); }),
    });
    await W.run({ now: pkt(3, 0), ...d });
    expect(d.post.mock.calls[0][0]).toMatch(/not confirmed/i);
  });
});

describe('9 · the queries', () => {
  test('every query is scoped to one env — staging and production share the dataset', () => {
    for (const apl of Object.values(W.aplFor({ env: 'production', dataset: 'niete-logs', now: pkt(10, 5) }))) {
      expect(apl).toMatch(/^\['niete-logs'\] \| where env == 'production' \| /);
    }
  });

  test('the render-gate trap never reaches a query', () => {
    for (const apl of Object.values(W.aplFor({ env: 'production', dataset: 'niete-logs', now: pkt(10, 5) }))) {
      expect(apl).not.toMatch(/lp612\.render\.failed|render produced defects|revision_round/);
    }
  });

  test('Axiom\'s nanosecond timestamps are read as times', () => {
    expect(W.toMillis(1788808678198726700)).toBe(1788808678199);
    expect(W.toMillis('2026-09-07T20:07:58.198Z')).toBe(Date.parse('2026-09-07T20:07:58.198Z'));
    expect(W.toMillis('nonsense')).toBeNull();
  });
});

describe('10 · the CLI prints the exact DM text and posts nothing', () => {
  const Cli = require('../../bot/scripts/quiz-funnel-watch');

  test('--dry-run prints the summary and the alerts it would send, and asks for no Slack token', async () => {
    const lines = [];
    const query = world({ lifecycle: [life(Q(7), 'accepted', 'transcript', Date.now() - 70 * MIN)] });
    const code = await Cli.main(['--env', 'staging', '--window', '2h', '--dry-run'], { out: (s) => lines.push(s), query });
    expect(code).toBe(0);
    const text = lines.join('\n');
    expect(text).toMatch(/From recordings/);
    expect(text).toContain(Q(7).slice(0, 8));
    expect(text).toMatch(/not confirmed/i);                   // a dry run has no database to confirm against
    expect(query.calls.every((c) => /where env == 'staging'/.test(c.apl))).toBe(true);
    // The window asked for is the window queried.
    const summary = query.calls.find((c) => c.name === 'summary');
    expect(Date.parse(summary.end) - Date.parse(summary.start)).toBe(2 * H);
  });

  test('without --dry-run it refuses: the CLI never posts', async () => {
    const lines = [];
    const code = await Cli.main(['--env', 'production'], { out: (s) => lines.push(s), query: world() });
    expect(code).toBe(2);
    expect(lines.join('\n')).toMatch(/--dry-run/);
  });
});
