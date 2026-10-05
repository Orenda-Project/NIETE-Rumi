'use strict';
/**
 * SOURCE FIDELITY — every question carries the moment of the lesson that holds
 * its ANSWER, and code holds the question to it (behind app_settings
 * `quiz_author_gates_v2`, off by default).
 *
 * WHY. A pedagogy review of real quizzes found keys the source never gave:
 * an answer invented for a textbook question the lesson plan only ASKED, word
 * problems with numbers the lesson never used, and a quote that carried the
 * class's mistaken chant rather than the fact being tested. Every one of them
 * passed the gates that existed, because nothing compared the answer with the
 * source. The same rows go out on WhatsApp and on the web, so the check lives
 * in the AUTHOR, for both.
 *
 * WHAT. The author returns `source_quote` (the teaching moment, copied) and
 * `teaching_error` (null, or what was said wrongly and the correct fact) on
 * every question. `sourceFaults` refuses a question whose quote is missing, is
 * not in the source, is itself a question, shares no content word or number
 * with the key and the explanation, or — for a numeric key — quotes numbers
 * that are not the key's and not the stem's (the wrong moment, or an invented
 * example). On a grade 1-2 quiz a stem longer than 8 words is refused too.
 * Each complaint is written in the targeted rewrite's own form ("qN: CODE — …")
 * and names the lesson lines nearest the question, so the replacement is built
 * on the lesson's own example rather than re-worded.
 *
 * Pure functions: no I/O, no model call.
 */

const CODES = {
  MISSING: 'SOURCE_QUOTE_MISSING',
  NOT_FOUND: 'SOURCE_QUOTE_NOT_FOUND',
  IS_QUESTION: 'SOURCE_QUOTE_IS_QUESTION',
  OFF_KEY: 'SOURCE_QUOTE_OFF_KEY',
  WRONG_MOMENT: 'SOURCE_QUOTE_WRONG_MOMENT',
  STEM_LONG: 'STEM_TOO_LONG_G12',
};
const SOURCE_FAULT = /^q(\d+): (SOURCE_QUOTE_[A-Z_]+|STEM_TOO_LONG_G12)\b/;
const G12_MAX_WORDS = 8;

