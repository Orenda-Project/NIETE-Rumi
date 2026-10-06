'use strict';
/**
 * Web quiz items (SCHEMA_v2): the question a child meets on the web page,
 * written from the same source as the WhatsApp question and stored BESIDE it.
 *
 * WhatsApp caps (button 20 code points, list rows 24/72) forced today's
 * question into one shape: three short text options, and a picture card with
 * the stem painted in when an option ran long. On the web none of that binds,
 * so a question can carry picture options, be heard by a child who cannot read
 * yet, or ask for an order or a set of pairs when the lesson taught one.
 *
 * THE RULE THAT KEEPS WHATSAPP SAFE: a web item never replaces the row. The
 * row's own columns (question_text, option_a..d, correct_option, explanation,
 * option_feedback) are written exactly as before and every gate in the
 * authoring pipeline has already run on them. The web item lives in
 * `media.web`, is written by ONE extra call after the quiz is final, and is
 * checked here in code. Anything that fails a check is simply not attached,
 * and that question plays on the web as the row it already is. Nothing here
 * can fail a quiz.
 *
 * Every item cites the moment of the lesson it tests (`source.quote`), and the
 * quote is looked up in the real transcript or lesson plan. A quote that is
 * not there is a question the model wrote from somewhere else, and is dropped.
 *
 * Off unless the teacher is on the web arm (web_quiz_enabled +
 * web_quiz_teachers) AND app_settings `web_quiz_items_v2` is true.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { texFaults, mathToText } = require('./quiz-math');
const GatesV2 = require('./quiz-author-gates-v2');
const Hint = require('./web-quiz-hint');
const { questionAddressForms } = require('./transcript-quiz-address');
const { LANG_NAME } = require('./transcript-quiz-language');
const {
  languageRule, MATH_NOTATION_RULE, ADJACENT_TERMS_RULE_TEXT, CHILD_ADDRESS_RULE_TEXT,
} = require('./web-quiz-items-rules');

const AuthorGates = require('./quiz-author-gates');
const ITEMS_KEY = 'web_quiz_items_v2';
const SLOTS = ['A', 'B', 'C', 'D'];

/** Types that keep the row's options and key (only richer). */
const SAME_TYPES = new Set(['single', 'picture', 'listen', 'multi']);
/** Types with their own options and key; WhatsApp keeps the row as a projection. */
const NEW_TYPES = new Set(['tf', 'order', 'match', 'label']);
const TYPES = new Set([...SAME_TYPES, ...NEW_TYPES]);
/** Ordered answers: the list of slots is compared position by position. */
const ORDERED = new Set(['order', 'match']);
/** The types the author is OFFERED in the pilot (no true/false in the pilot: two options are a coin flip; label waits for hotspots). */
const PILOT_TYPES = ['single', 'picture', 'listen', 'order', 'match'];
const MAX_NEW_PER_QUIZ = 2;          // per quiz (8 questions)
/** Not offered and not accepted in the pilot: a 2-option item is a coin flip. */
const NOT_IN_PILOT = new Set(['tf']);
const PRE_READER_STEM_WORDS = 8;

const STOP = new Set(('the a an and or of in on to is are was were be this that these those which what who how why when where '
  + 'for with from by it its as at do does did your you we our they their them has have had can will not no yes '
  + 'کے کی کا میں ہے ہیں سے کو اور یہ وہ ایک کون کیا کس کس نے پر بھی تو ہو گا گی گے تھا تھی تھے').split(/\s+/));

/** True when the quote shares a content word with the stem or the right answer (a quote can be real and still be about something else). */
function quoteOnTopic(quote, texts) {
  // A lone digit or Urdu letter is content (a sum's 7, the letter خ being taught); a lone Latin letter is not.
  const words = (t) => normWords(mathToText(String(t || ''))).filter((w) => (w.length >= 2 || /[\p{N}\u0600-\u06FF]/u.test(w)) && !STOP.has(w));
  const q = new Set(words(quote));
  const stem = (w) => w.replace(/(ing|ed|es|s)$/, '');
  const qs = new Set([...q].map(stem));
  return texts.some((t) => words(t).some((w) => q.has(w) || qs.has(stem(w))));
}

