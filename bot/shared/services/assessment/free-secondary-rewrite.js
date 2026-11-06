'use strict';
/**
 * bd-5jmnfj.38.31 — the targeted rewrite of a G6-12 free paper. When the whole-paper revision still
 * leaves an item that gives another away (A5b), a key that is the longest option, or an absolute or
 * obviously wrong distractor (A7a/A7b, including one the distractor review rated 1), or a written item lacks its band, accept or do-not-accept
 * line (A7c), only those items are sent back, each with its problem and the
 * items it must not overlap, and the replies are merged in by question number, for up to two rounds
 * while each round leaves fewer problems. No I/O: the service passes the call in as `ask`.
 */

const { items, answerText } = require('./free-secondary-checks');
const { MEANING_RULE, SCHEME_RULE } = require('./free-secondary-rules');

const CHECKS = new Set(['cross-leak', 'longest-key', 'absolute-option', 'scheme', 'weak-distractor',
  'two-correct', 'odd-key', 'stem-grammar', 'long-sentence', 'long-stem', 'part-levels']);
const FIELDS = ['question', 'options', 'answer', 'marking_points', 'mark_bands', 'accept', 'reject', 'blooms', 'part_levels'];

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
    'In an MCQ exactly one option is right and the other three are clearly wrong; every option completes the stem as one correct sentence; the key is never the odd one out of the four (three near-synonyms or three negatives against it).',
    'An MCQ that gives away another item\'s answer (its key, or its options listing that answer) asks about a different fact of the lesson, so its key and options are no longer that answer.',
    'A written item in labelled parts carries "part_levels": one thinking level per part, in order.',
    'Keep every sentence within the word limit the problem states; split a long sentence in two rather than drop what it asks.',
    MEANING_RULE,
    'A written item keeps marking points that add up to its marks.',
    SCHEME_RULE,
    'Return JSON only: {"items":[{"n":<question number>,"question":"...","options":["a) ...","b) ...","c) ...","d) ..."],"answer":"...","marking_points":[{"point":"...","marks":1}],"mark_bands":[{"marks":"...","descriptor":"..."}],"accept":"...","reject":"...","blooms":"...","part_levels":["..."]}]} — options for MCQs only; marking points, mark bands, accept, reject and part_levels (items in parts) for written items only.');
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

/**
 * Up to `max` targeted rounds. A round runs only while targets remain and is kept only when its paper
 * has fewer issues than the one before; the first round that does not improve ends the loop. `ask`
 * takes the request text and resolves to the parsed reply; `tidy` cleans a merged paper in place.
 */
async function rounds({ examJson, issues, ask, check, tidy = () => {}, max = 2, onError = () => {} }) {
  let exam = examJson;
  let left = issues;
  const rewritten = new Set();
  for (let round = 0; round < max; round += 1) {
    const list = targets(left);
    if (!list.length) break;
    let merged;
    try {
      merged = merge(exam, await ask(prompt(exam, list)), list.map((i) => i.n));
    } catch (err) {
      onError(err);
      break;
    }
    if (!merged.replaced.length) break;
    tidy(merged.exam);
    const next = check(merged.exam);
    if (next.length >= left.length) break;
    exam = merged.exam;
    left = next;
    merged.replaced.forEach((n) => rewritten.add(n));
  }
  return { exam, issues: left, rewritten: [...rewritten].sort((a, b) => a - b) };
}

module.exports = { targets, prompt, merge, rounds };
