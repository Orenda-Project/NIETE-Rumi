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

/**
 * THE SPELLING FAMILIES USE for the names a word problem is likely to use.
 * The model guesses a spelling from the English letters, and a guess can be an
 * ordinary Urdu word: replayed, 3 of 16 lesson-plan digests spelled Hira «ہرا»
 * — "green" — and, handed to every writer, the whole quiz said it. A name in
 * this table is written this way whatever the model returned; any other name
 * keeps the model's spelling. Keys are lowercase English spellings (variants
 * included).
 */
const STANDARD_SPELLING = {
  hira: 'حرا', hina: 'حنا', ali: 'علی', ahmed: 'احمد', ahmad: 'احمد', sara: 'سارہ', sarah: 'سارہ',
  ayesha: 'عائشہ', aisha: 'عائشہ', fatima: 'فاطمہ', fatimah: 'فاطمہ', zainab: 'زینب', maryam: 'مریم', mariam: 'مریم',
  amna: 'آمنہ', hamza: 'حمزہ', bilal: 'بلال', usman: 'عثمان', umar: 'عمر', omar: 'عمر', hassan: 'حسن', hasan: 'حسن',
  hussain: 'حسین', husain: 'حسین', sana: 'ثناء', asad: 'اسد', saad: 'سعد', zara: 'زارا', iqra: 'اقرا', noor: 'نور',
  nadia: 'نادیہ', rabia: 'رابعہ', saima: 'صائمہ', sadia: 'سعدیہ', kiran: 'کرن', imran: 'عمران', kamran: 'کامران',
  farhan: 'فرحان', faisal: 'فیصل', salman: 'سلمان', adnan: 'عدنان', danish: 'دانش', haris: 'حارث', talha: 'طلحہ',
  zeeshan: 'ذیشان', arslan: 'ارسلان', rehan: 'ریحان', babar: 'بابر', aslam: 'اسلم', akram: 'اکرم', nasir: 'ناصر',
  tariq: 'طارق', khalid: 'خالد', hamid: 'حامد', rashid: 'راشد', shahid: 'شاہد', zubair: 'زبیر', yasir: 'یاسر',
  hafsa: 'حفصہ', hareem: 'حریم', huma: 'ہما', laiba: 'لائبہ', areeba: 'اریبہ', anam: 'انعم', mahnoor: 'ماہ نور',
  abdullah: 'عبداللہ', ibrahim: 'ابراہیم', ismail: 'اسماعیل', yusuf: 'یوسف', yousuf: 'یوسف', musa: 'موسیٰ',
};

/** The standard spelling of a name in English letters, word by word, or null when a word is not in the table. */
function standardSpelling(latin) {
  const words = String(latin || '').toLowerCase().split(' ');
  const spelled = words.map((w) => STANDARD_SPELLING[w]);
  return spelled.every(Boolean) ? spelled.join(' ') : null;
}

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
    const ur = urduSpelling(p.ur) && (standardSpelling(latin) || urduSpelling(p.ur));
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
    const ur = urduSpelling(urdu) && (standardSpelling(latin) || urduSpelling(urdu));
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
  return `- "people": each PERSON ${material}'s examples, stories or word problems are about (the child whose bottle or apples an example uses, a character in a story), once each, as { "latin": the name in English letters, "ur": the same name in Urdu script, spelled the way Pakistani families write it — never a spelling that is an ordinary Urdu word (Hira → «حرا», never «ہرا», which means "green") }. Only the people IN the material — never the teacher, and never a child in the class who was called on or named. [] when there are none.`;
}

// ─── NO NAME IN THE LOGS (data standard D4) ─────────────────────────────────
// A log line may carry a complaint that quotes a name, or a stripped picture
// label. Each person's name is replaced by a short hash of its English form,
// so one person is the same token in either script and two lines about them
// can still be matched, and the rest of the line (the fault code, the key,
// the reason) is kept. Nothing stored with the quiz is touched.

const nameHash = (latin) => require('crypto').createHash('sha1').update(String(latin).toLowerCase()).digest('hex').slice(0, 6);
/** "Hira" / «حرا» → "‹name:1a2b3c›" */
const nameToken = (latin) => `‹name:${nameHash(latin)}›`;
/** The name a URDU_NAME_LATIN complaint quotes. */
const QUOTED_NAME = /(URDU_NAME_LATIN — ")([^"]+)(")/g;

/**
 * A function that redacts every name it knows from a string, an array or an
 * object: the digest's people (each in English letters and in Urdu script,
 * whole and word by word), any `extraNames` in English letters (the lesson's
 * name candidates, for a digest made before people were recorded), and the
 * name a URDU_NAME_LATIN complaint quotes, whatever it is.
 */
function logRedactor(digest, extraNames = []) {
  const canonical = new Map();   // token as written → its English form
  const add = (token, latin) => { const t = String(token || '').trim(); if (t.length >= 3 && !canonical.has(t)) canonical.set(t, latin); };
  normalisePeople(digest && digest.people).forEach((p) => {
    add(p.latin, p.latin);
    add(p.ur, p.latin);
    const lw = p.latin.split(' ');
    const uw = p.ur.split(' ');
    lw.forEach((w, k) => { add(w, w); if (uw.length === lw.length) add(uw[k], w); });
  });
  (Array.isArray(extraNames) ? extraNames : [...(extraNames || [])]).forEach((n) => { if (LATIN_NAME.test(n)) add(n, n); });
  const list = [...canonical.keys()].sort((a, b) => b.length - a.length);
  const patterns = list.map((t) => [new RegExp(`(?<![\\p{L}\\p{M}])${escape(t)}(?![\\p{L}\\p{M}])`, 'gu'), nameToken(canonical.get(t))]);
  const text = (t) => patterns.reduce(
    (acc, [re, token]) => acc.replace(re, token),
    t.replace(QUOTED_NAME, (m, a, name, b) => `${a}${nameToken(name)}${b}`),
  );
  const redact = (v) => {
    if (typeof v === 'string') return text(v);
    if (Array.isArray(v)) return v.map(redact);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redact(x)]));
    return v;
  };
  return redact;
}

module.exports = {
  LATIN_NAME, STANDARD_SPELLING, standardSpelling, normalisePeople, validSpellings, peopleSpellings, spellText, spellQuestion, spellNames, peopleRule, peopleDigestRule,
  logRedactor, nameToken,
};
