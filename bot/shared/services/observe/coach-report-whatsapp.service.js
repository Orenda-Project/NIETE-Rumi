'use strict';
/**
 * Coach reports in the app — the WhatsApp side: ONE link to her debrief report page, and only if she has not opened it.
 *
 * WHAT IT IS. For a coach with app_settings.coach_reports_app on (a list of users.id, or true), her debrief report is a
 * page in the coach app (dashboard/services/coach-report.service.js); a card on her Home opens it. WhatsApp no longer
 * carries the report picture. It carries, at most once per report, a link straight to that report:
 *
 *   recorded on WhatsApp  sendReportLinkNow, called by the debrief job in place of the picture. She has just sent her
 *                         voice note, so her 24-hour window is open: a cta_url button ("Open my report"), no template.
 *                         'off' = switch off for her (the caller sends today's picture); 'failed' = Meta refused (the
 *                         caller sends today's text card, so she still gets her feedback); 'not_claimed' = already
 *                         opened, closed or messaged.
 *   recorded in the app   runSweep, every 20 s on the main worker. A report coached at least 10 minutes ago that she
 *                         has neither opened nor closed (✕ on the Home card) gets the link: inside her window a cta_url
 *                         button; outside it the UTILITY template coach_report_ready_v1 — only once that template is
 *                         approved on this WABA and app_settings.coach_report_template_enabled is true. Until then the
 *                         report is left unclaimed (the Home card still shows it) and nothing is sent.
 *
 * AT MOST ONE MESSAGE PER REPORT. Everything the message needs is built first; then ONE conditional UPDATE
 * (coach_report_whatsapp_at set where it, coach_report_opened_at and coach_report_seen_at are all NULL, RETURNING the row)
 * claims the report; only the caller that gets the row back sends. A refused send is logged at ERROR and NOT retried.
 *
 * THE LINK names the coach and ONE report (portal-link-token area 'coachreport', item 'debrief:<id>'); it opens that
 * report and nothing else. The message never names the teacher (messages get forwarded).
 *
 * PRE-MERGE CLASSES. G: outside the window a template only. M: the button text is inside 20 code points (test). N: every
 * failure logged at error. P: first run 90 s after boot, owned by the worker that owns `main`. R: bounded per tick,
 * narrow JSON slices, the coach_report_notice.sql partial index; OFF costs one app_settings read per tick.
 * NOTHING HERE THROWS.
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { signPortalLink } = require('../portal-link-token');
const { isTrue, TEMPLATE_LANGUAGES } = require('../portal-web-link');
const { observeStrings } = require('./observe-strings');

const SETTING_SWITCH = 'coach_reports_app';
const SETTING_TEMPLATE = 'coach_report_template_enabled';
const TEMPLATE_DEFAULT = 'coach_report_ready_v1';
const TEMPLATE_ENV = 'COACH_REPORT_TEMPLATE';

/** A report recorded in the app waits this long for her to open it before the link follows. */
const WAIT_MS = 10 * 60 * 1000;
/** How far back a report is still chased. A link a day later is not a reminder. */
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
const PER_TICK = 10;
const FIRST_RUN_MS = 90 * 1000;
const SWEEP_EVERY_MS = 20 * 1000;

const errorLog = (message, data) => logToFile(`❌ coach_report_whatsapp: ${message}`, data, 'error');
const iso = (ms) => new Date(ms).toISOString();

/* ── the switch ─────────────────────────────────────────────────────────────────────────────────────────────── */

const parseValue = (v) => {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (_) { return v; }
};

/** The coaches it is on for: true (every coach) or a Set of users.id; null = off. Fail closed. */
async function readSwitch() {
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [SETTING_SWITCH, SETTING_TEMPLATE]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const byKey = Object.fromEntries((data || []).map((r) => [r.key, parseValue(r.value)]));
    const sw = byKey[SETTING_SWITCH];
    const coaches = isTrue(sw) ? true : (Array.isArray(sw) && sw.length ? new Set(sw.map(String)) : null);
    return { coaches, template: isTrue(byKey[SETTING_TEMPLATE]) };
  } catch (err) {
    logToFile('coach_report_whatsapp: settings lookup failed — off this time', { error: err.message }, 'warn');
    return { coaches: null, template: false };
  }
}

const onFor = (coaches, userId) => coaches === true || (coaches instanceof Set && coaches.has(String(userId)));

/** Is the in-app report on for this coach? Never throws (off on any failure). */
async function coachReportsOn(coachId) {
  if (!coachId) return false;
  const { coaches } = await readSwitch();
  return onFor(coaches, coachId);
}

