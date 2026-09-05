'use strict';
/**
 * Transcript quiz — the deterministic validator.
 *
 * Runs on every authored quiz BEFORE a single row is stored. The author
 * prompt asks for these properties; this file enforces them, because a model
 * complies most of the time and freestyles the rest (root rule 24c). Pure:
 * questions in, { ok, errors, questions } out. No network, no DB.
 *
 * The property list is the one the offline eval converged on across nine
 * flash-tier models and forty real transcripts — each check below caught a
 * real failure in that run.
 */

const { checkReligiousMarks, cpLen } = require('./religious-marks');
const { canonicalSubject, fixQuestionTransliterations } = require('./transcript-quiz-language');
const { renderFigureSvg, figureLeaksAnswer, figureEmptyReason, svgInkCount, figureIsRedundant, unknownColourToken, figureMismatch, MATHS_ONLY_TYPES } = require('./transcript-quiz-figure');
const { canonicalSubject: canonSubj } = require('./transcript-quiz-language');

const MIN_QUESTIONS = 6;
const MAX_QUESTIONS = 10;
const STEM_MAX = 200;        // a list body carries 1024, but a stem past this is not a child's question
const OPTION_MAX = 72;       // Meta's list-row description cap, in code points
const LEVELS = { recall: 0, understand: 1, apply: 2 };

// Roman Urdu tokens: three or more of these in an "Urdu" quiz means the model
// wrote Urdu in Latin letters, which no child reads comfortably.
const ROMAN_URDU = new Set(['hai', 'hain', 'aur', 'kya', 'nahi', 'nahin', 'kaun', 'kounsa', 'konsa', 'kis',
  'kiya', 'yeh', 'woh', 'mein', 'main', 'ko', 'ka', 'ki', 'ke', 'se', 'par', 'bhi', 'toh', 'hota', 'hoti',
  'karo', 'karen', 'kitna', 'kitne', 'kahan', 'kab', 'batao', 'sahi', 'ghalat', 'galat', 'paude', 'hissa', 'mitti', 'neeche']);

// Gendered address. A child of unknown gender is "آپ" with plural-respectful
// verbs; these stems guess. Both feminine and masculine guesses are banned.
const FEM_STEMS = /(کرتی ہیں|چاہتی ہیں|کریں گی|رہی ہوں گی|سکتی ہیں|بتاتی ہیں|سوچتی ہیں|جانتی ہیں|سمجھتی ہیں|کرتی ہو|سکتی ہو|ہو گی)/;

// English technical terms belong in English letters inside Urdu (operator
// rule: "Urdu written well, English terms in English"). Speech-to-text spells
// them in Urdu letters and a model copies that. The common maths / science /
// grammar ones are listed; a hit sends the quiz back for a rewrite.
const TRANSLIT_TERMS = /(فیکشن|فریکشن|نیومریٹر|نمبریٹر|ڈینومینیٹر|ڈینامینیٹر|پروپر\s|امپروپر|ٹائپس|سبٹریکشن|ایڈیشن|ملٹیپلیکیشن|ملٹی\s*پلیکیشن|ڈویژن|فوٹو\s*سنتھیسز|ایکو\s*سسٹم|نائون|پروناؤن|ایڈجیکٹو|سینٹینس|ورب\b|ٹرائی\s*اینگل|ریکٹینگل|سرکل\b|ایریا\b|پیری\s*میٹر|ڈیجٹ|پلیس\s*ویلیو|ایون\b|آڈ\b|میٹر\b|کلوگرام|ٹمپریچر|انرجی|میٹیریل|سالڈ\b|لیکوئڈ|گیس\b)/;

