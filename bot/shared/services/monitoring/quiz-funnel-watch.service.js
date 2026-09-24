'use strict';
/**
 * The quiz funnel watcher — one Slack DM stream for the operator, and no spam.
 *
 * Replaces the hourly production failure digest. That digest posted ~13 times a
 * day: chronic families (observation reports without notes, undelivered child
 * media) were non-zero in 40+ hours a week and every such hour was a message.
 * The operator's ask: "notify me if something goes wrong, otherwise once every
 * 2 hours a quick summarized status view of the funnel and whether it's flowing
 * correctly." So this sends two things, and nothing else:
 *
 *   SUMMARY  at the even PKT hours 08:00–22:00 (the 08:00 one covers the night):
 *            per stream — quizzes from recordings, quizzes from lesson plans —
 *            offers → yes/no → made → sent → children joined → finished →
 *            scorecards → class cards → reports, with a verdict (flowing /
 *            stalled / idle), today's totals, and one line for the non-quiz
 *            families the old digest watched. It is also the heartbeat: a slot
 *            with no summary means the watcher is down.
 *   ALERT    any hour, only when something is wrong (findIncidents), each
 *            incident at most once per 2 h — a stuck quiz at most once a day —
 *            naming the quiz ids. An alert due in a summary tick rides in it.
 *
 * WHERE IT RUNS. Inside the sqs-worker on a 15-minute tick (+ a boot run: the
 * worker redeploys several times a day and each restart resets the interval).
 * ~10 replicas run it; exactly one speaks per tick (claimTick). Axiom native
 * monitors (query-scoped token: 403) and cloud agents (no Axiom/Slack reach) are
 * dead ends, measured 2026-09-07.
 *
 * WHAT IT READS. Axiom only — the `quiz_funnel.*` events (quiz-funnel.js) plus
 * the old digest's families. The one database read is the stall confirmation:
 * Axiom drops whole batches on an ingest failure (~0.2% of events, measured), so
 * before "this quiz is stuck" is sent, the candidate ids (≤ CONFIG.confirmMax,
 * one primary-key `in` read, only when a candidate exists) are checked against
 * `quizzes.status`. A quiz the teacher already has is never reported stuck
 * because its `sent` line was lost.
 *
 * THE TRAP IT REFUSES (inherited from the digest). `lp612.render.failed` fires
 * ~329×/day against ~123 completions: the 6-12 author's own quality gate
 * rejecting a draft mid-loop. It is not a delivery failure and no query here
 * reads it; the suite asserts that.
 *
 * ENV (names only; a no-op until the first is set):
 *   QUIZ_FUNNEL_WATCH_ENABLED        'true' arms it. Unset = nothing runs, nothing is logged.
 *   QUIZ_FUNNEL_WATCH_SLACK_TOKEN    bot token (falls back to PROD_DIGEST_SLACK_TOKEN)
 *   QUIZ_FUNNEL_WATCH_SLACK_CHANNEL  DM/channel id (falls back to PROD_DIGEST_SLACK_CHANNEL)
 *   QUIZ_FUNNEL_WATCH_ENV            Axiom `env` to read (default NODE_ENV) — staging and prod share a dataset
 *   QUIZ_FUNNEL_WATCH_DATASET        Axiom dataset (default AXIOM_DATASET, else niete-logs)
 *   QUIZ_FUNNEL_WATCH_THRESHOLDS     optional JSON overriding CONFIG keys, e.g. {"genStallMin":90}
 *   AXIOM_TOKEN / AXIOM_API_TOKEN, AXIOM_ORG_ID — already on the worker
 */

const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { streamOf } = require('../quiz/quiz-funnel');

const MIN = 60 * 1000;
const H = 60 * MIN;
const PKT_OFFSET_MS = 5 * H;   // PKT is UTC+5 all year

/** Every threshold, calibrated on production 11–24 Sep 2026 (see the suite). */
const DEFAULTS = Object.freeze({
  tickMin: 15,
  lifecycleLookbackH: 6,
  // 3 terminal failures in an hour, or 2 when they are ≥30% of the hour's outcomes.
  // Baseline: 30 failures in 14 days (~2/day), almost all validator_failed.
  genFailWindowMin: 60, genFailMin: 3, genFailPairMin: 2, genFailRate: 0.3,
  // accepted → generated: p50 51 s, p90 23 min, p99 59 min, max 2.2 h (1,633 quizzes).
  // 20 min would fire ~13×/day on busy days; 60 fires ~1×/day and only on real waits.
  genStallMin: 60,
  // generated → sent: p99 10 s, max 15 s.
  sendStallMin: 15,
  // scorecard_sent is logged by the same function as child_completed.
  scorecardStallMin: 10, childLookbackMin: 120, scorecardFallbackMin: 5,
  // The report goes 12 h after the first join, pushed to 07:00 PKT out of the night:
  // at most 21 h. Owed from 22 h; looked for up to 46 h back.
  reportOwedH: 22, reportLookbackH: 46,
  classCardFailMin: 3,
  // whatsapp.rate_limited is logged on every Meta refusal: warn while the send pacer
  // retries, gaveUp:true when it stops. A give-up is a lost message (always an alert);
  // retried refusals only matter when Meta is throttling hard.
  rateLimitedGaveUpMin: 1, rateLimitedRetriedMin: 30,
  // ≥10 coaching analyses in 2 h and no quiz offer, 09–17 PKT. On 14 days of prod
  // this fires in exactly one stretch — 15 Sep 13:00–16:30, the real outage (250
  // analyses, 0 offers) — and nowhere else, at any threshold from 5 to 15.
  zeroOffersAnalysesMin: 10, zeroOffersFromPkt: 9, zeroOffersToPkt: 17,
  // The lesson-plan offer goes at 15:00 PKT; by 16:30 a built cohort must show offers.
  lpOffersDeadlinePkt: 16.5, lpOffersUntilPkt: 22,
  // The old digest's families, as spikes (per hour) instead of every non-zero hour.
  lp612FailMin: 3, coachingErrorsMin: 3, coachingLostMin: 5,
  observeDegradedMin: 3, observeDegradedRate: 0.5,
  childSendFailedMin: 5, mediaNotDeliveredMin: 30,
  kindDedupMin: 120, idDedupH: 24,
  confirmMax: 25, idsShown: 8,
});