// ── normalising text for comparison ─────────────────────────────────────────
const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
function toWesternDigits(s) {
  return String(s ?? '').replace(/[۰-۹]/g, (d) => String(URDU_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
}

/** Lower-case, Western digits, no Arabic-script diacritics/tatweel, no punctuation, single spaces. */
function normalise(s) {
  return toWesternDigits(s)
    .normalize('NFC')
    .toLowerCase()
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, ' ')          // [mm:ss] stamps
    .replace(/\$[^$]*\$/g, (m) => ` ${m.slice(1, -1).replace(/\\[a-z]+/g, ' ')} `)  // TeX: keep its numbers
    .replace(/[ً-ٰٟۖ-ۭـ‌-‏]/g, '')
    .replace(/[ي]/g, 'ی').replace(/[ك]/g, 'ک').replace(/[ہۃ]/g, 'ہ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const tokens = (s) => (normalise(s) ? normalise(s).split(' ') : []);

const STOP = new Set((
  'the a an and or of to in on at is are was were be been it its this that these those which what who whom whose why how when where '
  + 'for from with by as into than then there their they them you your we our i he she his her not no yes do does did can could will would '
  + 'shall should may might must has have had so if but all any each every some more most many much one also very just only about after before '
  + 'over under up down out off again here class lesson teacher children child question answer'
  + ' کا کی کے کو میں سے نے پر ہے ہیں تھا تھی تھے ہو ہوں اور یا یہ وہ اس ان جو کہ کیا کیوں کون کونسا کونسی کس کتنے کتنی بھی تو ہی نہیں '
  + 'جب تک ایک کر کرتے کرنا کیا گیا گئی گئے رہا رہی رہے سکتا سکتی سکتے والا والی والے لیے لئے ساتھ بعد پہلے اپنے اپنی آپ ہم تم سب کچھ'
).split(/\s+/).filter(Boolean));

const isNumber = (t) => /^\d+$/.test(t);
/** A content word, or any number (a shared number is shared content: "64 ÷ 7"). */
function contentSet(s) {
  const out = new Set();
  for (const t of tokens(s)) {
    if (isNumber(t)) { out.add(t); continue; }
    if (STOP.has(t)) continue;
    if (/^[a-z]+$/.test(t)) {
      if (t.length < 3) continue;
      out.add(t.length > 5 ? t.slice(0, 5) : t.replace(/(es|s)$/, ''));   // drink/drinks, layer/layers
    } else if (t.length >= 2) {
      out.add(t);
    }
  }
  return out;
}
const numbersIn = (s) => new Set(tokens(s).filter(isNumber));

// ── the checks ──────────────────────────────────────────────────────────────
/** The quote, found in the source: exactly after normalising, or one window of the same length sharing ≥ 85% of its words (a slip of one word in seven). */
function quoteFound(quote, sourceText) {
  const q = tokens(quote);
  if (!q.length) return false;
  const src = normalise(sourceText);
  if (` ${src} `.includes(` ${q.join(' ')} `)) return true;
  if (q.length < 4) return false;
  const s = src.split(' ');
  const need = Math.ceil(q.length * 0.85);
  const want = new Map();
  q.forEach((t) => want.set(t, (want.get(t) || 0) + 1));
  for (let i = 0; i + q.length <= s.length; i += 1) {
    const have = new Map(want);
    let hit = 0;
    for (let k = i; k < i + q.length; k += 1) {
      const c = have.get(s[k]);
      if (c) { hit += 1; have.set(s[k], c - 1); }
    }
    if (hit >= need) return true;
  }
  return false;
}

const isQuestionQuote = (quote) => /[?؟]\s*["'»”’)\]]*\s*$/.test(String(quote || '').trim());

/**
 * A quote may join moments of the lesson with "…" (a worked example said over
 * three lines). Each piece is held to the source on its own; the pieces that
 * are questions are not evidence and do not count toward the answer.
 */
const ELLIPSIS = /\s*(?:\.\.\.+|…)\s*/;
function pieces(quote) {
  return String(quote || '').split(ELLIPSIS).map((p) => p.trim()).filter((p) => tokens(p).length > 0);
}

function correctIndices(q) {
  if (Array.isArray(q.correct_indices) && q.correct_indices.length) return q.correct_indices.map(Number);
  if (Array.isArray(q.correct_index)) return q.correct_index.map(Number);
  return [Number(q.correct_index) || 0];
}
function keyText(q) {
  const opts = Array.isArray(q.options) ? q.options : [];
  return correctIndices(q).map((i) => String(opts[i] ?? '')).join(' ');
}

/** Words in a stem as a child reads them: a $…$ expression is one word. */
function stemWords(stem) {
  return String(stem || '').replace(/\$[^$]*\$/g, ' X ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function isGradeOneTwo(gradeBand) {
  const g = String(gradeBand ?? '').trim().toLowerCase();
  return g === '1-2' || g === '1' || g === '2' || /^(k|kg|ece|prep|nursery)/.test(g);
}

/** The source lines that share the most content with the question, its key and why: the lesson's own moments to rebuild it on. */
function nearestLines(q, sourceText, n = 2) {
  const want = contentSet(`${q.question || ''} ${keyText(q)} ${q.explanation || ''}`);
  if (!want.size) return [];
  return String(sourceText || '').split(/\n+/)
    .map((line) => line.replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, '').trim())
    .filter((line) => line.length >= 12 && !isQuestionQuote(line))
    .map((line) => {
      let score = 0;
      contentSet(line).forEach((w) => { if (want.has(w)) score += 1; });
      return { line: line.length > 220 ? `${line.slice(0, 217)}…` : line, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.line);
}

/**
 * The faults of ONE question against its source. Returns [{code, detail}] —
 * empty when the question may ship.
 */
function questionFaults(q, sourceText, { gradeBand } = {}) {
  const faults = [];
  const quote = String((q && q.source_quote) || '').trim();
  if (!quote) {
    faults.push({ code: CODES.MISSING, detail: 'no "source_quote": copy the moment of the lesson that carries this answer' });
  } else if (pieces(quote).every(isQuestionQuote)) {
    faults.push({ code: CODES.IS_QUESTION, detail: 'the quote is a question, and a question is not evidence of its answer' });
  } else if (!pieces(quote).every((p) => quoteFound(p, sourceText))) {
    faults.push({ code: CODES.NOT_FOUND, detail: 'the quote is not in the lesson; copy the lesson\'s words exactly' });
  } else {
    const evidence = pieces(quote).filter((p) => !isQuestionQuote(p)).join(' ');
    const qs = contentSet(evidence);
    const answer = contentSet(`${keyText(q)} ${q.explanation || ''}`);
    let shared = false;
    qs.forEach((w) => { if (answer.has(w)) shared = true; });
    if (!shared) {
      faults.push({ code: CODES.OFF_KEY, detail: 'the quote shares no word or number with the answer or its explanation, so it does not carry the answer' });
    } else {
      // A NUMERIC key: the quote's numbers must include the key's or the
      // stem's. A quote of "12" for a key of "24" is the wrong moment (the
      // class's slip, not the fact); a quote of the rule beside a stem of
      // numbers the lesson never used is an invented example.
      const keyNums = numbersIn(keyText(q));
      const quoteNums = numbersIn(evidence);
      if (keyNums.size && quoteNums.size) {
        const stemNums = numbersIn(q.question);
        const overlaps = [...quoteNums].some((x) => keyNums.has(x) || stemNums.has(x));
        if (!overlaps) {
          faults.push({ code: CODES.WRONG_MOMENT, detail: `the quote's numbers (${[...quoteNums].join(', ')}) are neither the answer's nor the question's: quote the moment that says the correct fact, or ask about the lesson's own numbers` });
        }
      }
    }
  }
  if (isGradeOneTwo(gradeBand)) {
    const n = stemWords(q && q.question);
    if (n > G12_MAX_WORDS) {
      faults.push({ code: CODES.STEM_LONG, detail: `the stem is ${n} words; a grade 1-2 child reads at most ${G12_MAX_WORDS}` });
    }
  }
  return faults;
}

/** The targeted-rewrite complaint for one question's faults (one line per fault, the rewrite's own "qN: CODE — …" form). */
function complaints(index, q, faults, sourceText) {
  const lines = nearestLines(q, sourceText);
  const anchor = lines.length
    ? ` Build the replacement on the lesson's own example — the moments nearest this question are: ${lines.map((l) => `«${l}»`).join(' / ')}.`
    : ' Build the replacement on an example the lesson itself used.';
  return faults.map((f) => (f.code === CODES.STEM_LONG
    ? `q${index}: ${f.code} — ${f.detail}. Write the same question in ${G12_MAX_WORDS} words or fewer.`
    : `q${index}: ${f.code} — ${f.detail}.${anchor}`));
}

/** Every question's faults: { byIndex: {i: faults[]}, errors: complaint strings }. */
function sourceFaults(questions, sourceText, { gradeBand } = {}) {
  const byIndex = {};
  const errors = [];
  (Array.isArray(questions) ? questions : []).forEach((q, i) => {
    const f = questionFaults(q || {}, sourceText, { gradeBand });
    if (!f.length) return;
    byIndex[i] = f;
    errors.push(...complaints(i, q || {}, f, sourceText));
  });
  return { byIndex, errors };
}

/** The teaching errors the author recorded: [{question, said, correct, quote}]. */
function teachingErrors(questions) {
  const out = [];
  (Array.isArray(questions) ? questions : []).forEach((q) => {
    const t = q && q.teaching_error;
    if (!t || typeof t !== 'object') return;
    const said = String(t.said || '').trim();
    const correct = String(t.correct || '').trim();
    if (!said || !correct) return;
    out.push({
      question: String(q.question || '').trim().slice(0, 200),
      said: said.slice(0, 200),
      correct: correct.slice(0, 200),
      quote: String(q.source_quote || '').trim().slice(0, 200),
    });
  });
  return out;
}

/**
 * The prompt rule, stated in the author prompt and in the targeted rewrite
 * (only while the flag is on), so both write the same two fields.
 */
function sourceFidelityRule({ lessonPlan = false, gradeBand = null } = {}) {
  const src = lessonPlan ? 'LESSON PLAN' : 'TRANSCRIPT';
  const g12 = isGradeOneTwo(gradeBand)
    ? `\n- GRADE 1-2 READING LOAD: every stem is at most ${G12_MAX_WORDS} words. These children are only beginning to read; ask the same thing in fewer words.`
    : '';
  return `THE ANSWER COMES FROM THE LESSON — every question also carries:
- "source_quote": 6 to 25 CONSECUTIVE words copied EXACTLY, letter for letter, from ONE line of the ${src} — the teaching moment that carries THIS question's ANSWER (the explanation, the rule, the worked example, the fact as it was said). It must share a word or a number with the correct option or the explanation. Never copy a question (a line ending in ? or ؟ is not evidence of its answer), never paraphrase or translate, never quote across two lines; leave out any "[mm:ss]" and the speaker's name. The quote is looked up in the ${src.toLowerCase()} and a question whose quote is not there, or does not carry its answer, is rewritten. If the lesson never gives the answer, do not ask that question: ask about something the lesson did teach, with the lesson's own example and numbers.
- "teaching_error": null — unless the lesson itself says something wrong about what this question tests (a slip, a miscounted chant, a wrong rule). Then test the CORRECT fact, quote the moment where the correct fact was said (if it was), and set "teaching_error": { "said": "<what the lesson said, at most 20 words>", "correct": "<the correct fact, at most 20 words>" }.${g12}`;
}

module.exports = {
  CODES, SOURCE_FAULT, G12_MAX_WORDS,
  normalise, contentSet, quoteFound, isQuestionQuote, keyText, stemWords, isGradeOneTwo, nearestLines,
  questionFaults, complaints, sourceFaults, teachingErrors, sourceFidelityRule,
};
