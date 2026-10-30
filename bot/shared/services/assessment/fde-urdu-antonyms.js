'use strict';
/**
 * G5 Urdu comprehension antonym parts (v37r4 g5-urdu Q2 ب): the key printed «صبح: رات» alone, so a child who
 * wrote «شام» lost the mark. A small reviewed table of standard Urdu antonym pairs adds the other standard
 * opposites to the printed key text (`pair[1]`, which the renderer prints after the colon; the asked word
 * `pair[0]` is never touched). A pair is changed only when its key is itself in the table. G1/G2 Opposites are
 * handled by fde-urdu-r4 (synonyms of the key only). Pure: {examJson, notes}.
 */

const { mapAll } = require('./fde-urdu-walk-all');

// Reviewed standard pairs, each a word and the opposites a Grade 5 child may write. needs fluent-Urdu review
const ANTONYMS = {
  صبح: ['رات', 'شام'], شام: ['صبح'], دن: ['رات'], رات: ['دن'],
  خوش: ['اداس', 'غمگین', 'ناخوش'], شاد: ['اداس', 'غمگین', 'ناخوش'], اداس: ['خوش', 'شاد'], غمگین: ['خوش', 'شاد'],
  آسان: ['مشکل', 'دشوار'], مشکل: ['آسان'], دشوار: ['آسان'],
  اچھا: ['برا', 'خراب'], برا: ['اچھا'], بڑا: ['چھوٹا'], چھوٹا: ['بڑا'],
  اندھیرا: ['روشنی', 'اجالا'], روشنی: ['اندھیرا'], اجالا: ['اندھیرا'],
  سچ: ['جھوٹ'], جھوٹ: ['سچ'], امیر: ['غریب'], غریب: ['امیر'],
  گرم: ['سرد', 'ٹھنڈا'], سرد: ['گرم'], ٹھنڈا: ['گرم'],
  پرانا: ['نیا'], نیا: ['پرانا'], اوپر: ['نیچے'], نیچے: ['اوپر'],
  شروع: ['ختم', 'آخر'], ختم: ['شروع'], جلدی: ['دیر'], دیر: ['جلدی'],
  دوست: ['دشمن'], دشمن: ['دوست'], صاف: ['گندا', 'میلا', 'گندہ'], گندا: ['صاف'],
  دور: ['قریب', 'نزدیک'], قریب: ['دور'], نزدیک: ['دور'], اندر: ['باہر'], باہر: ['اندر'],
  ہنسنا: ['رونا'], رونا: ['ہنسنا'],
};

const bare = (s) => String(s || '').replace(/[ً-ٰٟ]/g, '').replace(/[۔.،,!؟?]/g, '').trim();
const SPLIT = /\s*[،,]\s*(?:یا\s+)?|\s+یا\s+/u;

function mendPair(pair) {
  if (!Array.isArray(pair) || pair.length < 2 || typeof pair[1] !== 'string') return pair;
  const table = ANTONYMS[bare(pair[0])];
  if (!table) return pair;
  const have = pair[1].split(SPLIT).map(bare).filter(Boolean);
  if (!have.some((w) => table.includes(w))) return pair;
  const add = table.filter((w) => !have.includes(w));
  if (!add.length) return pair;
  return [pair[0], `${have.join('، ')}، یا ${add.join('، ')}`, ...pair.slice(2)];
}

function mendAntonymParts(examJson) {
  const notes = [];
  const out = mapAll(examJson, (q) => {
    if (!Array.isArray(q.parts)) return undefined;
    let changed = false;
    const parts = q.parts.map((p) => {
      if (!p || p.key !== 'antonyms' || !Array.isArray(p.antonyms)) return p;
      const antonyms = p.antonyms.map(mendPair);
      if (antonyms.every((a, i) => a === p.antonyms[i])) return p;
      changed = true;
      notes.push(`${q.slot}: antonym key lists the other standard opposites (${antonyms.map((a) => a.join(': ')).join('؛ ')})`);
      return { ...p, antonyms };
    });
    return changed ? { ...q, parts } : undefined;
  });
  return { examJson: out, notes };
}

module.exports = { mendAntonymParts, ANTONYMS };
