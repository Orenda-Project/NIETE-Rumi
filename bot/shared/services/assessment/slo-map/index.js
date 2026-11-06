'use strict';
/**
 * The official-SLO stamp for grades 6-12 (G612 contract 6b, slo-map README §4-§5).
 *
 * One file per registry core cell, `<grade>_<code>.json`, built from the FBISE assessment
 * frameworks. G6-8 files are `policy: 'null'` (FDE prints no official code). Code, never the model,
 * writes `tag.official_slo`: a model value is ignored and replaced by what this returns.
 * Never throws; anything it cannot place is null.
 */

const CELL = /^(?:[6-9]|1[0-2])_[a-z][a-z_]*$/;
const cache = new Map();

function mapFor(grade, code) {
  const key = `${Number(grade)}_${String(code || '').trim().toLowerCase()}`;
  if (!CELL.test(key)) return null;
  if (!cache.has(key)) {
    let map = null;
    try {
      map = require(`./${key}.json`); // eslint-disable-line global-require, import/no-dynamic-require
    } catch (err) {
      map = null;
    }
    cache.set(key, map);
  }
  return cache.get(key);
}

/** README §4: a named code in the map, else exactly one entry at the tag's chapter, else null. */
function stamp(map, tag) {
  if (!map || map.policy !== 'stamp' || !Array.isArray(map.slos) || !tag) return null;
  const named = typeof tag.code === 'string' ? tag.code.trim().toUpperCase() : '';
  const hit = map.slos.find((s) => s.official_slo === named);
  if (hit) return hit.official_slo;
  const atChapter = map.slos.filter((s) => s.chapter !== null && s.chapter === tag.chapter);
  return atChapter.length === 1 ? atChapter[0].official_slo : null;
}

function officialSloFor(grade, code, tag) {
  return stamp(mapFor(grade, code), tag);
}

/** chapters/<grade>_<code>.json (build-chapters.js, from the LP matrix): the codes each chapter teaches; null when none. */
function chaptersFor(grade, code) {
  const key = `ch:${Number(grade)}_${String(code || '').trim().toLowerCase()}`;
  if (!CELL.test(key.slice(3))) return null;
  if (!cache.has(key)) {
    let map = null;
    try {
      map = require(`./chapters/${key.slice(3)}.json`); // eslint-disable-line global-require, import/no-dynamic-require
    } catch (err) {
      map = null;
    }
    cache.set(key, map);
  }
  return cache.get(key);
}

/**
 * The official SLOs of a stamp cell as the board prompt's {slo_list}: "<code> (<level>) <gist>" per line; '' when none.
 * With a chapter that the matrix lists, that chapter's own codes follow: "This chapter (ch N):" then "<code> — <desc>".
 */
function listFor(grade, code, chapter = null) {
  const map = mapFor(grade, code);
  const base = !map || map.policy !== 'stamp' || !Array.isArray(map.slos) ? '' : map.slos.map((s) => `${s.official_slo} (${s.level}) ${s.gist}`).join('\n');
  const ch = chapter == null ? null : chaptersFor(grade, code);
  const own = ch && ch.chapters && ch.chapters[String(Number(chapter))];
  if (!Array.isArray(own) || !own.length) return base;
  const lines = [`This chapter (ch ${Number(chapter)}):`, ...own.map((x) => `${x.code} — ${x.desc}`)].join('\n');
  return base ? `${base}\n${lines}` : lines;
}

/** The `<grade>_<code>` keys loaded so far (files that exist). */
function cells() {
  return [...cache.entries()].filter(([k, m]) => m && !k.startsWith('ch:')).map(([k]) => k);
}

module.exports = { officialSloFor, listFor, chaptersFor, stamp, cells };
