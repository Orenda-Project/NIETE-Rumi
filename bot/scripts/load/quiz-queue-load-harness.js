#!/usr/bin/env node
'use strict';
/**
 * Quiz-queue load harness — no network, no database, no sends.
 *
 * Runs N real SQSCoachingWorker instances (workers/sqs-worker.js — the real poll
 * loops, slot accounting and executeJob switch) against an in-memory SQS on a
 * VIRTUAL clock, so a school day of queue traffic simulates in seconds. The real
 * code paths that create quiz-queue traffic run too:
 *   - video-quiz-report scheduleForShareCode() on every child join (+ the real
 *     worker re-queue cascade for quiz_video_report until its target time);
 *   - the real quiz_nudge_teacher dispatch/re-queue cascade.
 * Faked at the boundary: the SQS client (in-memory Standard/FIFO queues honouring
 * DelaySeconds and 20 s long polls), Redis (in-memory SET NX), the DB client
 * (throws if touched), the logger. The WORK of a job (LLM calls, renders, sends)
 * is a sleep sampled from production latency distributions.
 *
 * Usage:
 *   node scripts/load/quiz-queue-load-harness.js --scenario=today|central|high --mode=before|after|fix1|fix2
 *        [--replicas=10] [--from=7] [--to=21] [--seed=7] [--json=out.json]
 *   mode: before = QUIZ_QUEUE_OWN_LOOP=off + VIDEO_REPORT_SCHEDULE_ONCE=off (production today)
 *         after  = both fixes (defaults)   fix1 = schedule-once only   fix2 = own loop only
 * Workload numbers (per school-day hour, PKT) are production measurements; the
 * rollout adds the 15:00 lesson-plan quiz cohort. See the constants below.
 */

const path = require('path');

// ── arguments ───────────────────────────────────────────────────────────────
const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const SCENARIO = arg('scenario', 'today');
const MODE = arg('mode', 'after');
const REPLICAS = Number(arg('replicas', 10));
const FROM_H = Number(arg('from', 7));
const TO_H = Number(arg('to', 21));
const SEED = Number(arg('seed', 7));
const JSON_OUT = arg('json', '');

// ── environment for the worker module (set BEFORE it is required) ──────────
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'harness-not-used';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'harness-not-used';
process.env.SQS_QUEUE_URL = 'https://sqs.harness.invalid/main.fifo';
process.env.SQS_QUIZ_QUEUE_URL = 'https://sqs.harness.invalid/quiz';
delete process.env.SQS_VIDEO_QUEUE_URL;
process.env.WORKER_QUEUES = 'main,quiz';
process.env.SQS_WORKER_CONCURRENCY = process.env.SQS_WORKER_CONCURRENCY || '6';
process.env.SQS_POLL_INTERVAL = '100';
process.env.QUIZ_QUEUE_OWN_LOOP = (MODE === 'before' || MODE === 'fix1') ? 'off' : '';
process.env.VIDEO_REPORT_SCHEDULE_ONCE = (MODE === 'before' || MODE === 'fix2') ? 'off' : '';

