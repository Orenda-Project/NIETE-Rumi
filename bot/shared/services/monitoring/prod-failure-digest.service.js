'use strict';
/**
 * The hourly production failure digest.
 *
 * Asks one question every hour — did anything reach a teacher or a child less
 * than whole? — and says nothing when the answer is no. A digest that cries
 * wolf gets muted, and a muted digest is worse than none.
 *
 * WHERE IT RUNS. Inside the sqs-worker, on the same setInterval pattern as the
 * debrief retry sweep, because that process already holds the Axiom credentials
 * and runs on Railway — so it is alive whether or not anyone's laptop is.
 * Axiom's own monitors were the first choice and are not reachable: the token we
 * hold is query-scoped (403 on /v2/monitors and /v2/notifiers). A scheduled
 * cloud agent was the second and cannot reach Axiom or Slack at all.
 *
 * WHAT IT WATCHES. The SURFACE, never the machinery (root rule 24). The
 * temptation is `lp612.render.failed`, which fires ~329 times a day against
 * ~123 completions and reads like a 73% failure rate. It is the author's own
 * quality gate rejecting a draft mid-loop — "FIGURE TOO SMALL", "PAGE COUNT:
 * teach needs 10 pages; the cap is 9" — which then triggers a revision round and
 * usually succeeds. Alerting on it would produce 329 false alarms a day and the
 * digest would be muted inside a week. SURFACE_ONLY names it so the next person
 * who finds that number knows it was considered and rejected.
 */

const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

/** Signals deliberately NOT alerted on, and why. Asserted by the suite. */
const SURFACE_ONLY = [
  // the author's own quality gate mid-loop, not a teacher missing anything
  'lp612.render.failed',
  'lp612 render produced defects',
  // a draft being revised is the loop working
  'lp612.author.revision_round',
];

const P = "['niete-logs'] | where env == 'production' | ";
const count = (family, key, where) => ({ family, key, apl: `${P}${where} | summarize c=count()` });

/**
 * One Axiom query per counter. Each names the family and the key it fills, so a
 * new signal is one row here and one line in the formatter.
 */
const QUERIES = [
  // ── 6-12 lesson plans: did the teacher get the PDF? ──────────────────────
  count('lp', 'delivered', "where msg == 'lp612.deliver.completed'"),
  count('lp', 'failed', "where msg == 'lp612.deliver.failed'"),
  count('lp', 'degraded', "where msg == 'lp612.deliver.degraded'"),
  count('lp', 'overCap', "where msg == 'lp612.deliver.over_cap'"),

  // ── quizzes: did the class get one, and could the children answer it? ────
  count('quiz', 'accepted', "where msg == 'transcript_quiz.accepted'"),
  count('quiz', 'sent', "where msg == 'transcript_quiz.sent'"),
  count('quiz', 'failed', "where msg == 'transcript_quiz.failed'"),
  count('quiz', 'childSendFailed', "where msg contains 'Question list send failed'"),
  count('quiz', 'mediaNotDelivered', "where msg contains 'video-quiz message not delivered'"),

  // ── coaching: did the recording become a report the teacher received? ────
  count('coaching', 'analysisStarted', "where msg == 'Starting pedagogical analysis'"),
  count('coaching', 'analysisCompleted', "where msg == 'Analysis completed'"),
  count('coaching', 'reportsSent', "where msg contains 'Hero image report sent'"),
  count('coaching', 'errors',
    "where msg contains 'Error in processAnalysis' or msg contains 'Mid-flight watchdog' "
    + "or msg contains 'generateReportNarrative failed'"),
  count('coaching', 'observeDelivered', "where msg contains 'combined report delivered to teacher'"),
  count('coaching', 'observeDegraded', "where msg contains 'debrief-notes extraction failed'"),
];

/**
 * A shortfall this small is work still in flight at the moment we looked, not a
 * loss: an analysis started at 10:58 has not finished by 11:00 and never should
 * have.
 */
const INFLIGHT_TOLERANCE = 2;

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Decide whether this hour is worth a message, and write it.
 * Pure — the suite asserts the rule directly rather than through Axiom.
 */