/** Wrong-option feedback lines that say the same thing twice teach nothing: keep none. */
function distinctFeedback(lines) {
  const real = lines.filter(Boolean).map((l) => l.trim().toLowerCase());
  return real.length < 2 || new Set(real).size === real.length;
}
const SOURCE_TEXT_MAX = 24000;

let pictogramSet = null;
function pictograms() {
  if (!pictogramSet) {
    // eslint-disable-next-line global-require
    const { names } = require('../../../vendor/lp-v9/diagrams/lib/pictogram');
    pictogramSet = new Set(names());
  }
  return pictogramSet;
}

// ─── the switch ──────────────────────────────────────────────────────────────

const TTL_MS = 30 * 1000;
let cache = null;

function isTrue(v) {
  let x = v;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch (_) { /* plain string */ } }
  return x === true || (typeof x === 'string' && x.trim().toLowerCase() === 'true');
}

async function itemsFlag(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [ITEMS_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || []).find((r) => r.key === ITEMS_KEY);
    cache = { at: now, on: Boolean(row) && isTrue(row.value) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ web quiz items: settings lookup failed — no web items', { error: err.message });
    return false;
  }
}

/** True when this teacher's next quiz should carry web items. Never throws; fails closed. */
async function webItemsOn(teacherUserId) {
  if (!(await itemsFlag())) return false;
  try {
    // eslint-disable-next-line global-require
    return await require('./web-quiz-link').webQuizOn(teacherUserId);
  } catch (_) { return false; }
}

// ─── the source span ────────────────────────────────────────────────────────

