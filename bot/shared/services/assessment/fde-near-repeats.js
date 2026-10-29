'use strict';
/**
 * One question answering another in different words (bd-5jmnfj.4.57). v25 G5 Science printed «Why can
 * nobody hear a sound made in outer space?» as an MCQ and again in Section C; the MCQ key «The muscles
 * need more oxygen» was the mark point of the pulse question; frying an egg keyed «a chemical change
 * because a new substance forms and cannot be reversed», the answer to boiling an egg; and «They repel
 * each other» answered a Logical Reasoning sub-question about two north poles.
 *
 * Two questions of different slots, each a stem with its answer (an item or a sub-question), repeat
 * when: their stems share 3 or more content words that make up 80% of the shorter one; or an MCQ key
 * of 3 or more content words has two thirds of them in the other's answer; or the stems share 3 content
 * words and a key word is in the other's answer. The later one is flagged. English only: an Urdu stem
 * changes its endings between two questions on one lesson.
 *
 * v27 (bd-5jmnfj.4.58.2): v26 G5 Science still printed Q3(a)8 (iron nails turn orange) beside Q2(b)(ii)c, keyed
 * «Rust is a new substance, so it is a chemical change» both times: no rule compared two written answers.
 * Added: a short answer that is 75% inside another item's answer (shorter one 4 or more content words); an MCQ
 * key with 3 or more words its own stem lacks, half of them in another item's answer or in one of its mark
 * points (a long answer was never read, so the drum MCQ's «higher amplitude» was missed against Q3(b)5).
 *
 * Pure: exam JSON in, flags out.
 */

const WORD = /[\p{L}\p{M}]+/gu;
const ARABIC = /[؀-ۿ]/;
const STOP = new Set(('what which when where why does while made make makes nobody happens happen statement correct each other '
  + 'before after give reason this that there their they them then than have from with into your these those will would '
  + 'more less most many much same only some what about because takes take place '
  // v27 G5 Maths: two word problems sharing only "Find the value … simplest form" / "show your working" are not one
  // question twice (bd-5jmnfj.4.58.3). Task words carry no content; the list is read before stemming.
  + 'find value answer answers simplest form following show working number write solve words').split(' '));
const words = (s) => String(s == null ? '' : s).toLowerCase().match(WORD) || [];
const stem = (w) => w.replace(/(ing|ed|es|s)$/, '') || w;
const content = (s) => [...new Set(words(s).filter((w) => w.length >= 4 && !STOP.has(w)).map(stem))];
// "b) They repel each other" -> "They repel each other", as fde-early-prompt reads a choice.
const choice = (o) => String(o == null ? '' : o).replace(/^\s*\(?[^\s)]{1,3}\)\s*/, '').trim();
const LONG_ANSWER = 40; // a paragraph uses everyday science words; it is not one question's answer

// What an item's mark points say, one content list each (a short sentence, unlike a long model answer).
const pointsOf = (q) => ((q.scheme && Array.isArray(q.scheme.points)) ? q.scheme.points : []).map((p) => content(p && p.text)).filter((c) => c.length);

/** The questions in paper order: the layout's slot order, then the order the model wrote them. */
function itemsInOrder(examJson) {
  const order = new Map();
  ((examJson._layout && examJson._layout.sections) || []).forEach((s) => (s.slots || []).forEach((sl) => order.set(sl.slot, order.size)));
  const list = [];
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values(examJson[branch] || {})) {
      for (const l of Object.values(types || {})) if (Array.isArray(l)) list.push(...l.filter(Boolean));
    }
  }
  const at = (q) => (order.has(q.slot) ? order.get(q.slot) : order.size);
  return list.map((q, i) => ({ q, i })).sort((a, b) => at(a.q) - at(b.q) || a.i - b.i).map((x) => x.q);
}

// An item and each sub-question, as {stem, answer, key}: key is an MCQ's keyed choice, else null.
function units(q, i) {
  const subs = (Array.isArray(q.questions) ? q.questions : []).filter(Boolean);
  const mcq = Array.isArray(q.options) && q.options.length > 1;
  return [{ i, stem: q.question, answer: mcq ? '' : q.answer, key: mcq ? choice(q.answer) : null, pts: pointsOf(q) },
    ...subs.map((s) => ({ i, stem: s.question, answer: s.answer, key: null, pts: pointsOf(s) }))]
    .filter((u) => String(u.stem || '').trim() && !ARABIC.test(u.stem))
    .map((u) => ({ ...u, s: content(u.stem), a: words(u.answer).length <= LONG_ANSWER ? content(u.answer) : [], k: u.key ? content(u.key) : [] }));
}

