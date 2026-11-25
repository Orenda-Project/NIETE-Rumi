'use strict';
/**
 * The production incident watch: rule-based Slack alerts for a regional deployment, with NO model
 * anywhere in the path. Every message is a fixed template filled with counts from the logs.
 *
 * Why it exists. On 25 Nov 2026 the OpenRouter key hit its total limit at 10:05 PKT. For 40 minutes
 * every model call was refused; 149 jobs failed and each one told a teacher "please try again". The
 * quiz funnel watcher saw the errors but titled them "quizzes — needs a look" and never named the cause;
 * the first sign that reached the operator came 21 minutes in. The operator asked for "log monitoring
 * (without the use of any LLM inference) to drop in alerts in case of major errors in a slack channel".
 *
 * WHAT IT DOES. Every 5 minutes (one replica speaks — claimTick), it counts the deployment's own log lines
 * in Axiom and checks each rule:
 *
 *   provider_refusal  an error/warn line naming a provider refusal (key limit, credits, quota, bad key):
 *                     fires on the first one seen. Zero in the 30 days before 25 Nov; 238 that morning.
 *   health_down       a service's /health fails 2 checks in a row; clears on the first good check
 *   crash_loop        one deployment's worker replicas boot again and again (a deploy boots each once)
 *   job_failures      `❌ Job failed` ≥5 in 30 min (zero in 92% of hours)
 *   error_rate        error lines ≥75 in 15 min AND ≥3× the usual for that PKT hour (two known-noise
 *                     lines left out; p90 16, p99 42 per 15 min)
 *   portal_5xx        portal 5xx ≥50 in 15 min (p99 20)
 *   rate_limited      429s from a model provider or Meta ≥20 in 15 min (at most 12 in 15 min in 30 days)
 *
 * One open incident is ONE top-level post (the most severe rule leads, with a colour bar). Any other rule
 * that fires while it is open goes in its thread ("Also: …"), a "Still happening" update goes in the thread
 * at most every 30 minutes, and when every rule is below its clear line (lower than its fire line) for 2
 * checks in a row the all-clear goes in the thread and to the channel. A problem back within an hour of its
 * all-clear continues that thread ("Back again", shown in the channel too) instead of a new post.
 *
 * A second check, every 30 minutes on its own claim, reads the OpenRouter key's usage (GET /api/v1/key —
 * a usage read, never a completion) and warns once a day when under 10% is left or under 3 days at the
 * 7-day burn rate; again at 3% or 1 day. Every reading is logged.
 *
 * WHERE IT RUNS. Inside the sqs-worker (boot run + 5-minute interval), next to the quiz funnel watcher,
 * whose Axiom reader, Slack sender and one-replica claim it reuses. It dies with the worker; an outside
 * heartbeat (no `prod_incident_watch.tick` for 30 min) covers that.
 *
 * ENV (names only; nothing runs until the first is 'true'):
 *   PROD_ALERTS_ENABLED          'true' arms it. Unset = a no-op.
 *   PROD_ALERTS_SLACK_TOKEN      bot token that posts
 *   PROD_ALERTS_SLACK_CHANNEL    channel id
 *   PROD_ALERTS_DRY_RUN          'true' = run every check and log `prod_incident_watch.would_post`, post nothing
 *   PROD_ALERTS_ENV              Axiom `env` to read (default NODE_ENV) · PROD_ALERTS_DATASET (default AXIOM_DATASET)
 *   PROD_ALERTS_THRESHOLDS       JSON overriding DEFAULTS keys, e.g. {"errorMin":100}
 *   PROD_ALERTS_HEALTH_URLS      "portal=https://…/health,bot=https://…/health"; 'off' = none. Default: the
 *                                Railway-provided RAILWAY_SERVICE_PORTAL_URL / RAILWAY_SERVICE_BOT_URL + /health
 *   PROD_ALERTS_KEY_BUDGET_OFF   '1' skips the key-usage read (it uses the worker's own OPENROUTER_API_KEY)
 *   AXIOM_TOKEN / AXIOM_API_TOKEN, AXIOM_ORG_ID — already on the worker
 */

const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const {
  claimTick, axiomQuery, postToSlack, toMillis, hhmm,
} = require('./quiz-funnel-watch.service');

const MIN = 60 * 1000;
const H = 60 * MIN;
const DAY = 24 * H;
const PKT_OFFSET_MS = 5 * H;

/** Every threshold. Calibrated on niete-logs production, 25 Oct–24 Nov 2026, and replayed (see the CLI). */
const DEFAULTS = Object.freeze({
  tickMin: 5,
  binsLookbackMin: 35,
  totalsLeadMin: 30,
  refusalWindowMin: 10, refusalMin: 1, refusalClearWindowMin: 5, refusalClearMax: 0,
  // The 30-day replay (25 Oct–24 Nov) at the planned lines gave 19 top-level posts (~4 a week). These lines
  // keep every real outage in it (portal 5xx at 500-700 per 15 min, the R2 and nudge error storms) and drop
  // the blips: 3-4 job failures, 30-36 portal 5xx, 12 Meta rate limits.
  rate429WindowMin: 15, rate429Min: 20, rate429ClearMax: 5,
  jobFailWindowMin: 30, jobFailMin: 5, jobFailClearWindowMin: 15, jobFailClearMax: 1,
  errorWindowMin: 15, errorMin: 75, errorRatio: 3, errorClearMax: 39,
  portal5xxWindowMin: 15, portal5xxMin: 50, portal5xxClearMax: 15,
  healthFailsMin: 2, healthTimeoutMs: 8000,
  // A deploy boots each replica once. Old boot lines carry no deployment id: then only a total far above
  // the busiest deploy day (80 boots in 30 min on 25 Nov, 9 deploys in an hour) counts.
  crashWindowMin: 30, crashRestartsMin: 5, workerReplicas: 10, crashBootsFallbackMin: 120,
  clearChecks: 2,
  updateEveryMin: 30,
  // A problem back within this long of its all-clear continues the old thread (broadcast), not a new post.
  reopenWithinMin: 60,
  baselineDays: 14, baselineTtlMin: 360,
  keyTickMin: 30, keyWarnPctLeft: 10, keyWarnDays: 3, keyCritPctLeft: 3, keyCritDays: 1,
  stateTtlH: 72,
});

function config(env = process.env) {
  let over = {};
  try {
    over = env.PROD_ALERTS_THRESHOLDS ? JSON.parse(env.PROD_ALERTS_THRESHOLDS) : {};
  } catch {
    over = {};
  }
  const out = { ...DEFAULTS };
  for (const [k, v] of Object.entries(over || {})) {
    if (k in DEFAULTS && v !== null && v !== '' && Number.isFinite(Number(v))) out[k] = Number(v);
  }
  return out;
}

