'use strict';
/**
 * The production incident watch — rule-based Slack alerts, no model anywhere in the path.
 *
 * Operator, 25 Nov 2026: "we need log monitoring (without the use of any LLM inference) to drop in
 * alerts in case of major errors in a slack channel." That morning the OpenRouter key hit its total
 * limit at 10:05 PKT; 150 jobs failed and each one told a teacher "please try again" before anyone saw it.
 *
 * What this file holds:
 *   1  no model   — the module (and what it requires) never loads an LLM client
 *   2  replay     — 25 Nov 05:00-06:00 UTC: the provider alert in the 05:05-05:10 check, the job
 *                   failures in its thread, one top-level post, an all-clear after 05:44
 *   3  quiet day  — a normal morning posts nothing
 *   4  each rule  — fires at its line and stays quiet just under it
 *   5  threads    — one incident = one post; updates at most every 30 min; all-clear after 2 clean checks
 *   6  key budget — the OpenRouter /key maths: under 10% or 3 days warns, under 3% or 1 day again, once a day
 *   7  one replica, kill switch — a held or unreadable claim never posts; nothing runs until enabled
 *   8  privacy    — only counts, scrubbed code-authored lines and regex-extracted amounts reach Slack
 *
 * Fixture: tests/monitoring/fixtures/niete-prod-2026-11-25-outage.json — per-minute counts per rule key
 * from niete-logs production (no ids, no phones, no message bodies).
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
// Loading an LLM client anywhere under the watcher fails the suite (section 1).
jest.mock('../../bot/shared/services/llm-client', () => { throw new Error('the incident watch loaded llm-client'); });

const fs = require('fs');
const path = require('path');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const W = require('../../bot/shared/services/monitoring/prod-incident-watch.service');
const FIX = require('./fixtures/niete-prod-2026-11-25-outage.json');

const MIN = 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const utc = (hhmm, day = '2026-11-25') => new Date(`${day}T${hhmm}:00Z`);

/** An in-memory store with the railway-redis surface the watcher uses. */
function memStore() {
  const m = new Map();
  return {
    m,
    isAvailable: () => true,
    get: async (k) => (m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : null),
    set: async (k, v) => { m.set(k, typeof v === 'string' ? v : JSON.parse(JSON.stringify(v))); return true; },
    setNX: async (k, v) => { if (m.has(k)) return false; m.set(k, v); return true; },
  };
}

/** A query function that serves fixture rows the way Axiom would for [start, end). */
function fixtureQuery({ bins = [], baseline = FIX.baseline.rows, boots = [], sample = FIX.outage.refusalSample, top = FIX.outage.refusalTop } = {}) {
  const tOf = (r) => r.t || r._time;
  const inRange = (rows, s, e) => rows.filter((r) => { const t = Date.parse(tOf(r)); return t >= Date.parse(s) && t < Date.parse(e); });
  return jest.fn(async (name, apl, s, e) => {
    if (name === 'bins') return inRange(bins, s, e).map((r) => ({ _time: tOf(r), k: r.k, c: r.c }));
    if (name === 'baseline') return inRange(baseline, s, e).map((r) => ({ _time: tOf(r), k: r.k, c: r.c }));
    if (name === 'boots') return inRange(boots, s, e).map((r) => ({ _time: tOf(r), service: r.service, dep: r.dep || '', rep: r.rep || '' }));
    if (name === 'sample') return [{ k: 'refusal:key_limit', s: sample }];
    if (name === 'top') return top;
    if (name === 'portal_top') return [{ path: '/api/portal/config', c: 12 }, { path: '/teacher/lessons/0b8f3c1e-1111-4aaa-8aaa-aaaaaaaaaaaa', c: 5 }];
    return [];
  });
}

/** Run ticks every `stepMin` from `from` to `to` (inclusive) against one store; collect the posts. */
async function replay({ from, to, bins, boots, stepMin = 5, health = null, cfg = W.config({}) }) {
  const store = memStore();
  const posts = [];
  const post = jest.fn(async (msg) => { const ts = `${1000 + posts.length}.0001`; posts.push({ ...msg, ts, at: null }); return ts; });
  const query = fixtureQuery({ bins, boots });
  for (let t = from.getTime(); t <= to.getTime(); t += stepMin * MIN) {
    const now = new Date(t);
    const before = posts.length;
    // eslint-disable-next-line no-await-in-loop
    await W.tick({ now, cfg, query, store, post, checkHealth: health ? () => health(now) : null, env: 'production', dataset: 'niete-logs' });
    for (let i = before; i < posts.length; i += 1) posts[i].at = now.toISOString().slice(11, 16);
  }
  return { posts, store, query };
}

