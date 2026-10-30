'use strict';
/**
 * G5 Science v37 review, second pass (bd-5jmnfj.4.58): two pure helpers.
 *
 * splitIdeaPoints (finding 5): five Q2 (b) rows were written from the model answer, each one all-or-nothing A2.5 row that
 * copied the answer. A row of 2 or more marks is cut into one point per idea (a sentence, else a clause at «, because»,
 * «, so», «, and», «;»), at most one point per whole mark, the marks shared in halves (the first points take the odd
 * half) so they add to the row's marks. One idea stays one point.
 *
 * dropPaidCommonError (finding 7): the v37 compass key paid «the needle's north end is attracted towards Earth's
 * magnetic north» and listed the same statement as a common error. A clause of `common_error` whose content words are
 * 70% or more inside one paid point's words is dropped; the line goes when no clause is left.
 *
 * Pure: never throws, never changes its input.
 */

const POINT_MAX = 240;
const CLAUSE_SPLIT = /\s*;\s*|,\s+(?=(?:because|so|which|but|and|while)\b)|\s+(?=because\b)/i;
const SHARE = 0.7;
const STOP = new Set('saying writing thinking that this with from have they them then than into only when which their there because'.split(' '));

const words = (s) => String(s == null ? '' : s).toLowerCase().match(/[\p{L}]+/gu) || [];
const stem = (w) => w.replace(/(ing|ed|es|s)$/, '') || w;
const content = (s) => [...new Set(words(s).filter((w) => w.length >= 4 && !STOP.has(w)).map(stem))];

function ideasOf(answer) {
  const text = String(answer).replace(/\s+/g, ' ').trim();
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length >= 2) return sentences;
  const parts = text.split(CLAUSE_SPLIT).map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts : [text];
}

/** The A points of a row worth `marks` on `answer`; marks add to `marks`. */
function splitIdeaPoints(answer, marks) {
  const text = String(answer == null ? '' : answer).trim();
  const ideas = ideasOf(text);
  const n = Math.min(ideas.length, Math.floor(marks));
  if (n < 2) return [{ kind: 'A', marks, text: text.slice(0, POINT_MAX) }];
  const texts = ideas.slice(0, n - 1).concat(ideas.slice(n - 1).join(' '));
  const base = Math.floor((marks / n) * 2) / 2;
  const odd = Math.round((marks - base * n) * 2);
  return texts.map((t, i) => ({ kind: 'A', marks: base + (i < odd ? 0.5 : 0), text: t.slice(0, POINT_MAX) }));
}

const pointTexts = (q) => ((q.scheme && Array.isArray(q.scheme.points)) ? q.scheme.points : []).map((p) => content(p && p.text)).filter((c) => c.length);

/** Item in, item out: a common_error clause that restates a paid point goes. Science items only. */
function dropPaidCommonError(q, notes) {
  if (!q || typeof q !== 'object' || !/^science\./.test(q.slot || '') || !q.scheme || typeof q.scheme.common_error !== 'string') return q;
  const paid = pointTexts(q);
  if (!paid.length) return q;
  const clauses = q.scheme.common_error.split(/,\s+or\s+|;\s*/).map((c) => c.trim().replace(/[.\s]+$/, '')).filter(Boolean);
  const restates = (clause) => {
    const c = content(clause);
    return c.length >= 3 && paid.some((p) => c.filter((w) => p.includes(w)).length / c.length >= SHARE);
  };
  const kept = clauses.filter((c) => !restates(c));
  if (kept.length === clauses.length) return q;
  notes.push(`${q.slot}: common_error restates a paid point («${clauses.filter(restates)[0].slice(0, 60)}»), dropped`);
  const scheme = { ...q.scheme };
  if (!kept.length) {
    delete scheme.common_error;
  } else {
    // A kept clause that begins mid-sentence takes the opening verb of the line.
    const lead = /^(Saying|Writing|Thinking|Giving|Naming)\b(?: that)?/i.exec(q.scheme.common_error);
    const first = kept[0];
    const opened = lead && !/^(saying|writing|thinking|giving|naming)\b/i.test(first) ? `${lead[1]} that ${first.replace(/^that\s+/i, '')}` : first;
    scheme.common_error = `${[opened, ...kept.slice(1)].join(', or ')}.`;
  }
  return { ...q, scheme };
}

module.exports = { splitIdeaPoints, dropPaidCommonError };