const on = (v) => String(v || '').toLowerCase() === 'true';
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const iso = (ms) => new Date(ms).toISOString();
const floorMin = (d) => Math.floor(d.getTime() / MIN) * MIN;
const pktHour = (ms) => new Date(ms + PKT_OFFSET_MS).getUTCHours();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Severity order: the first firing rule leads an incident's post. */
const RULES = ['provider_refusal', 'health_down', 'crash_loop', 'job_failures', 'error_rate', 'portal_5xx', 'rate_limited'];
const COLOR = Object.freeze({ red: '#d0021b', orange: '#f5a623', yellow: '#f8e71c', green: '#2eb67d' });

// ─── the queries ─────────────────────────────────────────────────────────────

const REFUSALS = [
  ['refusal:key_limit', ['Key limit exceeded']],
  ['refusal:credits', ['Insufficient credits', 'requires more credits']],
  ['refusal:quota', ['insufficient_quota', 'exceeded your current quota', 'quota_exceeded']],
  ['refusal:bad_key', ['401 User not found', 'No auth credentials found', 'Invalid API key', 'invalid_api_key',
    'Incorrect API key', 'API key not valid']],
];
// Bare "429" (or "401"/"402") also appears in word counts and timings inside data_json, so only provider
// phrases count, and only on error or warn lines. Meta's refusals are the whatsapp.rate_limited event.
const RATE_429 = ['429 Provider returned error', '"code":429', 'status code 429', '429 Too Many Requests',
  'Rate limit exceeded', 'RESOURCE_EXHAUSTED'];
const JOB_FAILED = '❌ Job failed';
const BOOT_LINE = '🚀 Starting SQS Coaching Worker';
const AWS_NOTE = 'The AWS SDK for JavaScript (v2) has reached end-of-support';
const RENDER_NOTE = 'lp612 render produced defects';

const q = (s) => `'${s}'`;
const anyOf = (phrases) => (phrases.length === 1
  ? `s contains ${q(phrases[0])}`
  : `(${phrases.map((p) => `s contains ${q(p)}`).join(' or ')})`);
const WARN = "level in ('error', 'warn')";
const KEY_CASE = 'case('
  + REFUSALS.map(([k, p]) => `${WARN} and ${anyOf(p)}, ${q(k)}`).join(', ')
  + `, msg == 'whatsapp.rate_limited' or (${WARN} and ${anyOf(RATE_429)}), 'rate_429'`
  + `, msg == ${q(JOB_FAILED)}, 'job_failed'`
  + ", service == 'portal' and toint(statusCode) >= 500, 'portal_5xx'"
  + `, level == 'error' and not(msg contains ${q(AWS_NOTE)}) and msg != ${q(RENDER_NOTE)}, 'error'`
  + ", '')";

/** Every APL this watch runs, keyed by name — one place, so the suite and the CLI read the same text. */
function aplFor({ env, dataset }) {
  const P = `['${dataset}'] | where env == '${env}'`;
  const keyed = `${P} | where ${WARN} or msg == ${q(JOB_FAILED)} or (service == 'portal' and toint(statusCode) >= 500) `
    + `| extend s = strcat(msg, ' ', tostring(data_json)) | extend k = ${KEY_CASE} | where k != ''`;
  const top = (where) => `${keyed} | where ${where} | summarize c = count() by m = substring(msg, 0, 90), service `
    + '| order by c desc | take 5';
  return {
    bins: `${keyed} | summarize c = count() by bin(_time, 1m), k`,
    baseline: `${keyed} | summarize c = count() by bin(_time, 15m), k`,
    boots: `${P} | where msg == ${q(BOOT_LINE)} | extend d = parse_json(data_json) `
      + '| project _time, service, dep = tostring(d.deploymentId), rep = tostring(d.replicaId) | take 5000',
    sample: `${keyed} | where k startswith 'refusal:' | summarize arg_max(_time, s) by k`,
    top: {
      refusal: top("k startswith 'refusal:'"),
      error: top("k == 'error'"),
      rate_429: top("k == 'rate_429'"),
    },
    portal_top: `${P} | where service == 'portal' and toint(statusCode) >= 500 | summarize c = count() by path `
      + '| order by c desc | take 20',
  };
}

// ─── counting ────────────────────────────────────────────────────────────────

const FAMILY_OF_KEY = (k) => (String(k).startsWith('refusal:') ? 'refusal' : k);
const FAMILY_OF_RULE = {
  provider_refusal: 'refusal', rate_limited: 'rate_429', job_failures: 'job_failed', error_rate: 'error', portal_5xx: 'portal_5xx',
};
const FAMILY_NAME = {
  refusal: ['provider refusal', 'provider refusals'],
  job_failed: ['job failure', 'job failures'],
  error: ['error line', 'error lines'],
  portal_5xx: ['portal 5xx', 'portal 5xx'],
  rate_429: ['429 refusal', '429 refusals'],
};

/** Sum of the 1-minute bins of `match(k)` in [end - windowMin, end). */
function sumWindow(bins, match, end, windowMin) {
  let n = 0;
  for (const r of bins || []) {
    const t = toMillis(r._time);
    if (t !== null && t >= end - windowMin * MIN && t < end && match(r.k)) n += num(r.c);
  }
  return n;
}
const isKey = (key) => (k) => k === key;
const isRefusal = (k) => String(k).startsWith('refusal:');

/**
 * The usual 15-minute count per PKT hour: the median over the look-back, each missing slot a 0.
 * rows: 15-minute bins [{_time, k, c}] → {key: [24 medians]}.
 */
function buildBaseline(rows, { days = DEFAULTS.baselineDays } = {}) {
  const slots = {};
  for (const r of rows || []) {
    const t = toMillis(r._time);
    if (t === null) continue;
    const key = FAMILY_OF_KEY(r.k);
    const h = pktHour(t);
    ((slots[key] = slots[key] || Array.from({ length: 24 }, () => []))[h]).push(num(r.c));
  }
  const out = {};
  for (const [key, hours] of Object.entries(slots)) {
    out[key] = hours.map((vals) => {
      const all = vals.concat(Array(Math.max(0, days * 4 - vals.length)).fill(0)).sort((a, b) => a - b);
      if (!all.length) return 0;
      const mid = Math.floor(all.length / 2);
      return all.length % 2 ? all[mid] : (all[mid - 1] + all[mid]) / 2;
    });
  }
  return out;
}

/** Crash loop from the boot lines in the window: restarts beyond one boot per replica, per deployment. */
function crashFromBoots(boots, end, cfg) {
  if (!boots) return { fire: false, clean: false, count: 0, unknown: true };
  const groups = new Map();
  for (const b of boots) {
    const t = toMillis(b._time);
    if (t === null || t < end - cfg.crashWindowMin * MIN || t >= end) continue;
    const id = `${b.service || ''}|${b.dep || ''}`;
    const g = groups.get(id) || { service: b.service || 'worker', dep: b.dep || '', boots: 0, reps: new Set() };
    g.boots += 1;
    if (b.rep) g.reps.add(b.rep);
    groups.set(id, g);
  }
  let worst = { fire: false, clean: true, count: 0 };
  for (const g of groups.values()) {
    const expected = g.reps.size ? g.reps.size : cfg.workerReplicas;
    const restarts = g.dep ? Math.max(0, g.boots - expected) : 0;
    const fallback = g.boots >= cfg.crashBootsFallbackMin;
    if (restarts > 0 || fallback) worst.clean = false;
    if ((restarts >= cfg.crashRestartsMin || fallback) && Math.max(restarts, g.boots) > worst.count) {
      worst = {
        fire: true, clean: false, count: fallback && restarts < cfg.crashRestartsMin ? g.boots : restarts,
        service: g.service, fallback: fallback && restarts < cfg.crashRestartsMin,
      };
    }
  }
  return worst;
}