// ── 1 · no model ──────────────────────────────────────────────────────────────

describe('no model anywhere in the path', () => {
  const SRC = path.resolve(__dirname, '../../bot/shared/services/monitoring');
  const files = ['prod-incident-watch.service.js', 'quiz-funnel-watch.service.js'];
  it.each(files)('%s requires no LLM client, OpenAI or Anthropic SDK', (f) => {
    const src = fs.readFileSync(path.join(SRC, f), 'utf8');
    const requires = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    expect(requires.filter((r) => /llm|openai|anthropic|openrouter|gemini/i.test(r))).toEqual([]);
  });
  it('the CLI requires no LLM client either', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../bot/scripts/prod-incident-watch.js'), 'utf8');
    const requires = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    expect(requires.filter((r) => /llm|openai|anthropic|openrouter|gemini/i.test(r))).toEqual([]);
  });
  it('the only OpenRouter call is the key-usage read (GET /api/v1/key), never a completion', () => {
    const src = fs.readFileSync(path.join(SRC, 'prod-incident-watch.service.js'), 'utf8');
    expect(src).toMatch(/openrouter\.ai\/api\/v1\/key/);
    expect(src).not.toMatch(/chat\/completions|\/completions|\/responses/);
  });
});

// ── 2 · the 25 Nov outage, replayed ───────────────────────────────────────────

describe('replaying 25 Nov 2026 (key limit at 10:05 PKT)', () => {
  let run;
  beforeAll(async () => {
    run = await replay({ from: utc('04:30'), to: utc('06:30'), bins: FIX.outage.bins });
  });

  it('posts ONE top-level message, in the 05:05-05:10 check, naming OpenRouter and the key limit', () => {
    const top = run.posts.filter((p) => !p.thread_ts);
    expect(top).toHaveLength(1);
    expect(top[0].at).toBe('05:10');
    expect(top[0].text).toMatch(/OpenRouter is refusing calls: key limit reached/);
    expect(top[0].text).toMatch(/403 Key limit exceeded \(total limit\)/);
    expect(top[0].text).toMatch(/\$2000\.07 of \$2000\.00 used/);
    expect(top[0].text).toMatch(/does not reset/);
    expect(top[0].text).toMatch(/Since 10:05 PKT/);
    expect(top[0].color).toBe(W.COLOR.red);
  });

  it('never posts the key URL or anything but the extracted status, phrase and amounts', () => {
    const all = run.posts.map((p) => p.text).join('\n');
    expect(all).not.toMatch(/openrouter\.ai\/workspaces/);
    expect(all).not.toMatch(/redacted/);
  });

  it('puts the job failures in that thread', () => {
    const top = run.posts.find((p) => !p.thread_ts);
    const jobs = run.posts.find((p) => p.thread_ts && /Also: job failures/i.test(p.text));
    expect(jobs).toBeDefined();
    expect(jobs.thread_ts).toBe(top.ts);
    expect(jobs.at <= '05:15').toBe(true);
  });

  it('gives an update at most every 30 minutes', () => {
    const updates = run.posts.filter((p) => /Still happening/.test(p.text));
    expect(updates.length).toBeGreaterThanOrEqual(1);
    const mins = updates.map((p) => Number(p.at.slice(0, 2)) * 60 + Number(p.at.slice(3)));
    for (let i = 1; i < mins.length; i += 1) expect(mins[i] - mins[i - 1]).toBeGreaterThanOrEqual(30);
    expect(mins[0] - (5 * 60 + 10)).toBeGreaterThanOrEqual(30);
  });

  it('posts the all-clear in the thread (and to the channel) after the last refusal at 05:44', () => {
    const top = run.posts.find((p) => !p.thread_ts);
    const clear = run.posts.filter((p) => /All clear/.test(p.text));
    expect(clear).toHaveLength(1);
    expect(clear[0].thread_ts).toBe(top.ts);
    expect(clear[0].broadcast).toBe(true);
    expect(clear[0].at > '05:44').toBe(true);
    expect(clear[0].color).toBe(W.COLOR.green);
    expect(clear[0].text).toMatch(/238 provider refusals/);
    // 149 `❌ Job failed` rows from 05:05 to 05:51; the one at 06:11 is after the all-clear.
    expect(clear[0].text).toMatch(/149 job failures/);
  });

  it('leaves no incident open at the end', async () => {
    const state = await run.store.get(W.STATE_KEY);
    expect(state && state.incident).toBeFalsy();
  });
});

