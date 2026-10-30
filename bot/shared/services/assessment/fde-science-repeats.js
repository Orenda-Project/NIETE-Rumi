'use strict';
/**
 * G5 Science repeats fde-concept-caps and fde-mcq-giveaway do not catch (v34 review, bd-5jmnfj.4.58 round 6).
 *
 * - Biodegradable against non-biodegradable was tested in four places (Q1 (a) vii, Q2 (b) (ii) a and b, Q3 (a) 5) and the
 *   answers repeat. It is asked at most twice on a paper: an ask past the cap is flagged, naming the earlier asks.
 * - An MCQ whose keyed option names an example (a candle, a ceramic mug) that a written item's accept line lists, when that
 *   item asks the child to name or give an example: the MCQ hands over the written answer. The MCQ's slot is flagged.
 * Science only. Pure: exam JSON in, flags `{slot, reason:'giveaway', words, with, text, printed}` out.
 */

const { itemsInOrder, content, choice } = require('./fde-near-repeats');
const { sharedKeyFacts } = require('./fde-science-shared-facts'); // v37 round 7: two items paying one key fact
const { crossSectionRepeats } = require('./fde-science-task-repeats'); // v37r4: a C item asking a B item's task

const BIO = /\b(?:non-?)?biodegradable\b|\brot(?:s|ting)? (?:away )?naturally\b|\bstays? (?:in the (?:environment|water) )?for (?:many|hundreds of) years\b/i;
const MOST_BIO = 2;
const ASKS_EXAMPLE = /\b(?:name|give|suggest|list|write)\b[^.?]{0,25}\b(?:example|examples|one|two|three)\b|\bexamples?\b/i;

const isMcq = (q) => Array.isArray(q.options) && q.options.length > 1;
const str = (v) => (typeof v === 'string' ? v : '');
const subs = (q) => (Array.isArray(q.questions) ? q.questions.filter((s) => s && typeof s === 'object') : []);
const points = (o) => ((o.scheme && Array.isArray(o.scheme.points)) ? o.scheme.points.map((p) => str(p && p.text)) : []);
const excerpt = (t) => str(t).replace(/\s+/g, ' ').trim().slice(0, 70);
const flag = (slot, word, earlier) => ({ slot, reason: 'giveaway', words: [word], with: earlier.map((e) => e.slot), text: earlier.map((e) => excerpt(e.stem)), printed: true });

function asksOf(q) {
  if (isMcq(q)) return [{ slot: q.slot, stem: q.question, text: `${q.question} ${choice(q.answer)}` }];
  const own = (o, stem) => ({ slot: q.slot, stem, text: [stem, str(o.answer), ...points(o)].join(' ') });
  return subs(q).length ? subs(q).map((s) => own(s, str(s.question))) : [own(q, str(q.question))];
}

function biodegradableCap(asks) {
  const hits = asks.filter((a) => BIO.test(a.text));
  return hits.slice(MOST_BIO).map((a) => flag(a.slot, 'biodegradable and non-biodegradable', hits.slice(0, hits.indexOf(a))));
}

// The words of an MCQ's keyed option that a written item's accept line lists, when that item asks for an example.
function acceptExamples(list) {
  const written = list.filter((q) => !isMcq(q) && ASKS_EXAMPLE.test([q.question, ...subs(q).map((s) => s.question)].join(' ')));
  return list.filter(isMcq).flatMap((m) => {
    const key = content(choice(m.answer)).filter((w) => w.length >= 5);
    return written.filter((o) => o.slot !== m.slot).flatMap((o) => {
      const lines = [...((o.scheme && o.scheme.accept) || []), ...subs(o).flatMap((s) => (s.scheme && s.scheme.accept) || [])].map(str);
      const said = new Set(content(lines.join(' ')));
      const shared = key.filter((w) => said.has(w));
      return shared.length && shared.length * 2 >= key.length ? [{ ...flag(m.slot, shared[0], [{ slot: o.slot, stem: o.question }]), words: shared }] : [];
    });
  });
}

function scienceRepeats(examJson) {
  if (!examJson) return [];
  const list = itemsInOrder(examJson).filter((q) => /^science\./.test(q.slot || ''));
  return [...biodegradableCap(list.flatMap(asksOf)), ...acceptExamples(list), ...sharedKeyFacts(examJson), ...crossSectionRepeats(examJson)];
}

module.exports = { scienceRepeats };
