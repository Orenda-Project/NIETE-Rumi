'use strict';
/**
 * bd-snkn32.15 — the guard for "Change this plan". Pure: no I/O, no clock unless passed in.
 *
 * Every check here runs on the server BEFORE a row is written or a model is called: one change is one
 * full generation (~$0.24–0.36). Refusals are never counted against her two changes or the daily limit.
 */

const PARTS = Object.freeze({
  k5: Object.freeze(['hook', 'i_do', 'we_do', 'you_do', 'wrap']),
  g612: Object.freeze(['objectives', 'introduction', 'development', 'activity', 'conclusion', 'homework', 'whole']),
});
const TEXT_MIN = 15;
const TEXT_MAX = 300;
const MAX_ROUNDS = 2;
const DAILY_LIMIT = 5;
const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000; // Asia/Karachi is UTC+5 all year (no DST)

// Words that mark a request as only about punctuation, spelling or diacritics (English, Roman Urdu, Urdu).
const TINY_WORDS = new Set([
  'comma', 'commas', 'stop', 'stops', 'fullstop', 'fullstops', 'dot', 'dots', 'punctuation', 'spelling', 'spellings',
  'spell', 'typo', 'typos', 'apostrophe', 'apostrophes', 'capitalisation', 'capitalization', 'spacing', 'diacritic',
  'diacritics', 'zer', 'zabar', 'pesh', 'irab', 'aerab', 'hyphen', 'hyphens',
  'اعراب', 'زیر', 'زبر', 'پیش', 'کاما', 'املا', 'ہجے', 'نقطہ', 'نقطے', 'ڈیش',
]);
const TINY_PHRASES = ['full stop', 'question mark', 'capital letter', 'capital letters', 'فل اسٹاپ', 'فل سٹاپ', 'رموز اوقاف'];

// Words that carry no request of their own: function words, "please fix it" words, the part names.
const FILLER = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'is', 'are', 'be', 'it', 'its', 'this', 'that',
  'these', 'there', 'here', 'please', 'pls', 'plz', 'fix', 'correct', 'correction', 'add', 'put', 'remove', 'missing',
  'wrong', 'mistake', 'mistakes', 'error', 'errors', 'change', 'make', 'use', 'each', 'every', 'all', 'end', 'line',
  'lines', 'word', 'words', 'sentence', 'sentences', 'part', 'section', 'plan', 'lesson', 'some', 'few', 'small',
  'minor', 'just', 'only', 'my', 'with', 'from', 'by', 'i', 'do', 'we', 'you', 'hook', 'wrap', 'whole',
  'objectives', 'introduction', 'development', 'activity', 'conclusion', 'homework', 'full', 'mark', 'marks',
  'theek', 'thik', 'karein', 'karen', 'kar', 'kardo', 'karo', 'mein', 'me', 'main', 'hai', 'hain', 'ki', 'ka', 'ke',
  'aur', 'ko', 'se', 'par', 'pe', 'ghalti', 'galti', 'lagaein', 'lagayen', 'laga', 'dein', 'den', 'do',
  'کریں', 'کرو', 'کر', 'ٹھیک', 'درست', 'کی', 'کا', 'کے', 'میں', 'ہے', 'ہیں', 'غلطی', 'غلطیاں', 'پر', 'براہ',
  'مہربانی', 'یہاں', 'وہاں', 'اور', 'لگائیں', 'لگا', 'لگاؤ', 'دیں', 'دو', 'پلیز', 'کو', 'سے', 'یہ', 'وہ', 'ٹھیک',
]);

/** Lowercase, drop diacritics (harakat), turn punctuation into spaces, collapse whitespace. */
function normalise(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .normalize('NFC')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the request is only about punctuation, spelling or diacritics: she can fix that by hand. */
function isTinyEdit(text) {
  let s = ` ${normalise(text)} `;
  let hit = false;
  for (const phrase of TINY_PHRASES) {
    if (s.includes(` ${phrase} `)) { hit = true; s = s.split(` ${phrase} `).join(' '); }
  }
  const tokens = s.split(' ').filter(Boolean);
  if (tokens.some((t) => TINY_WORDS.has(t))) hit = true;
  if (!hit) return false;
  const content = tokens.filter((t) => !TINY_WORDS.has(t) && !FILLER.has(t));
  return content.length < 3;
}

/** Start of the current Pakistan day (Asia/Karachi midnight) as an ISO string. */
function karachiDayStart(nowMs) {
  const local = nowMs + KARACHI_OFFSET_MS;
  const midnightLocal = local - (((local % 86400000) + 86400000) % 86400000);
  return new Date(midnightLocal - KARACHI_OFFSET_MS).toISOString();
}

const liveRounds = (chain) => (chain || []).filter((r) => r && r.parent_own_id && r.status !== 'failed');

/** How many of her two changes are left. Failed rounds never count. */
function changesLeft(chain) {
  return Math.max(0, MAX_ROUNDS - liveRounds(chain).length);
}

const refuse = (outcome) => ({ ok: false, outcome });

/**
 * Decide whether a change may be queued. `chain` is the root plan plus every change row under it;
 * `todayCount` is her makes + changes so far today (failed rows excluded).
 */
function checkChange({ band, part, text, chain, todayCount }) {
  const parts = PARTS[band];
  if (!parts || !parts.includes(part)) return refuse('bad_request');
  if (typeof text !== 'string' || text.trim().length < TEXT_MIN) return refuse('too_short');
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX);

  const rows = chain || [];
  const root = rows.find((r) => r && !r.parent_own_id);
  if (!root || root.status === 'failed') return refuse('not_found');
  if (rows.some((r) => r && r.status === 'authoring')) return refuse('in_flight');
  const live = liveRounds(rows);
  if (live.length >= MAX_ROUNDS) return refuse('cap_reached');
  if (isTinyEdit(clean)) return refuse('too_small');

  const last = live.reduce((a, r) => (!a || r.edit_round > a.edit_round ? r : a), null);
  const prev = last && last.edit_request;
  if (prev && prev.part === part && normalise(prev.text) === normalise(clean)) return refuse('repeat');
  if ((todayCount || 0) >= DAILY_LIMIT) return refuse('daily_limit');

  return { ok: true, round: live.length + 1, part, text: clean };
}

/** 'k5' for a grades 1–5 day (lesson_id), 'g612' for a 6-12 segment. */
const bandOf = (row) => (row && row.lesson_id ? 'k5' : 'g612');

/** The plan a change starts from: the latest READY plan in the chain (the root is round 0), or null. */
function editBase(chain) {
  const ready = (chain || []).filter((r) => r && r.status === 'ready');
  return ready.reduce((a, r) => (!a || (r.edit_round || 0) > (a.edit_round || 0) ? r : a), null);
}

/** The document stored beside a plan's PDF: .lp.json (6-12, editKeyFor) or .json (grades 1–5). */
function baseJsonKey(r2Key, band) {
  if (typeof r2Key !== 'string' || !r2Key.endsWith('.pdf')) return null;
  return `${r2Key.slice(0, -4)}${band === 'k5' ? '.json' : '.lp.json'}`;
}

/** The poll's fields for an own plan (lp612-own ownStatus sets changes_left on a ready one); {} for anything else. */
function statusFields(row) {
  if (!row || typeof row.changes_left !== 'number') return {};
  return { changesLeft: row.changes_left, ownBand: row.own_band };
}

module.exports = {
  PARTS, TEXT_MIN, TEXT_MAX, MAX_ROUNDS, DAILY_LIMIT,
  normalise, isTinyEdit, karachiDayStart, changesLeft, checkChange, bandOf, editBase, baseJsonKey, statusFields,
};
