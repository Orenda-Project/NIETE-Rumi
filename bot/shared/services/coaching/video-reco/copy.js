'use strict';
/**
 * The words around a recommended training clip — bd-gzfdu9 (VIDREC), SPEC §4.2. Pure.
 *
 * The strings live in the catalog (ux-strings.js, `videoReco*`); this file only fills them: whole minutes
 * (Urdu-Indic digits for ur), the clip's language by name, and the LLM's reason, whose English runs inside
 * an Urdu line are set in their own left-to-right isolates (U+2066…U+2069) so the line reads right to left.
 * Used by send.js (the WhatsApp message), the /cr card and the /v player.
 */
const { resolveUx, clampLanguage } = require('../../../config/ux-strings');
const { getLanguage } = require('../../../config/languages');

const BODY_MAX = 1024; // Meta's cap on an interactive body, in code points
const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const LRI = '\u2066';
const FSI = '\u2068';
const PDI = '\u2069';
const RLM = '‏';

/** The reader's language as NIETE offers it (flat en/ur, language-protocol): the catalog's own clamp. */
const lang = (l) => clampLanguage(l);
/** 'rtl' | 'ltr' from the language registry. */
const dirOf = (l) => (getLanguage(lang(l))?.direction === 'rtl' ? 'rtl' : 'ltr');
/** A row's per-language field (`title_ur`, `reason_ur`, …), falling back to the English one. */
const localized = (obj, field, l) => (obj && (obj[`${field}_${lang(l)}`] || obj[`${field}_en`])) || null;

/** Whole minutes for a clip of `s` seconds, never below 1. */
function minutesOf(s) {
  const n = Math.round((Number(s) || 0) / 60);
  return n < 1 ? 1 : n;
}

const urduDigits = (n) => String(n).replace(/[0-9]/g, (d) => URDU_DIGITS[Number(d)]);
const DIGITS = { ur: urduDigits };
const num = (n, l) => (DIGITS[l] || String)(n);

/** 95 → "1:35". */
function clock(s) {
  const t = Math.max(0, Math.floor(Number(s) || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

const LANG_KEY = { ur: 'videoRecoLangUr', en: 'videoRecoLangEn', mixed: 'videoRecoLangMixed' };
const clipLanguageName = (clipLanguage, l) => resolveUx(LANG_KEY[clipLanguage] || LANG_KEY.ur, { language: l });

/**
 * Each Latin phrase inside an Urdu line in its own isolate, and the line opened right to left. A phrase is
 * Latin words joined by spaces/hyphens/apostrophes, with a number that leads into them («4 digit addition», R7b); a bare
 * number or clock ("12:40") is left alone.
 */
function isolateLatin(text, mark = true) {
  const s = String(text || '');
  if (!s) return s;
  // Text already inside an isolate (a quoted moment, bd-8hhqhf) and a name placeholder ([a student], R7b) are left as
  // they are; only the rest is scanned.
  const out = s.split(/([\u2066-\u2068][^\u2066-\u2069]*\u2069|\[(?:a student|CHILD|TEACHER)\])/).map((part, i) => (i % 2 ? part
    : part.replace(/(?:[0-9][0-9.,:–-]*\s+)?[A-Za-z][A-Za-z0-9'’-]*(?:\s+[A-Za-z0-9][A-Za-z0-9'’-]*)*/g, (run) => `${LRI}${run}${PDI}`))).join('');
  if (!mark) return out;
  const first = [...out].find((ch) => /\p{L}/u.test(ch) && !/[⁦-⁩]/.test(ch));
  return first && /[؀-ۿ]/.test(first) ? out : `${RLM}${out}`;
}

/** Bidi embedding/override/isolate controls removed (U+202A–202E, U+2066–2069): a stray PDI in model text would close an outer isolate. */
const stripBidi = (text) => (typeof text === 'string' ? text.replace(/[\u202A-\u202E\u2066-\u2069]/g, '') : text);

const QUOTE_PAIR = /"([^"]+)"|“([^”]+)”|«([^»]+)»/g;
const ISOLATE_CH = /[\u2066-\u2069]/;
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

