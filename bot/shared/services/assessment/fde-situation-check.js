'use strict';
/**
 * A situation sub-part that states what an earlier part asks (bd-5jmnfj.4.58.2). v26 G5 Science Q2(b)(iii):
 * part a «Which of the three will make the faintest shadow?» keyed «The drinking glass, because …», and
 * part b said «the frosted plastic cup makes a shadow darker than the glass but lighter than the mug», so
 * a child who reads b has a's answer.
 *
 * A part is given away when another part of the same situation compares something «than the <thing>» and
 * <thing> is what its key picks (the words before its first comma, «because» or full stop).
 *
 * Pure: exam JSON in, flags `{slot, reason:'giveaway', words, with, text, printed}` out.
 */

const WORD = /[\p{L}\p{M}]+/gu;
const words = (s) => String(s == null ? '' : s).toLowerCase().match(WORD) || [];
const SKIP = new Set(['the', 'and', 'but', 'than', 'one', 'all', 'any']);
const HEAD = /^[^,.;]*?(?=\s+because\b|[,.;]|$)/i;
const headWords = (a) => words(HEAD.exec(String(a == null ? '' : a).trim())[0]).filter((w) => w.length >= 3 && !SKIP.has(w));
// «darker than the glass but lighter than the mug» -> glass, mug
function comparands(stem) {
  const out = [];
  const re = /\bthan\s+(?:the\s+|a\s+|an\s+)?([\p{L}]+(?:\s+[\p{L}]+)?)/giu;
  for (let m = re.exec(String(stem)); m; m = re.exec(String(stem))) out.push(...words(m[1]));
  return out;
}

function situationGiveaways(examJson) {
  const out = [];
  if (!examJson || !examJson.unseen) return out;
  const items = [];
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values(examJson[branch] || {})) {
      for (const l of Object.values(types || {})) if (Array.isArray(l)) items.push(...l.filter(Boolean));
    }
  }
  items.forEach((q) => {
    const parts = (Array.isArray(q.questions) ? q.questions : []).filter((p) => p && p.answer && p.question);
    const hit = new Set();
    const text = [];
    parts.forEach((x, i) => parts.forEach((y, j) => {
      if (i === j) return;
      const heads = headWords(x.answer);
      const shown = comparands(y.question).filter((w) => heads.includes(w));
      if (!shown.length) return;
      shown.forEach((w) => hit.add(w));
      text.push(String(x.question).replace(/\s+/g, ' ').trim().slice(0, 70));
    }));
    if (hit.size) out.push({ slot: q.slot, reason: 'giveaway', words: [...hit], with: text.map(() => q.slot), text, printed: true });
  });
  return out;
}

module.exports = { situationGiveaways };