// ── 3 · a normal morning ──────────────────────────────────────────────────────

describe('a normal morning (19 Nov 2026, same hours)', () => {
  it('posts nothing', async () => {
    const { posts } = await replay({ from: utc('04:30', '2026-11-19'), to: utc('06:30', '2026-11-19'), bins: FIX.quiet.bins });
    expect(posts).toEqual([]);
  });
});

// ── 4 · each rule at its line ─────────────────────────────────────────────────

/** `n` events of key `k` spread one per minute ending just before `end`. */
function burst(k, n, end, perMin = 1) {
  const rows = [];
  let left = n;
  for (let i = 1; left > 0; i += 1) {
    const c = Math.min(perMin, left);
    rows.push({ _time: new Date(end.getTime() - i * MIN).toISOString(), k, c });
    left -= c;
  }
  return rows;
}
const NOW = utc('10:00', '2026-11-26');   // 15:00 PKT
const usual = (n) => ({ error: Array(24).fill(n), job_failed: Array(24).fill(0), portal_5xx: Array(24).fill(1), rate_429: Array(24).fill(0) });
const evalAt = (bins, { baseline = usual(16), boots = [], health = null, cfg = W.config({}) } = {}) => W.evaluate({ bins, boots, baseline, health, now: NOW, cfg });

describe('each rule fires at its line and not below it', () => {
  it('provider refusal: on the first one seen', () => {
    expect(evalAt(burst('refusal:credits', 1, NOW)).provider_refusal.fire).toBe(true);
    expect(evalAt([]).provider_refusal.fire).toBe(false);
  });
  it('429s: 20 in 15 min fires, 19 does not (12 was the 30-day worst)', () => {
    expect(evalAt(burst('rate_429', 20, NOW, 2)).rate_limited.fire).toBe(true);
    expect(evalAt(burst('rate_429', 19, NOW, 2)).rate_limited.fire).toBe(false);
  });
  it('job failures: 5 in 30 min fires, 4 does not, 5 spread over 40 min does not', () => {
    expect(evalAt(burst('job_failed', 5, NOW)).job_failures.fire).toBe(true);
    expect(evalAt(burst('job_failed', 4, NOW)).job_failures.fire).toBe(false);
    const spread = [2, 10, 25, 33, 39].map((m) => ({ _time: new Date(NOW.getTime() - m * MIN).toISOString(), k: 'job_failed', c: 1 }));
    expect(evalAt(spread).job_failures.fire).toBe(false);
  });
  it('error lines: 75 in 15 min AND 3x the usual for the hour', () => {
    expect(evalAt(burst('error', 102, NOW, 7)).error_rate.fire).toBe(true);
    expect(evalAt(burst('error', 74, NOW, 5)).error_rate.fire).toBe(false);
    // 80 is over 75 but under 3x a usual of 30
    expect(evalAt(burst('error', 80, NOW, 6), { baseline: usual(30) }).error_rate.fire).toBe(false);
  });
  it('portal 5xx: 50 in 15 min fires, 49 does not', () => {
    expect(evalAt(burst('portal_5xx', 50, NOW, 4)).portal_5xx.fire).toBe(true);
    expect(evalAt(burst('portal_5xx', 49, NOW, 4)).portal_5xx.fire).toBe(false);
  });
  it('the clear line sits below the fire line', () => {
    const cfg = W.config({});
    expect(cfg.rate429ClearMax).toBeLessThan(cfg.rate429Min);
    expect(cfg.jobFailClearMax).toBeLessThan(cfg.jobFailMin);
    expect(cfg.errorClearMax).toBeLessThan(cfg.errorMin);
    expect(cfg.portal5xxClearMax).toBeLessThan(cfg.portal5xxMin);
  });
  it('thresholds can be overridden by PROD_ALERTS_THRESHOLDS, and junk is ignored', () => {
    const cfg = W.config({ PROD_ALERTS_THRESHOLDS: '{"errorMin": 120, "nope": 3, "jobFailMin": "x"}' });
    expect(cfg.errorMin).toBe(120);
    expect(cfg.jobFailMin).toBe(W.DEFAULTS.jobFailMin);
    expect(cfg.nope).toBeUndefined();
    expect(W.config({ PROD_ALERTS_THRESHOLDS: '{not json' }).errorMin).toBe(W.DEFAULTS.errorMin);
  });
});