/* ── the link and the words ─────────────────────────────────────────────────────────────────────────────────── */

const itemOf = (sessionId) => `debrief:${sessionId}`;

/** The signed link to this one report, or null (no PORTAL_URL or no signing secret here). */
function reportLinkUrl(coachId, sessionId) {
  const base = String(process.env.PORTAL_URL || '').trim().replace(/\/+$/, '');
  const token = signPortalLink(coachId, 'coachreport', { i: itemOf(sessionId) });
  if (!base || !token) return null;
  return `${base}/t/${token}`;
}

const langOf = (code) => (TEMPLATE_LANGUAGES.includes(code) ? code : TEMPLATE_LANGUAGES[0]);

function words(lang) {
  const S = observeStrings(lang);
  return { body: S.coach_report_link_body, button: S.coach_report_link_button };
}

/* ── the claim and the sends ────────────────────────────────────────────────────────────────────────────────── */

/** The ONE conditional UPDATE that decides who sends. True only for the caller that stamped it. */
async function claim(sessionId) {
  const { data, error } = await supabase.from('coaching_sessions')
    .update({ coach_report_whatsapp_at: new Date().toISOString() })
    .eq('id', sessionId)
    .is('coach_report_whatsapp_at', null)
    .is('coach_report_opened_at', null)
    .is('coach_report_seen_at', null)
    .select('id');
  if (error) throw new Error(error.message || 'claim failed');
  return Array.isArray(data) && data.length >= 1;
}

async function sendButton(phone, lang, url) {
  const w = words(lang);
  try {
    return (await WhatsAppService.sendCtaUrl(phone, { body: w.body, buttonText: w.button, url })) === true;
  } catch (err) {
    errorLog('the button send threw', { error: err.message });
    return false;
  }
}

async function sendTemplate(phone, lang, coachId, sessionId) {
  const token = signPortalLink(coachId, 'coachreport', { i: itemOf(sessionId) });
  if (!token) return false;
  const name = (process.env[TEMPLATE_ENV] || '').trim() || TEMPLATE_DEFAULT;
  const components = [{ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token }] }];
  try {
    return (await WhatsAppService.sendTemplate(phone, name, lang, components)) === true;
  } catch (err) {
    errorLog('the template send threw', { template: name, error: err.message });
    return false;
  }
}

function logSent(how, sessionId, coachId, lang) {
  try { logEvent('coach_report_whatsapp.sent', { how, sessionId, coachId, lang }); } catch (_) { /* logging never decides */ }
}

/**
 * Recorded on WhatsApp: the link at once, in place of the report picture.
 * @returns {Promise<'sent'|'off'|'not_claimed'|'no_link'|'failed'>}
 */
async function sendReportLinkNow({ sessionId, coachId, phone, lang }) {
  try {
    if (!(await coachReportsOn(coachId))) return 'off';
    const l = langOf(lang);
    const url = reportLinkUrl(coachId, sessionId);
    if (!url || !phone) {
      errorLog('no link to send (PORTAL_URL or signing secret missing) — the picture goes instead', { sessionId });
      return 'no_link';
    }
    if (!(await claim(sessionId))) return 'not_claimed';
    if (!(await sendButton(phone, l, url))) {
      errorLog('Meta refused the report link — not retried; the text card goes instead', { sessionId });
      return 'failed';
    }
    logSent('now', sessionId, coachId, l);
    return 'sent';
  } catch (err) {
    errorLog('could not send the report link — the picture goes instead', { sessionId, error: err.message });
    return 'off';
  }
}

/* ── the sweep (recorded in the app) ────────────────────────────────────────────────────────────────────────── */

/** Coached debriefs nobody has opened, closed or messaged, recorded in the app, newest-bounded. Narrow slices only. */
async function findWaiting({ sinceIso, limit }) {
  const { data, error } = await supabase.from('coaching_sessions')
    .select('id, observer_user_id, created_at, '
      + 'done_at:analysis_data->observer_debrief->>completed_at, '
      + 'talk_audio_id:analysis_data->observer_debrief->>audio_id, '
      + 'talk_r2_key:analysis_data->observer_debrief->>audio_r2_key')
    .eq('observation_type', 'leader_observation')
    .eq('debrief_status', 'done')
    .is('coach_report_whatsapp_at', null)
    .is('coach_report_opened_at', null)
    .is('coach_report_seen_at', null)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(limit * 3);
  if (error) throw new Error(error.message || 'coaching_sessions read failed');
  return data || [];
}

