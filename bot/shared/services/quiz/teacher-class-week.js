'use strict';
/**
 * The class week (SAMPLING_RULING §0.2, §7 row 2): a "Forward the week" card on the teacher's Jugnu tab for a
 * class the term's draw picked, shown only inside that class's week window. Switch web_quiz_class_week
 * (web-quiz-class-week-flags; parents web_quiz_class_round, web_quiz_class_link, web_quiz_challenge_v2,
 * web_quiz_challenge).
 *
 *   cardFor({ list, names, lang, T, now })  null, or { text, line, termCode, opensAt, closesAt, classId } when
 *       the class has a class_round_draws row for the current term_code with week_start <= now < week_end,
 *       a live class_links row for that term, and the page copy has jg.week.forward (T.<lang>.weekForward).
 *   forwardLine(line, url, names)           the ONE fixed line + the class link, or null when the line carries
 *       a digit, a class first name or a word that marks a child out (en or ur). Never invents a line.
 *   windowShown(card)                       sample_window{arm:'class_week', unit:'class', opens_at, closes_at},
 *       once per class per window (Redis SET NX until the window closes, and a per-process set).
 *   forwarded(card)                         class_week_forwarded{cls, term}.
 *
 * Reads only (class_round_draws, class_links), defensively: a missing table or column → no card, one
 * logToFile line. No message is sent, no ledger row, no DB write. Events carry w:'s', the keyed class hash
 * and the term — never a phone, a name, a class id or the link code; through web-quiz-kid's envelope,
 * required lazily (absent → no event).
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { classWeekOn } = require('./web-quiz-class-week-flags');

const PKT_MS = 5 * 3600 * 1000;
const CODE_RX = /^[A-HJ-NP-Z2-9]{8,16}$/;
const ANY_DIGIT = /[0-9٠-٩۰-۹]/;
// Words that would tell a family their child or class was singled out (NC9, L11): en and ur.
const MARKED = /\b(?:pick(?:ed)?|sampl(?:e|ed|ing)|select(?:ed)?|chos(?:en|e)|tests?|exams?|assessments?|draw[n]?|random)\b|منتخب|چنا|چنی|چنے|نمونہ|امتحان|ٹیسٹ|قرعہ/i;

const warned = new Set();
function warnOnce(what, err) {
  if (warned.has(what)) return;
  warned.add(what);
  logToFile('⚠️ class week: a read failed — no card', { what, error: err && err.message }, 'warn');
}
async function rowsOr(what, query) {
  try {
    const { data, error } = await query;
    if (error) throw new Error(error.message || 'read failed');
    return data || [];
  } catch (err) {
    warnOnce(what, err);
    return null;
  }
}

/** The term a moment falls in (IDENTITY §17): 'YYYY-YYa' 1 Apr–30 Sep, 'YYYY-YYb' 1 Oct–31 Mar, PKT. */
function termOf(now = Date.now()) {
  const pkt = new Date(now + PKT_MS);
  const y = pkt.getUTCFullYear();
  const m = pkt.getUTCMonth() + 1;
  const startYear = m >= 4 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}${m >= 4 && m <= 9 ? 'a' : 'b'}`;
}

/** The class's week window this term, when it is open now; else null. */
async function openWeek(classId, termCode, now) {
  const draws = await rowsOr('class_round_draws', supabase.from('class_round_draws')
    .select('class_id, term_code, week_start, week_end').eq('class_id', classId).eq('term_code', termCode));
  if (!draws) return null;
  const d = draws.find((r) => r.class_id === classId && r.term_code === termCode);
  if (!d) return null;
  const from = Date.parse(d.week_start || '');
  const to = Date.parse(d.week_end || '');
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    warnOnce('class_round_draws.week_window', new Error('week_start/week_end missing'));
    return null;
  }
  if (!(from <= now && now < to)) return null;
  return { opensAt: new Date(from).toISOString(), closesAt: new Date(to).toISOString() };
}

/** The class's live standing link code for the term, or null. */
async function liveCode(classId, termCode, now) {
  const links = await rowsOr('class_links', supabase.from('class_links')
    .select('code, class_id, term_code, expires_at, revoked_at').eq('class_id', classId).eq('term_code', termCode).is('revoked_at', null));
  if (!links) return null;
  const nowIso = new Date(now).toISOString();
  const live = links.filter((l) => !l.revoked_at && CODE_RX.test(String(l.code || '')) && (!l.expires_at || l.expires_at > nowIso));
  return live.length ? live[0].code : null;
}

function linkUrl(code) {
  const base = require('./web-quiz-link').webBaseUrl(); // eslint-disable-line global-require
  return base ? `${base}/j/${code}` : null;
}

/** The fixed line + the link, or null when the line is absent or would carry a number, a name or a marking word. */
function forwardLine(line, url, names = []) {
  const t = typeof line === 'string' ? line.trim() : '';
  if (!t || !url) return null;
  if (ANY_DIGIT.test(t) || MARKED.test(t)) return null;
  const folded = t.toLowerCase();
  if (names.some((n) => n && folded.includes(String(n).toLowerCase()))) return null;
  return `${t} ${url}`;
}

/** The card for a Jugnu tab's class list, or null. Never throws. */
async function cardFor({ list, names = [], lang = 'en', T = {}, now = Date.now() } = {}) {
  try {
    if (!list || !list.classId || !(await classWeekOn())) return null;
    const line = (T[lang] || {}).weekForward;
    if (typeof line !== 'string' || !line.trim()) return null; // jg.week.forward not in the deck yet → no card
    const termCode = termOf(now);
    const week = await openWeek(list.classId, termCode, now);
    if (!week) return null;
    const code = await liveCode(list.classId, termCode, now);
    const text = code ? forwardLine(line, linkUrl(code), names) : null;
    if (!text) return null;
    return { text, line: line.trim(), termCode, classId: list.classId, ...week };
  } catch (err) {
    warnOnce('cardFor', err);
    return null;
  }
}

let warnedNoKid = false;
function emit(name, fields, classId) {
  let Kid;
  try {
    Kid = require('./web-quiz-kid'); // eslint-disable-line global-require
  } catch (_) {
    if (!warnedNoKid) { warnedNoKid = true; logToFile('ℹ️ class week: web-quiz-kid not on this build — no class-week event written'); }
    return;
  }
  try {
    const data = { w: 's', ...fields };
    if (classId) data.cls = Kid.cls(classId);
    logEvent(`web_quiz.${name}`, Kid.envelope(data));
  } catch (err) {
    logToFile('⚠️ class week: event not written', { name, error: err.message });
  }
}

const shownHere = new Set();
/** sample_window once per class per window. */
async function windowShown(card) {
  if (!card) return;
  const key = `wq:cw:sw:${crypto.createHash('sha256').update(`${card.classId}|${card.termCode}|${card.opensAt}`).digest('hex').slice(0, 32)}`;
  if (shownHere.has(key)) return;
  shownHere.add(key);
  let first = true;
  try {
    const redis = require('../cache/railway-redis.service'); // eslint-disable-line global-require
    const ttl = Math.max(60, Math.ceil((Date.parse(card.closesAt) - Date.now()) / 1000));
    first = await redis.setNX(key, '1', ttl);
  } catch (err) {
    logToFile('⚠️ class week: window de-dup unavailable — this process only', { error: err.message });
  }
  if (!first) return;
  emit('sample_window', { arm: 'class_week', unit: 'class', opens_at: card.opensAt, closes_at: card.closesAt });
}

function forwarded(card) {
  if (card) emit('class_week_forwarded', { term: card.termCode }, card.classId);
}

module.exports = {
  cardFor, forwardLine, windowShown, forwarded, termOf, MARKED, _resetWarnings: () => { warned.clear(); shownHere.clear(); warnedNoKid = false; },
};