describe('the usual for this hour (baseline)', () => {
  it('is the median 15-minute count for that PKT hour over the look-back, missing slots counted as 0', () => {
    const rows = [];
    // 4 days x 4 slots at 15:00 PKT (10:00 UTC): 10, 10, 10, 200 per slot → median 10
    for (let d = 1; d <= 4; d += 1) {
      for (let q = 0; q < 4; q += 1) {
        rows.push({ _time: new Date(Date.UTC(2026, 10, 20 + d, 10, q * 15)).toISOString(), k: 'error', c: d === 4 ? 200 : 10 });
      }
    }
    const b = W.buildBaseline(rows, { days: 4 });
    expect(b.error[15]).toBe(10);
    expect(b.error[3]).toBe(0);
  });
  it('on the real 14 days before 25 Nov, the 10:00 PKT error usual is small (p90 16 overall)', () => {
    const b = W.buildBaseline(FIX.baseline.rows.map((r) => ({ _time: r.t, k: r.k, c: r.c })), { days: 14 });
    expect(b.error[10]).toBeLessThan(20);
  });
});

describe('hysteresis: the clear line is judged on its own, and a cleared rule needs NEW events to fire', () => {
  const cfg = W.config({});
  const ev = (over) => ({ ...Object.fromEntries(W.RULES.map((r) => [r, { fire: false, clean: true, count: 0 }])), ...over });
  it('a rule still over its fire line on a long window, but under its clear line, counts a clean check', () => {
    let s = W.step({}, ev({ job_failures: { fire: true, clean: false, count: 20, lastAt: iso(NOW) } }), NOW, cfg).state;
    const stale = ev({ job_failures: { fire: true, clean: true, count: 20, lastAt: iso(NOW) } });
    s = W.step(s, stale, new Date(NOW.getTime() + 5 * MIN), cfg).state;
    const r = W.step(s, stale, new Date(NOW.getTime() + 10 * MIN), cfg);
    expect(r.actions.map((a) => a.type)).toEqual(['clear']);
    // The same stale window one check later does not open a new incident…
    expect(W.step(r.state, stale, new Date(NOW.getTime() + 15 * MIN), cfg).actions).toEqual([]);
    // …but a new event after the all-clear does.
    const fresh = ev({ job_failures: { fire: true, clean: false, count: 4, lastAt: iso(NOW.getTime() + 16 * MIN) } });
    expect(W.step(r.state, fresh, new Date(NOW.getTime() + 20 * MIN), cfg).actions.map((a) => a.type)).toEqual(['open']);
  });
});

describe('a service that stops answering', () => {
  it('fires after 2 failed checks in a row and clears on the first good one', async () => {
    const down = new Set(['10:00', '10:05', '10:10']);
    const health = (now) => [{ name: 'portal', ok: !down.has(now.toISOString().slice(11, 16)), status: 502 }];
    const { posts } = await replay({ from: utc('09:55', '2026-11-26'), to: utc('10:20', '2026-11-26'), bins: [], health });
    const top = posts.filter((p) => !p.thread_ts);
    expect(top).toHaveLength(1);
    expect(top[0].at).toBe('10:05');
    expect(top[0].text).toMatch(/Portal is not answering/);
    expect(top[0].text).toMatch(/2 checks in a row/);
    const clear = posts.find((p) => /All clear/.test(p.text));
    expect(clear.at).toBe('10:15');
  });
});

