'use strict';
/**
 * bd-5jmnfj.38.31 — the targeted rewrite of a G6-12 free paper. When the whole-paper revision still
 * leaves an item that gives another away (A5b), a key that is the longest option, or an absolute or
 * obviously wrong distractor (A7a/A7b), only those items are sent back, each with its problem and the
 * items it must not overlap, and the replies are merged in by question number. Pure: builds text and
 * returns a new paper, no I/O. The service makes the call and keeps the result only if it is better.
 */

const { items, answerText } = require('./free-secondary-checks');

const CHECKS = new Set(['cross-leak', 'longest-key', 'absolute-option']);
const FIELDS = ['question', 'options', 'answer', 'marking_points', 'mark_bands', 'accept'];

/** The issues a targeted rewrite fixes; the rest belong to the whole-paper revision. */
function targets(issues) {
  return (issues || []).filter((i) => i && i.n > 0 && CHECKS.has(i.check));
}

function grouped(list) {
  const out = new Map();
  list.forEach((i) => {
    const g = out.get(i.n) || { problems: [], avoid: new Set() };
    g.problems.push(i.text);
    (i.avoid || []).forEach((m) => g.avoid.add(m));
    out.set(i.n, g);
  });
  return out;
}

/** The request: each item to rewrite as JSON, its problems, and what it must not overlap. */
function prompt(examJson, list) {
  const all = items(examJson);
  const lines = ['Rewrite ONLY the items below. Each still breaks a GRADES 6-12 RULE after your revision.', ''];
  grouped(list).forEach((g, n) => {
    const e = all[n - 1];
    if (!e) return;
    lines.push(`Q${n} (${e.isMcq ? 'MCQ' : 'written item'}): ${JSON.stringify(e.item)}`);
    lines.push(`Problem: ${g.problems.join('; ')}`);
    const avoid = [...g.avoid].map((m) => all[m - 1]).filter(Boolean);
    if (avoid.length) {
      lines.push('It must not share an answer, a key term or a clue with:');
      avoid.forEach((o) => lines.push(`- Q${o.n}: ${o.item.question} (answer: ${answerText(o)})`));
    }
    lines.push('');
  });
  lines.push('Keep each item\'s kind, marks and lesson topic; you may test a different point of the lesson.',
    'An MCQ keeps four options of about the same length, the key no longer than the others; no always, never, only, or all/none of the above; every distractor is one a student who half-knows the lesson could pick.',
    'A written item keeps marking points that add up to its marks.',
    'Return JSON only: {"items":[{"n":<question number>,"question":"...","options":["a) ...","b) ...","c) ...","d) ..."],"answer":"...","marking_points":[{"point":"...","marks":1}]}]} — options for MCQs only, marking points for written items only.');
  return lines.join('\n');
}

/** A copy of the paper with each acceptable reply put in place of its item. Marks and lines never change. */
function merge(examJson, reply, ns) {
  const exam = JSON.parse(JSON.stringify(examJson));
  const all = items(exam);
  const allowed = new Set(ns);
  const replaced = [];
  (Array.isArray(reply && reply.items) ? reply.items : []).forEach((r) => {
    const n = Number(r && r.n);
    const e = all[n - 1];
    if (!e || !allowed.has(n) || replaced.includes(n)) return;
    if (typeof r.question !== 'string' || !r.question.trim() || typeof r.answer !== 'string' || !r.answer.trim()) return;
    const isMcq = Array.isArray(r.options) && r.options.length === 4;
    if (isMcq !== e.isMcq) return;
    FIELDS.forEach((f) => { if (r[f] !== undefined) e.item[f] = r[f]; });
    replaced.push(n);
  });
  return { exam, replaced };
}

module.exports = { targets, prompt, merge };