/** Each quoted pair isolated — only when the pairing cannot be wrong: one pair, or several holding no Urdu text. */
function isolatePairs(text) {
  const pairs = [...text.matchAll(QUOTE_PAIR)];
  if (!pairs.length) return text;
  if (pairs.length > 1 && pairs.some((p) => ARABIC_SCRIPT.test(p[1] ?? p[2] ?? p[3]))) return text; // inner quotes possible: no guess
  return text.replace(QUOTE_PAIR, (m, a, b, c) => {
    const q = a ?? b ?? c;
    return ISOLATE_CH.test(q[0]) ? m : `${m[0]}${FSI}${q}${PDI}${m[m.length - 1]}`;
  });
}

/**
 * Every quoted lesson moment in a reason set in its own first-strong isolate (FSI…PDI), inside the quote marks, so an
 * Urdu quote in an English line (or a quote opening with a digit, "9 ہم نے …") renders in place on WhatsApp, /cr and
 * the React card (bd-8hhqhf, live session c53bf86d). `quote` is the moment the validator accepted: the longest stretch
 * between two quote marks that lies inside it is the moment, however many quote marks it holds (red7 070727,
 * d029b87c «اب "سی" اے ٹی …»); the rest of the text gets isolatePairs. A text with no quote is unchanged.
 */
