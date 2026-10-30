'use strict';
/**
 * G5 English Q10 picture composition (v37r2): the template pays «at least 4 word-bank words», the writer's accept line
 * said «at least five of the given words», and the paper stated no count. The template (composition-criteria) is the one
 * source: any «at least N ... words» in the item's accept lines and marking points becomes its count. The paper's
 * instruction carries the same number (pattern instruction_en).
 *
 * Pure: exam JSON in, { examJson, notes } out; never throws, never mutates.
 */

const { criteriaFor } = require('./composition-criteria');

const WORDS = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten' };
const COUNT = /\bat least (\w+)(\s+(?:of\s+)?(?:the\s+)?(?:given\s+|word[- ]bank\s+)?words)/gi;

/** The template's count as a word ("four"), or null. */
function templateCount() {
  const row = criteriaFor('picture_description', 6, 'en').find((r) => /word-bank/i.test(r.name));
  const m = row && /at least (\d+)/i.exec(row.name);
  return m ? WORDS[Number(m[1])] || m[1] : null;
}

function mend(q, count, notes) {
  let changed = false;
  const fix = (t) => (typeof t !== 'string' ? t : t.replace(COUNT, (all, n, rest) => {
    if (n.toLowerCase() === count) return all;
    changed = true;
    return `at least ${count}${/^\s+words$/i.test(rest) ? ' of the given words' : rest}`;
  }));
  const scheme = q.scheme && typeof q.scheme === 'object' ? q.scheme : null;
  if (!scheme) return q;
  const accept = Array.isArray(scheme.accept) ? scheme.accept.map(fix) : scheme.accept;
  const points = Array.isArray(scheme.points) ? scheme.points.map((p) => (p && typeof p.text === 'string' ? { ...p, text: fix(p.text) } : p)) : scheme.points;
  if (!changed) return q;
  notes.push({ slot: q.slot, reason: 'word_count', count });
  return { ...q, scheme: { ...scheme, accept, points } };
}

function pictureWordCount(examJson) {
  const notes = [];
  const count = templateCount();
  const slots = ((examJson && examJson._layout && examJson._layout.sections) || []).flatMap((s) => s.slots || []);
  const mine = new Set(slots.filter((s) => /^english\./.test(s.slot) && (s.kinds || []).includes('picture_description')).map((s) => s.slot));
  if (!count || !mine.size) return { examJson, notes };
  const unseen = Object.fromEntries(Object.entries(examJson.unseen || {}).map(([cat, byType]) => [cat,
    Object.fromEntries(Object.entries(byType || {}).map(([type, list]) => [type, Array.isArray(list) ? list.map((q) => (q && mine.has(q.slot) ? mend(q, count, notes) : q)) : list]))]));
  return { examJson: { ...examJson, unseen }, notes };
}

module.exports = { pictureWordCount };
