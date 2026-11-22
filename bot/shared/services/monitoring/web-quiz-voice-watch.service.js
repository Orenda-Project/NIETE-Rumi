'use strict';
/**
 * The daily voice alarm: the share of web quiz page sittings that lost at least one read-aloud clip, per Pakistan day,
 * posted on the existing ops stream (the quiz funnel watcher's Slack DM, quiz-funnel-watch.service.js slackTarget /
 * postToSlack) when it crosses its line. No new channel; Axiom read through the watcher's own axiomQuery.
 *
 * A sitting is a quiz session that showed a question (distinct `sid` on web_quiz.question_view); it lost a clip when the
 * same `sid` logged web_quiz.audio_fallback. One query per Pakistan day (19:00Z the day before to 19:00Z), one
 * summarize (a two-stage summarize drops rows over multi-day windows).
 *
 * The line (production, Axiom): 12–20 Oct ran 7.2–8.4% a day (median ~7.9%); 19 Nov was 23.8% (239 of 1,005).
 *   - one day at or above DAY_PCT (15%, about twice the mid-October median), on a day with at least MIN_SITTINGS, or
 *   - the last ROLL_DAYS days each with MIN_SITTINGS, averaging at or above ROLL_PCT (12%).
 * A day under MIN_SITTINGS (a holiday, a Sunday) never alerts on its own. Both lines share ONE marker (REPEAT_KEY, kept
 * ROLL_REPEAT_DAYS) holding the share of the day it posted: inside that week nothing posts again unless a day crosses
 * the one-day line at least REPOST_POINTS above the posted share, which posts and re-arms the marker. 25 of the 42 days
 * 10 Oct - 20 Nov crossed a line, so a post per crossing would be wallpaper; a plain weekly cap would hide a spike.
 *
 * Runs once per Pakistan day, from 09:00 PKT, for yesterday: one replica (claimTick), a day marker after the check.
 * Env (worker): WEB_QUIZ_VOICE_WATCH_ENABLED=true; the watcher's Slack and Axiom env (QUIZ_FUNNEL_WATCH_SLACK_TOKEN |
 * PROD_DIGEST_SLACK_TOKEN, QUIZ_FUNNEL_WATCH_SLACK_CHANNEL | PROD_DIGEST_SLACK_CHANNEL, AXIOM_TOKEN | AXIOM_API_TOKEN,
 * AXIOM_ORG_ID); QUIZ_FUNNEL_WATCH_DATASET / QUIZ_FUNNEL_WATCH_ENV as the watcher.
 */
const { logEvent } = require('../../utils/structured-logger');
const { logToFile } = require('../../utils/logger');

const DAY_PCT = 15;
const ROLL_PCT = 12;
const ROLL_DAYS = 3;
const MIN_SITTINGS = 300;
const BASELINE_PCT = 7.9; // 12–20 Oct 2026 median, said in the alert
const DUE_HOUR_PKT = 9;
const TICK_KEY = 'web_quiz_voice_watch:tick';
const DAY_KEY = (day) => `web_quiz_voice_watch:day:${day}`;
const REPEAT_KEY = 'web_quiz_voice_watch:posted';
const ROLL_REPEAT_DAYS = 7;
const REPOST_POINTS = 5;
const MARKER_TTL_S = 3 * 24 * 3600;
const PKT_MS = 5 * 3600 * 1000;

const watch = () => require('./quiz-funnel-watch.service');

/** The Pakistan date `days` before `now` (yyyy-mm-dd). */
function pktDay(now, days = 0) {
  return new Date(now.getTime() + PKT_MS - days * 86400000).toISOString().slice(0, 10);
}

/** [start, end) of a Pakistan day as UTC ISO strings. */
function dayWindow(day) {
  const start = Date.parse(`${day}T00:00:00Z`) - PKT_MS;
  return [new Date(start).toISOString(), new Date(start + 86400000).toISOString()];
}

function aplFor({ dataset, env }) {
  return `['${dataset}'] | where env == '${env}' and (event == 'web_quiz.question_view' or event == 'web_quiz.audio_fallback')`
    + ` | extend sid = extract('"sid":"([^"]+)"', 1, data_json), reason = extract('"reason":"([^"]+)"', 1, data_json)`
    + ` | summarize sit = dcountif(sid, event == 'web_quiz.question_view'), hit = dcountif(sid, event == 'web_quiz.audio_fallback'),`
    + ` fb = countif(event == 'web_quiz.audio_fallback'), stalled = countif(reason == 'stalled'), reject = countif(reason == 'reject'),`
    + ` unsupported = countif(reason == 'unsupported'), error = countif(reason == 'error')`;
}

const pct = (d) => (d && d.sit ? (100 * d.hit) / d.sit : 0);

/** days: oldest first, the last is the day being judged. → { alert, why: 'day'|'rolling'|null, share, day } */
function verdict(days) {
  const last = days[days.length - 1] || {};
  const share = pct(last);
  if (last.sit >= MIN_SITTINGS && share >= DAY_PCT) return { alert: true, why: 'day', share, day: last.day };
  const roll = days.slice(-ROLL_DAYS);
  if (roll.length === ROLL_DAYS && roll.every((d) => d.sit >= MIN_SITTINGS)) {
    const mean = roll.reduce((s, d) => s + pct(d), 0) / ROLL_DAYS;
    if (mean >= ROLL_PCT) return { alert: true, why: 'rolling', share, mean, day: last.day };
  }
  return { alert: false, why: null, share, day: last.day };
}