function config(env = process.env) {
  let over = {};
  try {
    over = env.QUIZ_FUNNEL_WATCH_THRESHOLDS ? JSON.parse(env.QUIZ_FUNNEL_WATCH_THRESHOLDS) : {};
  } catch {
    over = {};
  }
  const out = { ...DEFAULTS };
  for (const [k, v] of Object.entries(over || {})) {
    if (k in DEFAULTS && Number.isFinite(Number(v))) out[k] = Number(v);
  }
  return out;
}

function slackTarget(env = process.env) {
  return {
    token: env.QUIZ_FUNNEL_WATCH_SLACK_TOKEN || env.PROD_DIGEST_SLACK_TOKEN || '',
    channel: env.QUIZ_FUNNEL_WATCH_SLACK_CHANNEL || env.PROD_DIGEST_SLACK_CHANNEL || '',
  };
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Whatever Axiom hands back for a time, as milliseconds. `summarize max(_time)`
 * can return NANOSECONDS (1788808678198726700) — `new Date()` of that is an
 * Invalid Date, which is exactly how the old digest's gap guard never once worked
 * against the real API. Magnitudes, not guesses.
 */
function toMillis(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') {
    const parsed = Date.parse(v);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 1e17) return Math.round(n / 1e6);
  if (n > 1e14) return Math.round(n / 1e3);
  if (n > 1e11) return Math.round(n);
  return Math.round(n * 1000);
}

// ─── PKT time ────────────────────────────────────────────────────────────────

