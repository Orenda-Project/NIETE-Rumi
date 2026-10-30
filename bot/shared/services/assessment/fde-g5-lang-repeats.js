'use strict';
/**
 * Two G5 English give-aways between items (v37 round 6, bd-5jmnfj.4.58):
 *  - sameDirection: Q1(b) i and v both said «Change into simple past», one skill paid twice. Two items of one slot whose
 *    round-bracket direction is the same «Change into ...» / «Rewrite as ...» wording flag the later item.
 *  - outlineFromPassage: the Q2 passage and the Q9 story outline shared their events and moral (a bird freed, kindness,
 *    the bird singing next morning), so the writing could be copied. A Q9 outline of 4 or more content words, at least
 *    half of them in the passage, is flagged on Q9.
 * Pure: exam JSON in, flags `{slot, reason:'giveaway', words, with, text, printed}` out.
 */

const { itemsInOrder, content } = require('./fde-near-repeats');
const { asks } = require('./fde-lang-cross-asks');

const DIRECTION = /\(\s*((?:change|rewrite|convert|make)\b[^)]*)\)\s*[.?]?\s*$/i;
const excerpt = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 70);
const norm = (d) => d.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

function sameDirection(examJson) {
  if (!examJson) return [];
  const seen = new Map();
  const out = new Map();
  asks(examJson).filter((a) => a.slot === 'english.A.Q1b').forEach((a) => {
    const m = DIRECTION.exec(String(a.text || ''));
    if (!m) return;
    const key = norm(m[1]);
    if (seen.has(key)) {
      const r = out.get(a.slot) || { slot: a.slot, reason: 'giveaway', words: [], with: [], text: [], printed: true };
      r.words.push(`«${m[1].trim()}» twice`); r.with.push(a.slot); r.text.push(excerpt(seen.get(key)));
      out.set(a.slot, r);
    } else seen.set(key, a.text);
  });
  return [...out.values()];
}

function outlineFromPassage(examJson) {
  if (!examJson) return [];
  const list = itemsInOrder(examJson);
  const passage = list.find((q) => q.slot === 'english.B.Q2' && typeof q.passage === 'string');
  const outline = list.find((q) => q.slot === 'english.C.Q9' && typeof q.question === 'string');
  if (!passage || !outline) return [];
  const mine = content(outline.question);
  const inPassage = new Set(content(passage.passage));
  const shared = mine.filter((w) => inPassage.has(w));
  if (mine.length < 4 || shared.length * 2 < mine.length) return [];
  return [{ slot: outline.slot, reason: 'giveaway', words: shared, with: [passage.slot],
    text: [`${shared.length} of ${mine.length} outline words are in the passage: ${shared.join(', ')}`], printed: true }];
}

module.exports = { sameDirection, outlineFromPassage };
