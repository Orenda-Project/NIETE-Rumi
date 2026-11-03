'use strict';
/**
 * G5 Urdu Q6 (v35 round-5 review, bd-5jmnfj.4.58): the poem explanation printed four verses and every marking point
 * was a paraphrase of one printed line, so a child who copied the verses met every point without explaining anything.
 * A point's words are looked up in the printed passage (diacritics and common endings ignored); when the marks-weighted
 * share of point words found there is 55% or more, the item is flagged on the giveaway list, which re-asks the section.
 *
 * Pure: exam JSON in, flags `{slot, reason:'giveaway', words, with, text, printed}` out; never throws.
 */

const { itemsInOrder } = require('./fde-near-repeats');

const MARKS = /[ً-ٰۖ-ۭ]/g;
const norm = (s) => String(s == null ? '' : s).replace(MARKS, '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک');
const STOP = new Set(['کا', 'کی', 'کے', 'اور', 'سے', 'میں', 'ہے', 'ہیں', 'کر', 'کرنا', 'ہونا', 'کو', 'نے', 'پر', 'یہ', 'وہ', 'اس', 'ان', 'بھی', 'ہو', 'رہا', 'رہی', 'رہے', 'آنا', 'جانا', 'والا', 'والی', 'والے']);
const stem = (w) => w.replace(/(?:ات|یں|وں|ے|ی|ا|ں|ہ)$/, '');
const words = (s) => (norm(s).match(/\p{L}+/gu) || []).filter((w) => w.length >= 3 && !STOP.has(w));
const SHARE = 0.55;

function poemPaysPrinted(examJson) {
  try {
    if (!examJson) return [];
    const out = [];
    itemsInOrder(examJson).forEach((q) => {
      if (!q || !q.passage || !/مفہوم/.test(String(q.question || '')) || !q.scheme || !Array.isArray(q.scheme.points)) return;
      const printed = new Set(words(q.passage).map(stem));
      let total = 0;
      let found = 0;
      const shared = [];
      q.scheme.points.filter((p) => p && Number(p.marks) > 0).forEach((p) => {
        const ws = words(p.text);
        if (!ws.length) return;
        const hit = ws.filter((w) => printed.has(stem(w)));
        total += Number(p.marks);
        found += Number(p.marks) * (hit.length / ws.length);
        hit.forEach((w) => { if (!shared.includes(w)) shared.push(w); });
      });
      if (total > 0 && found / total >= SHARE) {
        out.push({
          slot: q.slot, reason: 'giveaway', words: shared.slice(0, 4), with: [q.slot], printed: true,
          text: ['the verses printed in this question already say what its marking points pay; ask for the meaning in the child\'s own words, with points for who speaks, what is wrong and how the speaker feels'],
        });
      }
    });
    return out;
  } catch (err) {
    return [];
  }
}

module.exports = { poemPaysPrinted };
