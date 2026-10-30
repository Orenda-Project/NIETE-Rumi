'use strict';
/**
 * G5 Science: a Section C item that asks a Section B item's task again (v37r4 panel, bd-5jmnfj.4.58).
 * B Q2 (b) (i) b and C Q3 (a) 5 both asked what fossil fuels do to the Earth's temperature; B Q2 (b) (ii) a and C Q3 (a) 10
 * both asked what a magnet picks up; B Q2 (a) (i) and C Q3 (a) 1 both asked for the respiratory parts. sharedKeyFacts needs
 * three shared key words, so a task asked in different wording slipped past. Two items of different sections are the same task
 * when their stems share most of their content words and the stems with their keys share enough of them too.
 * Pure: exam JSON in, flags `{slot, reason:'giveaway', words, with, text, printed:false}` out, on the LATER slot.
 */

const { itemsInOrder } = require('./fde-near-repeats');

const STOP = new Set('that this with from have they them then than into only when which their there because what does these those will also about each other such some very explain describe name state write give says show shows draw label'.split(' '));
const stem = (w) => w.replace(/(ing|ed|es|s|e)$/, '') || w;
const str = (v) => (typeof v === 'string' ? v : '');
const cw = (s) => [...new Set((str(s).toLowerCase().match(/\p{L}+/gu) || []).filter((w) => w.length >= 4 && !STOP.has(w)).map(stem))];
const section = (slot) => str(slot).split('.')[1];
const pointText = (o) => ((o.scheme && Array.isArray(o.scheme.points)) ? o.scheme.points : []).map((p) => str(p && p.text));
const keyOf = (o) => [str(o.answer), ...pointText(o)].join(' ');
const excerpt = (t) => str(t).replace(/\s+/g, ' ').trim().slice(0, 70);

// Written items only (an MCQ is checked by the give-away rules); each sub-question is its own ask.
function asks(examJson) {
  return itemsInOrder(examJson)
    .filter((q) => q && /^science\.[BC]\./.test(str(q.slot)) && !Array.isArray(q.options))
    .flatMap((q) => {
      const subs = Array.isArray(q.questions) ? q.questions.filter((s) => s && typeof s === 'object') : [];
      return (subs.length ? subs : [q]).map((o) => ({ slot: q.slot, stem: str(o.question), s: cw(o.question), f: new Set([...cw(o.question), ...cw(keyOf(o))]) }));
    })
    .filter((a) => a.s.length);
}

const sameTask = (a, b) => {
  const ss = a.s.filter((w) => b.s.includes(w)).length;
  const ff = [...a.f].filter((w) => b.f.has(w));
  const r1 = ss / Math.min(a.s.length, b.s.length);
  const r2 = ff.length / Math.min(a.f.size, b.f.size);
  return (ss >= 3 && r1 >= 0.6 && ff.length >= 5) || (ff.length >= 6 && r2 >= 0.45 && ss >= 2) ? ff : null;
};

function crossSectionRepeats(examJson) {
  if (!examJson || typeof examJson !== 'object') return [];
  const list = asks(examJson);
  const out = [];
  list.forEach((b, j) => {
    const earlier = list.slice(0, j).filter((a) => section(a.slot) !== section(b.slot));
    for (const a of earlier) {
      const words = sameTask(a, b);
      if (words) { out.push({ slot: b.slot, reason: 'giveaway', words, with: [a.slot], text: [`same task as: ${excerpt(a.stem)}`], printed: false }); break; }
    }
  });
  return out;
}

module.exports = { crossSectionRepeats };
