'use strict';
/**
 * THE PEOPLE IN A LESSON, and how each name is written in Urdu script.
 *
 * A lesson's examples are about people: the child whose bottle, apples or
 * journey a word problem uses, a character in a story. In an Urdu quiz their
 * names are written in Urdu script («حرا», never "Hira"). The spelling used to
 * be learned late, one repair at a time, so a rewrite made for another fault
 * could still write the name in English letters into a teacher's note before
 * any spelling was known.
 *
 * So the DIGEST records each person once, { latin, ur } (normalisePeople), and
 * the spelling is used everywhere from the start:
 *   - the author and every Urdu rewrite are told it up front (peopleRule);
 *   - the validator writes it into every Urdu field and every picture label
 *     that still has the name in English letters (spellQuestion). Every
 *     question that ships has passed the validator, so this is the one place
 *     that cannot be skipped.
 *
 * Only the people IN the lesson's material — never the teacher, never a child
 * in the class who was called on by name. The digest is quiz meta, not a
 * roster, and names are never logged (data standard D4).
 *
 * Pure: no I/O.
 */

/** A name in English letters: "Hira", "Ahmed Ali" (at most three words). */
const LATIN_NAME = /^[A-Z][a-z]{2,}(?: [A-Z][a-z]{2,}){0,2}$/;
const MAX_PEOPLE = 8;

/** An Urdu spelling: Urdu script, no English letter, short. */
function urduSpelling(value) {
  const u = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!u || u.length > 40 || /[A-Za-z]/.test(u) || !/\p{Script=Arabic}/u.test(u)) return null;
  return u;
}

/**
 * The digest's `people`, as the rest of the pipeline trusts it: each person
 * once, with a name in English letters and a spelling in Urdu script.
 * @returns {{latin:string, ur:string}[]}
 */
function normalisePeople(raw) {
  const out = [];
  const seen = new Set();
  (Array.isArray(raw) ? raw : []).forEach((p) => {
    if (!p || typeof p !== 'object') return;
    const latin = String(p.latin ?? '').replace(/\s+/g, ' ').trim();
    const ur = urduSpelling(p.ur);
    if (!LATIN_NAME.test(latin) || !ur || seen.has(latin)) return;
    seen.add(latin);
    out.push({ latin, ur });
  });
  return out.slice(0, MAX_PEOPLE);
}

/**
 * A guarded { latin: ur } map from any source — the digest's people, a
 * repair's "names" reply, the spellings a quiz has learned.
 */
function validSpellings(map) {
  const out = {};
  if (!map || typeof map !== 'object' || Array.isArray(map)) return out;
  Object.entries(map).forEach(([latin, urdu]) => {
    const ur = urduSpelling(urdu);
    if (LATIN_NAME.test(latin) && ur) out[latin] = ur;
  });
  return out;
}

/** The digest's people as a { latin: ur } map. */
function peopleSpellings(digest) {
  const people = normalisePeople(digest && digest.people);
  return Object.fromEntries(people.map((p) => [p.latin, p.ur]));
}

const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `text` with each name written in its Urdu spelling (whole words only). */
function spellText(text, spellings) {
  const pairs = Object.entries(spellings || {});
  if (typeof text !== 'string' || !pairs.length) return text;
  // longest first, so "Ahmed Ali" is written before "Ahmed"
  pairs.sort((a, b) => b[0].length - a[0].length);
  return pairs.reduce((acc, [latin, urdu]) => acc.replace(new RegExp(`\\b${escape(latin)}\\b`, 'g'), urdu), text);
}

/**
 * ONE question with each name written in its Urdu spelling: every text field
 * that is Urdu (the fields the name check reads) and every label of its
 * picture, so a bar says «حرا» when the stem does. A field wholly in English
 * letters is English content and is left alone. Pure; a question with nothing
 * to change is returned as it was.
 */
function spellQuestion(q, spellings) {
  if (!q || typeof q !== 'object' || !Object.keys(spellings || {}).length) return q;
  const { mapSpecStrings } = require('./transcript-quiz-figure');
  const swap = (t) => spellText(t, spellings);
  const inUrdu = (t) => (typeof t === 'string' && /\p{Script=Arabic}/u.test(t) ? swap(t) : t);
  const values = (o, fn) => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fn(v)])) : o);
  const next = {
    ...q,
    question: inUrdu(q.question),
    options: Array.isArray(q.options) ? q.options.map(inUrdu) : q.options,
    explanation: inUrdu(q.explanation),
    selected_because: inUrdu(q.selected_because),
    distractor_misconceptions: values(q.distractor_misconceptions, inUrdu),
    option_feedback: q.option_feedback && typeof q.option_feedback === 'object'
      ? { ...q.option_feedback, correct: inUrdu(q.option_feedback.correct), wrong: values(q.option_feedback.wrong, inUrdu) }
      : q.option_feedback,
    figure: q.figure && typeof q.figure === 'object' ? mapSpecStrings(q.figure, swap) : q.figure,
  };
  return JSON.stringify(next) === JSON.stringify(q) ? q : next;
}

/** The whole quiz, spelled. */
function spellNames(questions, spellings) {
  if (!Array.isArray(questions) || !Object.keys(spellings || {}).length) return questions;
  return questions.map((q) => spellQuestion(q, spellings));
}

/**
 * The rule every Urdu writer is given up front: the lesson's people, and the
 * one way each name is written. Empty for an English quiz or a lesson with no
 * recorded people (a digest from before people were recorded).
 */
function peopleRule(digest, language) {
  if (language !== 'ur') return '';
  const people = normalisePeople(digest && digest.people);
  if (!people.length) return '';
  const list = people.map((p) => `${p.latin} → «${p.ur}»`).join('; ');
  return `THE PEOPLE IN THIS LESSON — in this Urdu quiz each name is written in Urdu script, exactly this way, in every field you write (the question, the options, the explanation, the feedback, "selected_because", "distractor_misconceptions") and in every picture label: ${list}. A name is never written in English letters.`;
}

/**
 * The digest rule that asks for them — the same words on the transcript and
 * the lesson-plan paths (the `material` names what the lesson is).
 */
function peopleDigestRule(material = 'the lesson') {
  return `- "people": each PERSON ${material}'s examples, stories or word problems are about (the child whose bottle or apples an example uses, a character in a story), once each, as { "latin": the name in English letters, "ur": the same name in Urdu script }. Only the people IN the material — never the teacher, and never a child in the class who was called on or named. [] when there are none.`;
}

module.exports = {
  LATIN_NAME, normalisePeople, validSpellings, peopleSpellings, spellText, spellQuestion, spellNames, peopleRule, peopleDigestRule,
};