/**
 * Each rule, now. Pure. bins: 1-minute rows; boots: boot rows (null = unknown); baseline: buildBaseline();
 * health: [{name, ok, fails, status}] (fails = failed checks in a row) or null when not checked.
 * Returns {rule: {fire, clean, count, …}}.
 */
function evaluate({ bins = [], boots = [], baseline = null, health = null, now = new Date(), cfg = DEFAULTS }) {
  const end = floorMin(now);
  const h = pktHour(end - MIN);
  const usual = (key) => (baseline && baseline[key] ? num(baseline[key][h]) : null);
  const out = {};

  const refusals = sumWindow(bins, isRefusal, end, cfg.refusalWindowMin);
  const bySub = {};
  for (const [k] of REFUSALS) bySub[k] = sumWindow(bins, isKey(k), end, cfg.refusalWindowMin);
  const sub = Object.entries(bySub).sort((a, b) => b[1] - a[1])[0];
  out.provider_refusal = {
    fire: refusals >= cfg.refusalMin,
    clean: sumWindow(bins, isRefusal, end, cfg.refusalClearWindowMin) <= cfg.refusalClearMax,
    count: refusals,
    sub: sub && sub[1] > 0 ? sub[0].slice('refusal:'.length) : null,
  };

  const targets = health || [];
  const down = targets.filter((t) => !t.ok && num(t.fails) >= cfg.healthFailsMin);
  out.health_down = {
    fire: down.length > 0,
    clean: targets.every((t) => t.ok),
    count: down.length,
    targets: down.map((t) => ({ name: t.name, fails: num(t.fails), status: t.status || null, lastGoodAt: t.lastGoodAt || null, failedAt: t.failedAt || [] })),
  };

  out.crash_loop = crashFromBoots(boots, end, cfg);

  const jobs = sumWindow(bins, isKey('job_failed'), end, cfg.jobFailWindowMin);
  out.job_failures = {
    fire: jobs >= cfg.jobFailMin,
    clean: sumWindow(bins, isKey('job_failed'), end, cfg.jobFailClearWindowMin) <= cfg.jobFailClearMax,
    count: jobs,
    usual: usual('job_failed') === null ? null : usual('job_failed') * (cfg.jobFailWindowMin / 15),
  };

  const errors = sumWindow(bins, isKey('error'), end, cfg.errorWindowMin);
  const errUsual = usual('error');
  out.error_rate = {
    fire: errors >= cfg.errorMin && (errUsual === null || errors >= cfg.errorRatio * errUsual),
    clean: errors <= cfg.errorClearMax,
    count: errors,
    usual: errUsual,
  };

  const p5 = sumWindow(bins, isKey('portal_5xx'), end, cfg.portal5xxWindowMin);
  out.portal_5xx = { fire: p5 >= cfg.portal5xxMin, clean: p5 <= cfg.portal5xxClearMax, count: p5, usual: usual('portal_5xx') };

  const r429 = sumWindow(bins, isKey('rate_429'), end, cfg.rate429WindowMin);
  out.rate_limited = { fire: r429 >= cfg.rate429Min, clean: r429 <= cfg.rate429ClearMax, count: r429 };

  // The newest event behind each log rule: a rule that cleared fires again only on events after that.
  const last = (match) => {
    let m = null;
    for (const r of bins || []) {
      const t = toMillis(r._time);
      if (t !== null && t < end && num(r.c) > 0 && match(r.k) && (m === null || t > m)) m = t;
    }
    return m === null ? null : iso(m);
  };
  out.provider_refusal.lastAt = last(isRefusal);
  out.job_failures.lastAt = last(isKey('job_failed'));
  out.error_rate.lastAt = last(isKey('error'));
  out.portal_5xx.lastAt = last(isKey('portal_5xx'));
  out.rate_limited.lastAt = last(isKey('rate_429'));
  return out;
}

// ─── the incident ────────────────────────────────────────────────────────────

const checksFor = (rule, cfg) => (rule === 'health_down' ? 1 : cfg.clearChecks);

/**
 * One check's effect on the incident. Pure: (state, evals) → {state, actions}.
 * actions: open (lead rule; one top-level post) · reopen (back within cfg.reopenWithinMin of the last
 * all-clear: that thread + channel) · also (a rule joins: thread) · update (thread, at most every
 * cfg.updateEveryMin) · clear (every rule below its clear line for its checks: thread + channel).
 */
function step(state, evals, now, cfg = DEFAULTS) {
  const prev = state || {};
  const t = now.getTime();
  if (!prev.incident) {
    const recent = pruneCleared(prev.cleared, t);
    const firing = RULES.filter((r) => evals[r] && evals[r].fire && fresh(evals[r], recent[r]));
    if (!firing.length) return { state: { ...prev, incident: null, cleared: recent }, actions: [] };
    const rules = {};
    for (const r of firing) rules[r] = { active: true, clean: 0, joinedAt: iso(t), peak: num(evals[r].count) };
    const last = prev.lastIncident;
    const reopen = Boolean(last && last.ts && t - Date.parse(last.clearedAt) <= cfg.reopenWithinMin * MIN);
    const incident = {
      openedAt: iso(t), ts: reopen ? last.ts : null, lead: firing[0], rules, lastUpdateAt: iso(t), lastBadAt: iso(t),
      totals: {}, first: {}, last: {}, countedTo: null, reopened: reopen,
    };
    const actions = [{ type: reopen ? 'reopen' : 'open', rule: firing[0], rules: firing }, ...firing.slice(1).map((r) => ({ type: 'also', rule: r }))];
    return { state: { ...prev, incident, cleared: recent }, actions };
  }

  const incident = JSON.parse(JSON.stringify(prev.incident));
  const actions = [];
  const cleared = { ...pruneCleared(prev.cleared, t) };
  let bad = false;
  for (const r of RULES) {
    const e = evals[r];
    const s = incident.rules[r];
    if (s && s.active) {
      // Hysteresis: an active rule is judged on its clear line alone. A long fire window (30 min of job
      // failures) stays over its line long after the failures stop; the clear line, on a shorter window,
      // is what says they stopped.
      if (e && e.clean) {
        s.clean += 1;
        if (s.clean >= checksFor(r, cfg)) {
          s.active = false;
          s.clearedAt = iso(t);
          cleared[r] = iso(floorMin(now));
        }
      } else {
        s.clean = 0;
        bad = true;
      }
      if (e && e.fire) s.peak = Math.max(num(s.peak), num(e.count));
    } else if (e && e.fire && fresh(e, cleared[r])) {
      bad = true;
      if (!s) {
        incident.rules[r] = { active: true, clean: 0, joinedAt: iso(t), peak: num(e.count) };
        actions.push({ type: 'also', rule: r });
      } else {
        // A rule that cleared and fires again on new events rejoins quietly: the next update says so.
        s.active = true;
        s.clean = 0;
        s.peak = Math.max(num(s.peak), num(e.count));
      }
    }
  }
  if (bad) incident.lastBadAt = iso(t);
  if (Object.values(incident.rules).every((s) => !s.active)) {
    const lastIncident = { ts: incident.ts, clearedAt: iso(t) };
    return { state: { ...prev, incident: null, cleared, lastIncident }, actions: [...actions, { type: 'clear', incident }] };
  }
  if (!actions.length && t - Date.parse(incident.lastUpdateAt) >= cfg.updateEveryMin * MIN) {
    incident.lastUpdateAt = iso(t);
    actions.push({ type: 'update' });
  }
  return { state: { ...prev, incident, cleared }, actions };
}

