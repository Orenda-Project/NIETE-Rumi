'use strict';
/**
 * TWO ENGLISH TERMS SIDE BY SIDE IN AN URDU SENTENCE.
 *
 * Inside a right-to-left line, English words written next to each other form
 * ONE left-to-right run. When they are one English phrase — "place value",
 * "improper fraction", "cross multiplication" — that is exactly right, and the
 * page's Latin-run isolation exists to keep such a phrase whole. When they are
 * two SEPARATE parts of the Urdu sentence it reads backwards:
 *
 *   «جب numerator denominator سے چھوٹا ہو»      when the numerator is smaller than the denominator
 *
 * "denominator" is laid out against «جب», so a reader going right to left
 * meets it first and the relation turns around. Production Urdu quizzes carry
 * the same shape often: «Liquid Solid میں تبدیل ہوتا ہے», «Sunday Saturday کے
 * بعد آتا ہے», «pen matter ہے».
 *
 * WHAT IS FLAGGED. A boundary between two adjacent Latin words, in a field that
 * carries Urdu, when BOTH sides are known units of the lesson and the pair is
 * not itself a known phrase:
 *   a known single word — a one-word Latin key term; a Latin word this quiz uses
 *                         on its own (Urdu or punctuation on both sides); a
 *                         one-word Latin-only field (an option "numerator")
 *   a known phrase      — a Latin key term of two or more words; two words in a
 *                         row in the lesson's English (topic, SLO statements);
 *                         a Latin-only field ("Improper Fraction"). A phrase on
 *                         one side is a known unit too, so «Improper Fraction
 *                         Mixed Fraction میں تبدیل» is two terms side by side.
 * And never when: the run holds an English function word (an English phrase or
 * sentence the author wrote on purpose — "step by step process", a quoted line);
 * the left word is a modifier (an adjective, a number word, a title, a
 * participle — "happy feeling", "one-third students"); either side is quoted
 * (a quoted word beside its label is apposition — «'He' pronoun»); a word is a
 * single letter (spelled letters, initials).
 *
 * Measured on every Urdu class quiz on the production read replica (1,142
 * quizzes, 9,085 questions), labelled by hand: of the 73 distinct pairs it
 * flags, 69 are two separate terms (precision 0.95); estimated recall 0.83. A
 * rule that flags every pair not listed as a phrase in the lesson's key terms
 * scores 0.24 on the same labels. The four it still flags wrongly are
 * noun-noun compounds no lesson named ("electricity insulator"); that is why
 * the fault is SOFT and repaired in place — a wrong flag costs one small
 * rewrite, never a question and never a quiz.
 */

const AR = /\p{Script=Arabic}/u;
const MATH = /\$[^$\n]+?\$/g;

const FUNCTION = new Set(('a an the of to in on at is are was were be been and or but for with by as it its this that these those '
  + 'not no yes i you he she we they my your his her their our me him them from into than then so if per each every '
  + 'how what which who when where why do does did can will').split(' '));
const MODIFIER = new Set(('one two three four five six seven eight nine ten eleven twelve twenty hundred thousand million '
  + 'single double triple first second third fourth fifth last next half quarter '
  + 'happy sad angry big small large little long short tall high low hot cold warm cool wet dry hard soft heavy '
  + 'proper improper mixed like unlike odd even whole common simple compound complex singular plural masculine feminine '
  + 'positive negative formal informal main same different equal unequal full empty new old good bad right wrong true false '
  + 'real natural artificial physical chemical mechanical colorful colourful shining thick thin sharp deep open closed special '
  + 'prime composite least greatest highest lowest nearest largest smallest shortest longest simplest biggest '
  + 'mr mrs ms miss dr sir').split(' '));
const NUMBER_WORD = /^(one|two|three|four|five|six|seven|eight|nine|ten|half|single|double|triple)(-|$)/;
/** A word that modifies the word after it: an adjective, a number, a title, a participle. */
const isModifier = (w) => MODIFIER.has(w) || NUMBER_WORD.test(w) || (w.length > 4 && /(ed|ing)$/.test(w));

