'use strict';
/**
 * Quiz author gates v2 — checks in CODE for faults that passed every earlier
 * gate and reached children (a pedagogy review of 24 eval and 24 production
 * items, Oct 2026). Each returns complaints in the validator's own shape,
 * `q<i>: CODE — what to fix`, so a failing question goes back through the
 * existing targeted rewrite and is never shipped as it is.
 *
 *   KEY_ARITHMETIC     the stem asks one sum and the key is not its answer
 *   WHY_ARITHMETIC     an "a op b = c" in the key, the why or the praise is wrong
 *   WHY_CONTRADICTS_KEY the why's own result is a wrong option, never the key
 *   REGROUP_CLAIM      the why says a sum needs regrouping (borrowing/carrying)
 *                      when no column does
 *   PICTURE_MISSING    the stem points at a picture and the question has none
 *   FIGURE_NUMBERS     the picture lacks a number the stem uses
 *   ABOUT_TEACHER      the question asks about the teacher, not the lesson
 *   THROWAWAY_OPTION   a digit or a Latin letter among Urdu letter options
 *   READ_LETTER_PREFIX "A: …" in the text the voice reads (web items)
 *   WORD_BLANK_NOT_A_WORD a word_blank holding a sentence (50 of 392 prod items):
 *                      a row of tiles too small to read on a phone
 *   WORD_BLANK_NOT_ASKED a word_blank picture hides a letter, and the key is not
 *                      that letter: the picture is not the question asked (a
 *                      syllable count over «ک _ ا ب»; 316 of 392 prod items)
 *
 * Whether the key is fully correct as a STATEMENT (not just the best of the
 * options: "drunk" when "drank" is missing) is a judgement code cannot make;
 * it rides on the blind solve that already runs (transcript-quiz-key-verify,
 * STRICT_KEY_RULE), so it costs no extra call.
 *
 * OFF unless app_settings `quiz_author_gates_v2` is true. With it off, every
 * caller behaves exactly as before.
 */

const { logToFile } = require('../../utils/logger');
const { hiddenLetters } = require('./quiz-figure-child-view');

const TTL_MS = 60 * 1000;
let cache = null;

/**
 * Read the flag through the ONE reader (config/feature-flags isQuizAuthorGatesV2,
 * fail-closed), cached a minute. generate reads it once per quiz itself and
 * hands the value over with setEnabled(); this is for any other entry point.
 */
async function refreshFlag(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    // Required here, not at the top: the validator loads this module, and offline
    // callers of the validator (scripts, the KaTeX suite) have no database config.
    // eslint-disable-next-line global-require
    const { isQuizAuthorGatesV2 } = require('../../config/feature-flags');
    cache = { at: now, on: (await isQuizAuthorGatesV2()) === true };
  } catch (err) {
    logToFile('⚠️ quiz author gates v2: settings lookup failed — gates off', { error: err.message });
    cache = { at: now, on: false };
  }
  return cache.on;
}

/** The value generate read for this quiz (one read per quiz). */
function setEnabled(on, now = Date.now()) {
  cache = { at: now, on: on === true };
}

/** The last value read. `ctxValue` (a caller's explicit choice) wins. */
function enabled(ctxValue) {
  if (typeof ctxValue === 'boolean') return ctxValue;
  return Boolean(cache && cache.on);
}

function resetForTests() { cache = null; }

