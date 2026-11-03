'use strict';
/**
 * Words a Class 1-2 Urdu paper must never print (bd-5jmnfj.4.51.1). v23 G1 Urdu Q1 ix offered the
 * split "چھ + ٹٹی" for چھٹی: ٹٹی alone is crude. Every printed string of an item is read as whole
 * words (diacritics and labels ignored); a hit is a shortfall the writer is re-asked for.
 *
 * Pure: no I/O, never throws.
 */

const BANNED_URDU = Object.freeze(['ٹٹی', 'پاخانہ', 'حرامی', 'کمینہ']);

const MARKS = /[ً-ٰٟۖ-ۭ]/g;
const norm = (s) => String(s).replace(MARKS, '').normalize('NFC');
const BANNED = new Map(BANNED_URDU.map((w) => [norm(w), w]));

function strings(v, out) {
  if (typeof v === 'string') out.push(v);
  else if (typeof v === 'number') out.push(String(v));
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (k !== 'picture' && k !== 'checked') strings(x, out);
    }
  }
  return out;
}

/** [{word, where}] for each banned word in an item's printed text. */
function bannedHits(item) {
  const hits = [];
  for (const text of strings(item, [])) {
    for (const token of norm(text).split(/[^\p{L}\p{N}]+/u)) {
      if (BANNED.has(token)) hits.push({ word: BANNED.get(token), where: text });
    }
  }
  return hits;
}

/** `{slot, reason:'banned', items}` per slot with a hit ("question → word"). */
function bannedShortfall(examJson) {
  const out = new Map();
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values((examJson && examJson[branch]) || {})) {
      for (const list of Object.values(types || {})) {
        if (!Array.isArray(list)) continue;
        for (const q of list) {
          if (!q || typeof q !== 'object') continue;
          const hits = bannedHits(q);
          if (!hits.length) continue;
          const r = out.get(q.slot) || { slot: q.slot, reason: 'banned', items: [] };
          r.items.push(`${String(q.question || '').trim()} → ${[...new Set(hits.map((h) => h.word))].join(', ')}`);
          out.set(q.slot, r);
        }
      }
    }
  }
  return [...out.values()];
}

module.exports = { BANNED_URDU, bannedHits, bannedShortfall };
