'use strict';
/**
 * bd-znzjqi — a misspelled field name is repaired, not fatal.
 *
 * On live (18 Nov 2026) the model wrote `page2.coaching_lookfer` in all three rounds of the ladder; the
 * schema (additionalProperties: false, coaching_lookfor required) refused the document every round,
 * the render refused it, and the teacher got no plan. A revision prompt cannot be relied on to fix a
 * typo the model keeps repeating, and the fix is mechanical.
 *
 * THE RULE, deliberately narrow: an object key the schema does not allow is renamed to a key the schema
 * DOES allow there only when (a) that key is absent from the object, (b) it is within edit distance 2,
 * and (c) it is the only such candidate. Anything else is left for the schema gate to report as before.
 * Nothing is dropped and no value is touched. The document is repaired in place.
 */

const Ajv = require('ajv');
const fs = require('fs');
const { schemaFor } = require('../../vendor/lp-v9/lib/validate');

const MAX_DISTANCE = 2;
const MAX_PASSES = 5;

const _cache = new Map();
function validatorFor(doc) {
  const file = schemaFor(doc);
  if (!_cache.has(file)) {
    const ajv = new Ajv({ allErrors: true, strict: false, verbose: true });
    _cache.set(file, ajv.compile(JSON.parse(fs.readFileSync(file, 'utf8'))));
  }
  return _cache.get(file);
}

/** Levenshtein distance, capped: anything past `cap` reads as cap + 1. */
function distance(a, b, cap = MAX_DISTANCE) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** The object an ajv instancePath ('/page2/blocks/0') points at, or undefined. */
function at(doc, pointer) {
  return (pointer || '').split('/').slice(1)
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((o, k) => (o == null ? undefined : o[k]), doc);
}

/**
 * Rename near-miss keys in place.
 * @returns {Array<{path: string, from: string, to: string}>} what was renamed (empty: nothing)
 */
function repairNearMissKeys(doc) {
  const renamed = [];
  if (!doc || typeof doc !== 'object') return renamed;
  const validate = validatorFor(doc);
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    if (validate(doc)) break;
    // One (object, key) can be reported by several branches of a union, each allowing different keys.
    // Every candidate from every branch is pooled: a rename happens only when they all agree on one.
    const pooled = new Map();
    for (const e of validate.errors || []) {
      if (e.keyword !== 'additionalProperties') continue;
      const bad = e.params && e.params.additionalProperty;
      const obj = at(doc, e.instancePath);
      if (!obj || typeof obj !== 'object' || !(bad in obj)) continue;
      const allowed = Object.keys((e.parentSchema && e.parentSchema.properties) || {});
      const id = `${e.instancePath}\u0000${bad}`;
      const entry = pooled.get(id) || { obj, bad, path: e.instancePath || '/', near: new Set() };
      allowed.filter((k) => !(k in obj) && distance(bad, k) <= MAX_DISTANCE).forEach((k) => entry.near.add(k));
      pooled.set(id, entry);
    }
    let changed = false;
    for (const { obj, bad, path, near } of pooled.values()) {
      if (near.size !== 1) continue;
      const [to] = near;
      obj[to] = obj[bad];
      delete obj[bad];
      renamed.push({ path, from: bad, to });
      changed = true;
    }
    if (!changed) break;
  }
  return renamed;
}

module.exports = { repairNearMissKeys, distance };
