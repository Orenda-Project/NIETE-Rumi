'use strict';
/**
 * bd-snkn32.30 — a "Make my own" plan fits ONE period, and a bigger class gets LESS to do, not only less time.
 * Pure (no I/O). Used by the grades 1–5 rewrite (lp-k5-own: prompt + gate) and the 6–12 instruction (prompt).
 *
 * WHY. Tester, G3 English: "The content given in LP cannot be covered in one class specifically the schools which
 * have large number of students in the class." The stored grades 1–5 days state their period in `meta.minutes`
 * (30 for a v8 day, 40 for a v9/v10 day) but clock only I Do, We Do and You Do (typically 6 + 10 + 9 = 25 of 30):
 * the opening and the check ran on no clock. The rewrite was told to "keep the same total" and nothing checked it.
 *
 * THE PERIOD is the day's own number, never an assumed one (periodOf): no stated minutes, no timing check.
 * THE LOAD shrinks with the class (LOAD): We Do / You Do steps, You Do questions, checks and homework. Diagrams,
 * board drawings and worked examples are never counted: shorten by cutting activities and words, never a picture.
 */

const SECTIONS = ['hook', 'iDo', 'weDo', 'youDo', 'wrap'];
/** I Do is the teacher modelling: it does not grow with the class, so it has one cap for every size. */
const IDO_STEPS = 4;

/** Per class-size code (lp612-own-instruction SIZES): the most a part may carry. Never grows with the class. */
const LOAD = {
  up30: { steps: 4, problems: 4, checks: 2, homework: 2 },
  '31_50': { steps: 3, problems: 3, checks: 1, homework: 1 },
  '51_70': { steps: 3, problems: 2, checks: 1, homework: 1 },
  over70: { steps: 2, problems: 2, checks: 1, homework: 1 },
};

/** Share of the period per part, in order; the wrap takes what rounding leaves. */
const SHARE = { hook: 0.1, iDo: 0.2, weDo: 0.3, youDo: 0.3 };

const num = (v) => (v == null || v === '' ? NaN : Number(v));
const positive = (v) => Number.isFinite(num(v)) && num(v) > 0;

function strings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

/** The period the day was written for: meta.minutes, else the parts' sum, else null (nothing to check). */
function periodOf(script) {
  const s = script || {};
  if (s.meta && positive(s.meta.minutes)) return num(s.meta.minutes);
  const sum = SECTIONS.reduce((a, k) => a + (s[k] && positive(s[k].minutes) ? num(s[k].minutes) : 0), 0);
  return sum > 0 ? sum : null;
}

/** "hook about 3, iDo about 6, …" adding up to the period exactly. */
function split(period) {
  const out = {};
  let used = 0;
  for (const k of Object.keys(SHARE)) { out[k] = Math.max(1, Math.round(period * SHARE[k])); used += out[k]; }
  out.wrap = Math.max(1, period - used);
  return out;
}

/** The prompt line for a grades 1–5 day: every part clocked, adding up to the period. */
function timingLine(period) {
  const s = split(period);
  return `The period is ${period} minutes. Give each of the five parts a \`minutes\` number that adds up to exactly ${period}: `
    + `${SECTIONS.map((k) => `${k} about ${s[k]}`).join(', ')}. Plan only what fits in those minutes.`;
}

/** Reasons the five parts do not fill exactly one period; [] passes. A null period checks nothing. */
function timingProblems(script, period) {
  if (!positive(period)) return [];
  const s = script || {};
  const unclocked = SECTIONS.filter((k) => !(s[k] && positive(s[k].minutes)));
  if (unclocked.length) return [`${unclocked.join(', ')} has no minutes: give every part its minutes, adding up to the ${period}-minute period`];
  const sum = SECTIONS.reduce((a, k) => a + num(s[k].minutes), 0);
  return sum === num(period) ? [] : [`the parts add up to ${sum} minutes, not the ${period}-minute period`];
}

/** The prompt line for her class size: one activity per part, the caps, whole-class checks, book and copies only. */
function loadLine(size) {
  const c = LOAD[size] || LOAD.up30;
  const one = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return [
    `Fit her class size into ONE period: one activity in each part; I Do at most ${IDO_STEPS} steps; We Do and You Do at most ${c.steps} steps each;`,
    `You Do at most ${one(c.problems, 'question')}; at most ${one(c.checks, 'opening question')} and ${one(c.checks, 'exit check')}; at most ${one(c.homework, 'homework task')}.`,
    'A bigger class gets fewer activities, not just less time: cut activities and words to fit, never a diagram or picture.',
    'Checks are whole-class: choral answers, fingers or thumbs, children holding up the book; never check, mark or hear each child one by one.',
    // Never the word "slates" here: naming them made the model use them (bd-snkn32.27); the gate refuses them instead.
    'The children write in the book or their copies.',
  ].join(' ');
}