async function defaultWindowOpen(phone) {
  return require('../quiz/quiz-delivery.service')._hasOpenMessageWindow(phone);
}

/**
 * One tick. Returns what it did; never throws.
 * @param {{ now?: number, limit?: number, windowOpen?: (phone: string) => Promise<boolean> }} [opts]
 */
async function runSweep({ now = Date.now(), limit = PER_TICK, windowOpen = defaultWindowOpen } = {}) {
  const counts = { enabled: false, candidates: 0, claimed: 0, sent: 0, failed: 0, skipped: 0 };
  try {
    const sw = await readSwitch();
    if (!sw.coaches) return counts;
    counts.enabled = true;

    const rows = await findWaiting({ sinceIso: iso(now - LOOKBACK_MS - WAIT_MS), limit });
    const due = rows.filter((r) => {
      if (!onFor(sw.coaches, r.observer_user_id)) return false;
      // Recorded on WhatsApp: the link went at once (or the picture did); never the sweep's.
      if (r.talk_audio_id || !r.talk_r2_key) return false;
      const done = Date.parse(r.done_at || '');
      return Number.isFinite(done) && done <= now - WAIT_MS && done >= now - LOOKBACK_MS;
    }).slice(0, limit);
    counts.candidates = due.length;
    if (!due.length) return counts;

    const ids = [...new Set(due.map((r) => r.observer_user_id))];
    const { data: users, error } = await supabase.from('users').select('id, phone_number, preferred_language').in('id', ids);
    if (error) throw new Error(error.message || 'users read failed');
    const byId = new Map((users || []).map((u) => [u.id, u]));

    for (const r of due) {
      try {
        const u = byId.get(r.observer_user_id);
        if (!u || !u.phone_number) { counts.skipped += 1; continue; }
        const lang = langOf(u.preferred_language);
        const open = await windowOpen(u.phone_number);
        if (!open && !sw.template) { counts.skipped += 1; continue; } // the template is not approved/on: leave it unclaimed
        const url = open ? reportLinkUrl(r.observer_user_id, r.id) : 'template';
        if (!url) { errorLog('no link to send (PORTAL_URL or signing secret missing)', { sessionId: r.id }); counts.failed += 1; continue; }
        if (!(await claim(r.id))) continue; // opened a moment ago, or another sweep won
        counts.claimed += 1;
        const sent = open ? await sendButton(u.phone_number, lang, url) : await sendTemplate(u.phone_number, lang, r.observer_user_id, r.id);
        if (!sent) {
          errorLog('Meta refused the report link — not retried', { sessionId: r.id, how: open ? 'button' : 'template' });
          counts.failed += 1;
          continue;
        }
        counts.sent += 1;
        logSent(open ? 'button' : 'template', r.id, r.observer_user_id, lang);
      } catch (err) {
        errorLog('a report failed', { sessionId: r.id, error: err.message });
        counts.failed += 1;
      }
    }
  } catch (err) {
    errorLog('sweep failed', { error: err.message });
  }
  if (counts.candidates) {
    try { logEvent('coach_report_whatsapp.sweep', { ...counts }); } catch (_) { /* logging never decides */ }
  }
  return counts;
}

/** Register the sweep on the worker that owns `main` (one owner, so no tick runs twice). First run 90 s after boot. */
function scheduleSweep({ worker, queues, runSweep: run = runSweep } = {}) {
  if (!queues || typeof queues.has !== 'function' || !queues.has('main')) return { enabled: false, reason: 'main queue not owned' };
  const tick = async () => {
    if (worker && worker.isShuttingDown) return;
    try { await run({}); } catch (err) { errorLog('tick failed', { error: err.message }); }
  };
  let every = null;
  const first = setTimeout(() => {
    tick();
    every = setInterval(tick, SWEEP_EVERY_MS);
  }, FIRST_RUN_MS);
  logToFile('Coach report WhatsApp fallback sweep registered (OFF unless app_settings.coach_reports_app is set)', {
    firstRunSeconds: FIRST_RUN_MS / 1000, everySeconds: SWEEP_EVERY_MS / 1000,
  });
  return { enabled: true, stop() { clearTimeout(first); if (every) clearInterval(every); } };
}

module.exports = {
  coachReportsOn, reportLinkUrl, sendReportLinkNow, runSweep, scheduleSweep,
  SETTING_SWITCH, SETTING_TEMPLATE, TEMPLATE_DEFAULT, WAIT_MS, LOOKBACK_MS,
};