describe('a crash loop', () => {
  const boot = (min, dep, rep) => ({ t: new Date(NOW.getTime() - min * MIN).toISOString(), service: 'sqs-worker', dep, rep });
  const ev = (boots) => W.evaluate({ bins: [], boots: boots.map((b) => ({ _time: b.t, ...b })), baseline: usual(16), health: null, now: NOW, cfg: W.config({}) });
  it('a deploy (each of 10 replicas boots once) is not one', () => {
    expect(ev(Array.from({ length: 10 }, (_, i) => boot(3, 'dep1', `r${i}`))).crash_loop.fire).toBe(false);
  });
  it('two deploys in 30 minutes are not one either', () => {
    const two = [...Array.from({ length: 10 }, (_, i) => boot(20, 'dep1', `r${i}`)), ...Array.from({ length: 10 }, (_, i) => boot(5, 'dep2', `r${i}`))];
    expect(ev(two).crash_loop.fire).toBe(false);
  });
  it('replicas of one deployment booting again and again is', () => {
    const loop = [];
    for (let k = 0; k < 4; k += 1) for (let i = 0; i < 3; i += 1) loop.push(boot(2 + k * 6, 'dep1', `r${i}`));
    const e = ev(loop);
    expect(e.crash_loop.fire).toBe(true);
    expect(e.crash_loop.count).toBe(9);
  });
  it('old boot lines with no deployment id fall back to a total far above any deploy day (max 80 in 30 min)', () => {
    expect(ev(Array.from({ length: 80 }, (_, i) => boot(1 + (i % 29), '', ''))).crash_loop.fire).toBe(false);
    expect(ev(Array.from({ length: 120 }, (_, i) => boot(1 + (i % 29), '', ''))).crash_loop.fire).toBe(true);
  });
});

// ── 5 · threads, updates, all-clear ───────────────────────────────────────────

