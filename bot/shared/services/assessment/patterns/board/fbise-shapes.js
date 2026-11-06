'use strict';
/**
 * Compact helpers the four FBISE entry modules (fbise-ssc1/ssc2/hssc1/hssc2.js) share: slot tuples to builder
 * input, the variant helper (B+C share one printed time = total - A, P10), and the paper shapes FBISE repeats
 * across subjects (sciences, mathematics). Structure only, in marks x4 integers; no question text.
 *
 * Slot tuple: [label, type, printed, attempt, marks_each_x4, internal_or?, [stimuli, mcqs_per_stimulus]?].
 * An FBISE "OR" is a choice inside each numbered question, so it is carried as prompt_rule 'internal_or' and
 * printed/attempt keep counting numbered questions; the builder's own `or` (printed = branches) is not used.
 * Sections: [id, answer_on, slots]. Requires chrome.js (entry modules are not board chrome modules).
 */
const C = require('./chrome');

const MCQ_LINE = 'Fill the relevant bubble against each question.';
const LABELS = { '50pct': '50% MCQs & 50% Descriptive', nonpct: 'Inclusive Scheme 2024 (non-50%)' };

/** [English, Urdu, medium] per subject key. */
const NAMES = {
  biology: ['Biology', 'حیاتیات', 'en'], // ur: needs fluent-Urdu review
  chemistry: ['Chemistry', 'کیمیا', 'en'], // ur: needs fluent-Urdu review
  physics: ['Physics', 'طبیعیات', 'en'], // ur: needs fluent-Urdu review
  computer_science: ['Computer Science', 'کمپیوٹر سائنس', 'en'], // ur: needs fluent-Urdu review
  maths: ['Mathematics', 'ریاضی', 'en'], // ur: needs fluent-Urdu review
  english: ['English', 'انگریزی', 'en'], // ur: needs fluent-Urdu review
  urdu: ['Urdu', 'اردو', 'ur'], // ur: needs fluent-Urdu review
  islamiat: ['Islamiat', 'اسلامیات', 'ur'], // ur: needs fluent-Urdu review
  pakistan_studies: ['Pakistan Studies', 'مطالعۂ پاکستان', 'en'], // ur: needs fluent-Urdu review
  pakistan_studies_ur: ['Pakistan Studies', 'مطالعۂ پاکستان', 'ur'], // ur: needs fluent-Urdu review
  tarjuma_quran: ['Tarjuma-tul-Quran', 'ترجمۃ القرآن', 'ur'], // ur: needs fluent-Urdu review
  general_science: ['General Science', 'جنرل سائنس', 'en'], // ur: needs fluent-Urdu review
};

const splitOf = (levels = { K: 30, U: 50, A: 20 }, status = 'verified') => ({ levels, source: status === 'default' ? 'default' : 'policy', status });

function slotOf(sec, [label, type, printed, attempt, e4, or, stim]) {
  return {
    slot: `${sec}.${label}`, label_en: label, type, printed, attempt, marks_each: e4 / 4,
    instruction_en: type === 'mcq' || type === 'scenario' ? MCQ_LINE : undefined,
    prompt_rule: or ? 'internal_or' : null,
    stimulus: stim ? { count: stim[0], mcqs_per_stimulus: stim[1], kinds: ['passage'] } : null,
  };
}

/** One variant. `ta` = Section A minutes; every later section shares total - ta (null time of its own). */
function variant(o) {
  return {
    variant_id: o.id, total_marks: o.total, total_time_min: o.time, shared_time_min: o.time - o.ta,
    shared_sections: o.secs.slice(1).map((s) => s[0]), label_en: o.label || LABELS[o.id] || null,
    applies_to: { sessions: [o.applies || '*'] }, scheme_style: 'analytic_points', cognitive_split: o.split || splitOf(),
    sections: o.secs.map(([id, on, slots], i) => ({
      id, label_en: `Section ${id}`, answer_on: on, time_min: i === 0 ? o.ta : null, slots: slots.map((t) => slotOf(id, t)),
    })),
  };
}