const n = (x) => Number(x || 0).toLocaleString('en-US');

/** prev: the marker of the post this one repeats inside its week ({day, share}), or null. */
function alertText(v, days, prev = null) {
  const d = days[days.length - 1];
  const each = days.slice(-ROLL_DAYS).map((x) => `${x.day} ${pct(x).toFixed(1)}%`).join(', ');
  const head = v.why === 'rolling'
    ? `Web quiz voice: ${v.mean.toFixed(1)}% of page sittings lost a read-aloud clip on average over the last ${ROLL_DAYS} days (${each}).`
    : `Web quiz voice: ${v.share.toFixed(1)}% of page sittings lost a read-aloud clip on ${d.day} (${n(d.hit)} of ${n(d.sit)})`
      + (prev ? `, up ${(v.share - prev.share).toFixed(1)} points since the last post (${prev.share.toFixed(1)}% on ${prev.day}).` : '.');
  return `${head} Mid-October ran about ${BASELINE_PCT}%; the line is ${DAY_PCT}% a day or ${ROLL_PCT}% over ${ROLL_DAYS} days,`
    + ` posted once a week unless a day rises ${REPOST_POINTS} points.`
    + ` Why the clips failed (${n(d.fb)} events): stalled ${n(d.stalled)}, refused ${n(d.reject)}, unsupported ${n(d.unsupported)}, error ${n(d.error)}.`
    + ' Part, host, timing and view state are on each web_quiz.audio_fallback event.';
}

/** The week's marker: {day, share} of the last post, or null (absent, expired or unreadable). */
function posted(raw) {
  try {
    const o = raw ? JSON.parse(raw) : null;
    return o && Number.isFinite(Number(o.share)) ? { day: String(o.day || ''), share: Number(o.share) } : null;
  } catch (_) {
    return null;
  }
}

/**
 * One tick. opts (all injectable): now, env, redis, query(name, apl, start, end, env) → rows, post(text, slack).
 * → { outcome: off|unconfigured|not_due|skipped|done_already|quiet|alert, ... }
 */
async function run({ now = new Date(), env = process.env, redis = null, query = null, post = null } = {}) {
  if (String(env.WEB_QUIZ_VOICE_WATCH_ENABLED || '').toLowerCase() !== 'true') return { outcome: 'off' };
  const W = watch();
  const slack = W.slackTarget(env);
  if (!slack.token || !slack.channel || !(env.AXIOM_TOKEN || env.AXIOM_API_TOKEN)) {
    logEvent('web_quiz.voice_watch.skipped', { reason: 'unconfigured' });
    return { outcome: 'unconfigured' };
  }
  if (new Date(now.getTime() + PKT_MS).getUTCHours() < DUE_HOUR_PKT) return { outcome: 'not_due' };
  const r = redis || require('../cache/railway-redis.service');
  const claim = await W.claimTick(r, { tickMin: 60 }, TICK_KEY);
  if (claim !== 'owner') return { outcome: 'skipped', reason: claim };
  const day = pktDay(now, 1);
  if (await r.get(DAY_KEY(day))) return { outcome: 'done_already', day };

  const ask = query || W.axiomQuery;
  const apl = aplFor({ dataset: env.QUIZ_FUNNEL_WATCH_DATASET || 'niete-logs', env: env.QUIZ_FUNNEL_WATCH_ENV || env.NODE_ENV || 'production' });
  const days = [];
  for (let back = 1; back <= ROLL_DAYS; back += 1) {
    const d = pktDay(now, back);
    const [start, end] = dayWindow(d);
    const rows = await ask(`voice_watch_${d}`, apl, start, end, env);
    const row = (rows && rows[0]) || {};
    days.unshift({ day: d, sit: Number(row.sit || 0), hit: Number(row.hit || 0), fb: Number(row.fb || 0), stalled: Number(row.stalled || 0),
      reject: Number(row.reject || 0), unsupported: Number(row.unsupported || 0), error: Number(row.error || 0) });
  }
  const v = verdict(days);
  const last = days[days.length - 1];
  logEvent('web_quiz.voice_watch', { day, sittings: last.sit, lost: last.hit, share: Math.round(v.share * 10) / 10, alert: v.alert, why: v.why });
  const prev = v.alert ? posted(await r.get(REPEAT_KEY)) : null;
  const rose = Boolean(prev) && v.why === 'day' && v.share >= prev.share + REPOST_POINTS;
  if (prev && !rose) {
    await r.set(DAY_KEY(day), now.toISOString(), MARKER_TTL_S);
    return { outcome: 'quiet_repeat', day, share: v.share, why: v.why };
  }
  if (v.alert) {
    try {
      await (post || W.postToSlack)(alertText(v, days, rose ? prev : null), slack);
    } catch (error) {
      logToFile('Web quiz voice alarm: the post failed', { error: error && error.message, day }, 'error');
      return { outcome: 'post_failed', day };
    }
    await r.set(REPEAT_KEY, JSON.stringify({ day, share: Math.round(v.share * 100) / 100, why: v.why }), ROLL_REPEAT_DAYS * 86400);
  }
  await r.set(DAY_KEY(day), now.toISOString(), MARKER_TTL_S);
  return { outcome: v.alert ? 'alert' : 'quiet', day, share: v.share, why: v.why };
}

module.exports = { run, verdict, alertText, aplFor, dayWindow, pktDay, DAY_PCT, ROLL_PCT, ROLL_DAYS, MIN_SITTINGS, TICK_KEY, DAY_KEY, REPEAT_KEY, ROLL_REPEAT_DAYS };