describe('one incident, one thread', () => {
  const ev = (over) => ({ ...Object.fromEntries(W.RULES.map((r) => [r, { fire: false, clean: true, count: 0 }])), ...over });
  it('a rule that keeps firing gets a thread update at most every 30 minutes', () => {
    const cfg = W.config({});
    let state = {};
    const kinds = [];
    for (let m = 0; m <= 60; m += 5) {
      const r = W.step(state, ev({ job_failures: { fire: true, clean: false, count: 5 } }), new Date(NOW.getTime() + m * MIN), cfg);
      state = r.state;
      kinds.push(...r.actions.map((a) => `${m}:${a.type}`));
    }
    expect(kinds).toEqual(['0:open', '30:update', '60:update']);
  });
  it('the all-clear needs 2 clean checks in a row; a dirty check in between resets it', () => {
    const cfg = W.config({});
    const fire = ev({ job_failures: { fire: true, clean: false, count: 5 } });
    const dirty = ev({ job_failures: { fire: false, clean: false, count: 2 } });
    const clean = ev({});
    let s = W.step({}, fire, NOW, cfg).state;
    const seq = [clean, dirty, clean, clean];
    const out = [];
    seq.forEach((e, i) => { const r = W.step(s, e, new Date(NOW.getTime() + (i + 1) * 5 * MIN), cfg); s = r.state; out.push(r.actions.map((a) => a.type).join(',')); });
    expect(out).toEqual(['', '', '', 'clear']);
    expect(s.incident).toBeNull();
  });
  it('a second rule while the incident is open goes in the thread as "also", once', () => {
    const cfg = W.config({});
    let s = W.step({}, ev({ provider_refusal: { fire: true, clean: false, count: 3 } }), NOW, cfg).state;
    const both = ev({ provider_refusal: { fire: true, clean: false, count: 3 }, error_rate: { fire: true, clean: false, count: 90 } });
    const a = W.step(s, both, new Date(NOW.getTime() + 5 * MIN), cfg);
    expect(a.actions.map((x) => `${x.type}:${x.rule || ''}`)).toEqual(['also:error_rate']);
    s = a.state;
    expect(W.step(s, both, new Date(NOW.getTime() + 10 * MIN), cfg).actions).toEqual([]);
  });
  it('a problem back within an hour of its all-clear continues that thread, shown in the channel', () => {
    const cfg = W.config({});
    let s = W.step({}, ev({ error_rate: { fire: true, clean: false, count: 90 } }), NOW, cfg).state;
    s.incident.ts = '7.7';
    s = W.step(s, ev({}), new Date(NOW.getTime() + 5 * MIN), cfg).state;
    const closed = W.step(s, ev({}), new Date(NOW.getTime() + 10 * MIN), cfg);
    expect(closed.actions.map((a) => a.type)).toEqual(['clear']);
    const back = W.step(closed.state, ev({ portal_5xx: { fire: true, clean: false, count: 80 } }), new Date(NOW.getTime() + 40 * MIN), cfg);
    expect(back.actions.map((a) => a.type)).toEqual(['reopen']);
    expect(back.state.incident.ts).toBe('7.7');
    const later = W.step(closed.state, ev({ portal_5xx: { fire: true, clean: false, count: 80 } }), new Date(NOW.getTime() + 75 * MIN), cfg);
    expect(later.actions.map((a) => a.type)).toEqual(['open']);
    expect(later.state.incident.ts).toBeNull();
  });
  it('a reopen posts in the old thread and broadcasts', async () => {
    const store = memStore();
    await store.set(W.STATE_KEY, { incident: null, lastIncident: { ts: '3.3', clearedAt: new Date(NOW.getTime() - 20 * MIN).toISOString() } });
    const post = jest.fn().mockResolvedValue('4.4');
    await W.tick({ now: NOW, cfg: W.config({}), query: fixtureQuery({ bins: burst('refusal:key_limit', 3, NOW) }), store, post, env: 'production', dataset: 'niete-logs' });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toMatchObject({ type: 'reopen', thread_ts: '3.3', broadcast: true });
    expect(post.mock.calls[0][0].text).toMatch(/Back again/);
  });
  it('a failed top-level post opens nothing, so the next check tries again', async () => {
    const store = memStore();
    const post = jest.fn().mockRejectedValueOnce(new Error('slack channel_not_found')).mockResolvedValue('9.1');
    const query = fixtureQuery({ bins: burst('refusal:key_limit', 5, NOW) });
    await W.tick({ now: NOW, cfg: W.config({}), query, store, post, env: 'production', dataset: 'niete-logs' });
    expect((await store.get(W.STATE_KEY) || {}).incident || null).toBeNull();
    await W.tick({ now: new Date(NOW.getTime() + 60 * 1000), cfg: W.config({}), query, store, post, env: 'production', dataset: 'niete-logs' });
    expect((await store.get(W.STATE_KEY)).incident.ts).toBe('9.1');
  });
});

// ── 6 · the OpenRouter key budget ─────────────────────────────────────────────

