'use strict';
/**
 * bd-snkn32.58.2 (queue #155 B) — guardrails for a topic she types on Make my own's goal step (Amena 19 Nov: "how do we
 * set guardrails for misspelled words and how do we ensure it remains on task without a textbook?").
 *
 * A typed topic never becomes a plan by itself: it is matched against the OFFICIAL goals of her grade (a closed set),
 * and she taps one of up to three "Did you mean" goals. No model call; pure and fast.
 *
 *   normalise     lowercase; Urdu marks (zer, zabar, pesh…) dropped; ي→ی ك→ک ه→ہ, so one word is one word
 *   Roman Urdu    a small school-word table (data/lp-own-goal-words.json): "jama" → add/جمع, "nazm" → poem/نظم …;
 *                 everyday English too ("poem" → poetry, "aloud" → orally), same file
 *   misspelling   a word matches a goal word when equal, sharing a start of 5+ letters (3+ in Urdu script), or within
 *                 edit distance 1 (5–6 letters, both words) / 2 (7+ letters)
 *   score         the share of her words a goal matches (digits only add a little, when the goal has the same digit)
 *   grade check   another grade's goal (±2, the caller passes them) that scores clearly higher is named
 *   refusal       a blocked word (exact words, same file) → 'blocked'; nothing on the curriculum → 'none'
 */
const WORDS = require('../data/lp-own-goal-words.json');
const { outcomeOf } = require('./lp612-own-goal');

const MIN_SCORE = 0.5;
const GRADE_MARGIN = 0.25;
const MAX_SUGGESTIONS = 3;
const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'about', 'what', 'how', 'why', 'this', 'that', 'are', 'its', 'our', 'your',
  'by', 'of', 'to', 'a', 'an', 'in', 'on', 'at', 'is', 'up', 'lesson', 'chapter', 'grade', 'class', 'students', 'children',
  'learn', 'learning', 'teach', 'teaching', 'can', 'ko', 'ka', 'ki', 'ke', 'aur', 'se', 'mein', 'main',
  'اور', 'میں', 'سکیں', 'سکے', 'کریں', 'کرنا', 'بارے', 'اپنے', 'والے', 'کو', 'کا', 'کی', 'کے', 'سے',
]);

function normalise(s) {
  return String(s || '').replace(/\p{M}+/gu, '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/ه/g, 'ہ')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

const split = (s) => normalise(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const isDigits = (w) => /^\p{N}+$/u.test(w);
const latin = (w) => /^[a-z]+$/.test(w);
const tokens = (s) => split(s).filter((w) => !STOP.has(w) && (w.length >= 2 || isDigits(w)));

function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

const commonStart = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i += 1; return i; };

/** How well one of her words matches one goal word: 1, 0.85 (shared start), 0.8 (misspelling) or 0. */
function sim(a, b) {
  if (a === b) return 1;
  if (isDigits(a) || isDigits(b)) return 0;
  const short = Math.min(a.length, b.length);
  const start = commonStart(a, b);
  if (latin(a) && latin(b) ? start >= 5 || (start >= 4 && start === short) : start >= 3 && start === short) return 0.85;
  const long = Math.max(a.length, b.length);
  const d = editDistance(a, b);
  // one letter off only when both words have 5+ letters: "world" is not a misspelt "word".
  if ((short >= 5 && long <= 6 && d <= 1) || (long >= 7 && short >= 5 && d <= 2)) return 0.8;
  return 0;
}

const ROMAN = Object.fromEntries(Object.entries({ ...WORDS.synonyms, ...WORDS.roman }).map(([k, v]) => [k, v.map(normalise)]));
const expand = (w) => [w, ...(ROMAN[w] || []).flatMap((x) => split(x))];

const BLOCKED = new Set([...WORDS.blocked.en, ...WORDS.blocked.roman, ...WORDS.blocked.ur].map(normalise));

/** Any blocked word (or blocked Urdu phrase) in this text? Exact words only. */
function hasBlockedWord(text) {
  const n = normalise(text);
  const ws = split(n);
  return ws.some((w) => BLOCKED.has(w)) || [...BLOCKED].some((b) => b.includes(' ') && n.includes(b));
}

/** Score one goal row against her words. */
function scoreRow(want, digits, row) {
  const text = outcomeOf(row);
  const have = split([text, row.chapter_title, row.menu_title].filter(Boolean).join(' '));
  if (!want.length) return 0;
  let hit = 0;
  for (const w of want) {
    let best = 0;
    for (const x of expand(w)) for (const h of have) best = Math.max(best, sim(x, h));
    if (best >= 0.8) hit += best;
  }
  const bonus = digits.some((d) => have.includes(d)) ? 0.1 : 0;
  return hit / want.length + (hit ? bonus : 0);
}

function rank(q, rows) {
  const all = tokens(q);
  const want = all.filter((w) => !isDigits(w));
  const digits = all.filter(isDigits);
  const seen = new Set();
  return (rows || []).map((r, i) => ({ r, i, s: scoreRow(want, digits, r) }))
    .filter((x) => x.s >= MIN_SCORE)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .filter(({ r }) => { const k = outcomeOf(r).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

const asGoal = (r) => ({ segmentId: r.segment_id, text: outcomeOf(r), chapter: r.chapter_title || null });

/**
 * Her typed topic → { status: 'ok'|'none'|'blocked', suggestions: [≤3 goals of her grade], otherGrade? }.
 * `others`: [{ grade, rows }] of nearby grades, for the grade check.
 */
function guardTopic(q, { rows, others = [] } = {}) {
  if (hasBlockedWord(q)) return { status: 'blocked', suggestions: [] };
  const mine = rank(q, rows);
  const out = { status: mine.length ? 'ok' : 'none', suggestions: mine.slice(0, MAX_SUGGESTIONS).map((x) => asGoal(x.r)) };
  const myBest = mine.length ? mine[0].s : 0;
  let other = null;
  for (const o of others || []) {
    const top = rank(q, o.rows)[0];
    if (top && top.s >= myBest + GRADE_MARGIN && (!other || top.s > other.s)) other = { grade: o.grade, s: top.s, r: top.r };
  }
  if (other) out.otherGrade = { grade: other.grade, ...asGoal(other.r) };
  return out;
}

module.exports = { normalise, editDistance, sim, tokens, hasBlockedWord, guardTopic, MIN_SCORE };