// WhatsApp picks a message's direction from its FIRST strong character. An
// Urdu stem, explanation or feedback that opens with an English word is laid
// out left-to-right and reads scrambled on the phone. Options are exempt: a
// one-word English option ("numerator") is a button title.
const LATIN_FIRST = /^[\s"'«(]*[A-Za-z]/;

/**
 * An Urdu sentence that opens with an English word is laid out LEFT-to-right
 * by the phone: the Unicode bidi algorithm takes the paragraph direction from
 * the first strong character. Rejecting such sentences failed both attempts
 * on every "Types of Fractions" lesson — the English term IS the subject and
 * the model keeps leading with it. A RIGHT-TO-LEFT MARK (U+200F) as the first
 * character is a strong RTL character with no width, so the paragraph is laid
 * out RTL and the English run sits inside it in reading order. Same fix the
 * catalog uses for strings that open with a placeholder.
 */
const RLM = '\u200F';
function rtlOpen(t) {
  const str = String(t ?? '');
  if (!str.trim() || str.startsWith(RLM)) return str;
  return LATIN_FIRST.test(str) && /[؀-ۿ]/.test(str) ? RLM + str : str;
}
function rtlOpenQuestion(q) {
  const fb = q.option_feedback || { correct: '', wrong: {} };
  const wrong = {};
  Object.entries(fb.wrong || {}).forEach(([k, v]) => { wrong[k] = rtlOpen(v); });
  return {
    ...q,
    question: rtlOpen(q.question),
    options: Array.isArray(q.options) ? q.options.map(rtlOpen) : q.options,
    explanation: rtlOpen(q.explanation),
    option_feedback: { ...fb, correct: rtlOpen(fb.correct), wrong },
  };
}

// Letters are shuffled before display, so any letter reference is wrong by
// the time a child reads it.
const LETTER_REF = /\b[A-D]\)|\b(answer|option)\s+(is\s+)?[A-D]\b|آپشن\s*[A-D]\b|جواب\s*[A-D]\b/i;

// A stem that promises a picture and does not carry one asks a child to read
// something that is not there. Both scripts, because the quiz language and the
// teacher's language are decided separately.
const STEM_PROMISES_PICTURE =
  /\b(in|on|from) the (picture|image|diagram|figure|graph|chart|number ?line)\b|\bshown (above|below|here)\b|\bpictured\b|تصویر|خاکہ|خاکے|شکل میں/i;

// No more than half the questions may carry a figure. A quiz that is mostly
// pictures stops testing the lesson and starts testing picture-reading.
const FIGURE_MAX_SHARE = 0.5;

function scriptRatio(s) {
  const letters = [...String(s || '')].filter((c) => /\p{L}/u.test(c));
  if (!letters.length) return 1;
  const ar = letters.filter((c) => /[؀-ۿﭐ-﷿ﹰ-﻿]/.test(c)).length;
  return ar / letters.length;
}

/**
 * Accept the shapes models actually emit for option_feedback and return the
 * canonical { correct, wrong: { '<idx>': text } }. Seen in the eval:
 *   - flat: { correct, "1": …, "2": … }              (gemini-2.5-flash, 3.5-flash-lite)
 *   - list: wrong: [{ index, text }] or ["…", "…"]   (deepseek)
 *   - numeric keys                                    (everyone)
 */
function normaliseFeedback(q) {
  const out = { ...q };
  const fb = (q && typeof q.option_feedback === 'object' && q.option_feedback) ? { ...q.option_feedback } : {};
  const ci = Number(q?.correct_index);
  const wrongIdx = [0, 1, 2].filter((i) => i !== ci);
  let wrong = fb.wrong;

  if (Array.isArray(wrong)) {
    const w = {};
    wrong.forEach((item, pos) => {
      if (item && typeof item === 'object') {
        const k = item.index ?? item.idx ?? item.option ?? wrongIdx[pos];
        w[String(k)] = String(item.text ?? item.feedback ?? item.message ?? '');
      } else {
        w[String(wrongIdx[pos])] = String(item ?? '');
      }
    });
    wrong = w;
  } else if (wrong && typeof wrong === 'object') {
    const w = {};
    Object.entries(wrong).forEach(([k, v]) => { w[String(k)] = typeof v === 'string' ? v : String(v?.text ?? v ?? ''); });
    wrong = w;
  } else {
    // Flat shape: numeric keys sit beside "correct".
    const w = {};
    Object.entries(fb).forEach(([k, v]) => { if (/^\d+$/.test(k)) w[k] = String(v ?? ''); });
    wrong = w;
  }
  const correct = typeof fb.correct === 'string' ? fb.correct : String(fb.correct?.text ?? fb.correct ?? '');
  out.option_feedback = { correct, wrong };
  return out;
}