describe('the OpenRouter key budget', () => {
  const cfg = W.config({});
  const reading = (o) => ({ limit: 2000, usage: 1824, remaining: 176, weekly: 434, daily: 60, reset: null, ...o });
  it('reads remaining %, burn per day (7-day) and days left', () => {
    const v = W.keyBudgetVerdict(reading({}), NOW, cfg);
    expect(v.level).toBe('warn');
    expect(v.pctUsed).toBe(91);
    expect(v.burnPerDay).toBeCloseTo(62, 0);
    expect(v.daysLeft).toBeCloseTo(2.84, 1);
  });
  it('is quiet with plenty left', () => {
    expect(W.keyBudgetVerdict(reading({ usage: 1000, remaining: 1000, weekly: 70 }), NOW, cfg)).toBeNull();
  });
  it('warns on days left alone (under 3 at the 7-day burn) even with over 10% left', () => {
    expect(W.keyBudgetVerdict(reading({ usage: 1500, remaining: 500, weekly: 1400 }), NOW, cfg).level).toBe('warn');
  });
  it('goes critical at 97% used or under 1 day left', () => {
    expect(W.keyBudgetVerdict(reading({ usage: 1950, remaining: 50, weekly: 70 }), NOW, cfg).level).toBe('critical');
    expect(W.keyBudgetVerdict(reading({ usage: 1700, remaining: 300, weekly: 2800 }), NOW, cfg).level).toBe('critical');
  });
  it('a key with no limit never warns', () => {
    expect(W.keyBudgetVerdict(reading({ limit: null, remaining: null }), NOW, cfg)).toBeNull();
  });
  it('the message is a fixed template: %, amounts, burn, run-out day, whether it resets', () => {
    const v = W.keyBudgetVerdict(reading({}), NOW, cfg);
    const m = W.buildKeyBudget(reading({}), v, NOW);
    expect(m.text).toMatch(/OpenRouter key at 91% of its limit · about 3 days left/);
    expect(m.text).toMatch(/\$1,824 of \$2,000 used/);
    expect(m.text).toMatch(/about \$62 a day/);
    expect(m.text).toMatch(/does not reset/);
    expect(m.color).toBe(W.COLOR.yellow);
  });
  it('posts at most once a day per level, logs every reading', async () => {
    const store = memStore();
    const post = jest.fn().mockResolvedValue('5.5');
    const read = jest.fn().mockResolvedValue(reading({}));
    await W.keyBudgetCheck({ now: NOW, cfg, store, post, read });
    await W.keyBudgetCheck({ now: new Date(NOW.getTime() + 30 * MIN), cfg, store, post, read });
    expect(post).toHaveBeenCalledTimes(1);
    read.mockResolvedValue(reading({ usage: 1990, remaining: 10 }));
    await W.keyBudgetCheck({ now: new Date(NOW.getTime() + 60 * MIN), cfg, store, post, read });
    expect(post).toHaveBeenCalledTimes(2);
    const logged = logEvent.mock.calls.filter((c) => c[0] === 'prod_incident_watch.key_budget');
    expect(logged.length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(logged[0][1]).sort()).toEqual(['burn_per_day', 'days_left', 'limit', 'pct_used', 'remaining', 'usage']);
  });
  it('parses the OpenRouter /api/v1/key reply', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { limit: 2000, usage: 1824.5, limit_remaining: 175.5, usage_daily: 60, usage_weekly: 434, usage_monthly: 1500, limit_reset: null } }),
    });
    const r = await W.readKeyBudget({ key: 'k', fetchImpl });
    expect(r).toEqual({ limit: 2000, usage: 1824.5, remaining: 175.5, weekly: 434, daily: 60, reset: null });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/key');
    expect(fetchImpl.mock.calls[0][1].method || 'GET').toBe('GET');
  });
});

// ── 7 · one replica, and the switch ───────────────────────────────────────────