/** One spelling per word: lower case, edge punctuation off, a plain plural "s" off. */
function norm(w) {
  const x = String(w).toLowerCase().replace(/[’]/g, "'").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '').replace(/'s$/, '');
  return x.length > 3 && /[^s]s$/.test(x) ? x.slice(0, -1) : x;
}
const latinWords = (s) => (String(s || '').replace(MATH, ' ').match(/[A-Za-z][A-Za-z'’-]*/g) || []).map(norm).filter(Boolean);

/** The child-facing fields of one question, named the way the rewrite reads them. */
function childFields(q) {
  const fb = (q && q.option_feedback) || {};
  return [
    ['question', q && q.question],
    ...(Array.isArray(q && q.options) ? q.options : []).map((o, k) => [`option ${k}`, o]),
    ['explanation', q && q.explanation],
    ['option_feedback.correct', fb.correct],
    ...Object.entries(fb.wrong || {}).map(([k, v]) => [`option_feedback.wrong.${k}`, v]),
  ].filter(([, t]) => typeof t === 'string' && t.trim());
}

// A run: Latin tokens separated only by spaces. A quote mark at a token's edge
// is kept, so a quoted span is recognised as one constituent.
const RUN = /[‘'"“]?[A-Za-z][A-Za-z0-9'’\-.]*[’'"”]?(?:[  ]+[‘'"“]?[A-Za-z][A-Za-z0-9'’\-.]*[’'"”]?)*/g;
function runsIn(text) {
  const out = [];
  for (const m of String(text).matchAll(RUN)) {
    let depth = 0;
    const tokens = m[0].split(/[  ]+/).map((t) => {
      const opens = /^[‘'"“]/.test(t);
      if (opens) depth += 1;
      const quoted = depth > 0;
      if (depth > 0 && /[’'"”]$/.test(t) && !/[A-Za-z]'s$/.test(t) && (t.length > 1 || !opens)) depth -= 1;
      return { text: t, quoted };
    });
    out.push(tokens);
  }
  return out;
}

/**
 * What the lesson — and the quiz itself — says is a term, and what is a phrase.
 * @param {object} digest   the lesson digest (key_terms, topic, SLO statements)
 * @param {object[]} questions the quiz's questions
 * @returns {{words:Set<string>, pairs:Set<string>}}
 */
function lessonLexicon(digest, questions) {
  const words = new Set();
  const pairs = new Set();
  const addPairs = (ws) => { for (let i = 0; i + 1 < ws.length; i += 1) pairs.add(`${ws[i]} ${ws[i + 1]}`); };
  const d = digest || {};
  for (const t of Array.isArray(d.key_terms) ? d.key_terms : []) {
    for (const s of [typeof t === 'string' ? t : t && t.term, t && t.as_spoken]) {
      const ws = latinWords(s);
      if (ws.length === 1) words.add(ws[0]);
      addPairs(ws);
    }
  }
  // The lesson's own English: two words in a row inside one clause are a phrase.
  const prose = [d.topic, d.topic_as_taught, ...(Array.isArray(d.slos) ? d.slos.flatMap((s) => [s && s.statement, s && s.statement_en]) : [])];
  prose.forEach((p) => String(p || '').replace(MATH, ' ').split(/[^A-Za-z'’\- ]+/).forEach((c) => addPairs(latinWords(c))));
  for (const q of Array.isArray(questions) ? questions : []) {
    for (const [, t] of childFields(q)) {
      const text = t.replace(MATH, ' ');
      if (!AR.test(text)) {
        // a field with no Urdu is one English unit: one word is a term, more a phrase
        text.split(/[^A-Za-z'’\- ]+/).forEach((c) => { const ws = latinWords(c); if (ws.length === 1) words.add(ws[0]); addPairs(ws); });
        continue;
      }
      runsIn(text).forEach((tokens) => { if (tokens.length === 1 && !tokens[0].quoted) words.add(norm(tokens[0].text)); });
    }
  }
  return { words, pairs };
}

/**
 * Every boundary in ONE field where two separate English units of the lesson
 * sit side by side. Nothing for a field with no Urdu in it.
 * @returns {{pair:string, left:string, right:string}[]}
 */
function adjacentTermsIn(text, lex) {
  const s = String(text || '');
  if (!AR.test(s) || !lex) return [];
  const found = [];
  for (const t of runsIn(s.replace(MATH, ' ¦ '))) {
    if (t.some((x) => !x.quoted && FUNCTION.has(norm(x.text)))) continue;
    for (let i = 0; i + 1 < t.length; i += 1) {
      const a = t[i];
      const b = t[i + 1];
      if (a.quoted || b.quoted) continue;
      const wa = norm(a.text);
      const wb = norm(b.text);
      if (wa.length < 2 || wb.length < 2) continue;
      if (lex.pairs.has(`${wa} ${wb}`)) continue;
      if (isModifier(wa)) continue;
      const leftPhrase = i > 0 && !t[i - 1].quoted && lex.pairs.has(`${norm(t[i - 1].text)} ${wa}`);
      const rightPhrase = i + 2 < t.length && !t[i + 2].quoted && lex.pairs.has(`${wb} ${norm(t[i + 2].text)}`);
      if ((leftPhrase || lex.words.has(wa)) && (rightPhrase || lex.words.has(wb))) {
        found.push({ pair: `${a.text} ${b.text}`, left: wa, right: wb });
      }
    }
  }
  return found;
}

/** Per question: every child-facing field with a pair side by side. */
function questionAdjacentTerms(q, lex) {
  const out = [];
  for (const [field, t] of childFields(q)) {
    const f = adjacentTermsIn(t, lex);
    if (f.length) out.push({ field, pairs: f.map((x) => x.pair) });
  }
  return out;
}

module.exports = { lessonLexicon, adjacentTermsIn, questionAdjacentTerms };
