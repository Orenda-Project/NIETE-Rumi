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
  NO_REASON: 'SOURCE_QUOTE_NO_REASON',
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
 * Statements of the lesson no staying question already quotes — what a
 * REPLACEMENT question is written from (generate replaceFromSource). Sentences,
 * not lines: a transcript line can be a minute of speech. Questions are left
 * out (a quoted question is not evidence of its answer), and so is anything
 * under five words; the longest come first (they carry an answer more often
 * than "Very good."). Each is a verbatim slice of the source, so the quote the
 * model copies from it is found.
 */
function freshMoments(sourceText, usedQuotes = [], n = 6) {
  const used = (usedQuotes || []).map((u) => normalise(u)).filter(Boolean);
  const seen = new Set();
  return String(sourceText || '')
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, '\n')
    .split(/\n+|(?<=[.۔!])\s+/)
    .map((x) => x.replace(/^[^:\n]{0,40}:\s+/, '').trim())
    .filter((x) => tokens(x).length >= 5 && x.length <= 220 && !isQuestionQuote(x) && /[.۔!]$/.test(x))
    .filter((x) => {
      const k = normalise(x);
      if (seen.has(k) || used.some((u) => u && (u.includes(k) || k.includes(u)))) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => tokens(b).length - tokens(a).length)
    .slice(0, n);
}

// ── a "why" answered with words the lesson never says ───────────────────────
// The quote can be real and share a word with the key while the REASON in the
// key is the author's own ("hide from predators and ambush prey" for a lesson
// that says only camouflage and predators: the red team's BLOCKING chameleon
// item, 5 Oct 2026). For a why/how question with an English answer, the key's
// own content words — beyond the stem's — are looked for anywhere in the
// lesson; when half or more of them (two at least) never appear, the reason is
// not the lesson's. English only: a code-switched Urdu transcript paraphrases,
// and its words would not match. Measured on the 22 English why/how items of
// the re-score's 47 quizzes: 2 refused, the chameleon and a desert fox that
// "saves energy" (the lesson says only that it avoids the heat).
const ASKS_WHY = /\b(?:why|how (?:does|do|can|is|are)|reason|explain)\b/i;
const REASON_STOP = new Set(('that this these those with from they them their there because would could should '
  + 'which what when where while than then into also just only very more most some such each it\'s helps help makes make '
  + 'have has had been being were will does doing done').split(' '));
const reasonWords = (s) => (String(s ?? '').toLowerCase().match(/[a-z]{4,}/g) || [])
  .filter((w) => !REASON_STOP.has(w)).map((w) => w.slice(0, 5));
function inventedReason(q, sourceText) {
  if (!ASKS_WHY.test(String(q.question || ''))) return null;
  const key = keyText(q);
  if (/[\u0600-\u06ff]/.test(key)) return null;
  const inStem = new Set(reasonWords(q.question));
  // stem (first five letters) → the word as the key wrote it
  const said = new Map();
  (key.toLowerCase().match(/[a-z]{4,}/g) || []).forEach((w) => { if (!said.has(w.slice(0, 5))) said.set(w.slice(0, 5), w); });
  const want = [...new Set(reasonWords(key))].filter((w) => !inStem.has(w));
  if (want.length < 2) return null;
  const have = new Set(reasonWords(sourceText));
  const missing = want.filter((w) => !have.has(w));
  return missing.length * 2 >= want.length && missing.length >= 2 ? missing.map((w) => said.get(w) || w) : null;
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
  if (!faults.length) {
    const missing = inventedReason(q || {}, sourceText);
    if (missing) {
      faults.push({ code: CODES.NO_REASON, detail: `the answer's reason is not the lesson's: "${missing.join('", "')}" never appear in it; answer "why" with what the lesson itself says, and quote that moment` });
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
  CODES, SOURCE_FAULT, G12_MAX_WORDS, freshMoments,
  normalise, contentSet, quoteFound, isQuestionQuote, keyText, stemWords, isGradeOneTwo, nearestLines,
  questionFaults, complaints, sourceFaults, teachingErrors, sourceFidelityRule,
};