const MCQ = (n, e4, label = 'Q1') => [label, 'mcq', n, n, e4];
const STIM = (n, e4, count, label) => [label, 'scenario', n, n, e4, false, [count, 4]];
const SRQ = (label, n, e4) => [label, 'srq', n, n, e4, true];
const ERQ = (label, n, e4) => [label, 'erq', n, n, e4, true];

// Science, 50% variant: [Section A MCQs + stimulus MCQs, B SRQs, C ERQs]
const sci50 = (o, a, b, c, ta, total) => variant({ ...o, total, time: 180, ta, secs: [['A', o.on, a], ['B', 'e_sheet', [b]], ['C', 'e_sheet', [c]]] });
const ssc50 = (o) => sci50(o, [MCQ(40, 2, 'Q1-40'), STIM(20, 2, 5, 'Q41-60')], SRQ('Q1-6', 6, 12), ERQ('Q7-8', 2, 24), 80, 60);
const hsc50 = (o) => sci50(o, [MCQ(56, 2, 'Q1 (1-56)'), STIM(24, 2, 6, 'Q1 (57-80)')], SRQ('Q1-Q7', 7, 16), ERQ('Q8-Q9', 2, 24), 100, 80);
const sscMaths50 = (o) => sci50(o, [MCQ(32, 3, 'Q1-32'), STIM(16, 3, 4, 'Q33-48')], SRQ('Q1-7', 7, 12), ERQ('Q8-10', 3, 24), 80, 75);
const hscMaths50 = (o) => sci50(o, [MCQ(40, 3, 'Q1 (1-40)'), STIM(24, 3, 6, 'Q1 (41-64)')], SRQ('Q1-Q7', 7, 16), ERQ('Q8-Q10', 3, 32), 100, 100);
// Non-50% (Inclusive 2024): Section A is one MCQ question, B and C share the rest.
const non = (o, total, a, b, c, ta = 20) => variant({ ...o, total, time: o.time || 180, ta, secs: [['A', 'question_paper', [a]], ['B', 'e_sheet', [b]], ['C', 'e_sheet', [c]]] });
const sscSciNon = (o) => non(o, 60, MCQ(12, 4), SRQ('Q2 (i)-(x)', 10, 12), ERQ('Q3-5', 3, 24));
const sscMathsNon = (o) => non(o, 75, MCQ(15, 4), SRQ('Q2', 9, 16), ERQ('Q3-5', 3, 32));
const hscSciNon = (o) => non(o, 80, MCQ(17, 4), SRQ('Q2 (i-xiii)', 13, 12), ERQ('Q3-Q6', 4, 24), 25);
const hscMathsNon = (o) => non(o, 100, MCQ(20, 4), SRQ('Q2 (i-xii)', 12, 16), ERQ('Q3-Q6', 4, 32), 25);
// Humanities/short papers: A MCQ, B SRQs, C ERQs (Pakistan Studies, Islamiat parts)
const hum = (o, total, time, ta, a, b, c, extra = []) => variant({ ...o, total, time, ta, secs: [['A', 'question_paper', [a]], ['B', 'e_sheet', [b]], ['C', 'e_sheet', [c]], ...extra] });

function subject(key, sourceId, variants, o = {}) {
  const [en, ur, medium] = NAMES[key];
  return C.makeSubject({ key, source_id: sourceId, medium, name_en: en, name_ur: ur, status: 'ship', variants, ...o });
}
const pending = (key, sourceId, reason) => C.pendingCell({ key, source_id: sourceId, medium: NAMES[key][2], reason });

module.exports = {
  splitOf, slotOf, variant, subject, pending, NAMES, MCQ, STIM, SRQ, ERQ,
  ssc50, hsc50, sscMaths50, hscMaths50, sscSciNon, sscMathsNon, hscSciNon, hscMathsNon, hum,
};