const TIMESTAMP = /^\s*\[(\d{1,2}:\d{2}(?::\d{2})?)\]/;
const MD_HEADING = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/;
const CAPS_LABEL = /^\s*([A-Z][A-Z0-9 ,'()\-—]{2,80}):/;
const URDU_DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };

function normWords(text) {
  return String(text || '')
    .replace(/[۰-۹]/g, (d) => URDU_DIGITS[d])
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, '')            // Arabic diacritics
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** A transcript line without its "[mm:ss]" and its "Speaker:" label. */
function speechOf(line) {
  return String(line).replace(TIMESTAMP, '').replace(/^\s*[^:\n]{1,24}:\s/, '');
}

/**
 * Find a quote in the source. 4-30 words; matched on normalised words
 * (case, punctuation, diacritics and Urdu digits do not matter), exactly or
 * with at most one word in eight different. Returns where it sits: the
 * transcript timestamp above it, or the lesson-plan section it is under.
 */
function locateSource(quote, { kind, text } = {}) {
  const q = normWords(quote);
  if (q.length < 4 || q.length > 40) return { ok: false };
  const lines = String(text || '').split(/\r?\n/);
  const toks = [];      // every source word
  const lineOf = [];    // the line each word sits on
  lines.forEach((line, li) => {
    const words = normWords(kind === 'transcript' ? speechOf(line) : line);
    words.forEach((w) => { toks.push(w); lineOf.push(li); });
  });
  const allowed = Math.floor(q.length / 8);
  let hit = -1;
  for (let i = 0; i + q.length <= toks.length && hit < 0; i += 1) {
    let miss = 0;
    for (let k = 0; k < q.length && miss <= allowed; k += 1) if (toks[i + k] !== q[k]) miss += 1;
    if (miss <= allowed) hit = i;
  }
  if (hit < 0) return { ok: false };
  const li = lineOf[hit];
  if (kind === 'transcript') {
    for (let j = li; j >= 0; j -= 1) {
      const m = TIMESTAMP.exec(lines[j]);
      if (m) return { ok: true, at: `[${m[1]}]` };
    }
    return { ok: true, at: null };
  }
  for (let j = li; j >= 0; j -= 1) {
    const h = MD_HEADING.exec(lines[j]) || CAPS_LABEL.exec(lines[j]);
    if (h) return { ok: true, section: h[1].trim() };
  }
  return { ok: true, section: null };
}

// ─── one item ───────────────────────────────────────────────────────────────

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const slotList = (v) => String(v || '').toUpperCase().split(',').map((s) => s.trim()).filter(Boolean);
const sortedSlots = (v) => String(v || '').toUpperCase().replace(/[^A-D]/g, '').split('').sort().join(',');

/** Plain words for the voice: no TeX, no backslashes, no dollars. */
function spoken(text) {
  return str(mathToText(String(text || ''))).replace(/[\\$]/g, '').replace(/\s+/g, ' ').trim();
}

function rowOptions(row) {
  return [row.option_a, row.option_b, row.option_c, row.option_d]
    .map((t, i) => ({ slot: SLOTS[i], text: t == null ? '' : String(t).trim() }))
    .filter((o) => o.text);
}

function bandOf(gradeBand) {
  const s = String(gradeBand || '');
  const n = Number((/\d+/.exec(s) || [])[0]);
  if (!Number.isFinite(n)) return '3-5';
  if (n <= 2) return '1-2';
  if (n <= 5) return '3-5';
  if (n <= 8) return '6-8';
  return '9-12';
}

function oneSentence(text, maxWords = 30) {
  const t = str(text);
  if (!t) return null;
  if (t.split(/\s+/).length > maxWords) return null;
  return t;
}

/**
 * A picture option must BE the thing its text names. Never a drawing on a single letter, a mark
 * or a number (those are glyph tiles, not pictures: a pomegranate on «الف» asks the child to
 * read the picture, not the letter). In a Latin-script option the word must name the drawing
 * (roster names are English); an Urdu option is trusted only when it is a word, not a letter.
 */
function picFits(text, pic) {
  const t = str(text);
  if ([...t.replace(/\s+/g, '')].length <= 1) return false;
  if (/^[\p{N}\s.,:/+\-−×÷=%]+$/u.test(t)) return false;
  if (/[A-Za-z]/.test(t)) {
    const stem = (w) => w.replace(/(es|s)$/, '');
    const words = new Set(normWords(t).map(stem));
    return pic.name.split('_').some((part) => words.has(stem(part)));
  }
  return true;
}

/** An option that IS a letter or a mark (خ, بّ, b): shown as a big tile in the page's own font, never as a drawing. */
function isGlyph(text) {
  const t = str(text);
  return t.length > 0 && [...t].length <= 3 && /^[\p{L}\p{M}]+$/u.test(t);
}

function validPic(name) {
  const n = str(name).toLowerCase();
  return n && pictograms().has(n) ? { kind: 'pictogram', name: n } : null;
}

function gateFaults(item, language) {
  const texts = [item.stem, item.why, item.fb_right, ...item.options.map((o) => o.text), ...item.options.map((o) => o.fb),
    ...(item.left || []).map((l) => l.text)].filter((t) => typeof t === 'string' && t);
  if (texts.some((t) => texFaults(t).length)) return 'maths';
  if (language === 'ur') {
    const wrong = {};
    item.options.forEach((o, i) => { if (o.fb) wrong[String(i)] = o.fb; });
    const forms = questionAddressForms({
      question: item.stem, options: item.options.map((o) => o.text), explanation: item.why,
      option_feedback: { correct: item.fb_right || '', wrong },
    }).forms;
    if (forms.length) return 'urdu_address';
  }
  return null;
}

/**
 * Turn the model's reply for ONE question into a SCHEMA_v2 item, or null with
 * the reason. `index` is the question's place in the quiz (0 = question 1).
 * @returns {{item: object|null, reason?: string}}
 */
function normaliseItem(raw, row, index, ctx = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const language = ctx.language || 'en';
  const band = bandOf(ctx.gradeBand);
  const gates = AuthorGates.authorGatesOn(ctx);
  if (NOT_IN_PILOT.has(r.type)) return { item: null, reason: 'not_in_pilot' };
  let type = TYPES.has(r.type) ? r.type : 'single';
  const rowIsMulti = String(row.correct_option || '').includes(',');
  if (rowIsMulti && SAME_TYPES.has(type)) type = 'multi';
  if (!rowIsMulti && type === 'multi') type = 'single';

  const src = ctx.source || {};
  const found = locateSource(r.source_quote, src);
  if (!found.ok) return { item: null, reason: 'source_not_found' };
  const source = { kind: src.kind || 'transcript', quote: str(r.source_quote), ...found };

  const base = rowOptions(row);
  const rowWrong = (row.option_feedback && row.option_feedback.wrong) || {};
  let item;

  if (SAME_TYPES.has(type)) {
    const pics = Array.isArray(r.pics) ? r.pics.map(validPic) : [];
    // quiz_author_gates_v2: two options drawn with the same pictogram are the same picture.
    const samePic = gates && new Set(pics.filter(Boolean).map((p) => p.name)).size < pics.filter(Boolean).length;
    const allPics = !samePic && base.length > 0 && base.every((o, i) => pics[i] && picFits(o.text, pics[i]));
    // Options that ARE letters or marks: glyph tiles, heard by name (a pre-reader's letter question).
    const glyphs = base.length > 0 && base.every((o) => isGlyph(o.text));
    if (glyphs) {
      base.forEach((o, i) => { pics[i] = { kind: 'glyph', text: o.text }; });
      type = band === '1-2' ? 'listen' : 'picture';
    } else if ((type === 'picture' || type === 'listen') && !allPics) type = 'single';
    if (type === 'listen' && band !== '1-2') type = 'picture';
    let readOpts = Array.isArray(r.read && r.read.opts) ? r.read.opts : [];
    // quiz_author_gates_v2: the voice says the label that is DRAWN (P, Q, R), never "Picture A".
    if (gates) readOpts = readOpts.map((t) => (AuthorGates.PICTURE_N.test(str(t)) ? '' : t));
    // Gates v2: "A: stone" read for option A is the prompt's own format copied back — cut it, keep the item.
    if (GatesV2.enabled(ctx.authorGates)) readOpts = readOpts.map((t, i) => (base[i] ? GatesV2.stripOwnSlotPrefix(t, base[i].slot) : t));
    const fbDistinct = distinctFeedback(base.map((_, i) => str(rowWrong[String(i)])));
    item = {
      v: 2, type, stem: String(row.question_text || '').trim(),
      options: base.map((o, i) => {
        const opt = { slot: o.slot, text: o.text };
        if (type === 'picture' || type === 'listen') opt.pic = pics[i];
        const fb = str(rowWrong[String(i)]);
        if (fb && fbDistinct) opt.fb = fb;
        opt.name = spoken(readOpts[i]) || spoken(o.text);
        return opt;
      }),
      key: rowIsMulti ? sortedSlots(row.correct_option) : String(row.correct_option || '').trim().toUpperCase(),
      why: oneSentence(r.why) || str(row.explanation) || null,
      fb_right: str(row.option_feedback && row.option_feedback.correct) || null,
      wa: { from: 'same' },
    };
  } else {
    if (index === 0) return { item: null, reason: 'q1_new_type' };
    const opts = (Array.isArray(r.options) ? r.options : []).map((o) => str(o && typeof o === 'object' ? o.text : o));
    if (opts.some((t) => !t)) return { item: null, reason: 'shape' };
    const key = slotList(r.key);
    const n = opts.length;
    const inRange = key.every((s) => SLOTS.indexOf(s) >= 0 && SLOTS.indexOf(s) < n);
    const isPerm = key.length === n && new Set(key).size === n && inRange;
    let left = null;
    if (type === 'order' && !(n >= 3 && n <= 4 && isPerm)) return { item: null, reason: 'shape' };
    if (type === 'match') {
      left = (Array.isArray(r.left) ? r.left : []).map((l) => ({ text: str(l && typeof l === 'object' ? l.text : l) }));
      if (!(n >= 3 && n <= 4 && left.length === n && left.every((l) => l.text) && isPerm)) return { item: null, reason: 'shape' };
    }
    if (type === 'tf' && !(n === 2 && key.length === 1 && inRange)) return { item: null, reason: 'shape' };
    if (type === 'label') {
      const hs = r.hotspots || (row.media && row.media.web_hotspots);
      if (!Array.isArray(hs) || hs.length < 3) return { item: null, reason: 'label_no_hotspots' };
    }
    if (!oneSentence(r.why)) return { item: null, reason: 'no_why' };
    const fb = r.fb && typeof r.fb === 'object' ? r.fb : {};
    let readOpts = Array.isArray(r.read && r.read.opts) ? r.read.opts : [];
    if (GatesV2.enabled(ctx.authorGates)) readOpts = readOpts.map((t, i) => GatesV2.stripOwnSlotPrefix(t, SLOTS[i]));
    item = {
      v: 2, type, stem: str(r.stem),
      options: opts.map((text, i) => {
        const o = { slot: SLOTS[i], text, name: spoken(readOpts[i]) || spoken(text) };
        if (str(fb[String(i)])) o.fb = str(fb[String(i)]);
        return o;
      }),
      ...(left ? { left } : {}),
      key: key.join(','),
      why: oneSentence(r.why),
      fb_right: str(r.fb_right) || null,
      wa: { from: 'projected' },
    };
    if (!item.stem) return { item: null, reason: 'shape' };
    if (!distinctFeedback(item.options.map((o) => o.fb))) item.options.forEach((o) => { delete o.fb; });
    if (band === '1-2' && item.stem.split(/\s+/).filter(Boolean).length > PRE_READER_STEM_WORDS) return { item: null, reason: 'stem_too_long' };
  }

  // What the item is ABOUT: its stem, its right answer and why that answer is right (the row's
  // explanation and the item's own why) — a worked-procedure quote shares its words with the why.
  const keyTexts = item.wa.from === 'same'
    ? [item.stem, ...item.options.filter((o) => slotList(item.key).includes(o.slot)).map((o) => o.text), row.explanation, item.why]
    : [item.stem, ...item.options.map((o) => o.text), ...(item.left || []).map((l) => l.text), item.why];
  if (!quoteOnTopic(source.quote, keyTexts)) return { item: null, reason: 'source_off_topic' };

  const fault = gateFaults(item, language);
  if (fault) return { item: null, reason: fault };

  item.read = {
    stem: spoken((r.read && r.read.stem) || item.stem),
    opts: item.options.map((o) => o.name),
  };
  // Gates v2: the voice never reads an option letter ("A: …"); the row plays instead.
  if (GatesV2.enabled(ctx.authorGates) && GatesV2.readTextFaults(item.read).length) return { item: null, reason: 'read_letter_prefix' };
  if (row.media && row.media.figure && item.wa.from === 'same') {
    item.figure = { spec: row.media.figure, origin: { kind: 'quiz' } };
  }
  item.source = source;
  item.slo_id = (/^tq:[^:]+:([^:]+):/.exec(String(row.external_id || '')) || [])[1] || null;
  item.grade_fit = {
    band,
    reading: band === '1-2' ? 'pre' : band === '3-5' ? 'early' : 'fluent',
    stem_words: item.stem.split(/\s+/).filter(Boolean).length,
    note: str(r.grade_note) || null,
  };
  // A pre-reader's long stem is carried by the voice (read.stem); flagged so the page can lead with the speaker.
  if (band === '1-2' && item.grade_fit.stem_words > PRE_READER_STEM_WORDS) item.grade_fit.long_stem = true;
  // Gates v2: Jugnu's hint, held to the leak check (web-quiz-hint). A leaking hint is dropped alone.
  if (GatesV2.enabled(ctx.authorGates) && r.hint) {
    const h = Hint.hintFor(r.hint, item, spoken);
    if (h.hint) item.hint = h.hint;
    else return { item, hintDropped: h.reason };
  }
  return { item };
}

/** At most two of the new types per quiz; the rest play as their rows. */
function capNewTypes(items) {
  let n = 0;
  return items.map((it) => {
    if (!it || !NEW_TYPES.has(it.type)) return it;
    n += 1;
    return n <= MAX_NEW_PER_QUIZ ? it : null;
  });
}

// ─── grading and the page payload ───────────────────────────────────────────

function webOf(q) {
  const w = q && q.media && q.media.web;
  if (w && w.v === 2 && TYPES.has(w.type) && w.key) return w;
  // A WhatsApp match question (a lettered drawing, options coding whole pairings)
  // plays as the page's tap-to-match, decoded from its own figure and key.
  return q ? require('./web-quiz-figure').matchItem(q) : null;
}

/** One grader for both channels' rows: the web key when there is a web item, else the row's. */
function isCorrect(q, slot) {
  const w = webOf(q);
  if (w && ORDERED.has(w.type)) return slotList(slot).join(',') === slotList(w.key).join(',');
  if (w) return sortedSlots(slot) === sortedSlots(w.key);
  return sortedSlots(slot) === sortedSlots(q && q.correct_option);
}

/** The key the review shows: ordered for order/match, else as today. */
function keyFor(q) {
  const w = webOf(q);
  if (w && ORDERED.has(w.type)) return slotList(w.key).join(',');
  return w ? sortedSlots(w.key) : sortedSlots(q && q.correct_option);
}

/**
 * What E2 adds to a question that carries a web item (null when none). The
 * source QUOTE stays on the server: classroom talk does not go to a public page.
 * Picture options go as stored ({kind, name}); the figure module draws them.
 */
function webPayload(q) {
  const w = webOf(q);
  if (!w) return null;
  return {
    type: w.type,
    text: w.stem,
    options: w.options.map((o) => ({
      slot: o.slot, text: o.text, ...(o.pic ? { pic: o.pic } : {}), ...(o.name ? { name: o.name } : {}), ...(o.fb ? { fb: o.fb } : {}),
    })),
    ...(w.left ? { left: w.left } : {}),
    correct_slot: keyFor(q),
    why: w.why || null,
    fb_right: w.fb_right || null,
    read: w.read || null,
    source: w.source ? { kind: w.source.kind, at: w.source.at || null, section: w.source.section || null } : null,
    ...(w.type === 'multi' ? { multi: true } : {}),
    ...(w.hint && w.hint.text ? { hint: { text: w.hint.text } } : {}),
  };
}

// ─── the call ───────────────────────────────────────────────────────────────

function buildPrompt(rows, ctx) {
  const language = ctx.language || 'en';
  const band = bandOf(ctx.gradeBand);
  const srcKind = (ctx.source && ctx.source.kind) === 'lesson_plan' ? 'lesson_plan' : 'transcript';
  const srcText = String((ctx.source && ctx.source.text) || '').slice(0, SOURCE_TEXT_MAX);
  // Gates v2: the hint is in the reply template too — a model fills the fields its template shows.
  const hintTpl = GatesV2.enabled(ctx.authorGates) ? '"hint": "", ' : '';
  const qs = rows.map((r, i) => ({
    q: i,
    question: r.question_text,
    options: rowOptions(r).map((o) => `${o.slot}: ${o.text}`),
    correct: r.correct_option,
    explanation: r.explanation,
    has_figure: Boolean(r.media && r.media.figure),
  }));
  return `These ${rows.length} quiz questions are FINAL: they were written from one real lesson and have passed every check. A child will now meet them on a WEB PAGE on a cheap phone instead of in WhatsApp. On the web there are no length limits: the text stays text, options can be PICTURES, the page can read everything aloud, and a few new kinds of question are possible. Your job is to prepare each question for that page. For a "single", "picture" or "listen" item you never change the question, its options or its correct answer. An "order" or "match" item is a NEW question on the SAME moment of the lesson, and it is often the better question for that moment: a web page can ask a child to rebuild a whole sequence or link every pair, which a WhatsApp button never could. In a quiz whose lesson taught a sequence or linked pairs, aim for ONE such item.

QUIZ LANGUAGE: ${LANG_NAME[language] || 'Urdu'}. ${languageRule(language)}
GRADE BAND: ${band}${band === '1-2' ? ' — many of these children cannot read yet: they will HEAR the question and the options, so pictures carry the options wherever the options are things a child can see.' : ''}
SUBJECT: ${ctx.subject || 'unknown'}

FOR EVERY QUESTION return one item:
- "q": the question's number as given.
- "source_quote": 6 to 25 CONSECUTIVE words copied EXACTLY, letter for letter, from ONE line of the ${srcKind === 'lesson_plan' ? 'LESSON PLAN' : 'TRANSCRIPT'} below — the moment of the lesson that TAUGHT what this question tests (the explanation, the rule, the worked example, the fact as it was said). Copy, never paraphrase, never translate: the quote is looked up in the source and an item whose quote is not there is thrown away. NEVER copy the question itself, and never quote across two lines; leave out any "[mm:ss]" and the speaker's name. A question whose example was invented still tests an idea the lesson taught: quote where it was taught.
- "type": one of ${PILOT_TYPES.join(', ')}:
  * "single": the question as it is (the default).
  * "picture": EVERY option is a concrete thing a child can see (an animal, a fruit, an object, a shape) AND a name on the PICTOGRAM LIST below draws it. Give "pics": one pictogram name per option, in the options' order. If even one option cannot be drawn by a name on the list, use "single" — never stretch a name to something it does not show.
  * "listen": grades 1-2 only: as "picture", for a child who will hear the question rather than read it.
  * "order": ONLY when the lesson taught a SEQUENCE (the steps of a method, a life cycle, the events of a story, numbers in order) that has exactly one right order. Write a NEW item that tests the same moment: "stem" (e.g. "Put these in the order they happen."), "options": 3 or 4 steps as {"text"} listed in a MIXED order, "key": the option letters in the RIGHT order ("C,A,D,B"), "why" and "fb_right". The original question still goes to WhatsApp children. Never for a single fact.
  * "match": ONLY when the lesson linked 3 or 4 PAIRS (an animal and its home, a word and its meaning, a shape and its number of sides). "left": the 3-4 left items as {"text"}; "options": their partners as {"text"} in a MIXED order; "key": for left item 1, 2, 3(, 4) in turn, the letter of its partner ("B,C,A"). Not for grades 1-2. Never invent pairs the lesson did not teach.
  At most TWO questions in the whole quiz may be "order" or "match", and NEVER question 0 (the first question stays an easy pick).
  WHAT THE WEB CAN ASK BETTER — look for these and use them where they fit:
  * A question that asks for ONE step of a sequence the lesson taught ("which is the first step", "what comes after X", "what happens last") tests a single step; as an "order" item the child rebuilds the whole sequence the lesson taught. When the lesson taught a sequence, turn ONE such question into "order".
  * A question that asks for ONE pair the lesson linked becomes "match" when the lesson linked at least three pairs.
  * Grades 1-3: whenever every option is a thing on the pictogram list, use "picture" (grades 1-2: "listen").
- "read": {"stem": the question as it should be SPOKEN, "opts": each option as spoken} — plain words a voice can say: no symbols, no $, no letters for options ("three quarters", not "3/4"; «تین چوتھائی»).
- "why": ONE short sentence a child of this grade understands, saying why the right answer is right BY THE SUBJECT (never "the teacher said").
- "grade_note": at most 12 words on why this item suits the grade (reading load, picture, voice).
- For "order"/"match" only: "fb": {"<option index>": one sentence for a likely wrong step/pair, naming the confusion in child words}.
${GatesV2.enabled(ctx.authorGates) ? `${Hint.HINT_RULE}\n` : ''}- NEVER call an option by its letter in any text a child sees. NEVER put the question's words into a picture.
${MATH_NOTATION_RULE}
${language === 'ur' ? `${ADJACENT_TERMS_RULE_TEXT}\n${CHILD_ADDRESS_RULE_TEXT}` : ''}

PICTOGRAM LIST (the only names a picture option may use): ${[...pictograms()].join(', ')}

THE QUESTIONS:
${JSON.stringify(qs)}

THE ${srcKind === 'lesson_plan' ? 'LESSON PLAN' : 'TRANSCRIPT'}:
${srcText}

Return ONLY this JSON object:
{ "items": [ { "q": 0, "type": "single", "source_quote": "", "read": { "stem": "", "opts": ["", "", ""] }, "why": "", ${hintTpl}"grade_note": "" },
             { "q": 1, "type": "picture", "pics": ["apple", "banana", "carrot"], "source_quote": "", "read": { "stem": "", "opts": ["", "", ""] }, "why": "", ${hintTpl}"grade_note": "" },
             { "q": 4, "type": "order", "stem": "", "options": [ { "text": "" }, { "text": "" }, { "text": "" } ], "key": "B,C,A", "fb": { "0": "" }, "fb_right": "", "source_quote": "", "read": { "stem": "", "opts": ["", "", ""] }, "why": "", ${hintTpl}"grade_note": "" } ] }`;
}

/**
 * The one extra call. Returns NEW row objects (the input is not touched) with
 * `media.web` on every question that passed, and what happened, for the log.
 * Never throws.
 */
async function attachWebItems(rows, ctx = {}, { complete = null } = {}) {
  const t0 = Date.now();
  const stats = { attached: 0, types: {}, dropped: {}, hints: 0, hint_dropped: {}, cost_usd: 0, latency_ms: 0, model: null };
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return { rows: list, stats };
  // eslint-disable-next-line global-require
  const call = complete || require('./transcript-quiz-llm').completeJson;
  let json;
  try {
    const out = await call({ prompt: buildPrompt(list, ctx), label: 'web_quiz.items' });
    json = out && out.json;
    stats.cost_usd = Number(out && out.costUsd) || 0;
    stats.model = (out && out.model) || null;
  } catch (err) {
    stats.error = err.message;
    stats.latency_ms = Date.now() - t0;
    logToFile('⚠️ web quiz items: the call failed — the quiz plays as its rows', { quizId: ctx.quizId, error: err.message });
    return { rows: list, stats };
  }
  const replies = new Map();
  (Array.isArray(json && json.items) ? json.items : []).forEach((it) => {
    const q = Number(it && it.q);
    if (Number.isInteger(q) && !replies.has(q)) replies.set(q, it);
  });
  const drop = (reason) => { stats.dropped[reason] = (stats.dropped[reason] || 0) + 1; };
  const items = list.map((row, i) => {
    const raw = replies.get(i);
    if (!raw) { drop('no_reply'); return null; }
    const { item, reason, hintDropped } = normaliseItem(raw, row, i, ctx);
    if (!item) drop(reason);
    if (hintDropped && hintDropped !== 'none') stats.hint_dropped[hintDropped] = (stats.hint_dropped[hintDropped] || 0) + 1;
    return item;
  });
  const capped = capNewTypes(items);
  capped.forEach((it, i) => { if (items[i] && !it) drop('cap'); });
  const out = list.map((row, i) => {
    const it = capped[i];
    if (!it) return row;
    stats.attached += 1;
    stats.types[it.type] = (stats.types[it.type] || 0) + 1;
    if (it.hint) stats.hints += 1;
    return { ...row, media: { ...(row.media || {}), web: it } };
  });
  stats.latency_ms = Date.now() - t0;
  logEvent('web_quiz.items_attached', { quizId: ctx.quizId || null, ...stats, types: JSON.stringify(stats.types), dropped: JSON.stringify(stats.dropped), hint_dropped: JSON.stringify(stats.hint_dropped) });
  return { rows: out, stats };
}

/**
 * The generation hook: web items only when switched on for this teacher.
 * Returns the rows to insert and the stats (null when off). Never throws.
 */
async function maybeAttach(rows, ctx = {}) {
  try {
    if (!(await webItemsOn(ctx.teacherId))) return { rows, stats: null };
    return await attachWebItems(rows, ctx);
  } catch (err) {
    logToFile('⚠️ web quiz items: skipped', { quizId: ctx.quizId, error: err.message });
    return { rows, stats: null };
  }
}

module.exports = {
  webItemsOn, maybeAttach, attachWebItems, normaliseItem, locateSource, capNewTypes, isCorrect, keyFor, webPayload, buildPrompt,
  TYPES, NEW_TYPES, PILOT_TYPES, NOT_IN_PILOT, ITEMS_KEY,
  __resetCache: () => { cache = null; },
};
