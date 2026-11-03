'use strict';
/**
 * Round 4 Urdu panel (G1/G2). Pure; the input is never changed.
 *   - mendUrduOpposites: a keyed opposite whose true synonym a child would also write takes it into `scheme.accept`
 *     (v37 G1 Q8 «گرم» keyed «سرد» lost the mark of «ٹھنڈا»). A small curated map; nothing the map lacks is widened.
 *   - poemPage / citePoemPage: the page of the book poem, read from the book text's «=== Page N ===» markers, so the
 *     key can cite where the teacher finds the poem. Null (nothing cited) when the markers or the poem are missing.
 */

const { mapItems } = require('./fde-early-urdu-walk');

// True synonym pairs for opposite answers a Grade 1-2 child writes; each side accepts the other.
const PAIRS = [['سرد', 'ٹھنڈا'], ['صاف', 'ستھرا'], ['گندا', 'میلا']];
const SYNONYMS = new Map();
PAIRS.forEach(([a, b]) => { SYNONYMS.set(a, (SYNONYMS.get(a) || []).concat(b)); SYNONYMS.set(b, (SYNONYMS.get(b) || []).concat(a)); });

const clean = (w) => String(w == null ? '' : w).normalize('NFC').replace(/[۔،؟!.\s]+$/u, '').replace(/^\s+/, '');

function mendUrduOpposites(examJson) {
  const notes = [];
  const out = mapItems(examJson, (q, type) => {
    if (type !== 'Opposites' || typeof q.answer !== 'string') return q;
    const syn = SYNONYMS.get(clean(q.answer));
    if (!syn) return q;
    const have = Array.isArray(q.scheme && q.scheme.accept) ? q.scheme.accept : [q.answer];
    const add = syn.filter((w) => !have.map(clean).includes(w));
    if (!add.length) return q;
    notes.push(`${q.slot}: «${clean(q.answer)}» also accepts ${add.join('، ')}`);
    return { ...q, scheme: { ...(q.scheme || {}), accept: have.concat(add) } };
  });
  return { examJson: notes.length ? out : examJson, notes };
}

const squash = (s) => String(s == null ? '' : s).normalize('NFC').replace(/\s+/g, ' ').trim();

/** The page whose text holds the poem's first line (at least 6 characters), or null. */
function poemPage(script, content) {
  const text = String(content || '');
  const marks = [...text.matchAll(/=== Page (\d+) ===\n?/g)];
  const line = String(script || '').split('\n').map(squash).find((l) => l.length >= 6);
  if (!marks.length || !line) return null;
  const hit = marks.find((m, i) => squash(text.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : text.length)).includes(line));
  return hit ? Number(hit[1]) : null;
}

/** The oral content with `page` on the poem entry when the book text gives one. */
function citePoemPage(content, pageContent) {
  if (!Array.isArray(content)) return content;
  return content.map((c) => {
    if (!c || c.id !== 'poem' || !c.script) return c;
    const page = poemPage(c.script, pageContent);
    return page ? { ...c, page } : c;
  });
}

module.exports = { mendUrduOpposites, poemPage, citePoemPage, PAIRS };