// ─── numbers ────────────────────────────────────────────────────────────────
const DIGIT_MAP = { '۰': 0, '۱': 1, '۲': 2, '۳': 3, '۴': 4, '۵': 5, '۶': 6, '۷': 7, '۸': 8, '۹': 9,
  '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9 };
/** Eastern digits to ASCII, TeX operators to symbols, thousands commas out, direction marks out. */
function plain(text) {
  return String(text ?? '')
    .replace(/[۰-۹٠-٩]/g, (d) => String(DIGIT_MAP[d]))
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1/$2)')
    .replace(/\\times|\\cdot/g, '×').replace(/\\div/g, '÷')
    .replace(/[$\\{}]/g, ' ')
    .replace(/(\d),(?=\d{3}\b)/g, '$1');
}
const NUM = '(\\d+(?:\\.\\d+)?)';
const OP = '([+\\-−–×xX*÷/])';
const EQ_RE = new RegExp(`(?<![\\d.])${NUM}\\s*${OP}\\s*${NUM}\\s*=\\s*${NUM}`, 'g');
const EXPR_RE = new RegExp(`${NUM}\\s*${OP}\\s*${NUM}`, 'g');
const CHAINED_BEFORE = /[+\-−–×xX*÷/]\s*$/;
const CHAINED_AFTER = /^\s*[+\-−–×xX*÷/]\s*[\d(]/;

function apply(a, op, b) {
  const x = Number(a); const y = Number(b);
  switch (op) {
    case '+': return x + y;
    case '-': case '−': case '–': return x - y;
    case '×': case 'x': case 'X': case '*': return x * y;
    case '÷': case '/': return y === 0 ? NaN : x / y;
    default: return NaN;
  }
}
const close = (a, b) => Math.abs(a - b) < 1e-9;

/** The one number an option is, or null ("410", "۴۱۰", "410 apples" → 410). */
function numberOf(text) {
  const t = plain(text).trim();
  const m = /^[^\d]*?(\d+(?:\.\d+)?)[^\d]*$/.exec(t);
  return m ? Number(m[1]) : null;
}

/** Every number a text writes, as numbers. */
function numbersIn(text) {
  return (plain(text).match(/\d+(?:\.\d+)?/g) || []).map(Number);
}

/** Wrong "a op b = c" statements in a text (fraction a/b = c skipped: a slash there is rarely a division). */
function wrongEquations(text) {
  const bad = [];
  const t = plain(text);
  EQ_RE.lastIndex = 0;
  let m;
  while ((m = EQ_RE.exec(t))) {
    const [all, a, op, b, c] = m;
    if (op === '/') continue;
    if (CHAINED_BEFORE.test(t.slice(0, m.index))) continue; // "123 + 456 + 789 = 1368": not "456 + 789"
    if (CHAINED_AFTER.test(t.slice(m.index + all.length))) continue; // "1.2 ÷ 0.3 = 12/10 × …": a step, not a result
    if (op === '÷' && Number(c) === 0 && Number(a) % Number(b) === 0) continue; // "12 ÷ 6 leaves 0": a remainder

    const r = apply(a, op, b);
    // "64 ÷ 7 = 9 with a remainder of 1": the quotient of a division that does not go exactly
    const quotient = op === '÷' && Number(a) % Number(b) !== 0 && Number(c) === Math.floor(r);
    if (Number.isFinite(r) && !close(r, Number(c)) && !quotient) bad.push(all.trim());
  }
  return bad;
}

/** The single sum a stem asks, when it asks exactly one and nothing after "=" ("490 − 80 = ?"). */
function stemSum(stem) {
  const t = plain(stem);
  const found = [];
  EXPR_RE.lastIndex = 0;
  let m;
  while ((m = EXPR_RE.exec(t))) {
    const after = t.slice(m.index + m[0].length);
    if (/^\s*=\s*\d/.test(after)) continue; // a stated equation, not a question
    if (CHAINED_AFTER.test(after) || CHAINED_BEFORE.test(t.slice(0, m.index))) return null; // three or more terms: not decided here
    if (m[2] === '/' || m[2] === '-' && /^\s*\d/.test(t.slice(m.index - 1, m.index))) continue;
    found.push({ a: Number(m[1]), op: m[2], b: Number(m[3]), result: apply(m[1], m[2], m[3]) });
  }
  // worded: «490 میں سے 80 تفریق» / "subtract 80 from 490" / "490 minus 80" / "take 80 away from 490"
  const worded = [
    [/(\d+)\s*میں\s*سے\s*(\d+)\s*(?:کو\s*)?(?:تفریق|نکال|کم|منفی)/, (m) => [m[1], '-', m[2]]],
    [/(\d+)\s*(?:اور|میں)\s*(\d+)\s*(?:کو\s*)?جمع/, (m) => [m[1], '+', m[2]]],
    [/\bsubtract\s+(\d+)\s+from\s+(\d+)/i, (m) => [m[2], '-', m[1]]],
    [/\btake\s+(\d+)\s+away\s+from\s+(\d+)/i, (m) => [m[2], '-', m[1]]],
    [/(\d+)\s+minus\s+(\d+)/i, (m) => [m[1], '-', m[2]]],
    [/(\d+)\s+plus\s+(\d+)/i, (m) => [m[1], '+', m[2]]],
    [/\b(?:sum|total)\s+of\s+(\d+)\s+and\s+(\d+)\b(?!\s*(?:and|,)\s*\d)/i, (m) => [m[1], '+', m[2]]],
    [/\badd\s+(\d+)\s+(?:and|to)\s+(\d+)\b(?!\s*(?:and|,)\s*\d)/i, (m) => [m[1], '+', m[2]]],
    [/\bdifference\s+between\s+(\d+)\s+and\s+(\d+)\b/i, (m) => [String(Math.max(+m[1], +m[2])), '-', String(Math.min(+m[1], +m[2]))]],
  ];
  if (!found.length) {
    for (const [re, parts] of worded) {
      const m = re.exec(t);
      if (m) { const [a, op, b] = parts(m); found.push({ a: Number(a), op, b: Number(b), result: apply(a, op, b) }); break; }
    }
  }
  return found.length === 1 && Number.isFinite(found[0].result) ? found[0] : null;
}

/** Does subtracting b from a (or adding) need a regroup in any column? */
function needsRegroup(a, op, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return null;
  const da = String(a).split('').reverse().map(Number);
  const db = String(b).split('').reverse().map(Number);
  if (op === '+') {
    let carry = 0;
    for (let k = 0; k < Math.max(da.length, db.length); k += 1) {
      const s = (da[k] || 0) + (db[k] || 0) + carry;
      if (s > 9) return true;
      carry = 0;
    }
    return false;
  }
  if (['-', '−', '–'].includes(op)) {
    if (b > a) return null;
    for (let k = 0; k < db.length; k += 1) if ((da[k] || 0) < db[k]) return true;
    return false;
  }
  return null;
}

const REGROUP_WORD = /\b(regroup\w*|borrow\w*|carry(?:ing)?|carried|exchange)\b|ادھار|حاصل|ری\s?گروپ|regrouping/i;
const NEGATION = /\b(no|not|without|never|don'?t|doesn'?t)\b|بغیر|نہیں|ضرورت نہیں/i;

// A stem that asks for the sum's value (not about a step, a remainder or a mistake in it).
const ASKS_RESULT = /\b(?:what\s+is|find|calculate|work\s+out|solve|what\s+do\s+you\s+get|equals?|the\s+(?:sum|total|difference|product|answer))\b|=\s*\?|کیا\s+جواب|جواب\s+کیا|حاصل|کتنا\s+(?:ہے|ہو|بنے)|کتنے\s+(?:ہیں|ہوں|بچے|بنے)/i;

// A stem about a MISTAKE, a step or a property of the sum: its numbers are not a result to check.
const ABOUT_A_STEP = /\b(?:wrong|mistake|error|incorrect|student|says|said|remainder|decimal\s+places?|digits?|partial|step)\b|غلط|باقی|غلطی/i;

// ─── words ─────────────────────────────────────────────────────────────────
// A stem that points at something the child must SEE: DEICTIC words only
// ("look at the chart", "this picture", «اس تصویر», «تصویر میں»), never a bare
// noun — "the image in a mirror", «کتب خانہ» and "shown in the story" are fine
// questions. The list is the one measured on 12,136 sandbox stems for the web
// page's own guard (7 picture-less matches, all real), plus three forms from the
// pedagogy review it missed: "the clock shows", "how much of the bar is shaded",
// «خالی خانے». Quoted text is ignored.
const PIC_NOUN = '(?:picture|image|diagram|figure|drawing|chart|graph|clock|grid|map|shape|number line)s?';
const POINTS_AT_PICTURE = new RegExp([
  `\\b(?:look(?:ing)?\\s+at|see|in|from|use)\\s+(?:the|this|these|each)\\s+${PIC_NOUN}\\b`,
  `\\b(?:this|these|the\\s+following)\\s+${PIC_NOUN}\\b`,
  `\\b${PIC_NOUN}\\s+(?:below|above|here)\\b`,
  `\\b(?:shown|drawn)\\s+(?:here|in\\s+the\\s+${PIC_NOUN})\\b`,
  '\\bwhich\\s+(?:picture|image|drawing)\\b',
  '\\bthe\\s+(?:bar|grid|graph|chart|number line|picture|diagram)\\s+(?:shows?|is shaded|has)\\b',
  // a question about a clock, not a stem that states the time ("The clock shows 4 o'clock. After 1 hour…")
  '\\bwhat\\s+time\\s+(?:does|is)\\s+(?:the|this)\\s+clock\\b',
  '\\b(?:how much|what fraction|what part)\\s+of\\s+the\\s+(?:bar|grid|shape|circle|rectangle|square)\\s+is\\s+shaded\\b',
  '(?:اس|ان|یہ|دی\\s+گئی|نیچے\\s+دی\\s+گئی)\\s+(?:تصویر|تصویریں|تصویروں|خاکے|خاکہ|شکل)',
  '(?:تصویر|تصویریں|تصویروں|خاکے|خاکہ)\\s*(?:میں|کو\\s+دیکھ|دیکھ)',
  'خالی\\s+خان[ےہ]',
].join('|'), 'i');
// A picture the stem SUPPOSES ("If a diagram shows…"), DESCRIBES ("The image
// shows 2/6"), reads FROM ("according to the chart") or a part only a drawing
// has ("the shaded part", "labelled B"). A child on the web met "If a diagram
// shows four concentric circles…" with no diagram. Measured on 12,601
// picture-less sandbox stems: 12 more, every one a picture the child cannot
// see. Urdu nouns need a space before them: «پیراگراف» holds «گراف».
const VIS_NOUN = '(?:picture|image|diagram|figure|drawing|chart|graph|map|photo|illustration)s?';
const SUPPOSES_PICTURE = new RegExp([
  `\\b(?:if|when|suppose)\\s+(?:a|an|the|this|your)\\s+${VIS_NOUN}\\b`,
  `\\b(?:a|an|the)\\s+${VIS_NOUN}(?:\\s+of(?:\\s+[\\p{L}'’-]+){1,4}?)?\\s+(?:shows|showing|below|above|labell?ed)\\b`,
  `\\baccording\\s+to\\s+(?:the|this|a)\\s+${VIS_NOUN}`,
  `\\bas\\s+(?:shown|seen|drawn)\\s+(?:in|on)\\s+(?:the|this)\\s+${VIS_NOUN}`,
  '\\bshown\\s+in\\s+(?:red|blue|green|yellow|orange|purple|black|grey|gray|brown|pink)\\b',
  '\\bthe\\s+shaded\\s+(?:part|region|area|portion|section)\\b',
  '(?:^|\\s)(?:نقشے|نقشہ|گراف|چارٹ|ڈایاگرام|ڈائیگرام|ڈائگرام)\\s*(?:میں|پر|کے\\s+مطابق|کو\\s+دیکھ)',
  '(?:^|\\s)(?:تصویر|خاکے|خاکہ)\\s*(?:پر|کے\\s+مطابق|سے\\s+پتا)',
  '(?:اوپر|نیچے)\\s+(?:دی|دکھائی|بنی)\\s+(?:گئی|گئے|ہوئی)',
  'اگر\\s+(?:کسی\\s+|ایک\\s+)?(?:تصویر|خاکے|خاکہ|نقشے|گراف|شکل)',
].join('|'), 'iu');
/** "the part labelled B": a letter only a drawing can carry (case-sensitive on purpose). */
const LABEL_LETTER = /\b(?:[Ll]abell?ed|[Mm]arked)\s+(?:as\s+)?['"“‘]?[A-Z]['"”’]?(?=[\s.,?;:)]|$)/u;
const QUOTED = /[“"«][^”"»]*[”"»]/g;
const unquoted = (stem) => String(stem || '').replace(QUOTED, ' ');
const pointsAtPicture = (stem) => POINTS_AT_PICTURE.test(unquoted(stem));
/** Every phrasing that presupposes a picture: the measured list, plus (gates v2) a supposed or described one. */
const presupposesPicture = (stem) => pointsAtPicture(stem) || SUPPOSES_PICTURE.test(unquoted(stem)) || LABEL_LETTER.test(unquoted(stem));
const pictureWords = (stem) => {
  const s = unquoted(stem);
  return ((POINTS_AT_PICTURE.exec(s) || SUPPOSES_PICTURE.exec(s) || LABEL_LETTER.exec(s) || [''])[0]).trim();
};

// A question ABOUT the teacher (T23) asks what the teacher said, did or thought
// in class ("Why did the teacher predict…", «استاد نے کیا کہا؟»). A word problem
// that merely names a teacher is not one: on sandbox, 5 Oct 2026, an older gate
// rewrote "Zainab … She spends" into "The teacher spends", and a broad match
// here then refused every repair until the quiz died.
const TEACHER = '(?:the|your|our|my)\\s+(?:teacher|sir|miss|madam)(?:\'s)?';
const TEACHER_VERB = '(?:say|said|says|ask|asked|do|did|does|think|thought|predict|predicted|explain|explained|show|showed|write|wrote|draw|drew|want|wanted|mean|meant|tell|told|call|called|compare|compared|bring|brought|like|liked)';
const ABOUT_TEACHER = new RegExp([
  `\\b(?:why|what|how|when|where|which|who)\\b[^.?!]*\\b${TEACHER}\\b[^.?!]*\\b${TEACHER_VERB}\\b`,
  `\\b${TEACHER}\\s+(?:question|example|prediction|story|idea|answer)\\b`,
  '\\baccording to the teacher\\b',
  '(?:استاد|استانی|ٹیچر|معلم|معلمہ)\\s*(?:نے|کے\\s+مطابق|کی\\s+بات|کا\\s+سوال)[^؟?]*(?:کیوں|کیا|کون|کیسے|کس)',
].join('|'), 'i');

// A why that says the lesson never gave the answer ("no specific food was
// mentioned", «ذکر نہیں کیا گیا»): the key was made up, the question has no answer.
const NOT_IN_LESSON = /\bno\s+specific\s+\w+(?:\s+\w+)?\s+(?:was|were|is)\s+(?:mentioned|named|given|stated)\b|\b(?:the\s+)?(?:lesson|story|text|passage)\s+(?:did(?:n't|\s+not)|does(?:n't|\s+not))\s+(?:say|mention|name|state|tell)\b|\bnot\s+(?:mentioned|named|stated|given)\s+in\s+the\s+(?:lesson|story|text|passage)\b|خاص\s+\S+(?:\s+\S+){0,6}\s+(?:کا\s+)?(?:ذکر\s+نہیں|نام\s+نہیں\s+لیا)|سبق\s+میں\s+(?:اس\s+کا\s+)?(?:ذکر\s+نہیں|نہیں\s+بتایا)/i;

const ARABIC_LETTER = /^[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿][ً-ٰٟۖ-ۭ]*$/u;
const READ_PREFIX = /^\s*[(\[]?[A-Da-d][)\].:：]\s*/;

const optText = (q, k) => String((q.options || [])[k] ?? '').trim();

function hasFigure(q) {
  if (q.figure && typeof q.figure === 'object') return true;
  // Today's WhatsApp picture question: every option is a picture (emoji), no letter or digit.
  const opts = (q.options || []).map((o) => String(o ?? '').trim());
  if (opts.length && opts.every((o) => o && !/[\p{L}\p{N}]/u.test(o))) return true;
  const m = q.media || {};
  return Boolean(m.figure || m.image_url || m.question_image_url || (m.web && m.web.figure));
}

/** Numbers a figure spec carries, including the value a place-value spec draws. */
function figureNumbers(spec) {
  const out = new Set();
  const walk = (v) => {
    if (v == null) return;
    if (typeof v === 'number') { out.add(v); return; }
    if (typeof v === 'string') { numbersIn(v).forEach((n) => out.add(n)); return; }
    if (Array.isArray(v)) { v.forEach(walk); if (v.every((x) => typeof x === 'number')) out.add(v.length); return; }
    if (typeof v === 'object') {
      const h = Number(v.hundreds) || 0; const t = Number(v.tens) || 0; const o = Number(v.ones) || 0;
      const th = Number(v.thousands) || 0;
      if (h || t || o || th) out.add(th * 1000 + h * 100 + t * 10 + o);
      // a grid of rows × cols draws that many squares
      if (Number.isFinite(Number(v.rows)) && Number.isFinite(Number(v.cols))) out.add(Number(v.rows) * Number(v.cols));
      Object.values(v).forEach(walk);
    }
  };
  walk(spec);
  return out;
}

/**
 * The numbers a why ARRIVES at: a result after "=", and a place-value phrase
 * ("8 hundreds, 7 tens and 5 ones" / «۸ سینکڑے ۷ دہائیاں ۵ اکائیاں») read as 875.
 */
function claimedResults(text) {
  const t = plain(text);
  const out = (t.match(/=\s*(\d+(?:\.\d+)?)/g) || []).map((m) => Number(m.replace(/[^\d.]/g, '')));
  const part = (re) => { const m = re.exec(t); return m ? Number(m[1]) : null; };
  const h = part(/(\d+)\s*(?:hundreds?|سینکڑ\S*|سو\b)/i);
  const tn = part(/(\d+)\s*(?:tens?|دہائ\S*|دہا\S*)/i);
  const o = part(/(\d+)\s*(?:ones?|اکائ\S*|اکا\S*)/i);
  if ([h, tn, o].filter((x) => x != null).length >= 2) out.push((h || 0) * 100 + (tn || 0) * 10 + (o || 0));
  return out;
}

/** Each piece of a question that explains it: the why and the praise. */
function whyTexts(q) {
  const fb = q.option_feedback || {};
  return [q.explanation, fb.correct].map((t) => String(t || '')).filter(Boolean);
}

/**
 * Every v2 complaint for one question, in the validator's shape.
 * `q` is the question as the child sees it (question, options, correct_index,
 * explanation, option_feedback, figure).
 */
function questionErrors(q, i, ctx = {}) {
  const errs = [];
  const stem = String(q.question || '');
  const opts = (q.options || []).map((o) => String(o ?? ''));
  const ci = Number.isInteger(q.correct_index) ? q.correct_index : null;
  const key = ci == null ? '' : optText(q, ci);
  const whys = whyTexts(q);

  // 1. the sum the stem asks, against the key
  const sum = stemSum(stem);
  const keyNum = numberOf(key);
  const aboutStep = ABOUT_A_STEP.test(stem);
  const asksResult = !aboutStep && ASKS_RESULT.test(stem) && numbersIn(stem).every((n) => n === sum?.a || n === sum?.b);
  if (sum && asksResult && keyNum != null && opts.every((o) => numberOf(o) != null) && !close(sum.result, keyNum)
    && keyNum !== sum.a && keyNum !== sum.b) {
    errs.push(`q${i}: KEY_ARITHMETIC — ${sum.a} ${sum.op} ${sum.b} is ${sum.result}, but the key is "${key}"; make the key the true answer`);
  }
  // 2. every stated "a op b = c" in the key and the why
  if (!aboutStep) [key, ...whys].forEach((t) => wrongEquations(t).forEach((e) => {
    errs.push(`q${i}: WHY_ARITHMETIC — "${e}" is wrong; recompute every number in the key and the explanation`);
  }));
  // 3. the why lands on a wrong option's number and never on the key's
  if (keyNum != null && whys.length) {
    const said = new Set(whys.flatMap(numbersIn));
    const wrongNums = opts.map((o, k) => (k === ci ? null : numberOf(o))).filter((n) => n != null && !close(n, keyNum));
    const claimed = new Set(whys.flatMap(claimedResults));
    const stemNums = numbersIn(stem);
    // only what the why ARRIVES at ("= N", a place-value phrase): a number it merely mentions
    // ("100 has three digits: 1, 0 and 0") is not its answer
    const hit = aboutStep ? undefined : wrongNums.find((n) => claimed.has(n) && !stemNums.includes(n) || claimed.has(n) && /hundreds?|tens?|ones?|سینکڑ|دہائ|اکائ/i.test(whys.join(' ')));
    if (hit != null && !said.has(keyNum) && !claimed.has(keyNum)) {
      errs.push(`q${i}: WHY_CONTRADICTS_KEY — the explanation arrives at ${hit} (a wrong option), not the key "${key}"; the why must agree with its key`);
    }
  }
  // 4. a regroup the sum does not need
  if (sum) {
    const need = needsRegroup(sum.a, sum.op, sum.b);
    const claim = whys.find((t) => REGROUP_WORD.test(t) && !NEGATION.test(t));
    if (need === false && claim) {
      errs.push(`q${i}: REGROUP_CLAIM — ${sum.a} ${sum.op} ${sum.b} needs no regrouping in any column, but the explanation says it may; say what the child actually does`);
    }
  }
  // 5. the picture the stem points at
  const figured = hasFigure(q);
  if (!figured && presupposesPicture(stem) && !ctx.legacyPictureComplaint) {
    errs.push(`q${i}: PICTURE_MISSING — the stem points at a picture (${pictureWords(stem)}) but the question has none; add the "figure" or ask without it, so the question stands alone`);
  }
  // 6. the picture carries the stem's numbers
  if (figured && q.figure && typeof q.figure === 'object') {
    const have = figureNumbers(q.figure);
    const optNums = new Set(opts.map(numberOf).filter((n) => n != null));
    // "the subtraction in the picture": the numbers of the sum the why works on must be drawn too
    const pictured = pointsAtPicture(stem)
      ? whys.flatMap((t) => { EXPR_RE.lastIndex = 0; return [...plain(t).matchAll(EXPR_RE)].filter((m) => m[2] !== '/').flatMap((m) => [Number(m[1]), Number(m[3])]); })
      : [];
    const missing = [...new Set([...numbersIn(stem), ...pictured])].filter((n) => !have.has(n) && !optNums.has(n));
    if (missing.length) {
      errs.push(`q${i}: FIGURE_NUMBERS — the stem uses ${missing.join(', ')} but the picture's spec does not carry ${missing.length > 1 ? 'them' : 'it'}; draw every number the question needs`);
    }
  }
  // 6b. a key the lesson never gave
  const unknown = whys.find((t) => NOT_IN_LESSON.test(t));
  if (unknown) {
    errs.push(`q${i}: KEY_NOT_IN_LESSON — the explanation says the lesson never gave this answer; ask only what the lesson itself says, with its answer in the lesson`);
  }
  // 7. a question about the teacher
  if (ABOUT_TEACHER.test(stem)) {
    errs.push(`q${i}: ABOUT_TEACHER — the question asks what the teacher said, did or thought; ask about what the lesson taught instead, with the lesson's own example and never the teacher as a character`);
  }
  // 8. a throwaway option in an Urdu letter item
  if (key && ARABIC_LETTER.test(key) && /^\p{L}/u.test(key)) {
    const odd = opts.filter((o, k) => k !== ci && (/\d/.test(plain(o)) || /^[A-Za-z]$/.test(o.trim())));
    if (odd.length) {
      errs.push(`q${i}: THROWAWAY_OPTION — "${odd.join('", "')}" cannot be a letter answer; every wrong option must be a letter a child could confuse with "${key}"`);
    }
  }
  // 9. a word_blank is ONE word (a sentence draws as a row of unreadable tiles), and hides
  //    a letter the question must ask for
  const wbWord = q.figure && String(q.figure.type || '').toLowerCase() === 'word_blank' ? String(q.figure.word || '').trim() : '';
  if (/\s/.test(wbWord)) {
    errs.push(`q${i}: WORD_BLANK_NOT_A_WORD — the word_blank picture holds "${wbWord}", more than one word; a word_blank is one word with a letter hidden: use one word, or remove the figure`);
  }
  const blank = hiddenLetters(q.figure, { stem, language: ctx.language });
  if (blank && key && !blank.forms.some((f) => sameLetters(f, key))) {
    errs.push(`q${i}: WORD_BLANK_NOT_ASKED — the picture hides «${blank.hidden}» in «${String(q.figure.word)}», but the key is "${key}"; a word_blank asks which letter fills the blank: make the options letters and the key «${blank.hidden}», or remove the figure and ask without it`);
  }
  return errs;
}

/** Two spellings of one letter answer: case, marks, quotes and spacing aside. */
const KEY_MARKS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0610-\u061A\u200C-\u200F]/g;
const bareLetters = (t) => plain(t).normalize('NFC').toLowerCase().replace(KEY_MARKS, '').replace(/[^\p{L}\p{N}]/gu, '');
const sameLetters = (a, b) => bareLetters(a) !== '' && bareLetters(a) === bareLetters(b);

/**
 * "A: stone" read for option A → "stone". The web item prompt lists options as "A: stone", and a model
 * that copies the format does it for every option of every item: refused, a whole quiz lost its web items
 * (2 of 10 lessons on a real run). A prefix naming the option's OWN slot is only noise and is cut; one naming
 * another slot means the spoken options are out of order, and is left for readTextFaults to refuse.
 */
function stripOwnSlotPrefix(text, slot) {
  const t = String(text == null ? '' : text);
  const m = /^\s*[(\[]?([A-Da-d])[)\].:：]\s*/.exec(t);
  if (!m || String(m[1]).toUpperCase() !== String(slot || '').toUpperCase()) return text;
  const rest = t.slice(m[0].length);
  return /\S/.test(rest) ? rest : text;
}

/** Faults in the text the voice reads for a web item: a letter prefix ("A: …"). */
function readTextFaults(read) {
  if (!read || typeof read !== 'object') return [];
  const lines = [read.stem, ...(Array.isArray(read.opts) ? read.opts : [])].map((t) => String(t || ''));
  return lines.some((t) => READ_PREFIX.test(t) && /\S/.test(t.replace(READ_PREFIX, ''))) ? ['read_letter_prefix'] : [];
}

/**
 * The extra rule the blind solve carries with the flag on: the key must be
 * fully correct as a statement, never the least wrong option.
 */
const STRICT_KEY_RULE = 'FULLY CORRECT, NEVER THE CLOSEST. An option is correct only if it is a fully correct answer to the question exactly as asked — the right word form, tense, spelling, unit and number. If the true answer is not among the options (for example the past tense of "drink" is asked and only "drinking", "drinked", "drunk" are offered — "drunk" is the past participle, not the past tense), give an empty list. Never list the option that is merely closest.';

module.exports = {
  stripOwnSlotPrefix,
  refreshFlag,
  setEnabled,
  enabled,
  resetForTests,
  questionErrors,
  readTextFaults,
  STRICT_KEY_RULE,
  // exported for tests and the offline measure
  stemSum,
  wrongEquations,
  needsRegroup,
  numberOf,
  figureNumbers,
  POINTS_AT_PICTURE,
  pointsAtPicture,
  presupposesPicture,
};