function isolateQuotes(text, quote) {
  if (typeof text !== 'string' || !text) return text;
  const q = typeof quote === 'string' ? quote : '';
  const marks = [...text.matchAll(/["“”«»]/g)].map((m) => m.index);
  let best = null;
  for (let i = 0; q && i < marks.length; i++) {
    for (let j = i + 1; j < marks.length; j++) {
      const inner = text.slice(marks[i] + 1, marks[j]);
      if ([...inner.trim()].length >= 6 && !ISOLATE_CH.test(inner) && q.includes(inner.trim()) && (!best || inner.length > best.inner.length)) best = { i: marks[i], j: marks[j], inner };
    }
  }
  if (!best) return isolatePairs(text);
  return `${isolatePairs(text.slice(0, best.i))}${text[best.i]}${FSI}${best.inner}${PDI}${text[best.j]}${isolatePairs(text.slice(best.j + 1))}`;
}

const AR = '\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF';
// An Urdu run inside an English line: Urdu words with the spaces, digits, Urdu punctuation and "..." between them.
const AR_RUN = new RegExp(`[${AR}](?:[${AR}\\s\\d،۔؟؛…]|\\.{2,3}|[,.!?](?=\\s*[${AR}]))*`, 'g');

/** Each Urdu run of an English line, outside existing isolates, in its own FSI…PDI (no quote marks are added). */
function isolateArabic(text) {
  const s = String(text || '');
  return s.split(/([\u2066-\u2068][^\u2066-\u2069]*\u2069)/).map((part, i) => (i % 2 ? part
    : part.replace(AR_RUN, (run) => { const t = run.trimEnd(); return `${FSI}${t}${PDI}${run.slice(t.length)}`; }))).join('');
}

// Any case: a label only counts at a sentence start (LINE_PREFIX_AT), so "the teacher: …" mid-sentence is untouched.
const LABEL = '(?:[Tt]eacher|[Ss]tudents?|[Ss]peaker|[Cc]oach|ٹیچر|استاد|استانی|طالب علم|بچہ|بچے|بچی)(?:\\s*\\([A-Za-z]{2}\\))?';
// A copied line prefix at a sentence start: "[mm:ss] Label:", "[mm:ss]", "mm:ss:" or a bare "Label:" (COS 081156).
const LINE_PREFIX_AT = new RegExp(`(^|[.!?۔؟]\\s+)(?:\\[\\d{1,2}:\\d{2}(?::\\d{2})?\\]\\s*(?:${LABEL}\\s*:)?|\\d{1,2}:\\d{2}(?::\\d{2})?\\s*:|${LABEL}\\s*:)\\s*`, 'g');

/**
 * The stored reason (bd-8hhqhf r7; red7 075837 / 080908; COS 081156 = the panel's option 1): a copied transcript prefix
 * («[10:51] Teacher:», «00:00:», «استاد:») is dropped, clock stamp and label both; the accepted moment is isolated
 * (isolateQuotes); in the English reason every Urdu run outside an isolate is isolated too, so an unquoted moment
 * renders in place. No quote mark is ever added.
 */
// A child placeholder used as a vocative at the very start, inside an opening quote mark or not (scale-run 084820):
// the reason must never open with it ([v1.3c-5]); the quote stays a verbatim stretch of the line without it.
// One or more in a row («[a student]، [a student]، آپ دونوں پڑھیں», red7 085645).
const LEADING_VOCATIVE = /^(\s*["“«]?)\s*(?:\[(?:a student|CHILD)\]\s*[،,:]\s*)+/;

/** The copied prefix and the leading vocative, stripped until neither is left («[a student]، [00:12] …»). */
function stripLead(text) {
  let s = text;
  let prev;
  do {
    prev = s;
    s = s.replace(LINE_PREFIX_AT, '$1').replace(LEADING_VOCATIVE, '$1');
  } while (s !== prev);
  return s;
}

// R7b (panel §4 item 5; language-protocol §9.4): one digit system per message. Urdu prose takes Urdu digits, except a
// number that belongs to a Latin run («4 digit addition»); an English line takes Western digits outside the quoted moment.
const ASCII_RUN = /\d+(?:[.,:\-–]\d+)*/g;
const nearestLetter = (t, i, step) => { for (let k = i; k >= 0 && k < t.length; k += step) if (/\p{L}/u.test(t[k])) return t[k]; return ''; };
function urduDigitsInProse(text) {
  return text.replace(ASCII_RUN, (run, at, all) => {
    const latin = /[A-Za-z]/;
    return latin.test(nearestLetter(all, at - 1, -1)) || latin.test(nearestLetter(all, at + run.length, 1)) ? run : urduDigits(run);
  });
}
const westernDigits = (text) => text.split(/([\u2066-\u2068][^\u2066-\u2069]*\u2069)/).map((part, i) => (i % 2 ? part
  : part.replace(/[۰-۹٠-٩]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d) >= 0 ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(d) : '٠١٢٣٤٥٦٧٨٩'.indexOf(d))))).join('');

/**
 * The stored reason. Urdu: Urdu digits, the CJK stop «。» as «۔», every Latin run in its own LTR isolate (translate-or-isolate,
 * R7b; the WhatsApp body's isolateLatin skips runs already isolated). English: Western digits, «。» as «.», Urdu runs isolated.
 */
function composeReason(text, language, quote) {
  if (typeof text !== 'string' || !text) return text;
  const s = isolateQuotes(stripLead(text), quote);
  if (lang(language) === 'en') return isolateArabic(westernDigits(s.replace(/。\s*/g, '. ').trim()));
  // red7 N4: the word table and the digit rewrite never touch a quoted span (the transcript's or the card's own words)
  const prose = (fn) => (t) => t.split(QUOTED_SPAN).map((part, i) => (i % 2 ? part : fn(part))).join('');
  const western = /[0-9]/.test(s.split(QUOTED_SPAN).filter((_, i) => i % 2).join(' '));
  const digits = prose((t) => oneDigitSystem(urduDigitsInProse(t), western));
  return isolateLatin(digits(prose(urduWordTable)(s.replace(/。/g, '۔'))), false); // the WhatsApp body adds its own RLM
}

// R7c (COS 20261023T170515 §6; panel ped/REVIEW_r7b_rejudge.md §4): the model's recurring Urdu slips, each fixed to the word a
// teacher uses. Only forms that are wrong in every context are rewritten; «جوڑ» stays where it means addition.
const URDU_WORDS = [
  [/(^|[\s«"(])جوڑ(?= میں(?=[\s،۔]|$))/gu, '$1جوڑوں'], // pairs (Q092 Q096 Q101 Q111 Q145)
  [/(^|[\s«"(])جوڑ(?= بنا)/gu, '$1جوڑے'],
  [/(^|[\s«"(])ہمزات(?=[\s،۔]|$)/gu, '$1ساتھی'], // Q101
  [/(^|[\s«"(])طبقے(?=[\s،۔]|$)/gu, '$1کلاس'], // «class» (Q137)
  [/جگہ قدر/gu, 'مقامی قدر'], // place value (Q098)
  [/پورے کلاس/gu, 'پوری کلاس'], // Q081 Q105
  [/اگلے کلاس/gu, 'اگلی کلاس'], // Q020
  [/(^|[\s«"(])یاداشت/gu, '$1یادداشت'], // Q167
  [/مثلاََ|مثلاَ/gu, 'مثلاً'], // Q164
  // "why do you think" calque (Q082 Q149 Q200); red7 N5: «کیوں» goes after the subject, so the clause keeps its order
  [/آپ کیوں سوچتے ہیں کہ ([^؟?۔]+?)\s*([؟?])/gu, 'آپ کے خیال میں $1، ایسا کیوں$2'],
  [/آپ کیوں سوچتے ہیں/gu, 'آپ کے خیال میں ایسا کیوں ہے'],
  [/(^|[\s«"(])پروب(?=[\s،۔]|$)/gu, '$1مزید سوال'], // Q141
];
const urduWordTable = (text) => URDU_WORDS.reduce((t, [rx, to]) => t.replace(rx, to), text);

/** One digit system per Urdu line (14 panel rows): when a Western number must stay (inside a Latin run), all are Western. */
function oneDigitSystem(text, westernElsewhere = false) {
  return westernElsewhere || /[0-9]/.test(text) ? text.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))) : text;
}
// A quoted span: an isolate, or a pair of quote marks (the parts at odd indexes after a split)
const QUOTED_SPAN = /([\u2066-\u2068][^\u2066-\u2069]*\u2069|"[^"]*"|«[^»]*»|“[^”]*”)/;

// An Urdu line sets its English runs in isolates; other lines are as written.
const LINE = { ur: isolateLatin };

function cut(text, max) {
  const cps = [...text];
  return cps.length <= max ? text : `${cps.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`;
}

function buttonText({ minutes, language }) {
  const l = lang(language);
  return resolveUx('videoRecoButton', { language: l, params: { n: num(minutes, l) } });
}

function cardButton({ minutes, language }) {
  const l = lang(language);
  return resolveUx('videoRecoCardButton', { language: l, params: { n: num(minutes, l) } });
}

/** lead \n reason \n meta — the reason is cut first so the whole body stays ≤ 1024 code points. */
function messageBody({ minutes, reason, clipLanguage, language }) {
  const l = lang(language);
  const lead = resolveUx('videoRecoBodyLead', { language: l, params: { n: num(minutes, l) } });
  const meta = resolveUx('videoRecoBodyMeta', { language: l, params: { n: num(minutes, l), lang: clipLanguageName(clipLanguage, l) } });
  const r = String(reason || '').replace(/\s+/g, ' ').trim();
  if (!r) return `${lead}\n${meta}`;
  const room = BODY_MAX - [...lead].length - [...meta].length - 2;
  const line = cut((LINE[l] || String)(r), room);
  return `${lead}\n${line}\n${meta}`;
}

/** A plain catalog line in the reader's language (player + card labels). */
const word = (key, language, params) => resolveUx(key, { language: lang(language), params });

module.exports = {
  lang, dirOf, localized, num, minutesOf, urduDigits, clock, isolateLatin, isolateQuotes, isolateArabic, composeReason, stripBidi, buttonText, cardButton, messageBody, clipLanguageName, word, BODY_MAX,
};
