'use strict';
/**
 * Practice door freshness: a practice question must not match an exam-bank question, a textbook exercise or a
 * question the child has already seen. Pure. The check is text-only and deliberately narrow:
 *   - both sides are normalised (lower case, every character that is not a letter or digit dropped);
 *   - equal after that = a match;
 *   - otherwise, when the shorter of the two is at least MIN_CONTAIN characters, one containing the other = a match.
 * It does not catch a paraphrase, a reordered sentence or the same item with different names in it.
 */
const MIN_CONTAIN = 12;

function norm(s) {
  if (s == null) return '';
  return String(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

// Every string inside a JSON value (textbook_pages.exercises has no fixed shape).
function textsOf(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => textsOf(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => textsOf(x, out));
  return out;
}

function blocker(texts) {
  const exact = new Set();
  (texts || []).forEach((t) => { const n = norm(t); if (n) exact.add(n); });
  const long = [...exact].filter((n) => n.length >= MIN_CONTAIN);
  function isFresh(q) {
    const n = norm(q);
    if (!n || exact.has(n)) return false;
    if (n.length >= MIN_CONTAIN) {
      for (const b of long) if (b.includes(n) || n.includes(b)) return false;
    } else {
      for (const b of long) if (n.includes(b)) return false;
    }
    return true;
  }
  return { isFresh, size: exact.size };
}

module.exports = { MIN_CONTAIN, norm, textsOf, blocker };
