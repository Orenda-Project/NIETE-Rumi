'use strict';
/**
 * The board scheme normaliser (deps contract §5: the board writer supplies its own, because marking-scheme.js
 * normaliseScheme rewrites a top-level `blooms` to R/U/A and fills points by code; G6-12 keeps the level in tag.blooms
 * and a missing scheme is the D14 checker's call, never invented here).
 *
 * Objective types (mcq, scenario) carry no scheme. A constructed item keeps only the scheme field its
 * variant's scheme_style names: analytic_points -> points, holistic_bands -> bands. Mutates, returns {examJson, log}.
 */
const { eachList, isGroup } = require('./tree');

const OBJECTIVE = new Set(['mcq', 'scenario']);
const FIELD = { analytic_points: 'points', holistic_bands: 'bands' };

function leaf(q, style, log) {
  if (OBJECTIVE.has(q.type) && 'scheme' in q) {
    delete q.scheme;
    log.push(`${q.id}: scheme dropped on an objective item`);
    return;
  }
  const keep = FIELD[style];
  if (!keep || !q.scheme || typeof q.scheme !== 'object') return;
  Object.keys(q.scheme).forEach((k) => {
    if (k === keep) return;
    delete q.scheme[k];
    log.push(`${q.id}: ${k} removed (style ${style})`);
  });
}

function walk(q, style, log) {
  if (!q || typeof q !== 'object') return;
  if (Array.isArray(q.or)) q.or.forEach((b) => walk(b, style, log));
  else if (Array.isArray(q.parts)) q.parts.forEach((p) => walk(p, style, log));
  else if (isGroup(q)) q.stimulus.items.forEach((m) => walk(m, style, log));
  else leaf(q, style, log);
}

function normaliseBoardScheme(examJson, style) {
  const log = [];
  ['seen', 'unseen'].forEach((b) => eachList({ [b]: examJson[b] }, (list) => list.forEach((q) => walk(q, style, log))));
  return { examJson, log };
}

module.exports = { normaliseBoardScheme };