describe('run(): the switch and the one-replica claim', () => {
  const env = {
    PROD_ALERTS_ENABLED: 'true', PROD_ALERTS_SLACK_TOKEN: 'xoxb-test', PROD_ALERTS_SLACK_CHANNEL: 'C1', AXIOM_TOKEN: 'ax',
  };
  it('does nothing at all until PROD_ALERTS_ENABLED=true', async () => {
    const query = jest.fn();
    expect(await W.run({ env: {}, query })).toEqual({ skipped: 'disabled' });
    expect(query).not.toHaveBeenCalled();
  });
  it('skips, unconfigured, without a Slack token or channel (unless it is a dry run)', async () => {
    expect(await W.run({ env: { PROD_ALERTS_ENABLED: 'true', AXIOM_TOKEN: 'ax' }, query: jest.fn() })).toEqual({ skipped: 'unconfigured' });
  });
  it('another replica holding the tick: no query, no post', async () => {
    const store = memStore();
    await store.setNX(W.TICK_KEY, 'someone-else');
    const query = jest.fn();
    const post = jest.fn();
    expect(await W.run({ env, redis: store, query, post })).toEqual({ skipped: 'another_replica' });
    expect(query).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
  it('an unreadable claim (Redis down) is a skip, never ten posts', async () => {
    const redis = { isAvailable: () => false };
    const post = jest.fn();
    expect(await W.run({ env, redis, query: jest.fn(), post })).toEqual({ skipped: 'lock_unavailable' });
    expect(post).not.toHaveBeenCalled();
  });
  it('the owner logs prod_incident_watch.tick every check, even when all is well', async () => {
    logEvent.mockClear();
    const out = await W.run({ env, redis: memStore(), query: fixtureQuery({ bins: [] }), post: jest.fn(), now: NOW, checkHealth: async () => [], readKey: async () => null });
    expect(out.posts).toBe(0);
    expect(logEvent.mock.calls.some((c) => c[0] === 'prod_incident_watch.tick')).toBe(true);
  });
  it('a dry run (PROD_ALERTS_DRY_RUN=true) logs what it would post and never posts', async () => {
    logEvent.mockClear();
    const post = jest.fn();
    const dry = { PROD_ALERTS_ENABLED: 'true', PROD_ALERTS_DRY_RUN: 'true', AXIOM_TOKEN: 'ax' };
    await W.run({ env: dry, redis: memStore(), query: fixtureQuery({ bins: burst('refusal:key_limit', 4, NOW) }), post, now: NOW, checkHealth: async () => [], readKey: async () => null });
    expect(post).not.toHaveBeenCalled();
    expect(logEvent.mock.calls.some((c) => c[0] === 'prod_incident_watch.would_post')).toBe(true);
  });
});

// ── 8 · what reaches Slack ────────────────────────────────────────────────────

describe('privacy: only counts and scrubbed, code-authored text', () => {
  it('scrubs phone-like digit runs, emails and ids out of a top line', () => {
    const s = W.scrubLine('Send failed for 923001234567 (a@b.co) quiz 0b8f3c1e-1111-4aaa-8aaa-aaaaaaaaaaaa');
    expect(s).not.toMatch(/923001234567|a@b\.co|0b8f3c1e/);
  });
  it('folds ids and tokens out of portal paths', () => {
    expect(W.normPath('/teacher/lessons/0b8f3c1e-1111-4aaa-8aaa-aaaaaaaaaaaa?x=1')).toBe('/teacher/lessons/:id');
    expect(W.normPath('/go/AbCdEfGhIjKlMnOpQrStUvWx123')).toBe('/go/:id');
  });
  it('extracts status, phrase and amounts from a refusal; nothing else', () => {
    expect(W.refusalFacts(FIX.outage.refusalSample)).toEqual({
      status: '403', phrase: 'Key limit exceeded (total limit)', used: '2000.07', limit: '2000.00', noReset: true,
    });
    expect(W.refusalFacts('weird text')).toEqual({});
  });
});

describe('postToSlack: thread and colour bar (shared with the quiz watcher)', () => {
  const Q = require('../../bot/shared/services/monitoring/quiz-funnel-watch.service');
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  it('a plain call is unchanged', async () => {
    global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ ok: true, ts: '1.2' }) });
    await Q.postToSlack('hi', { token: 't', channel: 'C' });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ channel: 'C', text: 'hi', unfurl_links: false });
  });
  it('colour, thread and broadcast ride as attachments + thread_ts + reply_broadcast', async () => {
    global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ ok: true, ts: '1.3' }) });
    const ts = await Q.postToSlack('*head*\nbody', { token: 't', channel: 'C' }, { color: '#d93f0b', thread_ts: '1.0', reply_broadcast: true });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(ts).toBe('1.3');
    expect(body.thread_ts).toBe('1.0');
    expect(body.reply_broadcast).toBe(true);
    expect(body.attachments[0]).toMatchObject({ color: '#d93f0b', text: '*head*\nbody', fallback: 'head' });
  });
});

describe('the APL', () => {
  it('reads one env and dataset, and leaves the two known-noise lines out of the error count', () => {
    const apl = W.aplFor({ env: 'production', dataset: 'niete-logs' });
    expect(apl.bins).toMatch(/^\['niete-logs'\] \| where env == 'production'/);
    expect(apl.bins).toMatch(/The AWS SDK for JavaScript \(v2\) has reached end-of-support/);
    expect(apl.bins).toMatch(/lp612 render produced defects/);
    expect(apl.bins).toMatch(/bin\(_time, 1m\)/);
    expect(apl.baseline).toMatch(/bin\(_time, 15m\)/);
  });
  it('matches provider phrases on error or warn lines only — bare 401/402/429 text is not a refusal', () => {
    const apl = W.aplFor({ env: 'production', dataset: 'niete-logs' }).bins;
    expect(apl).not.toMatch(/contains '40[12] '/);
    expect(apl).toMatch(/level in \('error', 'warn'\) and s contains 'Key limit exceeded'/);
  });
});