// ── virtual clock (installed before anything schedules a timer) ─────────────
const FakeTimers = require('@sinonjs/fake-timers');
const DAY0_UTC = Date.UTC(2026, 8, 23, 0, 0, 0) - 5 * 3600 * 1000;   // 00:00 PKT on a school day
const clock = FakeTimers.install({ now: DAY0_UTC + FROM_H * 3600 * 1000,
  toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pktHour = (t = Date.now()) => Math.floor(((t - DAY0_UTC) / 3600000)) % 24;

// ── seeded randomness ───────────────────────────────────────────────────────
let rs = SEED >>> 0;
const rnd = () => { rs += 0x6D2B79F5; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const between = (a, b) => a + (b - a) * rnd();
/** Lognormal with the given median and p90 (seconds → ms). */
const lognormal = (p50, p90) => {
  const mu = Math.log(p50); const sigma = (Math.log(p90) - mu) / 1.2816;
  const z = Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  return Math.exp(mu + sigma * z) * 1000;
};

// ── module stubs at the network boundary ────────────────────────────────────
const BOT = path.resolve(__dirname, '..', '..');
function stub(rel, exportsObj) {
  const p = require.resolve(path.join(BOT, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj };
}
const noopProxy = (overrides = {}) => new Proxy(overrides, {
  get: (t, k) => (k in t ? t[k] : (k === '__esModule' ? false : () => undefined)),
});
const passCorrelation = { runWithCorrelation: (_id, fn) => fn(), generateCorrelationId: () => 'h',
  getCurrentCorrelationId: () => null };
stub('shared/utils/logger', noopProxy({ ...passCorrelation }));
stub('shared/utils/structured-logger', noopProxy({ ...passCorrelation }));
stub('shared/config/supabase', new Proxy({}, { get: () => () => { throw new Error('harness: the DB must not be touched'); } }));
stub('shared/services/gpt5-mini.service', noopProxy());

const redisStore = new Map();
stub('shared/services/cache/railway-redis.service', noopProxy({
  isAvailable: () => true,
  setNX: async (k, v) => { if (redisStore.has(k)) return false; redisStore.set(k, v); return true; },
  delete: async (k) => { redisStore.delete(k); return true; },
  get: async (k) => (redisStore.has(k) ? redisStore.get(k) : null),
  set: async (k, v) => { redisStore.set(k, v); return true; },
}));

// ── in-memory SQS ───────────────────────────────────────────────────────────
const M = {                       // metrics
  queued: new Map(),              // messageId → { at, delayMs, jobType, meta }
  claims: [],                     // { at, jobType, waitMs, meta }
  done: [],                       // { at, jobType, meta, totalMs }
  maxVisibleQuiz: 0,
  joins: 0,
};
let seq = 0;
class FakeQueue {
  constructor(name) { this.name = name; this.msgs = new Map(); this.waiters = []; }
  push(body, delayMs, meta) {
    const id = `${this.name}-${++seq}`;
    this.msgs.set(id, { id, body, visibleAt: Date.now() + delayMs, inflight: false });
    M.queued.set(id, { at: Date.now(), delayMs, jobType: body.jobType, meta });
    if (delayMs <= 0) this.wake(); else setTimeout(() => this.wake(), delayMs);
    return id;
  }
  wake() { const w = this.waiters.splice(0); w.forEach((f) => f()); }
  visible() { const now = Date.now(); const v = []; for (const m of this.msgs.values()) if (!m.inflight && m.visibleAt <= now) v.push(m); return v; }
  async receive(n) {
    const deadline = Date.now() + 20000;
    for (;;) {
      const v = this.visible();
      if (this.name === 'quiz') M.maxVisibleQuiz = Math.max(M.maxVisibleQuiz, v.length);
      if (v.length) {
        const out = [];
        while (out.length < n && v.length) {       // Standard queue: no ordering promise
          const m = v.splice(Math.floor(rnd() * v.length), 1)[0];
          m.inflight = true;
          out.push({ receiptHandle: m.id, messageId: m.id, body: m.body });
        }
        return out;
      }
      const left = deadline - Date.now();
      if (left <= 0) return [];
      await new Promise((res) => { const t = setTimeout(res, left); this.waiters.push(() => { clearTimeout(t); res(); }); });
    }
  }
  complete(id) { this.msgs.delete(id); }
  release(id) { const m = this.msgs.get(id); if (m) { m.inflight = false; m.visibleAt = Date.now(); this.wake(); } }
}
const QUIZ = new FakeQueue('quiz');
const MAIN = new FakeQueue('main');
const byId = (id) => (id.startsWith('quiz') ? QUIZ : MAIN);
const fakeSqs = noopProxy({
  queueJob: async (groupId, jobType, payload = {}, opts = {}, meta) => {
    const q = jobType.startsWith('quiz_') ? QUIZ : MAIN;
    const delayMs = q === QUIZ ? Math.min(900, opts.delaySeconds || 0) * 1000 : 0;
    return q.push({ groupId, jobType, payload, version: '2.0' }, delayMs, meta);
  },
  receiveJobs: (n) => MAIN.receive(n),
  receiveQuizJobs: (n) => QUIZ.receive(n),
  receiveVideoJobs: async () => [],
  completeJob: async (rh) => MAIN.complete(rh),
  completeQuizJob: async (rh) => QUIZ.complete(rh),
  completeVideoJob: async () => true,
  releaseInFlightMessage: async (rh) => byId(rh).release(rh),
  extendJobTimeout: async () => true,
  extendQuizJobTimeout: async () => true,
});
stub('shared/services/queue/index', fakeSqs);
stub('shared/services/queue/sqs-queue.service', fakeSqs);

// ── the real modules ────────────────────────────────────────────────────────
const { SQSCoachingWorker } = require(path.join(BOT, 'workers/sqs-worker'));
const VideoQuizReport = require(path.join(BOT, 'shared/services/quiz/video-quiz-report.service'));
const TranscriptQuizNudge = require(path.join(BOT, 'shared/services/quiz/transcript-quiz-nudge.service'));
const TranscriptQuizGenerate = require(path.join(BOT, 'shared/services/quiz/transcript-quiz-generate.service'));

// Work of each job = a sleep from production distributions (seconds).
VideoQuizReport.generate = async () => { await sleep(lognormal(8, 20)); return true; };
TranscriptQuizNudge.process = async () => { await sleep(lognormal(0.5, 2)); };
const generateMeta = new Map();   // quizId → { source }
let genNow = 0;
TranscriptQuizGenerate.process = async (quizId) => {
  const g = generateMeta.get(quizId) || { source: 'transcript' };
  genNow += 1; M.maxConcurrentGenerates = Math.max(M.maxConcurrentGenerates || 0, genNow);
  try {
  // prod transcript work: p50 35 s, p90 60 s (14 d). staging lp_v8: 45-80 s.
  await sleep(g.source === 'lp' ? lognormal(45, 80) : lognormal(35, 60));
  // the hand-off's nudge chain, exactly as transcript-quiz-handoff queues it
  const targetAt = TranscriptQuizNudge.nudgeTargetUtc(new Date(Date.now() + TranscriptQuizNudge.NUDGE_AFTER_MS)).toISOString();
  await fakeSqs.queueJob(quizId, 'quiz_nudge_teacher', { quizId, targetAt }, { delaySeconds: 900 });
  if (g.source === 'lp' && rnd() < LP_SHARE_RATE) {
    // the teacher shares the link; children join over the evening
    setTimeout(() => startShareCode(), between(10, 120) * 60000);
  }
  return { ok: true };
  } finally { genNow -= 1; }
};

const realExec = SQSCoachingWorker.prototype.executeJob;
const REAL = new Set(['quiz_video_report', 'quiz_nudge_teacher', 'quiz_generate']);
const WORK_S = { quiz_offer: [1.5, 3], quiz_child_videos_offer: [1, 2], quiz_report: [8, 20], quiz_expire: [0.3, 1] };
SQSCoachingWorker.prototype.executeJob = async function executeJob(sessionId, jobType, payload, rh, sourceQueue, body) {
  const q = M.queued.get(rh);
  if (q) M.claims.push({ at: Date.now(), jobType, waitMs: Date.now() - q.at - q.delayMs, meta: q.meta });
  if (REAL.has(jobType)) await realExec.call(this, sessionId, jobType, payload, rh, sourceQueue, body);
  else if (sourceQueue === 'main') await sleep(between(60, 240) * 1000);   // coaching/LP work, minutes
  else await sleep(lognormal(...(WORK_S[jobType] || [1, 3])));
  if (q) M.done.push({ at: Date.now(), jobType, meta: q.meta, totalMs: Date.now() - q.at - q.delayMs });
};

// ── workload (per school-day hour, PKT) ────────────────────────────────────
// Production 23 Sep 2026 (worker claims by hour), 14-day quiz_generate counts / 10
// school days, 15-day child joins / 11 school-day equivalents.
const MAIN_PER_H = { 7: 15, 8: 87, 9: 557, 10: 652, 11: 554, 12: 503, 13: 409, 14: 295, 15: 172, 16: 118, 17: 69, 18: 65, 19: 55, 20: 34 };
const OFFER_PER_H = { 8: 6, 9: 101, 10: 143, 11: 162, 12: 122, 13: 104, 14: 66, 15: 51, 16: 36, 17: 16, 18: 16, 19: 9, 20: 7 };
const CHILD_OFFER_PER_H = { 7: 31, 8: 59, 9: 18, 10: 20, 11: 30, 12: 37, 13: 41, 14: 59, 15: 109, 16: 110, 17: 89, 18: 107, 19: 152, 20: 166 };
const TQ_GEN_PER_H = { 8: 2.5, 9: 16, 10: 28.5, 11: 26, 12: 20, 13: 18, 14: 13, 15: 12, 16: 6.5, 17: 6.6, 18: 4.4, 19: 3.3, 20: 2.9 };
const JOINS_PER_H = { 7: 49, 8: 30, 9: 46, 10: 58, 11: 65, 12: 69, 13: 107, 14: 185, 15: 192, 16: 179, 17: 187, 18: 243, 19: 280, 20: 238 };
const CHAINS_PER_CODE_BEFORE = 5.9;                 // prod: 2,100 chains / 358 codes per day
// A code's joins within one day (prod: 5.9 joins per code per day; 16.3 over the code's life).
const JOINS_PER_CODE_PER_DAY = 5.9;
// Yesterday's joins per hour, 07:00-23:00 (same measurement as JOINS_PER_H).
const YESTERDAY_JOINS_PER_H = { 7: 49, 8: 30, 9: 46, 10: 58, 11: 65, 12: 69, 13: 107, 14: 185, 15: 192, 16: 179, 17: 187, 18: 243, 19: 280, 20: 238, 21: 200, 22: 105, 23: 40 };
// Rollout: the 15:00 lesson-plan offer. Cohort = K-5 teachers with a lesson that day (prod).
const ROLLOUT = { today: null, central: { cohort: 1140, accept: 0.24 }, high: { cohort: 1370, accept: 0.40 },
  // stress: every K-5 AND Grade 6-12 teacher with a lesson accepts (--cohort/--accept override any scenario)
  stress: { cohort: 1590, accept: 1.0 } }[SCENARIO];
if (ROLLOUT && arg('cohort', '')) ROLLOUT.cohort = Number(arg('cohort'));
if (ROLLOUT && arg('accept', '')) ROLLOUT.accept = Number(arg('accept'));
const LP_SHARE_RATE = 1.0;                          // upper bound: every LP quiz is shared with a class
// Offer → accept latency, prod transcript offers (769 pairs): p50 10 min, 59 % ≤20, 78 % ≤60, 90 % ≤208.
const ACCEPT_CDF = [[0, 0], [10, 0.50], [20, 0.59], [60, 0.78], [208, 0.90], [480, 1.0]];
const acceptDelayMin = () => { const u = rnd(); for (let i = 1; i < ACCEPT_CDF.length; i++) {
  const [m0, p0] = ACCEPT_CDF[i - 1]; const [m1, p1] = ACCEPT_CDF[i];
  if (u <= p1) return m0 + (m1 - m0) * ((u - p0) / (p1 - p0)); } return 480; };

let codeSeq = 0;
function startShareCode() {
  const code = `code-${++codeSeq}`;
  // children join over the next hours (exponential, mean 90 min), not past 22:00 PKT
  const kids = Math.max(1, Math.round(-JOINS_PER_CODE_PER_DAY * Math.log(rnd() || 1e-9)));
  for (let i = 0; i < kids; i++) {
    const at = -90 * 60000 * Math.log(rnd() || 1e-9);
    if (pktHour(Date.now() + at) >= 22) continue;
    setTimeout(() => { M.joins += 1; VideoQuizReport.scheduleForShareCode(code).catch(() => {}); }, at);
  }
}
function spread(perHour, fn) {
  for (let h = FROM_H; h < TO_H; h++) {
    const n = perHour[h] || 0; const whole = Math.floor(n) + (rnd() < n % 1 ? 1 : 0);
    for (let i = 0; i < whole; i++) {
      const at = DAY0_UTC + h * 3600000 + rnd() * 3600000 - Date.now();
      if (at >= 0) setTimeout(fn, at);
    }
  }
}
let mainSeq = 0; let quizSeq = 0;
function seedWorkload() {
  // Report chains alive at the start: one per join yesterday (before) or one per
  // share code (after), each aimed at the real reportTargetUtc() of its join —
  // joins 10:00-19:00 land on 07:00 today, evening joins on 07:00-10:00 and keep
  // hopping until then. Hops still in flight appear within 15 minutes.
  const once = process.env.VIDEO_REPORT_SCHEDULE_ONCE !== 'off';
  const simStart = Date.now();
  for (let h = 7; h < 24; h++) {
    const joins = YESTERDAY_JOINS_PER_H[h] || 0;
    const chains = Math.round(once ? joins / CHAINS_PER_CODE_BEFORE : joins);
    for (let i = 0; i < chains; i++) {
      const joinAt = DAY0_UTC - 24 * 3600000 + (h + rnd()) * 3600000;
      const target = VideoQuizReport.reportTargetUtc(new Date(joinAt)).getTime();
      if (target <= simStart - 3600000) continue;                 // fired and finished before the window
      const code = `seed-${h}-${i}`;
      const firstVisible = target <= simStart ? 0 : Math.min(target - simStart, rnd() * 900000);
      fakeSqs.queueJob(code, 'quiz_video_report', { shareCodeId: code, targetAt: new Date(target).toISOString() },
        { delaySeconds: Math.round(firstVisible / 1000) });
      if (once) redisStore.set(`vq:report:scheduled:${code}`, '1');
    }
  }
  spread(MAIN_PER_H, () => MAIN.push({ sessionId: `s-${++mainSeq}`, jobType: 'coaching_analysis', payload: {} }, 0));
  spread(OFFER_PER_H, () => fakeSqs.queueJob(`o-${++quizSeq}`, 'quiz_offer', {}, {}));
  spread(CHILD_OFFER_PER_H, () => fakeSqs.queueJob(`c-${++quizSeq}`, 'quiz_child_videos_offer', {}, {}));
  spread(TQ_GEN_PER_H, () => { const id = `tq-${++quizSeq}`; generateMeta.set(id, { source: 'transcript' });
    fakeSqs.queueJob(id, 'quiz_generate', { quizId: id }, {}, { source: 'transcript' }); });
  const codesPerH = Object.fromEntries(Object.entries(JOINS_PER_H).map(([h, n]) => [Number(h) - 1, n / JOINS_PER_CODE_PER_DAY]));
  spread(codesPerH, startShareCode);
  if (ROLLOUT && FROM_H <= 15 && TO_H > 15) {
    const accepts = Math.round(ROLLOUT.cohort * ROLLOUT.accept);
    for (let i = 0; i < accepts; i++) {
      const offerAt = DAY0_UTC + 15 * 3600000 + rnd() * 5 * 60000;         // sweeper claims the cohort in ~5 min
      const at = offerAt + acceptDelayMin() * 60000 - Date.now();
      setTimeout(() => { const id = `lp-${++quizSeq}`; generateMeta.set(id, { source: 'lp' });
        fakeSqs.queueJob(id, 'quiz_generate', { quizId: id }, {}, { source: 'lp' }); }, at);
    }
  }
}

// ── run ────────────────────────────────────────────────────────────────────
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r0 = (ms) => (ms == null ? '-' : Math.round(ms / 1000));

(async () => {
  const wall = process.hrtime.bigint();
  const workers = Array.from({ length: REPLICAS }, (_, i) => new SQSCoachingWorker(`harness-${i}`));
  seedWorkload();
  const runs = workers.map((w) => w.start());
  for (let h = FROM_H; h < TO_H; h++) {
    await clock.tickAsync(3600 * 1000);
  }
  workers.forEach((w) => { w.isShuttingDown = true; });
  await clock.tickAsync(25 * 1000);
  await clock.tickAsync(600 * 1000);
  await Promise.race([Promise.all(runs), Promise.resolve()]);

  // ── report ──
  const hours = [];
  for (let h = FROM_H; h < TO_H; h++) {
    const inH = (x) => pktHour(x.at) === h;
    const cl = M.claims.filter(inH);
    const quizCl = cl.filter((c) => c.jobType.startsWith('quiz_'));
    const gen = cl.filter((c) => c.jobType === 'quiz_generate');
    const genDone = M.done.filter((d) => d.jobType === 'quiz_generate' && inH(d));
    hours.push({
      pkt: h,
      quizClaims: quizCl.length,
      videoReportClaims: quizCl.filter((c) => c.jobType === 'quiz_video_report').length,
      generates: gen.length,
      waitP50s: r0(pct(gen.map((g) => g.waitMs), 0.5)),
      waitP90s: r0(pct(gen.map((g) => g.waitMs), 0.9)),
      waitP99s: r0(pct(gen.map((g) => g.waitMs), 0.99)),
      acceptToReadyP90s: r0(pct(genDone.map((g) => g.totalMs), 0.9)),
    });
  }
  const gens = M.claims.filter((c) => c.jobType === 'quiz_generate');
  const lpDone = M.done.filter((d) => d.jobType === 'quiz_generate' && d.meta && d.meta.source === 'lp');
  const queuedGen = [...M.queued.values()].filter((q) => q.jobType === 'quiz_generate').length;
  const summary = {
    scenario: SCENARIO, mode: MODE, replicas: REPLICAS, window: `${FROM_H}:00-${TO_H}:00 PKT`,
    workerConcurrency: Number(process.env.SQS_WORKER_CONCURRENCY),
    quizQueueOwnLoop: process.env.QUIZ_QUEUE_OWN_LOOP !== 'off',
    videoReportScheduleOnce: process.env.VIDEO_REPORT_SCHEDULE_ONCE !== 'off',
    generatesQueued: queuedGen, generatesClaimed: gens.length, generatesDone: M.done.filter((d) => d.jobType === 'quiz_generate').length,
    generateWait: { p50s: r0(pct(gens.map((g) => g.waitMs), 0.5)), p90s: r0(pct(gens.map((g) => g.waitMs), 0.9)), p99s: r0(pct(gens.map((g) => g.waitMs), 0.99)), maxs: r0(pct(gens.map((g) => g.waitMs), 1)) },
    lpAcceptToReady: { n: lpDone.length, p50s: r0(pct(lpDone.map((g) => g.totalMs), 0.5)), p90s: r0(pct(lpDone.map((g) => g.totalMs), 0.9)), p99s: r0(pct(lpDone.map((g) => g.totalMs), 0.99)) },
    quizClaimsTotal: M.claims.filter((c) => c.jobType.startsWith('quiz_')).length,
    videoReportExecutions: M.claims.filter((c) => c.jobType === 'quiz_video_report').length,
    maxVisibleQuizBacklog: M.maxVisibleQuiz,
    childJoins: M.joins, shareCodes: codeSeq, maxConcurrentGeneratesFleet: M.maxConcurrentGenerates || 0,
    wallSeconds: Number((process.hrtime.bigint() - wall) / 1000000n) / 1000,
    hours,
  };
  clock.uninstall();
  console.log(JSON.stringify({ ...summary, hours: undefined }, null, 1));
  console.table(hours);
  if (JSON_OUT) require('fs').writeFileSync(JSON_OUT, JSON.stringify(summary, null, 1));
  process.exit(0);
})().catch((e) => { try { clock.uninstall(); } catch (_) { /* */ } console.error(e); process.exit(1); });
