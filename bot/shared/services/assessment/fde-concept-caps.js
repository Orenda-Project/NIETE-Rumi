'use strict';
/**
 * Caps on how often one science construct is tested on a paper (bd-5jmnfj.4.58 round 4). v29 G5 Science tested physical
 * versus chemical change six times (Q1 (a) xii, xiii, Q2 (b) (i) c, (ii) a, c, Q3 (a) 8), transparent / translucent / opaque
 * five times, labelled the respiratory system in Q1 (b) and Q2 (a) (i), and paid the greenhouse point in both Q3 (a) 6 and Q3 (b) 2.
 *
 * Why fde-concept-count let these ship: it counted a written item with its sub-questions as ONE ask; it matched the stems and
 * the keyed option only, never a sub-question's answer, so Q2 (b) (iii) a, b, c (which ask about shadows and blurry glow
 * and never say «translucent») were not counted; its regexes were the bare concept words; and it allowed two asks of
 * every concept. This module counts every MCQ stem with its key and every sub-question with its answer as one ask, reads
 * the answers, uses the wider words of each construct and gives each construct its own cap. An ask past the cap is
 * flagged on its own slot, naming the earlier asks. Science papers only. Pure: exam JSON in, flags
 * `{slot, reason:'giveaway', words, with, text, printed}` out.
 */

const { itemsInOrder, choice } = require('./fde-near-repeats');

const CONSTRUCTS = [
  { name: 'physical and chemical change', most: 3,
    re: /\b(?:physical|chemical)\b[^.?]{0,30}\bchanges?\b|\bchanges?\b[^.?]{0,20}\b(?:physical|chemical)\b|\brust(?:ing|s)?\b|\bnew (?:substance|material|product)\b|\bcannot (?:easily )?be (?:changed|turned) back\b/i },
  { name: 'transparent, translucent and opaque', most: 3,
    re: /\b(?:transparent|translucent|opaque)\b|\bblurry\b|\bscatters?\b[^.?]{0,15}\blight\b|\blets? (?:some|only some|most|no|all) (?:of the )?light\b|\bblocks? all (?:the )?light\b/i },
  { name: 'labelling the respiratory system', most: 1, needs: /\blabel/i, re: /\brespiratory system\b|\bwindpipe\b|\bvoice box\b/i },
  { name: 'the greenhouse trap point', most: 1, re: /\btraps?\b[^.?]{0,25}\bheat\b|\bgreenhouse effect\b/i },
];

const isMcq = (q) => Array.isArray(q.options) && q.options.length > 1;
const subs = (q) => (Array.isArray(q.questions) ? q.questions.filter((s) => s && typeof s === 'object') : []);
const str = (v) => (typeof v === 'string' ? v : '');
const pointsOf = (o) => ((o.scheme && Array.isArray(o.scheme.points)) ? o.scheme.points.map((p) => str(p && p.text)) : []);
const excerpt = (t) => str(t).replace(/\s+/g, ' ').trim().slice(0, 70);

// What each ask says and keys, with the words of its own ask kept apart so a construct can need «label» in the stem.
function asksOf(q) {
  if (isMcq(q)) return [{ slot: q.slot, stem: q.question, text: `${q.question} ${choice(q.answer)}` }];
  const own = (o, stem) => ({ slot: q.slot, stem, text: [stem, str(o.answer), ...pointsOf(o)].join(' ') });
  if (subs(q).length) return subs(q).map((s) => own(s, `${str(s.question)}`));
  return [own(q, `${str(q.main_question)} ${str(q.question)}`)];
}

function conceptCaps(examJson) {
  if (!examJson) return [];
  const list = itemsInOrder(examJson).filter((q) => /^science\./.test(q.slot || ''));
  const asks = list.flatMap(asksOf);
  const out = new Map();
  CONSTRUCTS.forEach(({ name, most, re, needs }) => {
    const hits = asks.filter((a) => re.test(a.text) && (!needs || needs.test(a.stem)));
    hits.forEach((a, n) => {
      if (n < most) return;
      const r = out.get(a.slot) || { slot: a.slot, reason: 'giveaway', words: [], with: [], text: [], printed: true };
      if (!r.words.includes(name)) r.words.push(name);
      hits.slice(0, n).forEach((b) => { r.with.push(b.slot); r.text.push(excerpt(b.stem)); });
      out.set(a.slot, r);
    });
  });
  return [...out.values()];
}

module.exports = { conceptCaps };
