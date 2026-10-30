'use strict';
/**
 * A multiple-choice item that states what a Section B or C item asks or marks (bd-5jmnfj.4.58.4). v28 G5 Science
 * Q1 (a) ii «What do we call materials that let some light pass through but scatter it?» (key Translucent) said Q3 (a) 3's
 * key and Q2 (b) iii c's; Q1 (a) viii's key «teaches the body's defences to recognise and fight the germs» was Q3 (a) 5's
 * key; Q1 (a) xix's «washing hands with soap and water» was a Q3 (b) 1 mark point; Q1 (a) xx's copper coin was Q3 (a) 7's
 * example. fde-near-repeats compares the key with another answer or mark point; it never read the stem the key
 * answers, nor a long model answer.
 *
 * An MCQ's stem plus its keyed option are read as content words and compared with each written item of another slot:
 * its stem, each sub-question's stem, answer and mark points. A give-away when they share 4 or more words, or
 * 3 or more when those are half of the shorter text and at least 2 come from the keyed option. The MCQ's slot is
 * flagged, so its section is asked again. Pure: exam JSON in, flags `{slot, reason:'giveaway', words, with, text, printed}` out.
 */

const { itemsInOrder, content, choice } = require('./fde-near-repeats');

const ARABIC = /[؀-ۿ]/;
const isMcq = (q) => Array.isArray(q.options) && q.options.length > 1;
const subs = (q) => (Array.isArray(q.questions) ? q.questions.filter(Boolean) : []);
const points = (q) => ((q.scheme && Array.isArray(q.scheme.points)) ? q.scheme.points : []).map((p) => p && p.text);
const excerpt = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 70);

// The texts of a written item that a stem or key can state: its stem, answer and marking points, and each part's.
const textsOf = (o) => [o.question, o.answer, ...points(o), ...subs(o).flatMap((s) => [s.question, s.answer, ...points(s)])]
  .filter((t) => typeof t === 'string' && t.trim() && !ARABIC.test(t));

const SHARED_WORDS = 4;
const SHARED_WITH_KEY = 3;

function given(m, own, t) {
  const c = content(t);
  const both = m.filter((w) => c.includes(w));
  if (both.length >= SHARED_WORDS) return both;
  const shorter = Math.min(m.length, c.length);
  const fromKey = both.filter((w) => own.includes(w));
  return both.length >= SHARED_WITH_KEY && both.length * 2 >= shorter && fromKey.length >= 2 ? both : null;
}

/** One flag per MCQ slot whose items state what another slot's item asks or marks. */
function mcqGiveaways(examJson) {
  if (!examJson) return [];
  const list = itemsInOrder(examJson);
  const out = new Map();
  list.filter((q) => isMcq(q) && !ARABIC.test(q.question || '')).forEach((q) => {
    const key = content(choice(q.answer));
    const m = content(`${q.question} ${choice(q.answer)}`);
    list.filter((o) => o.slot !== q.slot && !isMcq(o)).forEach((o) => {
      const hit = textsOf(o).map((t) => ({ t, w: given(m, key, t) })).filter((x) => x.w).sort((a, b) => b.w.length - a.w.length)[0];
      if (!hit) return;
      const r = out.get(q.slot) || { slot: q.slot, reason: 'giveaway', words: [], with: [], text: [], printed: true };
      hit.w.forEach((w) => { if (!r.words.includes(w)) r.words.push(w); });
      if (!r.with.includes(o.slot)) { r.with.push(o.slot); r.text.push(`${excerpt(o.question)} (the MCQ «${excerpt(q.question)}»)`); }
      out.set(q.slot, r);
    });
  });
  return [...out.values()];
}

module.exports = { mcqGiveaways };