function validate(rawQuestions, { language, subject, digest, nExpected } = {}) {
  const errs = [];
  if (!Array.isArray(rawQuestions) || !rawQuestions.length) {
    return { ok: false, errors: ['no questions'], questions: [] };
  }
  const qs = rawQuestions.map(normaliseFeedback)
    .map((q) => (language === 'ur' ? rtlOpenQuestion(fixQuestionTransliterations(q)) : q));
  if (qs.length < MIN_QUESTIONS || qs.length > MAX_QUESTIONS) {
    errs.push(`count ${qs.length} outside ${MIN_QUESTIONS}..${MAX_QUESTIONS}${nExpected ? ` (asked for ${nExpected})` : ''}`);
  }

  const slos = (digest && Array.isArray(digest.slos)) ? digest.slos : [];
  const sloIds = new Set(slos.map((s) => s.id));
  const taught = new Map(slos.map((s) => [s.id, LEVELS[s.taught_level] ?? 1]));
  const covered = new Set();
  let atOrBelow = 0;
  let figured = 0;
  const allText = [];

  qs.forEach((q, i) => {
    const opts = Array.isArray(q.options) ? q.options.map((o) => String(o ?? '').trim()) : [];
    if (opts.length !== 3) errs.push(`q${i}: ${opts.length} options`);
    if (opts.some((o) => !o)) errs.push(`q${i}: empty option`);
    if (new Set(opts).size !== opts.length) errs.push(`q${i}: duplicate options`);
    const ci = q.correct_index;
    if (![0, 1, 2].includes(ci)) errs.push(`q${i}: bad correct_index ${ci}`);
    const fb = q.option_feedback || { correct: '', wrong: {} };
    const need = [0, 1, 2].filter((k) => k !== ci).map(String).sort();
    const have = Object.keys(fb.wrong || {}).sort();
    if (have.join(',') !== need.join(',')) errs.push(`q${i}: wrong-feedback keys [${have}] != [${need}]`);
    if (need.some((k) => !String(fb.wrong?.[k] || '').trim())) errs.push(`q${i}: empty wrong feedback`);
    if (!String(fb.correct || '').trim()) errs.push(`q${i}: empty correct feedback`);
    const stem = String(q.question || '').trim();
    if (!stem) errs.push(`q${i}: empty stem`);
    if (cpLen(stem) > STEM_MAX) errs.push(`q${i}: stem >${STEM_MAX} code points`);
    opts.forEach((o) => { if (cpLen(o) > OPTION_MAX) errs.push(`q${i}: option >${OPTION_MAX} code points`); });

    if (sloIds.has(q.slo_id)) covered.add(q.slo_id);
    else if (sloIds.size) errs.push(`q${i}: unknown slo_id ${q.slo_id}`);
    const lv = LEVELS[q.level] ?? 1;
    const tl = taught.has(q.slo_id) ? taught.get(q.slo_id) : 1;
    if (lv <= tl) atOrBelow += 1;
    if (lv > tl + 1) errs.push(`q${i}: level ${q.level} > taught ${slos.find((s) => s.id === q.slo_id)?.taught_level || 'understand'}+1`);

    const texts = [stem, String(q.explanation || ''), String(fb.correct || ''), ...opts, ...Object.values(fb.wrong || {}).map(String)];
    if (language === 'en') {
      // The mirror of the Urdu script check. The teacher chose English on a
      // lesson taught in Urdu and the model answered in Urdu — nothing objected.
      const stemAndOptions = [stem, ...opts].join(' ');
      const letters = [...stemAndOptions].filter((c) => /\p{L}/u.test(c));
      const latin = letters.filter((c) => /[A-Za-z]/.test(c)).length;
      if (letters.length && latin / letters.length < 0.7) {
        errs.push(`q${i}: an English quiz must be written in English — the stem and options are mostly not Latin script`);
      }
    }
    allText.push(...texts);
    if (texts.some((t) => LETTER_REF.test(t))) errs.push(`q${i}: letter reference`);

    // ── the figure, if this question carries one ────────────────────────────
    // Each check gets its OWN error string: the retry prompt quotes these back
    // verbatim, and "bad figure" would send the model re-rolling blind.
    if (q.figure == null) {
      if (STEM_PROMISES_PICTURE.test(stem)) {
        errs.push(`q${i}: FIGURE_MISSING — the stem talks about a picture but the question has no "figure"`);
      }
      return;
    }
    figured += 1;
    if (typeof q.figure !== 'object' || Array.isArray(q.figure)) {
      errs.push(`q${i}: FIGURE_TYPE — "figure" must be a spec object with a "type", not ${typeof q.figure}`);
      return;
    }
    if (MATHS_ONLY_TYPES.has(String(q.figure.type || '').toLowerCase()) && canonSubj(subject) !== 'maths') {
      errs.push(`q${i}: FIGURE_TYPE — "${q.figure.type}" draws mathematics only; for this subject use flow, timeline, fraction_bar, grid, numberline, or no picture`);
      return;
    }
    const badTokens = unknownColourToken(q.figure);
    if (badTokens) {
      errs.push(`q${i}: FIGURE_TYPE — unknown colour token(s) ${badTokens.map((t) => `var(--${t})`).join(', ')}; use only the tokens in the minimal specs, or none`);
      return;
    }
    const empty = figureEmptyReason(q.figure);
    if (empty) {
      errs.push(`q${i}: FIGURE_EMPTY — ${empty}; give the picture something to read off, or drop it`);
      return;
    }
    let svg = null;
    try {
      svg = renderFigureSvg(q.figure, language);
    } catch (err) {
      errs.push(`q${i}: ${err.code || 'FIGURE_RENDER'} — ${err.message}`);
    }
    if (!svg) return;
    if (svgInkCount(svg) < 3) {
      errs.push(`q${i}: FIGURE_BLANK — the drawing paints almost nothing (the engine skipped shapes it does not know); use a shape from the minimal specs`);
      return;
    }
    const mismatch = figureMismatch(q.figure, opts, ci);
    if (mismatch) {
      errs.push(`q${i}: FIGURE_MISMATCH — ${mismatch}; draw the quantities the question is about`);
    }
    if (figureIsRedundant(q.figure, stem)) {
      errs.push(`q${i}: FIGURE_REDUNDANT — the stem already states the numbers the picture shows; ask the child to READ them from the picture instead`);
    }
    // The DRAWING is checked, not only the spec: several types compute a label
    // the spec never mentions, and a fraction bar's "3/4" is the whole answer.
    if (figureLeaksAnswer(q.figure, opts, ci, svg)) {
      errs.push(`q${i}: FIGURE_LEAK — the picture gives the answer away (it names it, files it under a heading that decides it, or lands on it); a figure may show the situation, never the result`);
    }
    // Rendered once, here, and carried on the question: generate uploads this
    // SVG's PNG and the teacher PDF inlines the same vector.
    q.figureSvg = svg;
  });

  if (figured / qs.length > FIGURE_MAX_SHARE) {
    errs.push(`FIGURE_SHARE — ${figured}/${qs.length} questions carry a picture; at most half may`);
  }

  if (sloIds.size && covered.size !== sloIds.size) {
    errs.push(`SLOs uncovered: ${[...sloIds].filter((id) => !covered.has(id)).join(', ')}`);
  }
  if (qs.length && atOrBelow / qs.length < 0.6) {
    errs.push(`only ${atOrBelow}/${qs.length} at/below taught level`);
  }

  const joined = allText.join('\n');
  if (language === 'ur') {
    const r = scriptRatio(joined);
    if (r < 0.6) errs.push(`urdu script ratio ${r.toFixed(2)} < 0.6`);
    const latinWords = joined.match(/\b[a-zA-Z]{2,}\b/g) || [];
    const roman = latinWords.filter((w) => ROMAN_URDU.has(w.toLowerCase()));
    if (roman.length >= 3) errs.push(`roman urdu tokens: ${roman.slice(0, 6).join(' ')}`);
    if (FEM_STEMS.test(joined)) errs.push('feminine-stem address');
    const tl = TRANSLIT_TERMS.exec(joined);
    if (tl) errs.push(`transliterated English term in Urdu script: ${tl[1].trim()} — write it in English letters`);
  }
  const canon = canonicalSubject(subject);
  if (canon === 'islamiat' || canon === 'urdu') {
    errs.push(...checkReligiousMarks(joined));
  }

  return { ok: errs.length === 0, errors: errs, questions: qs };
}

module.exports = {
  validate,
  normaliseFeedback,
  STEM_PROMISES_PICTURE,
  FIGURE_MAX_SHARE,
  scriptRatio,
  MIN_QUESTIONS,
  MAX_QUESTIONS,
  STEM_MAX,
  OPTION_MAX,
  LEVELS,
  FEM_STEMS,
  TRANSLIT_TERMS,
  LATIN_FIRST,
  rtlOpen,
  LETTER_REF,
  ROMAN_URDU,
};
