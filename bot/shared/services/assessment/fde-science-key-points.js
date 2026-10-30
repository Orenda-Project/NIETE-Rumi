'use strict';
/**
 * G5 Science marking keys that split one idea across marks (v37 review, bd-5jmnfj.4.58). Q3 (a) 10, 6, 2 and 9 paid one idea
 * as several points. Each mark is one distinct point the question asks for, so two points of one key that repeat the same
 * content words (60% of all the words the two use, at least two shared) are one idea paid twice.
 *
 * Rows ride the 'answer' shortfall path of fde-scheme-checks: `{slot, reason: 'answer', items: ['<question> (...)']}`.
 * Science items and Q2 (b) sub-questions only. Pure: reads the exam JSON, never throws.
 */

const { keyStemFlags, keyStemNote } = require('./fde-science-key-stem');

const SHARE = 0.6; // of the words the two points use together; contrast pairs (morning and evening, contagious and non-contagious) and sibling points of one process stay below it
const STOP = new Set('that this with from have they them then than into only when which their there because what does'.split(' '));
const words = (s) => String(s == null ? '' : s).toLowerCase().match(/[\p{L}]+/gu) || [];
const stem = (w) => w.replace(/(ing|ed|es|s|e)$/, '') || w; // change and changed meet at «chang»
const content = (s) => [...new Set(words(s).filter((w) => w.length >= 4 && !STOP.has(w)).map(stem))];

// A point opening «morning:» beside one opening «evening:» is a contrast the question asks for, two points however alike the rest.
const label = (p) => { const m = /^\s*([^:]{1,30}):/.exec(String((p && p.text) || '')); return m ? m[1].trim().toLowerCase() : null; };

function twins(points) {
  const c = points.map((p) => content(p && p.text));
  for (let i = 0; i < c.length; i += 1) {
    for (let j = i + 1; j < c.length; j += 1) {
      if (label(points[i]) && label(points[j]) && label(points[i]) !== label(points[j])) continue;
      const shared = c[i].filter((w) => c[j].includes(w)).length;
      const union = new Set([...c[i], ...c[j]]).size;
      if (shared >= 2 && shared / union >= SHARE) return [points[i], points[j]];
    }
  }
  return null;
}

function walk(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => walk(n, out));
  else if (node && typeof node === 'object') {
    if (/^science\./.test(node.slot || '') && node.scheme) out.push(node);
    if (Array.isArray(node.questions)) node.questions.forEach((s) => s && s.scheme && out.push({ ...s, slot: node.slot }));
    if (!node.slot) Object.values(node).forEach((v) => { if (v && typeof v === 'object') walk(v, out); });
  }
  return out;
}

function repeatedPoints(examJson) {
  const by = new Map();
  const roots = [];
  for (const branch of ['seen', 'unseen']) roots.push(examJson && examJson[branch]);
  for (const q of walk(roots)) {
    const points = Array.isArray(q.scheme.points) ? q.scheme.points : [];
    const pair = points.length >= 2 ? twins(points) : null;
    if (!pair) continue;
    if (!by.has(q.slot)) by.set(q.slot, { slot: q.slot, reason: 'answer', items: [] });
    by.get(q.slot).items.push(`${String(q.question || '').slice(0, 70)} (the points «${String(pair[0].text).slice(0, 50)}» and «${String(pair[1].text).slice(0, 50)}» are one idea paid twice)`);
  }
  return [...by.values(), ...keyStemFlags(examJson)];
}

/** The re-ask paragraph for those rows, or null when there are none. */
function repeatedPointsNote(rows) {
  const all = (Array.isArray(rows) ? rows : []).filter((r) => r && r.reason === 'answer');
  const lines = all.filter((r) => !r.keyStem).flatMap((r) => r.items || []);
  const twin = lines.length ? `These keys pay one idea as several marks: ${lines.join('; ')}. Each mark is one distinct point the question asks for: merge the repeated points into one and share the marks among the distinct points.` : null;
  return [twin, keyStemNote(all)].filter(Boolean).join(' ') || null;
}

module.exports = { repeatedPoints, repeatedPointsNote };