const shared = (a, b) => a.filter((w) => b.includes(w));

// The words one unit gives the other, or null: same stem; key in the other's answer; like stems with a key word in it.
function repeat(u, v) {
  const stems = shared(u.s, v.s);
  if (stems.length >= 3 && stems.length >= 0.8 * Math.min(u.s.length, v.s.length)) return stems;
  for (const [x, y] of [[u, v], [v, u]]) {
    const given = shared(x.k, y.a);
    if (x.k.length >= 3 && given.length * 3 >= x.k.length * 2) return given;
    if (stems.length >= 3 && given.length) return given;
  }
  return answerPair(u, v);
}

// v27: two short answers that are the same answer; an MCQ key's own words in the other item's answer or point.
function answerPair(u, v) {
  const [lo, hi] = u.a.length <= v.a.length ? [u, v] : [v, u];
  if (lo.a.length >= 4) {
    const both = shared(lo.a, hi.a);
    if (both.length * 4 >= lo.a.length * 3) return both;
  }
  for (const [x, y] of [[u, v], [v, u]]) {
    const own = x.k.filter((w) => !x.s.includes(w));
    if (own.length < 3) continue;
    const best = [y.a, ...y.pts].map((t) => shared(own, t)).sort((a, b) => b.length - a.length)[0];
    if (best.length >= 3 && best.length * 2 >= own.length) return best;
  }
  return null;
}

// A slot's formula: the stem words every one of its 2 or more items says («Look at the picture and …»),
// and, on a paper of 3 or more slots, the words some stem of every slot says.
function formulas(list) {
  const bySlot = new Map();
  list.forEach((q) => bySlot.set(q.slot, [...(bySlot.get(q.slot) || []), content(q.question)]));
  const slots = [...bySlot.values()];
  const paper = slots.length >= 3 ? slots[0].flat().filter((w) => slots.every((st) => st.some((s) => s.includes(w)))) : [];
  const out = new Map();
  bySlot.forEach((stems, slot) => out.set(slot, [...paper,
    ...(stems.length > 1 ? stems[0].filter((w) => stems.every((s) => s.includes(w))) : [])]));
  return out;
}

/** `[{i, j, words}]`: item j (later on the paper) is answered by item i, both in different slots. */
function nearPairs(list) {
  const formula = formulas(list);
  const all = list.flatMap(units).map((u) => ({ ...u, s: u.s.filter((w) => !(formula.get(list[u.i].slot) || []).includes(w)) }));
  const out = new Map();
  all.forEach((u, a) => all.slice(a + 1).forEach((v) => {
    if (u.i === v.i || list[u.i].slot === list[v.i].slot) return;
    const w = repeat(u, v);
    const [i, j] = u.i < v.i ? [u.i, v.i] : [v.i, u.i];
    if (w && !out.has(`${i}|${j}`)) out.set(`${i}|${j}`, { i, j, words: w });
  }));
  return [...out.values()];
}

const excerpt = (q) => String(q.question || '').replace(/\s+/g, ' ').trim().slice(0, 70);

/** `{slot, reason:'giveaway', words, with, text, printed}` for each question another one answers. */
function nearRepeats(examJson) {
  if (!examJson) return [];
  const list = itemsInOrder(examJson);
  const out = new Map();
  nearPairs(list).forEach(({ i, j, words: w }) => {
    const r = out.get(list[j].slot) || { slot: list[j].slot, reason: 'giveaway', words: [], with: [], text: [], printed: true };
    w.forEach((x) => { if (!r.words.includes(x)) r.words.push(x); });
    if (!r.with.includes(list[i].slot)) { r.with.push(list[i].slot); r.text.push(excerpt(list[i])); }
    out.set(r.slot, r);
  });
  return [...out.values()];
}

module.exports = { itemsInOrder, nearPairs, nearRepeats, content, choice };
