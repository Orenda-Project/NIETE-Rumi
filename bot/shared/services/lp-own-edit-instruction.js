'use strict';
/**
 * bd-snkn32.15 — "Change this plan": her one change as the rewrite's instruction. Pure (no I/O).
 *
 * The rewrite always starts from her LATEST ready plan (the worker passes it in), so a second change builds on the
 * first. 6-12: one instruction for the existing edit lane (reviseLessonPlan, gates and page-truth unchanged).
 * Grades 1–5: the existing rewrite's system rules (lp-k5-own system), and her change to one part instead of the class
 * answers; the same gate (checkK5Rewrite) then checks it against the plan it started from.
 */
const { system } = require('./lp-k5-own');

const G612_NAMES = Object.freeze({
  objectives: 'Objectives', introduction: 'Introduction', development: 'Development', activity: 'Activity',
  conclusion: 'Conclusion', homework: 'Homework',
});
/** The portal's part names → the grades 1–5 script's section keys. */
const K5_SECTIONS = Object.freeze({ hook: 'hook', i_do: 'iDo', we_do: 'weDo', you_do: 'youDo', wrap: 'wrap' });

const quoted = (text) => `"${String(text).replace(/"/g, "'")}"`;

/** 6-12: the instruction reviseLessonPlan takes. Throws on a part the guard would have refused. */
function buildEditInstruction({ part, text }) {
  const ask = `Her request (follow it where it fits the learning outcomes and the plan's rules; do not quote it back): ${quoted(text)}`;
  if (part === 'whole') {
    return [
      'The teacher asks for ONE change, across the whole plan.',
      'Keep the learning outcomes, the textbook pages and the total time exactly as they are.',
      ask,
    ].join('\n');
  }
  const name = G612_NAMES[part];
  if (!name) throw new Error(`buildEditInstruction: unknown part ${part}`);
  return [
    `The teacher asks for ONE change, to only the ${name} section of her plan.`,
    'Keep every other section exactly as it is, and keep the learning outcomes, the textbook pages and the total time.',
    ask,
  ].join('\n');
}

/** Grades 1–5: the two messages for the model. Throws on a part the guard would have refused. */
function k5EditMessages({ script, edit, lang, grade, subject }) {
  const key = K5_SECTIONS[edit && edit.part];
  if (!key) throw new Error(`k5EditMessages: unknown part ${edit && edit.part}`);
  const others = Object.values(K5_SECTIONS).filter((k) => k !== key);
  const lines = [
    `Grade ${grade}${subject ? `, ${subject}` : ''}. The teacher already has this plan and asks for ONE change.`,
    `Change only the ${key} part. Keep ${others.slice(0, -1).join(', ')} and ${others[others.length - 1]} word for word, and keep the minutes the same.`,
    `Her request (follow it where it fits the outcome and these rules; do not quote it back): ${quoted(edit.text)}`,
    '', 'The plan:', JSON.stringify(script),
  ];
  return [{ role: 'system', content: system(lang) }, { role: 'user', content: lines.join('\n') }];
}

module.exports = { buildEditInstruction, k5EditMessages, G612_NAMES, K5_SECTIONS };