function buildDigest(counts = {}, { windowMin = 60 } = {}) {
  const lp = counts.lp || {};
  const quiz = counts.quiz || {};
  const co = counts.coaching || {};

  const lines = [];

  const lpBad = n(lp.failed) + n(lp.degraded);
  if (lpBad > 0) {
    const bits = [];
    if (n(lp.failed)) bits.push(`*${n(lp.failed)}* failed to deliver`);
    if (n(lp.degraded)) bits.push(`*${n(lp.degraded)}* delivered degraded`);
    lines.push(`• *6-12 lesson plans* — ${bits.join(', ')}, of ${n(lp.delivered) + n(lp.failed)} attempted.`);
  }

  const quizBad = n(quiz.failed) + n(quiz.childSendFailed) + n(quiz.mediaNotDelivered);
  if (quizBad > 0) {
    const bits = [];
    if (n(quiz.failed)) {
      bits.push(`*${n(quiz.failed)}* quiz${n(quiz.failed) === 1 ? '' : 'zes'} never reached the teacher`
        + ` (of ${n(quiz.accepted)} accepted)`);
    }
    if (n(quiz.childSendFailed)) bits.push(`*${n(quiz.childSendFailed)}* children could not be sent a question`);
    if (n(quiz.mediaNotDelivered)) bits.push(`*${n(quiz.mediaNotDelivered)}* quiz messages undelivered`);
    lines.push(`• *Quizzes* — ${bits.join('; ')}.`);
  }

  const lost = Math.max(0, n(co.analysisStarted) - n(co.analysisCompleted));
  const coBad = n(co.errors) + n(co.observeDegraded) + (lost > INFLIGHT_TOLERANCE ? lost : 0);
  if (coBad > 0) {
    const bits = [];
    if (n(co.errors)) bits.push(`*${n(co.errors)}* pipeline error${n(co.errors) === 1 ? '' : 's'}`);
    if (lost > INFLIGHT_TOLERANCE) {
      bits.push(`*${lost}* of ${n(co.analysisStarted)} analyses started and did not complete`);
    }
    if (n(co.observeDegraded)) bits.push(`*${n(co.observeDegraded)}* observation reports shipped without notes`);
    lines.push(`• *Coaching* — ${bits.join('; ')}. ${n(co.reportsSent)} reports sent.`);
  }

  if (!lines.length) return { report: false, text: '' };

  const families = lines.length === 1 ? 'one area' : `${lines.length} areas`;
  const head = `NIETE production — something needs a look in ${families}, last ${windowMin} min.`;
  return { report: true, text: [head, '', ...lines].join('\n') };
}


// ─── the run ─────────────────────────────────────────────────────────────────

const AX_URL = 'https://api.axiom.co/v1/datasets/_apl?format=legacy';

function axiomToken() {
  return process.env.AXIOM_API_TOKEN || process.env.AXIOM_TOKEN || '';
}

async function axiom(apl, windowMin) {
  const end = new Date();
  const start = new Date(end.getTime() - windowMin * 60 * 1000);
  const headers = { Authorization: `Bearer ${axiomToken()}`, 'Content-Type': 'application/json' };
  if (process.env.AXIOM_ORG_ID) headers['X-Axiom-Org-Id'] = process.env.AXIOM_ORG_ID;
  const res = await fetch(AX_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ apl, startTime: start.toISOString(), endTime: end.toISOString() }),
  });
  if (!res.ok) throw new Error(`axiom ${res.status}`);
  const body = await res.json();
  const totals = (body.buckets && body.buckets.totals) || [];
  const first = totals[0] && totals[0].aggregations && totals[0].aggregations[0];
  return n(first && first.value);
}

/** Run every query and fold the answers into {family: {key: count}}. */
async function fetchCounts(windowMin) {
  const counts = { lp: {}, quiz: {}, coaching: {} };
  for (const q of QUERIES) {
    try {
      counts[q.family][q.key] = await axiom(q.apl, windowMin);
    } catch (err) {
      // One unreachable counter must not cost the whole digest. A missing
      // counter reads as 0, which can only make the digest quieter, never
      // noisier — so a broken query can never raise a false alarm.
      counts[q.family][q.key] = 0;
      logToFile('⚠️ prod digest: a counter failed', {
        key: `${q.family}.${q.key}`, error: err.message,
      });
    }
  }
  return counts;
}

async function postToSlack(text) {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PROD_DIGEST_SLACK_TOKEN}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: process.env.PROD_DIGEST_SLACK_CHANNEL, text, unfurl_links: false,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error(`slack ${body.error || res.status}`);
  return body.ts;
}


/**
 * How far back this run should look.
 *
 * Not simply "the last hour". This worker redeploys on every push to main —
 * several times on a busy day — and a fresh process starts its interval from
 * zero, so an hourly timer alone can be reset forever and never fire once. The
 * debrief sweep carries the same warning in its own comment.
 *
 * So the digest runs shortly after every boot AND hourly, and asks Axiom when it
 * last spoke: the window is the gap since that moment, which makes a redeploy
 * cost nothing and a long outage self-heal. Two guards keep it honest — a run
 * closer than MIN_GAP_MIN to the last one is skipped rather than re-reporting
 * the same failures to someone who just read them, and the window never opens
 * wider than MAX_WINDOW_MIN so a week of downtime cannot produce a week-long
 * digest.
 */
const MIN_GAP_MIN = 45;
const MAX_WINDOW_MIN = 180;

