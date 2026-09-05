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
const { canonicalSubject } = require('./transcript-quiz-language');

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

// Letters are shuffled before display, so any letter reference is wrong by
// the time a child reads it.
const LETTER_REF = /\b[A-D]\)|\b(answer|option)\s+(is\s+)?[A-D]\b|آپشن\s*[A-D]\b|جواب\s*[A-D]\b/i;

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
  const qs = rawQuestions.map(normaliseFeedback);
  if (qs.length < MIN_QUESTIONS || qs.length > MAX_QUESTIONS) {
    errs.push(`count ${qs.length} outside ${MIN_QUESTIONS}..${MAX_QUESTIONS}${nExpected ? ` (asked for ${nExpected})` : ''}`);
  }

  const slos = (digest && Array.isArray(digest.slos)) ? digest.slos : [];
  const sloIds = new Set(slos.map((s) => s.id));
  const taught = new Map(slos.map((s) => [s.id, LEVELS[s.taught_level] ?? 1]));
  const covered = new Set();
  let atOrBelow = 0;
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
    allText.push(...texts);
    if (texts.some((t) => LETTER_REF.test(t))) errs.push(`q${i}: letter reference`);
  });

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
  scriptRatio,
  MIN_QUESTIONS,
  MAX_QUESTIONS,
  STEM_MAX,
  OPTION_MAX,
  LEVELS,
  FEM_STEMS,
  TRANSLIT_TERMS,
  LETTER_REF,
  ROMAN_URDU,
};
