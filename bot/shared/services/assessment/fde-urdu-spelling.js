'use strict';
/**
 * v28 G2 Urdu Q1 vi (bd-5jmnfj.4.58.4): the poet printed as «نادیہ نغمان»; the spelling is «نعمان». A v27 prompt rule
 * did not stop it, so a small map of known misspellings is applied to every string an Urdu item prints or keys
 * (stems, options, answers, scheme text). A picture's data URI is never touched.
 *
 * Pure: {examJson, notes}; a paper with none of the spellings is returned as it was.
 */

const SPELLINGS = [['نغمان', 'نعمان']];

function fixText(text, hits) {
  let out = text;
  for (const [wrong, right] of SPELLINGS) {
    if (out.includes(wrong)) { out = out.split(wrong).join(right); hits.add(`«${wrong}» → «${right}»`); }
  }
  return out;
}

function walk(value, hits, key) {
  if (key === 'picture') return value;
  if (typeof value === 'string') return fixText(value, hits);
  if (Array.isArray(value)) return value.map((v) => walk(v, hits));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, hits, k)]));
  return value;
}

/** Every item of the paper with the known misspellings corrected; one note naming what changed. */
function urduSpelling(examJson) {
  if (!examJson || typeof examJson !== 'object') return { examJson, notes: [] };
  const hits = new Set();
  const out = { ...examJson };
  for (const branch of ['seen', 'unseen']) if (examJson[branch]) out[branch] = walk(examJson[branch], hits);
  return hits.size ? { examJson: out, notes: [`urdu spelling corrected: ${[...hits].join(', ')}`] } : { examJson, notes: [] };
}

module.exports = { urduSpelling, SPELLINGS };
