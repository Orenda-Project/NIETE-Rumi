'use strict';
/**
 * bd-snkn32.15 — the guard for "Change this plan". Pure: no I/O, no clock unless passed in.
 *
 * Every check here runs on the server BEFORE a row is written or a model is called: one change is one
 * full generation (~$0.24–0.36). Refusals are never counted against her two changes or the daily limit.
 */

const PARTS = Object.freeze({
  k5: Object.freeze(['hook', 'i_do', 'we_do', 'you_do', 'wrap']),
  // no 'whole': a change is to one section, so it cannot quietly rewrite the gradual release away.
  g612: Object.freeze(['objectives', 'introduction', 'development', 'activity', 'conclusion', 'homework']),
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

/*
 * a first filter for the two rules no change can lift: the gradual release (I do → We do → You do) is
 * never dropped, skipped or merged ('grr'), and no part becomes rote drill ('rote'). Small on purpose: the instruction
 * (GRR_LINE, ROTE_LINE) and the gates after the rewrite are the real guard. Run on normalise()d text; a hit right after
 * a negation ("don't skip We do", "do not make them memorise") is not a request for it. Roman-Urdu and Urdu phrases are
 * machine-drafted.
 */
const PHASE = '(?:i ?do|we ?do|you ?do|میں کروں|ہم کریں|آپ کریں)';
const DROP = '(?:skip|drop|remove|delete|cut|omit|leave out|merge|combine|hata|hatao|hatado|nikal|nikalo|chhor|chor)';
const GRR_PATTERNS = [
  new RegExp(`\\b${DROP} (?:the |whole |entire |both )*${PHASE}(?= |$)`, 'u'),
  new RegExp(`(?:without|no need for|no) (?:the |any )?${PHASE}(?= |$)`, 'u'),
  new RegExp(`${PHASE} (?:ko |wala hissa |کو |والا حصہ )?(?:hata|hatao|nikal|nikalo|khatam|chhor|chor|ہٹا|نکال|چھوڑ|ختم)`, 'u'),
  new RegExp(`${PHASE} (?:ko )(?:skip|remove|drop)`, 'u'),
  new RegExp(`${PHASE} کے بغیر`, 'u'),
];
// Rote = learning answers, definitions or passages off by heart, or copying them. Choral practice of a sound or a word
// (phonics) is NOT rote and must pass, so counted repetition and memorising only count when aimed at such text.
const ROTE_TEXT = '(?:answers?|definitions?|passages?|paragraphs?|poems?|texts?|lines|sentences|questions?|chapters?|pages?|notes|tables?)';
const ROTE_PATTERNS = [
  /\b(?:word for word|rote|cram|cramming|ratta|rata)\b/u,
  new RegExp(`\\b(?:memori[sz]e|memori[sz]ing)(?: \\S+){0,3} ${ROTE_TEXT}\\b`, 'u'),
  new RegExp(`\\b${ROTE_TEXT}(?: \\S+){0,2} (?:by heart|off by heart)\\b`, 'u'),
  new RegExp(`\\brepeat(?: \\S+){0,3} ${ROTE_TEXT}(?: \\S+){0,3} (?:\\d+|two|three|four|five|ten|twenty) times\\b`, 'u'),
  /\bcopy(?: \S+){0,4} (?:from|off) (?:the )?board\b/u,
  /(?:رٹا|رٹے|رٹہ|زبانی یاد|یاد کروا)/u,
];
// A hit followed by "is not needed" and the like is a refusal of rote, not a request for it.
const NEGATED_AFTER = /^(?: \S+){0,4} (?:is |are )?(?:not needed|not required|unnecessary|not allowed|zaroori nahi|zaroori nahin)\b/u;
const NEGATION = new Set(['no', 'not', 'never', 'dont', 'don', 'doesn', 'without', 'avoid', 'instead', 'na', 'nahi', 'nahin', 'mat', 'نہ', 'نہیں', 'مت', 'بغیر']);

/** True when a pattern matches somewhere not just after a negation (the 3 words before it). */
function asksFor(norm, patterns) {
  return patterns.some((re) => {
    const g = new RegExp(re.source, `${re.flags.replace('g', '')}g`);
    for (const m of norm.matchAll(g)) {
      const before = norm.slice(0, m.index).split(' ').filter(Boolean).slice(-3);
      const after = norm.slice(m.index + m[0].length);
      if (!before.some((w) => NEGATION.has(w)) && !NEGATED_AFTER.test(after)) return true;
    }
    return false;
  });
}

/** 'grr', 'rote' or null for her request text. */
function ruleBreak(text) {
  const norm = normalise(text);
  if (asksFor(norm, GRR_PATTERNS)) return 'grr';
  if (asksFor(norm, ROTE_PATTERNS)) return 'rote';
  return null;
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
  const broken = ruleBreak(clean);
  if (broken) return refuse(broken);

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
  normalise, isTinyEdit, ruleBreak, karachiDayStart, changesLeft, checkChange, bandOf, editBase, baseJsonKey, statusFields,
};