/** Reasons a part carries more activities than her class size allows; [] passes. */
function overLoad(script, size) {
  const c = LOAD[size];
  if (!c) return [];
  const s = script || {};
  const caps = [
    ['hook', 'steps', c.steps], ['hook', 'conversation', c.checks], ['iDo', 'steps', IDO_STEPS], ['weDo', 'steps', c.steps],
    ['youDo', 'steps', c.steps], ['youDo', 'problems', c.problems], ['wrap', 'exitOptions', c.checks], ['wrap', 'homework', c.homework],
  ];
  return caps.filter(([k, f, max]) => s[k] && Array.isArray(s[k][f]) && s[k][f].length > max)
    .map(([k, f, max]) => `${k}.${f} has ${s[k][f].length}; her class allows at most ${max}: cut activities to fit one period`);
}

const PER_CHILD = [
  /\b(?:check|mark|correct|tick|look at|listen to|hear)\s+(?:each|every)\s+(?:single\s+)?(?:child|student|pupil|learner)(?:'s|s')?\b/i,
  /\bone by one\b/i,
  /ایک ایک کر کے/,
  /ہر (?:بچے|طالب علم) (?:کی|کا|سے)\s*(?:کاپی|کام)?\s*(?:چیک|سنیں|دیکھیں)/,
];
/** An Urdu letter (not its punctuation, ۔ ، ؛): JS's \b does not see Urdu words, so a boundary is "no letter here". */
const UR = '[\\u0621-\\u064A\\u0671-\\u06D3]';
// bd-snkn32.43 — "تختی" is also a clay tablet in a book (G4 Urdu ch9, Mohenjo-daro): it is a slate only in use (on it,
// held up, wiped, her own). "slate(s)" and "سلیٹ" mean only the slate.
const SLATE = new RegExp(`\\bslates?\\b|سلیٹ|(?<!${UR})تختی(?:اں|وں)?\\s*(?:پر|پہ|پے|اوپر|اٹھا|دکھا|صاف|مٹا)|(?:اپنی|اپنے)\\s+تختی`, 'i');

// bd-snkn32.44 — pair, group or peer work in either language. Precise on purpose: the old pattern matched "مل کر"
// inside "مکمل کریں" / "شامل کر", a maths question ("packed in groups of 2") and rhyming pairs (ہم آواز جوڑیاں), and
// refused 9 of 60 days in which each child worked alone. "مل کر" counts only with an instruction (…یں) in its clause.
const TOGETHER = new RegExp([
  '(?<!\\b(?:not|never|no)\\s)(?<!\\b(?:packed|put|arranged|sorted|grouped|split|divided|shared|placed|tied|stacked|counted|bundled)\\s)\\b(?:in|into) (?:pairs|groups)\\b',
  '\\bgroup work\\b', '\\bpair work\\b', '\\bwork together\\b', '\\bturn and talk\\b', '\\bthink[- ]pair[- ]share\\b',
  '\\b(?:with|and|to|tell|ask|show)\\s+(?:a |your |their |the )?(?:partner|neighbou?r|desk-?mate)s?\\b',
  '\\bthe (?:child|person|student) next to (?:you|them|her|him)\\b',
  'جوڑی(?:وں)?\\s*(?:میں|بنا)', `(?<!${UR})(?:اپنی|اپنے) جوڑی`, 'گروپ میں', 'گروہ میں',
  `(?<!${UR})مل\\s*کر[^۔،؛:.!?]*?(?:یں)(?!${UR})`, `(?<!${UR})ساتھی (?:کے ساتھ|کو|سے)`,
].join('|'), 'i');

/** The pair/group words in one line, or null. */
const together = (s) => { const m = String(s || '').match(TOGETHER); return m ? m[0] : null; };

const inParts = (script, re) => SECTIONS.flatMap((k) => strings((script || {})[k] || {})).filter((x) => re.some((r) => r.test(x)));

/** Teacher checks no one can run in a class of 40+ (each child, one by one). */
const perChildChecks = (script) => inParts(script, PER_CHILD);
/** Slates: ICT classes work in the book. */
const slates = (script) => inParts(script, [SLATE]);

module.exports = { LOAD, IDO_STEPS, SECTIONS, periodOf, timingLine, timingProblems, loadLine, overLoad, perChildChecks, slates, together };