function pktParts(date) {
  const t = new Date(date.getTime() + PKT_OFFSET_MS);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth(), d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() };
}
const pktDate = (y, mo, d, h, mi = 0) => new Date(Date.UTC(y, mo, d, h, mi) - PKT_OFFSET_MS);
const pktHours = (date) => { const p = pktParts(date); return p.h + p.mi / 60; };
const hhmm = (date) => { const p = pktParts(date); return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`; };

/**
 * The summary slot a moment belongs to: the latest even PKT hour from 08 to 22 at
 * or before it, with the window it reports (the 08:00 slot covers 22:00–08:00).
 * null from 00:00 to 07:59 PKT — the night is quiet.
 */
function slotFor(now) {
  const p = pktParts(now);
  if (p.h < 8) return null;
  const hour = Math.min(22, p.h - (p.h % 2));
  const end = pktDate(p.y, p.mo, p.d, hour);
  const start = hour === 8 ? pktDate(p.y, p.mo, p.d - 1, 22) : pktDate(p.y, p.mo, p.d, hour - 2);
  const hh = String(hour).padStart(2, '0');
  const day = `${p.y}-${String(p.mo + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  return { hour: hh, key: `${day}T${hh}`, start, end, label: `${hhmm(start)}–${hhmm(end)} PKT` };
}

function dayStart(now) {
  const p = pktParts(now);
  return pktDate(p.y, p.mo, p.d, 0);
}

// ─── the queries ─────────────────────────────────────────────────────────────

const LIFECYCLE = ['accepted', 'generated', 'generation_failed', 'sent', 'send_failed'];
const COUNTER_MSGS = [
  'lp612.deliver.completed', 'lp612.deliver.failed', 'lp612.deliver.degraded',
  'Starting pedagogical analysis', 'Analysis completed', 'whatsapp.rate_limited',
  'quiz_funnel.offer_made', 'quiz_funnel.scorecard_sent', 'quiz_funnel.class_cards',
];
const COUNTER_CONTAINS = [
  'Hero image report sent', 'Error in processAnalysis', 'Mid-flight watchdog', 'generateReportNarrative failed',
  'combined report delivered to teacher', 'debrief-notes extraction failed',
  'Question list send failed', 'video-quiz message not delivered',
];
const quote = (s) => `'${s}'`;
const COUNTER_FILTER = `(msg in (${COUNTER_MSGS.map(quote).join(', ')}) or ${COUNTER_CONTAINS.map((s) => `msg contains ${quote(s)}`).join(' or ')})`;
const COUNTER_KEY = 'case('
  + "msg == 'lp612.deliver.completed', 'lp612_delivered', "
  + "msg == 'lp612.deliver.failed', 'lp612_failed', "
  + "msg == 'lp612.deliver.degraded', 'lp612_degraded', "
  + "msg == 'Starting pedagogical analysis', 'analysis_started', "
  + "msg == 'Analysis completed', 'analysis_completed', "
  + "msg contains 'Hero image report sent', 'coaching_reports', "
  + "msg contains 'Error in processAnalysis' or msg contains 'Mid-flight watchdog' or msg contains 'generateReportNarrative failed', 'coaching_errors', "
  + "msg contains 'combined report delivered to teacher', 'observe_delivered', "
  + "msg contains 'debrief-notes extraction failed', 'observe_degraded', "
  + "msg contains 'Question list send failed', 'child_send_failed', "
  + "msg contains 'video-quiz message not delivered', 'media_not_delivered', "
  + "msg == 'whatsapp.rate_limited' and tostring(d.gaveUp) == 'true', 'rate_limited_gave_up', "
  + "msg == 'whatsapp.rate_limited', 'rate_limited_retried', "
  + "msg == 'quiz_funnel.offer_made' and tostring(d.channel) == 'coaching_offer', 'coaching_offers', "
  + "msg == 'quiz_funnel.scorecard_sent' and tostring(d.ok) == 'false', 'scorecard_fallback', "
  + "msg == 'quiz_funnel.class_cards', 'class_cards', "
  + "'')";
const STAGE = "substring(msg, 12)";   // 'quiz_funnel.' is 12 characters

/** Every APL this watcher runs, keyed by name — one place, so the suite can read them all. */
function aplFor({ env, dataset, now }) {
  const P = `['${dataset}'] | where env == '${env}' | `;
  const at = (ms) => `datetime(${new Date(now.getTime() - ms).toISOString()})`;
  const inList = (stages) => stages.map((s) => quote(`quiz_funnel.${s}`)).join(', ');
  const summary = `${P}where msg startswith 'quiz_funnel.' | extend d = parse_json(data_json) `
    + '| summarize c = count(), q = dcount(tostring(d.quiz_id)), s = dcount(tostring(d.session_id)), '
    + 'n = sum(toint(d.n)), f = sum(toint(d.failed)), k = sum(toint(d.skipped)) '
    + `by stage = ${STAGE}, source = tostring(d.source), channel = tostring(d.channel), choice = tostring(d.choice), `
    + 'ok = tostring(d.ok), kind = tostring(d.kind), delivered = tostring(d.delivered) | limit 5000';
  return {
    lifecycle: `${P}where msg in (${inList(LIFECYCLE)}) | extend d = parse_json(data_json) `
      + `| summarize t = min(_time), tl = max(_time), reasons = make_set(tostring(d.reason)) `
      + `by q = tostring(d.quiz_id), stage = ${STAGE}, source = tostring(d.source) | limit 20000`,
    children: `${P}where msg in (${inList(['child_completed', 'scorecard_sent'])}) | extend d = parse_json(data_json) `
      + `| summarize t = min(_time), oks = make_set(tostring(d.ok)) `
      + `by s = tostring(d.session_id), q = tostring(d.quiz_id), stage = ${STAGE}, source = tostring(d.source) | limit 20000`,
    reports: `${P}where msg in (${inList(['child_joined', 'report_sent'])}) | extend d = parse_json(data_json) `
      + `| summarize t = min(_time) by q = tostring(d.quiz_id), stage = ${STAGE}, source = tostring(d.source) | limit 50000`,
    counters: `${P}where ${COUNTER_FILTER} | extend d = parse_json(data_json) | extend k = ${COUNTER_KEY} | where k != '' `
      + `| summarize c60 = countif(_time >= ${at(60 * MIN)}), c75 = countif(_time >= ${at(75 * MIN)}), `
      + `lag = countif(_time >= ${at(75 * MIN)} and _time < ${at(15 * MIN)}), c120 = count(), `
      + `f60 = sumif(toint(d.failed), _time >= ${at(60 * MIN)}) by k`,
    // `lp_quiz.offer_sent` counts too: it is logged by the same send, so an offer
    // that went out is never mistaken for one that did not — including while a
    // deploy is rolling and only one of the two events exists.
    lp_today: `${P}where msg in ('lp_quiz.cohort_built', 'quiz_funnel.offer_made', 'lp_quiz.offer_sent', 'lp_quiz.offer_skipped') `
      + '| extend d = parse_json(data_json) '
      + "| summarize inserted = sumif(toint(d.inserted), msg == 'lp_quiz.cohort_built'), "
      + "offers = countif((msg == 'quiz_funnel.offer_made' and tostring(d.channel) == 'lp_offer') or msg == 'lp_quiz.offer_sent'), "
      + "skipped = countif(msg == 'lp_quiz.offer_skipped')",
    summary,
    // The same funnel over the day so far: a different time range, the same query.
    summary_today: summary,
    other: `${P}where ${COUNTER_FILTER} | extend d = parse_json(data_json) | extend k = ${COUNTER_KEY} | where k != '' `
      + '| summarize c = count(), f = sum(toint(d.failed)) by k',
  };
}

// ─── counting ────────────────────────────────────────────────────────────────

function blankCounts() {
  return {
    offers: 0, undelivered: 0, yes: 0, no: 0, expired: 0, accepted: 0, menu: 0, remake: 0,
    started: 0, generated: 0, failed: 0, sent: 0, sendFailed: 0, joined: 0, completed: 0,
    scorecards: 0, scorecardFallback: 0, classCards: 0, classCardFailed: 0, reports: 0, reportsNoOne: 0, reportFailed: 0,
  };
}

/** The funnel per stream, from the `summary` rows. Rows outside the two streams are ignored. */
function streamCounts(rows = []) {
  const out = { transcript: blankCounts(), lp: blankCounts() };
  for (const r of rows || []) {
    const stream = streamOf(r.source);
    if (!stream) continue;
    const c = out[stream];
    switch (r.stage) {
      case 'offer_made':
        c.offers += num(r.c);
        if (String(r.delivered) === 'false') c.undelivered += num(r.c);
        break;
      case 'offer_answered':
        if (r.choice === 'no') c.no += num(r.c);
        else if (r.choice === 'expired') c.expired += num(r.c);
        else c.yes += num(r.c);            // yes, or a class picked from the list
        break;
      case 'accepted':
        c.accepted += num(r.q);
        if (r.channel === 'quiz_menu') c.menu += num(r.q);
        if (r.channel === 'remake') c.remake += num(r.q);
        break;
      case 'generation_started': c.started += num(r.q); break;
      case 'generated': c.generated += num(r.q); break;
      case 'generation_failed': c.failed += num(r.q); break;
      case 'sent': c.sent += num(r.q); break;
      case 'send_failed': c.sendFailed += num(r.q); break;
      case 'child_joined': c.joined += num(r.s); break;
      case 'child_completed': c.completed += num(r.s); break;
      case 'scorecard_sent':
        if (String(r.ok) === 'false') c.scorecardFallback += num(r.c);
        else c.scorecards += num(r.c);
        break;
      case 'class_cards':
        c.classCards += num(r.n);
        c.classCardFailed += num(r.f);
        break;
      case 'report_sent':
        if (r.kind === 'no_one') c.reportsNoOne += num(r.c);
        else c.reports += num(r.c);
        break;
      case 'report_failed': c.reportFailed += num(r.c); break;
      default: break;
    }
  }
  return out;
}

function verdictFor(counts, incidents = [], stream) {
  if (stream && incidents.some((i) => i.stream === stream)) return 'stalled';
  const c = counts || blankCounts();
  return (c.offers + c.accepted + c.sent + c.joined + c.completed + c.reports) ? 'flowing' : 'idle';
}

// ─── incidents ───────────────────────────────────────────────────────────────

const STREAM_NAME = { transcript: 'Recordings', lp: 'Lesson plans' };
const short = (id) => String(id).slice(0, 8);
function idList(ids, cfg) {
  const shown = ids.slice(0, cfg.idsShown).map(short).join(', ');
  return ids.length > cfg.idsShown ? `${shown} +${ids.length - cfg.idsShown} more` : shown;
}

function byQuiz(rows) {
  const m = new Map();
  for (const r of rows || []) {
    if (!r.q) continue;
    const e = m.get(r.q) || { q: r.q, source: r.source || null, first: {}, last: {}, reasons: {} };
    const t0 = toMillis(r.t);
    const t1 = toMillis(r.tl) || t0;
    if (t0 !== null) e.first[r.stage] = Math.min(e.first[r.stage] ?? Infinity, t0);
    if (t1 !== null) e.last[r.stage] = Math.max(e.last[r.stage] ?? -Infinity, t1);
    if (r.reasons) e.reasons[r.stage] = [...(e.reasons[r.stage] || []), ...[].concat(r.reasons).filter(Boolean)];
    if (!e.source && r.source) e.source = r.source;
    m.set(r.q, e);
  }
  return m;
}

function groupByStream(entries) {
  const g = {};
  for (const e of entries) {
    const s = streamOf(e.source);
    if (!s) continue;
    (g[s] = g[s] || []).push(e);
  }
  return g;
}

function counterMap(rows) {
  const m = {};
  for (const r of rows || []) m[r.k] = r;
  return m;
}
const c60 = (m, k) => num(m[k] && m[k].c60);

/**
 * Everything wrong right now, from the incident queries. Pure: `data` holds the
 * rows each query returned ({lifecycle, children, reports, counters, lpToday}).
 * Returns [{kind, stream, ids?, text, dedup: 'ids'|'kind', key?}].
 */
function findIncidents(data = {}, now = new Date(), cfg = DEFAULTS) {
  const t = now.getTime();
  const out = [];
  const lookback = t - cfg.lifecycleLookbackH * H;

  // ── generate → send ─────────────────────────────────────────────────────
  const quizzes = [...byQuiz(data.lifecycle).values()];
  const failedRecent = quizzes.filter((e) => e.last.generation_failed >= t - cfg.genFailWindowMin * MIN);
  const madeRecent = quizzes.filter((e) => e.last.generated >= t - cfg.genFailWindowMin * MIN);
  const failedBy = groupByStream(failedRecent);
  const madeBy = groupByStream(madeRecent);
  for (const [stream, failed] of Object.entries(failedBy)) {
    const F = failed.length;
    const G = (madeBy[stream] || []).length;
    if (F >= cfg.genFailMin || (F >= cfg.genFailPairMin && F / (F + G) >= cfg.genFailRate)) {
      const tally = {};
      failed.forEach((e) => (e.reasons.generation_failed || ['?']).forEach((r) => { tally[r] = (tally[r] || 0) + 1; }));
      const why = Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ×${n}`).join(', ');
      out.push({
        kind: 'gen_failures', stream, dedup: 'kind', key: `gen_failures:${stream}`, ids: failed.map((e) => e.q),
        text: `*${STREAM_NAME[stream]} — ${F} quiz${F === 1 ? '' : 'zes'} failed to generate* in the last hour `
          + `(of ${F + G}; ${why})`,
      });
    }
  }

  const stalledGen = quizzes.filter((e) => {
    const acc = e.last.accepted;
    if (!(acc >= lookback) || acc > t - cfg.genStallMin * MIN) return false;
    return !['generated', 'generation_failed', 'sent', 'send_failed'].some((s) => e.last[s] >= acc - MIN);
  }).sort((a, b) => a.last.accepted - b.last.accepted);
  for (const [stream, list] of Object.entries(groupByStream(stalledGen))) {
    out.push({
      kind: 'gen_stall', stream, dedup: 'ids', ids: list.map((e) => e.q),
      text: `*${STREAM_NAME[stream]} — quiz generation stalled*: accepted over ${cfg.genStallMin} min ago, not made yet`,
    });
  }

  const stalledSend = quizzes.filter((e) => {
    const gen = e.last.generated;
    if (!(gen >= lookback) || gen > t - cfg.sendStallMin * MIN) return false;
    return !['sent', 'send_failed', 'generation_failed'].some((s) => e.last[s] >= gen - MIN);
  });
  for (const [stream, list] of Object.entries(groupByStream(stalledSend))) {
    out.push({
      kind: 'send_stall', stream, dedup: 'ids', ids: list.map((e) => e.q),
      text: `*${STREAM_NAME[stream]} — made but never sent*: ready over ${cfg.sendStallMin} min, the teacher has nothing`,
    });
  }

  const sendFailed = quizzes.filter((e) => e.last.send_failed >= lookback);
  for (const [stream, list] of Object.entries(groupByStream(sendFailed))) {
    const reasons = [...new Set(list.flatMap((e) => e.reasons.send_failed || []))].join(', ') || 'unknown';
    out.push({
      kind: 'send_failed', stream, dedup: 'ids', ids: list.map((e) => e.q),
      text: `*${STREAM_NAME[stream]} — the class link did not reach the teacher* (${reasons})`,
    });
  }

  // ── children: every finished child gets a scorecard ────────────────────
  const sessions = new Map();
  for (const r of data.children || []) {
    if (!r.s) continue;
    const e = sessions.get(r.s) || { s: r.s, q: r.q, source: r.source, first: {} };
    e.first[r.stage] = Math.min(e.first[r.stage] ?? Infinity, toMillis(r.t) ?? Infinity);
    if (!e.source && r.source) e.source = r.source;
    sessions.set(r.s, e);
  }
  const noCard = [...sessions.values()].filter((e) => e.first.child_completed <= t - cfg.scorecardStallMin * MIN
    && !(e.first.scorecard_sent < Infinity));
  for (const [stream, list] of Object.entries(groupByStream(noCard))) {
    out.push({
      kind: 'scorecard_missing', stream, dedup: 'ids', ids: [...new Set(list.map((e) => e.q))], sessions: list.length,
      text: `*${STREAM_NAME[stream]} — ${list.length} child${list.length === 1 ? '' : 'ren'} finished with no scorecard*`,
    });
  }

  // ── the teacher's report ────────────────────────────────────────────────
  const reportQuiz = [...byQuiz(data.reports).values()];
  const owed = reportQuiz.filter((e) => {
    const joined = e.first.child_joined;
    return joined <= t - cfg.reportOwedH * H && joined >= t - cfg.reportLookbackH * H && !(e.first.report_sent > 0);
  });
  for (const [stream, list] of Object.entries(groupByStream(owed))) {
    out.push({
      kind: 'report_owed', stream, dedup: 'ids', ids: list.map((e) => e.q),
      text: `*${STREAM_NAME[stream]} — class report owed*: children joined over ${cfg.reportOwedH} h ago, no report sent`,
    });
  }

  // ── counters: rate limits, missing offers, class cards, the old families ─
  const k = counterMap(data.counters);
  const gaveUp = c60(k, 'rate_limited_gave_up');
  const retried = c60(k, 'rate_limited_retried');
  if (gaveUp >= cfg.rateLimitedGaveUpMin || retried >= cfg.rateLimitedRetriedMin) {
    out.push({
      kind: 'rate_limited', stream: null, dedup: 'kind', key: 'rate_limited', count: gaveUp + retried,
      text: `*Meta is refusing sends for rate* — ${gaveUp} message${gaveUp === 1 ? '' : 's'} given up on, `
        + `${retried} refusal${retried === 1 ? '' : 's'} retried, in the last hour (whatsapp.rate_limited)`,
    });
  }
  const scorecardFallback = c60(k, 'scorecard_fallback');
  if (scorecardFallback >= cfg.scorecardFallbackMin) {
    out.push({
      kind: 'scorecard_fallback', stream: null, dedup: 'kind', key: 'scorecard_fallback', count: scorecardFallback,
      text: `*Scorecards not drawing* — ${scorecardFallback} children got the text fallback in the last hour`,
    });
  }
  const cardFails = num(k.class_cards && k.class_cards.f60);
  if (cardFails >= cfg.classCardFailMin) {
    out.push({
      kind: 'class_card_failures', stream: null, dedup: 'kind', key: 'class_card_failures', count: cardFails,
      text: `*Class cards failing* — ${cardFails} could not be sent in the last hour`,
    });
  }
  const hour = pktHours(now);
  const analyses = num(k.analysis_completed && k.analysis_completed.c120);
  const coachingOffers = num(k.coaching_offers && k.coaching_offers.c120);
  if (hour >= cfg.zeroOffersFromPkt && hour < cfg.zeroOffersToPkt
      && analyses >= cfg.zeroOffersAnalysesMin && coachingOffers === 0) {
    out.push({
      kind: 'zero_offers', stream: 'transcript', dedup: 'kind', key: 'zero_offers',
      text: `*Recordings — no quiz offered* in 2 h while ${analyses} coaching analyses completed`,
    });
  }
  const lp = (data.lpToday || [])[0];
  if (lp && hour >= cfg.lpOffersDeadlinePkt && hour < cfg.lpOffersUntilPkt
      && num(lp.inserted) > 0 && num(lp.offers) === 0 && num(lp.skipped) === 0) {
    const p = pktParts(now);
    out.push({
      kind: 'lp_offers_missing', stream: 'lp', dedup: 'kind', key: `lp_offers_missing:${p.y}-${p.mo + 1}-${p.d}`,
      ttlS: 24 * 3600,
      text: `*Lesson plans — no afternoon offer went out*: ${num(lp.inserted)} teachers were queued today, 0 offered, 0 skipped`,
    });
  }

  // The old digest's families — the same surfaces, as spikes.
  const spike = (key, min, text) => {
    const n = c60(k, key);
    if (n >= min) out.push({ kind: key, stream: null, dedup: 'kind', key, count: n, text: text(n) });
  };
  spike('lp612_failed', cfg.lp612FailMin, (n) => `*6-12 lesson plans* — ${n} failed to deliver in the last hour`);
  spike('coaching_errors', cfg.coachingErrorsMin, (n) => `*Coaching* — ${n} pipeline errors in the last hour`);
  spike('child_send_failed', cfg.childSendFailedMin, (n) => `*Quizzes* — ${n} children could not be sent a question in the last hour`);
  spike('media_not_delivered', cfg.mediaNotDeliveredMin, (n) => `*Quizzes* — ${n} quiz messages undelivered in the last hour`);
  const started = num(k.analysis_started && k.analysis_started.lag);
  const completed = k.analysis_completed ? num(k.analysis_completed.c75 ?? k.analysis_completed.c60) : 0;
  if (started - completed > cfg.coachingLostMin) {
    out.push({
      kind: 'coaching_lost', stream: null, dedup: 'kind', key: 'coaching_lost',
      text: `*Coaching* — ${started - completed} analyses started and did not complete`,
    });
  }
  const degraded = c60(k, 'observe_degraded');
  const delivered = c60(k, 'observe_delivered');
  if (degraded >= cfg.observeDegradedMin && degraded / (degraded + delivered) >= cfg.observeDegradedRate) {
    out.push({
      kind: 'observe_degraded', stream: null, dedup: 'kind', key: 'observe_degraded',
      text: `*Observations* — ${degraded} of ${degraded + delivered} reports shipped without notes in the last hour`,
    });
  }
  return out;
}

// ─── the messages ────────────────────────────────────────────────────────────

function alertLine(i, cfg = DEFAULTS) {
  const ids = i.ids && i.ids.length ? ` — ${idList(i.ids, cfg)}` : '';
  const note = i.unconfirmed ? ' _(not confirmed against the DB)_' : '';
  const more = i.alreadySent ? ` (+${i.alreadySent} already reported)` : '';
  return `• ${i.text}${ids}${more}${note}`;
}

function buildAlert(incidents, now = new Date(), cfg = DEFAULTS) {
  if (!incidents || !incidents.length) return '';
  return [`⚠️ *NIETE quizzes — needs a look* · ${hhmm(now)} PKT`, ...incidents.map((i) => alertLine(i, cfg))].join('\n');
}

const VERDICT = { flowing: '✅ flowing', stalled: '⚠️ stalled', idle: '⏸ idle' };

function streamBlock(name, stream, c, incidents) {
  const v = verdictFor(c, incidents, stream);
  if (v === 'idle') return [`*${name}* — ${VERDICT.idle} (no offers, quizzes or children in this window)`];
  const offers = `offers ${c.offers}${c.undelivered ? ` (${c.undelivered} undelivered)` : ''}`;
  const menu = c.menu ? ` · /quiz ${c.menu}` : '';
  const remake = c.remake ? ` · remade ${c.remake}` : '';
  const sendFail = c.sendFailed ? ` (${c.sendFailed} link not delivered)` : '';
  const cards = `scorecards ${c.scorecards}${c.scorecardFallback ? ` (${c.scorecardFallback} text fallback)` : ''}`;
  const classCards = `class cards ${c.classCards}${c.classCardFailed ? ` (${c.classCardFailed} failed)` : ''}`;
  const reports = `reports ${c.reports}${c.reportsNoOne ? ` (+${c.reportsNoOne} nobody joined)` : ''}`
    + `${c.reportFailed ? ` (${c.reportFailed} failed)` : ''}`;
  return [
    `*${name}* — ${VERDICT[v]}`,
    `${offers} · yes ${c.yes} · no ${c.no}${menu}${remake} → made ${c.generated} · failed ${c.failed} → sent ${c.sent}${sendFail}`,
    `children ${c.joined} joined → ${c.completed} finished · ${cards} · ${classCards} · ${reports}`,
  ];
}

function todayLine(today) {
  const one = (label, c) => (verdictFor(c) === 'idle'
    ? `${label} —`
    : `${label} ${c.offers} offers → ${c.sent} sent → ${c.completed} finished → ${c.reports} reports`);
  return `*Today* ${one('recordings', today.transcript)} · ${one('lesson plans', today.lp)}`;
}

function otherLine(rows) {
  if (!rows) return null;
  const m = {};
  for (const r of rows) m[r.k] = num(r.c);
  const g = (key) => m[key] || 0;
  const bits = [];
  if (g('lp612_delivered') || g('lp612_failed') || g('lp612_degraded')) {
    bits.push(`6-12 LPs ${g('lp612_delivered')} delivered${g('lp612_failed') ? `, ${g('lp612_failed')} failed` : ''}`
      + `${g('lp612_degraded') ? `, ${g('lp612_degraded')} degraded` : ''}`);
  }
  if (g('analysis_completed') || g('coaching_errors')) {
    bits.push(`coaching ${g('analysis_completed')} analysed${g('coaching_errors') ? `, ${g('coaching_errors')} errors` : ''}`);
  }
  if (g('observe_delivered') || g('observe_degraded')) {
    bits.push(`observe ${g('observe_delivered')} sent${g('observe_degraded') ? `, ${g('observe_degraded')} without notes` : ''}`);
  }
  if (g('child_send_failed')) bits.push(`${g('child_send_failed')} child question sends failed`);
  if (g('media_not_delivered')) bits.push(`${g('media_not_delivered')} child media undelivered`);
  if (g('rate_limited_retried') || g('rate_limited_gave_up')) {
    bits.push(`Meta rate limits: ${g('rate_limited_retried')} retried, ${g('rate_limited_gave_up')} given up`);
  }
  return bits.length ? `Other · ${bits.join(' · ')}` : null;
}

function buildSummary({ label, window, today, other, incidents = [], failedQueries = [], cfg = DEFAULTS }) {
  const lines = [`*NIETE quizzes* · ${label}`];
  if (incidents.length) {
    lines.push('⚠️ *needs a look*', ...incidents.map((i) => alertLine(i, cfg)));
  }
  if (window) {
    lines.push(...streamBlock('From recordings', 'transcript', window.transcript, incidents));
    lines.push(...streamBlock('From lesson plans', 'lp', window.lp, incidents));
  } else {
    lines.push('_(funnel counts unavailable — the Axiom query failed)_');
  }
  if (today) lines.push(todayLine(today));
  const o = otherLine(other);
  if (o) lines.push(o);
  if (failedQueries.length) lines.push(`_watcher: ${failedQueries.length} quer${failedQueries.length === 1 ? 'y' : 'ies'} failed (${failedQueries.join(', ')})_`);
  return lines.join('\n');
}

// ─── the run ─────────────────────────────────────────────────────────────────

const TICK_KEY = 'quiz_funnel_watch:tick';
const SUMMARY_KEY = (slot) => `quiz_funnel_watch:summary:${slot.key}`;
const ALERT_KEY = (incident, id) => (id
  ? `quiz_funnel_watch:alert:${incident.kind}:${id}`
  : `quiz_funnel_watch:alert:${incident.key || incident.kind}`);

/**
 * Exactly one replica per tick. `setNX` alone is not enough here: the shared
 * Redis service's setNX answers TRUE when Redis is down (right for capture
 * de-dup, wrong for a monitor — ten replicas would each post). So the claim is
 * read back: only the replica whose token is IN the key speaks, and a read that
 * returns nothing is 'unavailable' — a skip, logged, never a post.
 */
async function claimTick(redis, cfg) {
  const token = `tick:${process.pid}:${Math.random().toString(36).slice(2)}`;
  try {
    if (!redis || (typeof redis.isAvailable === 'function' && !redis.isAvailable())) return 'unavailable';
    await redis.setNX(TICK_KEY, token, Math.max(60, cfg.tickMin * 60 - 60));
    const holder = await redis.get(TICK_KEY);
    if (holder === null || holder === undefined) return 'unavailable';
    return holder === token ? 'owner' : 'other';
  } catch {
    return 'unavailable';
  }
}

async function readKey(redis, key) {
  try { return await redis.get(key); } catch { return null; }
}

/** The incidents not already reported: per quiz id for 'ids', per kind for 'kind'. Reads only. */
async function unreported(incidents, redis) {
  const out = [];
  for (const i of incidents) {
    if (i.dedup === 'ids') {
      const fresh = [];
      for (const id of i.ids) if (!(await readKey(redis, ALERT_KEY(i, id)))) fresh.push(id);
      if (fresh.length) out.push({ ...i, ids: fresh, alreadySent: i.ids.length - fresh.length });
    } else if (!(await readKey(redis, ALERT_KEY(i)))) {
      out.push(i);
    }
  }
  return out;
}

async function markReported(incidents, redis, cfg) {
  for (const i of incidents) {
    try {
      if (i.dedup === 'ids') {
        for (const id of i.ids) await redis.set(ALERT_KEY(i, id), '1', cfg.idDedupH * 3600);
      } else {
        await redis.set(ALERT_KEY(i), '1', i.ttlS || cfg.kindDedupMin * 60);
      }
    } catch (err) {
      logToFile('⚠️ quiz funnel watch: could not record an alert as sent', { kind: i.kind, error: err.message });
    }
  }
}

/** Which statuses mean a stall candidate is REALLY still stuck. */
const STILL_STUCK = {
  gen_stall: (s) => s === 'generating',
  send_stall: (s) => s === 'ready',
  report_owed: (s) => s !== 'report_sent',
};

/**
 * Confirm stall candidates against quizzes.status — bounded: the first
 * cfg.confirmMax ids across all stall incidents, ONE read, only when there is a
 * candidate. An id past the bound, or a read that fails, stays in the alert
 * marked unconfirmed rather than being dropped: a monitor that goes quiet when
 * the database is struggling is the wrong way round.
 */
async function confirmStalls(incidents, confirm, cfg) {
  const stall = incidents.filter((i) => STILL_STUCK[i.kind]);
  if (!stall.length) return incidents;
  const candidates = [...new Set(stall.flatMap((i) => i.ids))];
  if (!confirm) return incidents.map((i) => (STILL_STUCK[i.kind] ? { ...i, unconfirmed: true } : i));
  const checked = candidates.slice(0, cfg.confirmMax);
  let status;
  try {
    const rows = await confirm(checked);
    status = new Map((rows || []).map((r) => [r.id, r.status]));
  } catch (err) {
    logToFile('⚠️ quiz funnel watch: stall confirmation read failed — alerting unconfirmed', { error: err.message }, 'error');
    return incidents.map((i) => (STILL_STUCK[i.kind] ? { ...i, unconfirmed: true } : i));
  }
  const out = [];
  for (const i of incidents) {
    if (!STILL_STUCK[i.kind]) { out.push(i); continue; }
    const keep = i.ids.filter((id) => !status.has(id) ? !checked.includes(id) : STILL_STUCK[i.kind](status.get(id)));
    const unchecked = keep.some((id) => !checked.includes(id));
    if (keep.length) out.push({ ...i, ids: keep, ...(unchecked ? { unconfirmed: true } : {}) });
  }
  return out;
}

/**
 * Everything one tick knows, with no side effects: the incidents (confirmed when
 * `confirm` is given) and, when `window` is given, the summary text. Shared by
 * run() and the dry-run CLI, so the CLI prints exactly what would be posted.
 */
async function buildReport({ now = new Date(), env, dataset, query, confirm = null, cfg = DEFAULTS, window = null }) {
  const apl = aplFor({ env, dataset, now });
  const failedQueries = [];
  const ask = async (name, start, end) => {
    try {
      return await query(name, apl[name], start.toISOString(), end.toISOString());
    } catch (err) {
      failedQueries.push(name);
      logToFile('❌ quiz funnel watch: query failed', { name, error: err.message }, 'error');
      logEvent('quiz_funnel_watch.query_failed', { name });
      return null;
    }
  };
  const t = now.getTime();
  const hour = pktHours(now);
  const data = {
    lifecycle: await ask('lifecycle', new Date(t - cfg.lifecycleLookbackH * H), now),
    children: await ask('children', new Date(t - cfg.childLookbackMin * MIN), now),
    reports: await ask('reports', new Date(t - cfg.reportLookbackH * H), now),
    counters: await ask('counters', new Date(t - 120 * MIN), now),
    lpToday: hour >= cfg.lpOffersDeadlinePkt && hour < cfg.lpOffersUntilPkt ? await ask('lp_today', dayStart(now), now) : null,
  };
  let incidents = findIncidents(data, now, cfg);
  incidents = await confirmStalls(incidents, confirm, cfg);

  let summary = null;
  if (window) {
    const rows = await ask('summary', window.start, window.end);
    const todayRows = await ask('summary_today', dayStart(window.end), window.end);
    const other = await ask('other', window.start, window.end);
    summary = {
      label: window.label,
      window: rows ? streamCounts(rows) : null,
      today: todayRows ? streamCounts(todayRows) : null,
      other,
    };
  }
  return { incidents, summary, failedQueries };
}

/**
 * One tick. Silent unless a summary slot is due or something is wrong, and a
 * complete no-op until QUIZ_FUNNEL_WATCH_ENABLED=true.
 */
async function run({
  now = new Date(), env = process.env, redis, query, confirm, post,
} = {}) {
  if (String(env.QUIZ_FUNNEL_WATCH_ENABLED || '').toLowerCase() !== 'true') return { skipped: 'disabled' };
  const slack = slackTarget(env);
  if (!slack.token || !slack.channel || !(env.AXIOM_API_TOKEN || env.AXIOM_TOKEN)) {
    logEvent('quiz_funnel_watch.skipped', { why: 'unconfigured' });
    return { skipped: 'unconfigured' };
  }
  const cfg = config(env);
  const redisSvc = redis || require('../cache/railway-redis.service');

  // One replica speaks. Claimed before any query, so the others cost nothing.
  const lock = await claimTick(redisSvc, cfg);
  if (lock !== 'owner') {
    const why = lock === 'unavailable' ? 'lock_unavailable' : 'another_replica';
    logEvent('quiz_funnel_watch.skipped', { why });
    return { skipped: why };
  }

  const slot = slotFor(now);
  const summaryDue = Boolean(slot) && !(await readKey(redisSvc, SUMMARY_KEY(slot)));
  const report = await buildReport({
    now,
    env: env.QUIZ_FUNNEL_WATCH_ENV || env.NODE_ENV || 'production',
    dataset: env.QUIZ_FUNNEL_WATCH_DATASET || env.AXIOM_DATASET || 'niete-logs',
    query: query || axiomQuery,
    confirm: confirm === undefined ? confirmFromDb : confirm,
    cfg,
    window: summaryDue ? slot : null,
  });
  const fresh = await unreported(report.incidents, redisSvc);

  let text = '';
  if (summaryDue) {
    text = buildSummary({ ...report.summary, incidents: fresh, failedQueries: report.failedQueries, cfg });
  } else if (fresh.length) {
    text = buildAlert(fresh, now, cfg);
  }
  if (!text) {
    logEvent('quiz_funnel_watch.tick', { alerts: 0, incidents: report.incidents.length, summary: false });
    return { summary: false, alerts: 0 };
  }

  try {
    await (post || postToSlack)(text, slack);
  } catch (err) {
    // Not recorded as sent: the next tick tries again.
    logToFile('❌ quiz funnel watch: Slack post failed', { error: err.message }, 'error');
    logEvent('quiz_funnel_watch.post_failed', { alerts: fresh.length, summary: summaryDue });
    return { failed: true };
  }
  await markReported(fresh, redisSvc, cfg);
  if (summaryDue) {
    try { await redisSvc.set(SUMMARY_KEY(slot), '1', 6 * 3600); } catch { /* a repeat summary beats a crash */ }
  }
  logEvent('quiz_funnel_watch.tick', {
    alerts: fresh.length, incidents: report.incidents.length, summary: summaryDue,
    kinds: fresh.map((i) => i.kind).join(','),
  });
  return { summary: summaryDue, alerts: fresh.length };
}

// ─── the network boundary ────────────────────────────────────────────────────

const AX_URL = 'https://api.axiom.co/v1/datasets/_apl?format=tabular';

/** One APL query → rows ([{column: value}]). Throws on a non-200. */
async function axiomQuery(name, apl, startIso, endIso, env = process.env) {
  const headers = {
    Authorization: `Bearer ${env.AXIOM_API_TOKEN || env.AXIOM_TOKEN || ''}`,
    'Content-Type': 'application/json',
  };
  if (env.AXIOM_ORG_ID) headers['X-Axiom-Org-Id'] = env.AXIOM_ORG_ID;
  const res = await fetch(AX_URL, {
    method: 'POST', headers, body: JSON.stringify({ apl, startTime: startIso, endTime: endIso }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`axiom ${res.status} on ${name}: ${body.slice(0, 200)}`);
  }
  const body = await res.json();
  const table = (body.tables || [])[0];
  if (!table) return [];
  const fields = table.fields.map((f) => f.name);
  const cols = table.columns || [];
  const n = cols.length ? cols[0].length : 0;
  const rows = [];
  for (let r = 0; r < n; r += 1) {
    const row = {};
    fields.forEach((f, i) => { row[f] = cols[i][r]; });
    rows.push(row);
  }
  return rows;
}

/** The bounded stall confirmation: one primary-key read, narrow columns. */
async function confirmFromDb(ids) {
  const supabase = require('../../config/supabase');
  const { data, error } = await supabase.from('quizzes').select('id, status').in('id', ids);
  if (error) throw new Error(error.message);
  return data || [];
}

async function postToSlack(text, slack) {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${slack.token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel: slack.channel, text, unfurl_links: false }),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error(`slack ${body.error || res.status}`);
  return body.ts;
}

module.exports = {
  DEFAULTS, config, slackTarget, toMillis, slotFor, dayStart, aplFor, streamCounts, verdictFor, findIncidents,
  buildAlert, buildSummary, buildReport, run, claimTick, axiomQuery, confirmFromDb, TICK_KEY,
};