async function windowSinceLastDigest(fallbackMin) {
  try {
    const apl = `${P}where msg == 'prod_digest.clean' or msg == 'prod_digest.reported' `
      + '| summarize last_seen = max(_time)';
    const end = new Date();
    const start = new Date(end.getTime() - MAX_WINDOW_MIN * 60 * 1000);
    const headers = { Authorization: `Bearer ${axiomToken()}`, 'Content-Type': 'application/json' };
    if (process.env.AXIOM_ORG_ID) headers['X-Axiom-Org-Id'] = process.env.AXIOM_ORG_ID;
    const res = await fetch(AX_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ apl, startTime: start.toISOString(), endTime: end.toISOString() }),
    });
    if (!res.ok) return { windowMin: fallbackMin };
    const body = await res.json();
    const totals = (body.buckets && body.buckets.totals) || [];
    const agg = totals[0] && totals[0].aggregations && totals[0].aggregations[0];
    const lastSeen = agg && agg.value ? new Date(agg.value) : null;
    if (!lastSeen || Number.isNaN(lastSeen.getTime())) return { windowMin: fallbackMin };
    const gapMin = Math.round((Date.now() - lastSeen.getTime()) / 60000);
    if (gapMin < MIN_GAP_MIN) return { tooSoon: true, gapMin };
    return { windowMin: Math.min(MAX_WINDOW_MIN, Math.max(5, gapMin)) };
  } catch {
    // Never let the bookkeeping query decide whether the digest runs.
    return { windowMin: fallbackMin };
  }
}


/**
 * The tick lock.
 *
 * The first live run posted the SAME digest SIX times inside 500 ms — once per
 * worker replica. The 45-minute gap guard could not prevent it: that guard asks
 * Axiom when the digest last spoke, and six replicas booting together all asked
 * before any of them had answered. A time-based guard cannot settle a tie
 * between processes; only a lock can, which is why the debrief retry sweep
 * beside it takes one per row.
 *
 * So one key, claimed with setNX for the length of the gap. Whoever claims it
 * reports; everyone else goes quiet until it expires — which also makes the
 * gap guard redundant across replicas and keeps it honest across redeploys.
 *
 * If Redis is unreachable the digest runs anyway. A monitor that goes silent
 * because its lock is down is worse than one that occasionally repeats itself:
 * a duplicate is noticed and ignored, a silence is trusted.
 */
const TICK_KEY = 'prod:digest:tick';

async function claimTick() {
  try {
    const redisService = require('../cache/railway-redis.service');
    const got = await redisService.setNX(TICK_KEY, String(Date.now()), MIN_GAP_MIN * 60);
    return { claimed: Boolean(got) };
  } catch (err) {
    logToFile('⚠️ prod digest: tick lock unreachable, running anyway', { error: err.message });
    return { claimed: true, degraded: true };
  }
}

/**
 * One digest cycle. Silent by design: no message when every family is clean,
 * and a complete no-op until the env is set, so merging this changes nothing
 * anywhere until someone turns it on.
 */
async function run({ windowMin = n(process.env.PROD_DIGEST_WINDOW_MIN) || 60 } = {}) {
  if (String(process.env.PROD_DIGEST_ENABLED || '').toLowerCase() !== 'true') {
    return { skipped: 'disabled' };   // not armed anywhere: nothing to say, nothing to log
  }
  if (!process.env.PROD_DIGEST_SLACK_TOKEN || !process.env.PROD_DIGEST_SLACK_CHANNEL || !axiomToken()) {
    return { skipped: 'unconfigured' };
  }
  // One replica speaks. Claimed before any query so the losers cost nothing.
  const tick = await claimTick();
  if (!tick.claimed) {
    // Logged, not silent. A monitor whose quiet minutes leave no trace cannot be
    // told apart from a monitor that died, and the second is the dangerous one.
    logEvent('prod_digest.skipped', { why: 'another_replica' });
    return { skipped: 'another_replica' };
  }

  // A redeploy must not re-report what was reported ten minutes ago, and a gap
  // must not be lost just because the process restarted inside it.
  const w = await windowSinceLastDigest(windowMin);
  if (w.tooSoon) {
    logEvent('prod_digest.skipped', { why: 'too_soon', gapMin: w.gapMin });
    return { skipped: 'too_soon', gapMin: w.gapMin };
  }
  windowMin = w.windowMin;

  const counts = await fetchCounts(windowMin);
  const digest = buildDigest(counts, { windowMin });
  if (!digest.report) {
    logEvent('prod_digest.clean', { windowMin });
    return { reported: false };
  }
  const ts = await postToSlack(digest.text);
  logEvent('prod_digest.reported', { windowMin, ts: Boolean(ts) });
  return { reported: true, ts };
}

module.exports = {
  buildDigest, QUERIES, SURFACE_ONLY, INFLIGHT_TOLERANCE, run, fetchCounts,
  windowSinceLastDigest, MIN_GAP_MIN, MAX_WINDOW_MIN, claimTick, TICK_KEY,
};
