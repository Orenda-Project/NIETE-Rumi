'use strict';
/**
 * G1 Maths Q8 (v37r2): the child writes the name of an unlabelled picture, and the key accepted one noun. A plain wall
 * brick is also a block; a motorbike is also a bike or a motorcycle. The usual other names join `scheme.accept`, each
 * with and without "the", so a right answer in the child's own word is paid.
 *
 * Pure: exam JSON in, a copy out; only g1.maths.B.Q8 items change. Never throws.
 */

const SLOT = 'g1.maths.B.Q8';
const SAME = { brick: ['block'], motorbike: ['bike', 'motorcycle'], mouse: ['rat'] };

const bare = (a) => String(a == null ? '' : a).toLowerCase().replace(/^the\s+/, '').replace(/[.!]+$/, '').trim();

function widen(q) {
  if (!q || q.slot !== SLOT || !q.scheme || typeof q.scheme !== 'object') return q;
  const extra = SAME[bare(q.answer)] || [];
  if (!extra.length) return q;
  const accept = Array.isArray(q.scheme.accept) ? q.scheme.accept.slice() : [];
  const have = new Set(accept.map((a) => String(a).toLowerCase()));
  extra.forEach((w) => [w, `the ${w}`].forEach((f) => { if (!have.has(f)) { have.add(f); accept.push(f); } }));
  return { ...q, scheme: { ...q.scheme, accept } };
}

function sceneAlternatives(examJson) {
  if (!examJson || typeof examJson !== 'object') return examJson;
  const unseen = Object.fromEntries(Object.entries(examJson.unseen || {}).map(([cat, byType]) => [cat,
    Object.fromEntries(Object.entries(byType || {}).map(([type, list]) => [type, Array.isArray(list) ? list.map(widen) : list]))]));
  return { ...examJson, unseen };
}

module.exports = { sceneAlternatives };