/**
 * A cleared rule fires again only on events newer than its clear: the window it fired on still holds the
 * old ones for up to 30 minutes, and they must not re-open an incident that was just called over.
 * Rules without a last-event time (health, crash loop) carry no stale window.
 */
function fresh(e, clearedAt) {
  if (!clearedAt || !e.lastAt) return true;
  return Date.parse(e.lastAt) >= Date.parse(clearedAt);
}
function pruneCleared(cleared, t) {
  const out = {};
  for (const [r, at] of Object.entries(cleared || {})) if (t - Date.parse(at) < 2 * H) out[r] = at;
  return out;
}

/** Add the bins in [countedTo, end) to the incident's totals, per family, with first/last seen. */
function accumulate(incident, bins, end, cfg) {
  if (!incident) return;
  const from = incident.countedTo ? Date.parse(incident.countedTo) : end - cfg.totalsLeadMin * MIN;
  for (const r of bins || []) {
    const t = toMillis(r._time);
    const c = num(r.c);
    if (t === null || t < from || t >= end || c <= 0) continue;
    const f = FAMILY_OF_KEY(r.k);
    incident.totals[f] = num(incident.totals[f]) + c;
    if (!incident.first[f] || t < Date.parse(incident.first[f])) incident.first[f] = iso(t);
    if (!incident.last[f] || t > Date.parse(incident.last[f])) incident.last[f] = iso(t);
  }
  incident.countedTo = iso(end);
}

// ─── the messages (fixed templates) ──────────────────────────────────────────

/** A log line as it may appear in Slack: no phone-like numbers, emails or ids, ever. */
function scrubLine(s) {
  return String(s || '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, ':email')
    .replace(/\+?\d[\d\s-]{6,}\d/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** A portal path with ids and tokens folded, so the top paths group and never carry a link token. */
function normPath(p) {
  return String(p || '').split('?')[0].split('/').map((seg) => {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':id';
    if (/^\d+$/.test(seg)) return ':id';
    if (seg.length >= 16 && /\d/.test(seg) && /^[A-Za-z0-9_.~-]+$/.test(seg)) return ':id';
    return seg;
  }).join('/');
}

/** The status, phrase and amounts of a refusal line — extracted, never the line itself (it carries a key URL). */
function refusalFacts(text) {
  const s = String(text || '');
  const out = {};
  const m = /\b([45]\d\d)\s+(Key limit exceeded(?:\s*\([^)]*\))?|Insufficient credits|This request requires more credits|User not found|No auth credentials found)/i.exec(s);
  if (m) { out.status = m[1]; out.phrase = m[2]; }
  const a = /\$([\d,]+(?:\.\d+)?) of \$([\d,]+(?:\.\d+)?) used/.exec(s);
  if (a) { out.used = a[1]; out.limit = a[2]; }
  if (Object.keys(out).length && /does not reset/i.test(s)) out.noReset = true;
  return out;
}

const PROVIDER_HEAD = {
  key_limit: ['OpenRouter is refusing calls: key limit reached', "Fix: raise the key's limit or swap the key (OpenRouter → Keys)."],
  credits: ['OpenRouter is refusing calls: out of credits', 'Fix: add credits (OpenRouter → Credits).'],
  quota: ['A model provider is refusing calls: quota used up', "Fix: raise the provider's quota or swap the key."],
  bad_key: ['A model provider is refusing calls: the API key is not accepted', 'Fix: check the key set on the service (OPENROUTER_API_KEY or the provider named above).'],
};

const RULE_LINE = (rule, cfg) => ({
  provider_refusal: 'fires on the first one seen',
  health_down: `${cfg.healthFailsMin} failed checks in a row; clears on the first good one`,
  crash_loop: `≥${cfg.crashRestartsMin} restarts of one deploy in ${cfg.crashWindowMin} min`,
  job_failures: `≥${cfg.jobFailMin} in ${cfg.jobFailWindowMin} min`,
  error_rate: `≥${cfg.errorMin} in ${cfg.errorWindowMin} min and ≥${cfg.errorRatio}× the usual for this hour; clears below ${cfg.errorClearMax + 1}`,
  portal_5xx: `≥${cfg.portal5xxMin} in ${cfg.portal5xxWindowMin} min`,
  rate_limited: `≥${cfg.rate429Min} in ${cfg.rate429WindowMin} min`,
}[rule]);

const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const roundUsual = (u) => (u === null || u === undefined ? null : Math.round(u));
/** "Top: <line> n · …" — the same line from two services counts once. */
function topLine(rows) {
  const by = {};
  for (const r of rows || []) { const m = scrubLine(r.m); by[m] = num(by[m]) + num(r.c); }
  const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return top.length ? `Top: ${top.map(([m, n]) => `${m} ${n}`).join(' · ')}` : null;
}

/** The service most of the top lines came from, or null. */
function mostlyFrom(rows) {
  const by = {};
  for (const r of rows || []) if (r.service) by[r.service] = num(by[r.service]) + num(r.c);
  const best = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

/** The headline of a rule: {emoji, color, title, detail, lines}. Pure apart from `details` (pre-fetched). */
function headline(rule, ev, { incident = null, details = {}, cfg = DEFAULTS } = {}) {
  const e = ev || {};
  const totals = (incident && incident.totals) || {};
  switch (rule) {
    case 'provider_refusal': {
      const [title, fix] = PROVIDER_HEAD[e.sub] || PROVIDER_HEAD.key_limit;
      const f = refusalFacts(details.sample);
      const facts = [
        f.status && f.phrase ? `${f.status} ${f.phrase}` : null,
        f.used && f.limit ? `$${f.used} of $${f.limit} used` : null,
        f.noReset ? 'does not reset' : null,
      ].filter(Boolean).join(' · ');
      const first = incident && incident.first.refusal ? hhmm(new Date(incident.first.refusal)) : hhmm(new Date());
      const n = num(totals.refusal) || num(e.count);
      const jobs = num(totals.job_failed);
      return {
        emoji: '🔴', color: COLOR.red, title,
        detail: `${plural(n, 'refusal')} in the last ${cfg.refusalWindowMin} min`,
        lines: [
          facts || null,
          `Since ${first} PKT: ${plural(n, 'refusal')} · ${plural(jobs, 'job')} failed (each failed job tells the teacher to try again)`,
          topLine(details.top),
          fix,
        ].filter(Boolean),
      };
    }
    case 'health_down': {
      const t = (e.targets || [])[0] || { name: 'service', fails: cfg.healthFailsMin };
      const times = (t.failedAt || []).slice(-3).map((x) => hhmm(new Date(x))).join(', ');
      const others = (e.targets || []).slice(1).map((x) => cap(x.name));
      return {
        emoji: '🔴', color: COLOR.red, title: `${cap(t.name)} is not answering`,
        detail: `/health failed ${t.fails} checks in a row${times ? ` (${times})` : ''}`,
        lines: [
          t.lastGoodAt ? `Last good: ${hhmm(new Date(t.lastGoodAt))} PKT` : 'No good check since the watch started',
          t.status ? `Last answer: ${t.status}` : 'Last answer: none (timed out or refused)',
          others.length ? `Also down: ${others.join(', ')}` : null,
        ].filter(Boolean),
      };
    }
    case 'crash_loop':
      return {
        emoji: '🔴', color: COLOR.red, title: `${e.service || 'The worker'} is restarting in a loop`,
        detail: e.fallback
          ? `${e.count} boots in ${cfg.crashWindowMin} min, more than any deploy day`
          : `${plural(e.count, 'restart')} in ${cfg.crashWindowMin} min within one deploy`,
        lines: ['Railway → the service → Deployments: look at the latest crash logs. Checks run inside this worker, so they may stall while it loops.'],
      };
    case 'job_failures': {
      const u = roundUsual(e.usual);
      return {
        emoji: '🟠', color: COLOR.orange, title: 'Job failures far above normal',
        detail: `${e.count} in ${cfg.jobFailWindowMin} min${u === null ? '' : ` (normal for this hour: ${u})`}`,
        lines: ['Each failed job tells the teacher to try again.', topLine(details.top)].filter(Boolean),
      };
    }
    case 'error_rate': {
      const u = roundUsual(e.usual);
      const x = u ? Math.round(e.count / u) : null;
      return {
        emoji: '🟠', color: COLOR.orange, title: x ? `Errors ${x}× normal` : 'Errors far above normal',
        detail: `${e.count} error lines in the last ${cfg.errorWindowMin} min${u === null ? '' : ` (normal for this hour: ${u})`}`,
        lines: [topLine(details.top)].filter(Boolean),
      };
    }
    case 'portal_5xx': {
      const u = roundUsual(e.usual);
      const paths = {};
      for (const r of details.paths || []) { const p = normPath(r.path); paths[p] = num(paths[p]) + num(r.c); }
      const top = Object.entries(paths).sort((a, b) => b[1] - a[1]).slice(0, 3);
      return {
        emoji: '🟠', color: COLOR.orange, title: 'Portal 5xx',
        detail: `${e.count} in the last ${cfg.portal5xxWindowMin} min${u === null ? '' : ` (normal for this hour: ${u})`}`,
        lines: [top.length ? `Top: ${top.map(([p, n]) => `${p} ${n}`).join(' · ')}` : null].filter(Boolean),
      };
    }
    case 'rate_limited':
      return {
        emoji: '🟠', color: COLOR.orange, title: 'Rate-limited',
        detail: `${e.count} 429 refusals (model provider or Meta) in the last ${cfg.rate429WindowMin} min`,
        lines: [topLine(details.top)].filter(Boolean),
      };
    default:
      return { emoji: '🟠', color: COLOR.orange, title: rule, detail: '', lines: [] };
  }
}

function axiomLink(org, apl) {
  if (!org || !apl) return null;
  return `https://app.axiom.co/${org}/query?initForm=${encodeURIComponent(JSON.stringify({ apl }))}`;
}

function buildOpen(rule, ev, ctx) {
  const h = headline(rule, ev, ctx);
  const link = axiomLink(ctx.axiomOrg, ctx.linkApl);
  const footer = `_${ctx.service ? `mostly ${ctx.service} · ` : ''}rule ${rule}: ${RULE_LINE(rule, ctx.cfg)} · updates in this thread`
    + `${link ? ` · <${link}|open in Axiom>` : ''}_`;
  return { color: h.color, text: [`${h.emoji} *${h.title}*`, h.detail, ...h.lines, footer].filter(Boolean).join('\n') };
}

function buildReopen(rule, ev, ctx) {
  const h = headline(rule, ev, ctx);
  return { color: h.color, text: [`🔁 *Back again* · ${h.emoji} ${h.title}`, h.detail, ...h.lines].filter(Boolean).join('\n') };
}

function buildAlso(rule, ev, ctx) {
  const h = headline(rule, ev, ctx);
  return { color: h.color, text: [`${h.emoji} Also: ${h.title} · ${h.detail}`, ...h.lines.slice(0, 2)].join('\n') };
}

/** The joined rules' totals, e.g. "238 provider refusals · 149 job failures". */
function totalsLine(incident) {
  const fams = [...new Set(Object.keys(incident.rules).map((r) => FAMILY_OF_RULE[r]).filter(Boolean))];
  return fams.filter((f) => num(incident.totals[f]) > 0)
    .map((f) => { const n = num(incident.totals[f]); return `${n} ${FAMILY_NAME[f][n === 1 ? 0 : 1]}`; })
    .join(' · ');
}

function buildUpdate(incident, evals, now, cfg) {
  const active = Object.entries(incident.rules).filter(([, s]) => s.active).map(([r]) => r);
  const down = active.includes('health_down') ? (evals.health_down.targets || []).map((t) => `${t.name} still down`) : [];
  const loop = active.includes('crash_loop') ? ['the worker is still restarting'] : [];
  const parts = [totalsLine(incident), ...down, ...loop].filter(Boolean).join(' · ');
  const next = hhmm(new Date(now.getTime() + cfg.updateEveryMin * MIN));
  return {
    color: COLOR.orange,
    text: `Still happening · ${parts || active.join(', ')} so far · next update ${next} PKT, or sooner if it changes`,
  };
}

function buildClear(incident, cfg) {
  const fams = Object.keys(incident.rules).map((r) => FAMILY_OF_RULE[r]).filter(Boolean);
  const lastLog = fams.map((f) => incident.last[f]).filter(Boolean).map((x) => Date.parse(x));
  const last = lastLog.length ? Math.max(...lastLog) : Date.parse(incident.lastBadAt);
  const firstLog = fams.map((f) => incident.first[f]).filter(Boolean).map((x) => Date.parse(x));
  const first = firstLog.length ? Math.min(...firstLog) : Date.parse(incident.openedAt);
  const onlyHealth = Object.keys(incident.rules).every((r) => r === 'health_down');
  const checks = onlyHealth ? 'the first good check' : `${cfg.clearChecks} clean checks in a row`;
  const mins = Math.max(1, Math.round((last - first) / MIN) + 1);
  const totals = totalsLine(incident);
  return {
    color: COLOR.green,
    text: [`✅ *All clear* · nothing new since ${hhmm(new Date(last))} PKT (${checks})`,
      `Lasted about ${mins} min${totals ? ` · ${totals}` : ''}`].join('\n'),
  };
}

// ─── one check ───────────────────────────────────────────────────────────────

const TICK_KEY = 'prod_incident_watch:tick';
const STATE_KEY = 'prod_incident_watch:state';
const BASELINE_KEY = 'prod_incident_watch:baseline';
const KEY_TICK_KEY = 'prod_incident_watch:key_budget:tick';
const KEY_WARNED_KEY = 'prod_incident_watch:key_budget:warned';

async function safeGet(store, key) {
  try { return await store.get(key); } catch { return null; }
}
async function safeSet(store, key, value, ttlS) {
  try { await store.set(key, value, ttlS); } catch (err) {
    logToFile('⚠️ prod incident watch: could not save state', { key, error: err.message }, 'warn');
  }
}

/** The rule whose lines an "open in Axiom" link shows. */
function linkAplFor(rule, { env, dataset, sub = null }) {
  const P = `['${dataset}'] | where env == '${env}'`;
  if (rule === 'portal_5xx') return `${P} | where service == 'portal' and toint(statusCode) >= 500`;
  if (rule === 'job_failures') return `${P} | where msg == ${q(JOB_FAILED)}`;
  if (rule === 'crash_loop') return `${P} | where msg == ${q(BOOT_LINE)}`;
  if (rule === 'provider_refusal') {
    const phrases = (REFUSALS.find(([k]) => k === `refusal:${sub}`) || REFUSALS[0])[1];
    return `${P} | where ${WARN} | extend s = strcat(msg, ' ', tostring(data_json)) | where ${anyOf(phrases)}`;
  }
  if (rule === 'rate_limited') return `${P} | where msg == 'whatsapp.rate_limited' or ${WARN}`;
  if (rule === 'error_rate') return `${P} | where level == 'error'`;
  return null;
}

/**
 * One check, everything but the claim: query, evaluate, step the incident, post, save. Shared by run()
 * and the replay CLI. A failed bins query changes nothing (an unknown is never a clean check).
 */
async function tick({
  now = new Date(), cfg = DEFAULTS, query, store, post, checkHealth = null,
  env = 'production', dataset = 'niete-logs', stateKey = STATE_KEY, axiomOrg = null, details: wantDetails = true,
}) {
  const apl = aplFor({ env, dataset });
  const failed = [];
  const ask = async (name, text, start, end) => {
    try {
      return (await query(name, text, iso(start), iso(end))) || [];
    } catch (err) {
      failed.push(name);
      logToFile('❌ prod incident watch: query failed', { name, error: String(err.message).slice(0, 200) }, 'error');
      return null;
    }
  };
  const t = now.getTime();
  const end = floorMin(now);
  const prev = (await safeGet(store, stateKey)) || {};

  const bins = await ask('bins', apl.bins, end - cfg.binsLookbackMin * MIN, t);
  if (bins === null) return { failed, actions: [], firing: [], incident: prev.incident || null };
  const boots = await ask('boots', apl.boots, end - cfg.crashWindowMin * MIN, t);

  let base = await safeGet(store, BASELINE_KEY);
  if (!base || !base.table || t - Date.parse(base.computedAt) >= cfg.baselineTtlMin * MIN || t < Date.parse(base.computedAt)) {
    const rows = await ask('baseline', apl.baseline, t - cfg.baselineDays * DAY, t);
    if (rows) {
      base = { computedAt: iso(t), table: buildBaseline(rows, { days: cfg.baselineDays }) };
      await safeSet(store, BASELINE_KEY, base, cfg.baselineTtlMin * 60 * 2);
    }
  }

  // Health: failed checks in a row, per target, carried in the state.
  const healthState = { ...(prev.health || {}) };
  let health = null;
  if (checkHealth) {
    let results = [];
    try { results = (await checkHealth()) || []; } catch (err) { results = []; failed.push('health'); }
    health = results.map((r) => {
      const h = healthState[r.name] || { fails: 0, lastGoodAt: null, failedAt: [] };
      const next = r.ok
        ? { fails: 0, lastGoodAt: iso(t), failedAt: [] }
        : { fails: num(h.fails) + 1, lastGoodAt: h.lastGoodAt, failedAt: [...(h.failedAt || []), iso(t)].slice(-3) };
      healthState[r.name] = next;
      return { name: r.name, ok: r.ok, status: r.status || null, ...next };
    });
  }

  const evals = evaluate({ bins, boots, baseline: base && base.table, health, now, cfg });
  const firing = RULES.filter((r) => evals[r].fire);
  const r = step(prev, evals, now, cfg);
  const closing = r.actions.find((a) => a.type === 'clear');
  const incident = r.state.incident || (closing && closing.incident) || null;
  accumulate(incident, bins, end, cfg);

  // Only what a message will show is fetched, and only when there is a message.
  const details = {};
  const need = new Set(r.actions.filter((a) => a.type === 'open' || a.type === 'reopen' || a.type === 'also').map((a) => a.rule));
  if (wantDetails) {
    const s = end - 30 * MIN;
    if (need.has('provider_refusal')) {
      const rows = await ask('sample', apl.sample, s, t);
      const pick = (rows || []).find((x) => x.k === `refusal:${evals.provider_refusal.sub}`) || (rows || [])[0];
      details.provider_refusal = { sample: pick ? pick.s : null, top: await ask('top', apl.top.refusal, s, t) };
    }
    if (need.has('error_rate')) details.error_rate = { top: await ask('top', apl.top.error, end - cfg.errorWindowMin * MIN, t) };
    if (need.has('rate_limited')) details.rate_limited = { top: await ask('top', apl.top.rate_429, end - cfg.rate429WindowMin * MIN, t) };
    if (need.has('portal_5xx')) details.portal_5xx = { paths: await ask('portal_top', apl.portal_top, end - cfg.portal5xxWindowMin * MIN, t) };
  }

  const next = { ...r.state, health: healthState };
  const ctx = (rule) => ({
    incident, cfg, details: details[rule] || {}, axiomOrg,
    linkApl: linkAplFor(rule, { env, dataset, sub: evals.provider_refusal.sub }),
    service: mostlyFrom(details[rule] && details[rule].top),
  });
  let posted = 0;
  for (const a of r.actions) {
    let msg;
    if (a.type === 'open') msg = buildOpen(a.rule, evals[a.rule], ctx(a.rule));
    else if (a.type === 'reopen') msg = buildReopen(a.rule, evals[a.rule], ctx(a.rule));
    else if (a.type === 'also') msg = buildAlso(a.rule, evals[a.rule], ctx(a.rule));
    else if (a.type === 'update') msg = buildUpdate(incident, evals, now, cfg);
    else msg = buildClear(a.incident, cfg);

    if (a.type === 'open') {
      try {
        incident.ts = await post({ ...msg, type: 'open', rule: a.rule });
        posted += 1;
      } catch (err) {
        // Nothing opened: the next check tries again with the same rules.
        logToFile('❌ prod incident watch: Slack post failed', { type: 'open', error: err.message }, 'error');
        logEvent('prod_incident_watch.post_failed', { type: 'open', rule: a.rule });
        await safeSet(store, stateKey, { ...prev, incident: prev.incident || null, health: healthState }, cfg.stateTtlH * 3600);
        return { failed, actions: [], firing, incident: null };
      }
    } else {
      try {
        await post({
          ...msg, type: a.type, rule: a.rule || null, thread_ts: (a.incident || incident).ts, broadcast: a.type === 'clear' || a.type === 'reopen',
        });
        posted += 1;
      } catch (err) {
        if (a.type === 'reopen') {
          // Like a failed open: nothing reopened, the next check tries again.
          logToFile('❌ prod incident watch: Slack post failed', { type: 'reopen', error: err.message }, 'error');
          await safeSet(store, stateKey, { ...prev, incident: null, health: healthState }, cfg.stateTtlH * 3600);
          return { failed, actions: [], firing, incident: null };
        }
        logToFile('❌ prod incident watch: Slack post failed', { type: a.type, error: err.message }, 'error');
        logEvent('prod_incident_watch.post_failed', { type: a.type, rule: a.rule || null });
      }
    }
  }
  await safeSet(store, stateKey, next, cfg.stateTtlH * 3600);
  return { failed, actions: r.actions, firing, posted, incident: next.incident || null, evals };
}

// ─── the OpenRouter key budget ───────────────────────────────────────────────

const KEY_URL = 'https://openrouter.ai/api/v1/key';

/** GET /api/v1/key — the key's own usage and limit. A usage read: no model is called. */
async function readKeyBudget({ key, fetchImpl = global.fetch }) {
  const res = await fetchImpl(KEY_URL, { method: 'GET', headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`openrouter key read ${res.status}`);
  const body = await res.json();
  const d = (body && body.data) || {};
  const n = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    limit: n(d.limit), usage: n(d.usage), remaining: n(d.limit_remaining), weekly: n(d.usage_weekly), daily: n(d.usage_daily), reset: d.limit_reset || null,
  };
}

function budgetMaths(r) {
  if (!r || r.limit === null || r.limit === undefined || !(r.limit > 0)) {
    return { pctUsed: null, pctLeft: null, burnPerDay: r && r.weekly !== null ? num(r.weekly) / 7 : null, daysLeft: null, remaining: null };
  }
  const remaining = r.remaining !== null && r.remaining !== undefined ? num(r.remaining) : r.limit - num(r.usage);
  const burnPerDay = num(r.weekly) / 7;
  return {
    remaining,
    pctUsed: Math.round(((r.limit - remaining) / r.limit) * 100),
    pctLeft: (remaining / r.limit) * 100,
    burnPerDay,
    daysLeft: burnPerDay > 0 ? remaining / burnPerDay : Infinity,
  };
}

/** null when all is well; else {level: 'warn'|'critical', pctUsed, pctLeft, burnPerDay, daysLeft, runsOutAt}. */
function keyBudgetVerdict(reading, now = new Date(), cfg = DEFAULTS) {
  const m = budgetMaths(reading);
  if (m.pctLeft === null) return null;
  // A limit that resets (daily/weekly/monthly) is judged on what is left, not on days.
  const days = reading.reset ? Infinity : m.daysLeft;
  let level = null;
  if (m.pctLeft < cfg.keyCritPctLeft || days < cfg.keyCritDays) level = 'critical';
  else if (m.pctLeft < cfg.keyWarnPctLeft || days < cfg.keyWarnDays) level = 'warn';
  if (!level) return null;
  return {
    level, ...m, runsOutAt: Number.isFinite(m.daysLeft) ? iso(now.getTime() + m.daysLeft * DAY) : null,
  };
}

const money = (v) => `$${Math.round(num(v)).toLocaleString('en-US')}`;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function pktDayLabel(isoTime) {
  const d = new Date(Date.parse(isoTime) + PKT_OFFSET_MS);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
const pktDayKey = (now) => new Date(now.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);

function buildKeyBudget(reading, v, now = new Date(), cfg = DEFAULTS) {
  const footer = `_read from OpenRouter's key-usage endpoint (no model call) · checked every ${cfg.keyTickMin} min · posted at most once a day; `
    + `again at ${100 - cfg.keyCritPctLeft}% or under ${plural(cfg.keyCritDays, 'day')} left_`;
  if (v.remaining <= 0) {
    return {
      color: COLOR.red,
      text: [
        '🔴 *OpenRouter key has reached its limit · calls are being refused*',
        `${money(reading.usage)} of ${money(reading.limit)} used${reading.reset ? ` · resets ${reading.reset}` : ' · does not reset'}`,
        'Raise the limit or swap the key now (OpenRouter → Keys).',
        `_read from OpenRouter's key-usage endpoint (no model call) · checked every ${cfg.keyTickMin} min · posted at most once a day_`,
      ].join('\n'),
    };
  }
  const left = !Number.isFinite(v.daysLeft) ? 'no spend in the last 7 days'
    : v.daysLeft < 1 ? 'under a day left' : `about ${plural(Math.round(v.daysLeft), 'day')} left`;
  const runsOut = v.runsOutAt && !reading.reset ? ` → runs out around ${pktDayLabel(v.runsOutAt)}` : '';
  const resets = reading.reset
    ? `This limit resets ${reading.reset}.`
    : 'This limit does not reset. Raise it, or line up a new key, before then.';
  return {
    color: v.level === 'critical' ? COLOR.red : COLOR.yellow,
    text: [
      `${v.level === 'critical' ? '🔴' : '🟡'} *OpenRouter key at ${v.pctUsed}% of its limit · ${left}*`,
      `${money(reading.limit - v.remaining)} of ${money(reading.limit)} used · last 7 days: about ${money(v.burnPerDay)} a day${runsOut}`,
      resets,
      footer,
    ].join('\n'),
  };
}

/** One key-budget check: read, log the reading, post a warning at most once a day per level. */
async function keyBudgetCheck({ now = new Date(), cfg = DEFAULTS, store, post, read, warnedKey = KEY_WARNED_KEY }) {
  let reading;
  try {
    reading = await read();
  } catch (err) {
    logToFile('⚠️ prod incident watch: OpenRouter key usage read failed', { error: String(err.message).slice(0, 120) }, 'warn');
    logEvent('prod_incident_watch.key_budget_failed', { error: String(err.message).slice(0, 120) });
    return { failed: true };
  }
  if (!reading) return { skipped: 'no_reading' };
  const m = budgetMaths(reading);
  const r2 = (x) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
  logEvent('prod_incident_watch.key_budget', {
    limit: reading.limit, usage: reading.usage, remaining: r2(m.remaining), pct_used: m.pctUsed, days_left: r2(m.daysLeft), burn_per_day: r2(m.burnPerDay),
  });
  const v = keyBudgetVerdict(reading, now, cfg);
  if (!v) return { ok: true };
  const key = `${warnedKey}:${v.level}:${pktDayKey(now)}`;
  if (await safeGet(store, key)) return { level: v.level, already: true };
  try {
    await post({ ...buildKeyBudget(reading, v, now, cfg), type: 'key_budget', rule: `key_budget_${v.level}` });
  } catch (err) {
    logToFile('❌ prod incident watch: key budget post failed', { error: err.message }, 'error');
    return { level: v.level, failed: true };
  }
  await safeSet(store, key, '1', 26 * 3600);
  return { level: v.level, posted: true };
}

// ─── health ──────────────────────────────────────────────────────────────────

/** The /health URLs to check: PROD_ALERTS_HEALTH_URLS, else the Railway-provided service domains. */
function healthTargets(env = process.env) {
  const raw = env.PROD_ALERTS_HEALTH_URLS;
  if (raw && raw.trim().toLowerCase() === 'off') return [];
  if (raw) {
    return raw.split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
      const i = p.indexOf('=');
      return i > 0 ? { name: p.slice(0, i).trim(), url: p.slice(i + 1).trim() } : null;
    }).filter((x) => x && /^https?:\/\//.test(x.url));
  }
  const fromDomain = (name, d) => (d ? { name, url: `${/^https?:\/\//.test(d) ? d : `https://${d}`}`.replace(/\/+$/, '') + '/health' } : null);
  return [fromDomain('portal', env.RAILWAY_SERVICE_PORTAL_URL), fromDomain('bot', env.RAILWAY_SERVICE_BOT_URL)].filter(Boolean);
}

function makeHealthCheck(targets, cfg, fetchImpl = global.fetch) {
  if (!targets.length) return null;
  return async () => Promise.all(targets.map(async ({ name, url }) => {
    try {
      const res = await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(cfg.healthTimeoutMs) });
      return { name, ok: Boolean(res.ok), status: res.status };
    } catch {
      return { name, ok: false, status: null };
    }
  }));
}

// ─── the run ─────────────────────────────────────────────────────────────────

/**
 * One tick from the worker. A complete no-op until PROD_ALERTS_ENABLED=true; exactly one replica speaks.
 */
async function run({
  now = new Date(), env = process.env, redis, query, post, checkHealth, readKey, fetchImpl = global.fetch,
} = {}) {
  if (!on(env.PROD_ALERTS_ENABLED)) return { skipped: 'disabled' };
  const dry = on(env.PROD_ALERTS_DRY_RUN);
  const slack = { token: env.PROD_ALERTS_SLACK_TOKEN || '', channel: env.PROD_ALERTS_SLACK_CHANNEL || '' };
  if ((!dry && (!slack.token || !slack.channel)) || !(env.AXIOM_API_TOKEN || env.AXIOM_TOKEN)) {
    logEvent('prod_incident_watch.skipped', { why: 'unconfigured' });
    return { skipped: 'unconfigured' };
  }
  const cfg = config(env);
  const store = redis || require('../cache/railway-redis.service');
  const lock = await claimTick(store, { tickMin: cfg.tickMin }, TICK_KEY);
  if (lock !== 'owner') {
    const why = lock === 'unavailable' ? 'lock_unavailable' : 'another_replica';
    logEvent('prod_incident_watch.skipped', { why });
    return { skipped: why };
  }

  let posts = 0;
  let n = 0;
  const send = dry
    ? async (m) => {
      n += 1;
      logEvent('prod_incident_watch.would_post', { type: m.type, rule: m.rule || null, thread: Boolean(m.thread_ts), text: m.text });
      return `dry.${now.getTime()}.${n}`;
    }
    : async (m) => {
      const ts = await (post ? post(m) : postToSlack(m.text, slack, { color: m.color, thread_ts: m.thread_ts, reply_broadcast: m.broadcast }));
      posts += 1;
      return ts;
    };

  const aplEnv = env.PROD_ALERTS_ENV || env.NODE_ENV || 'production';
  const dataset = env.PROD_ALERTS_DATASET || env.AXIOM_DATASET || 'niete-logs';
  const result = await tick({
    now,
    cfg,
    query: query || ((name, apl, s, e) => axiomQuery(name, apl, s, e, env)),
    store,
    post: send,
    checkHealth: checkHealth !== undefined ? checkHealth : makeHealthCheck(healthTargets(env), cfg, fetchImpl),
    env: aplEnv,
    dataset,
    stateKey: dry ? `${STATE_KEY}:dry` : STATE_KEY,
    axiomOrg: env.AXIOM_ORG_ID || null,
  });

  let budget = null;
  const read = readKey !== undefined ? readKey
    : (env.OPENROUTER_API_KEY && env.PROD_ALERTS_KEY_BUDGET_OFF !== '1'
      ? () => readKeyBudget({ key: env.OPENROUTER_API_KEY, fetchImpl }) : null);
  if (read && (await claimTick(store, { tickMin: cfg.keyTickMin }, KEY_TICK_KEY)) === 'owner') {
    budget = await keyBudgetCheck({ now, cfg, store, post: send, read, warnedKey: dry ? `${KEY_WARNED_KEY}:dry` : KEY_WARNED_KEY });
  }

  logEvent('prod_incident_watch.tick', {
    posts: dry ? 0 : posts,
    would_post: dry ? n : 0,
    open: Boolean(result.incident),
    firing: (result.firing || []).join(','),
    failed: (result.failed || []).join(','),
    budget: budget ? (budget.level || (budget.ok ? 'ok' : Object.keys(budget)[0])) : '',
    dry,
  });
  return { posts: dry ? 0 : posts, wouldPost: dry ? n : 0, open: Boolean(result.incident), firing: result.firing || [] };
}

module.exports = {
  DEFAULTS, RULES, COLOR, TICK_KEY, STATE_KEY, BASELINE_KEY, KEY_TICK_KEY,
  config, aplFor, buildBaseline, evaluate, step, tick, run,
  headline, buildOpen, buildReopen, buildAlso, buildUpdate, buildClear,
  readKeyBudget, keyBudgetVerdict, buildKeyBudget, keyBudgetCheck,
  healthTargets, makeHealthCheck, scrubLine, normPath, refusalFacts,
};
