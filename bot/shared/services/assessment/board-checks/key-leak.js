'use strict';
/**
 * N18/N19 key-leak (contract 8 part 2 section 3), the cheap early net before the renderer test.
 *   N18 KEY_IN_STEM      an item's key string appears in the child view of another item, or in its own
 *                        stem/passage/stimulus (never in its own options or word box)
 *   N19 COLUMN_B_ORDER   a match item whose column_b order equals the keyed pair order (3+ rows)
 *   N19 COLUMN_B_EXTRA   (soft) column_b has no distractor beyond column_a
 * Starting values in LIMITS are design_pending: no source, calibrate on the 24 fixtures.
 * RULINGS: true/false style keys and `true_false_correct` items are never searched (a one-word key that every
 * statement repeats); one issue per key, on the first view that holds it (own view first). Pure.
 */
const { leaves } = require('./_walk-local');
const { childFields } = require('./_child-view');
const { fold, stripLabel, tokens, str, issue, excerpt } = require('./_text-norm');

const LIMITS = { minTokens: 2, minLetters: 5, minDigits: 3 }; // design_pending: no source
const SKIP_KEYS = new Set(['true', 'false', 'correct', 'incorrect', 'yes', 'no', 'صحیح', 'غلط']);
const UR_LETTERS = ['الف', 'ب', 'ج', 'د'];
const padded = (s) => ` ${tokens(s).join(' ')} `;
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

function mcqKey(it) {
  const ans = str(it.answer).trim();
  const lat = /^\(?([A-Za-z])\)?(?:[\s.):]|$)/.exec(ans);
  let idx = lat ? lat[1].toUpperCase().charCodeAt(0) - 65 : -1;
  if (idx < 0) { const ur = UR_LETTERS.findIndex((l) => new RegExp(`^\\(?${l}\\)?(?:[\\s.):]|$)`).test(ans)); idx = ur; }
  if (idx >= 0 && idx < it.options.length) return stripLabel(it.options[idx]);
  const f = fold(ans);
  const hit = it.options.map(stripLabel).find((o) => o && (fold(o) === f || f.includes(fold(o))));
  return hit || null;
}

function keyOf(it) {
  if (it.type === 'match' || it.type === 'true_false_correct') return null;
  const key = Array.isArray(it.options) && it.options.length > 1 ? mcqKey(it) : (typeof it.answer === 'string' ? it.answer : null);
  return key && key.trim() ? key : null;
}

function searchable(key) {
  const t = tokens(key);
  if (!t.length) return false;
  if (t.length === 1 && SKIP_KEYS.has(t[0])) return false;
  if (t.length >= LIMITS.minTokens) return true;
  const one = t[0];
  return /^\p{N}+$/u.test(one) ? one.length >= LIMITS.minDigits : one.length >= LIMITS.minLetters;
}

function n18(ls) {
  const views = ls.map((n) => {
    const fields = childFields(n);
    return {
      n,
      own: padded(fields.filter((f) => f.field !== 'options' && f.field !== 'words').map((f) => f.text).join(' . ')),
      all: padded(fields.map((f) => f.text).join(' . ')),
    };
  });
  const out = [];
  views.forEach((v, i) => {
    const key = keyOf(v.n.item);
    if (!key || !searchable(key)) return;
    const needle = padded(key);
    if (v.own.includes(needle)) { out.push(leak(v.n, key, 'its own stem')); return; }
    const other = views.find((w, j) => j !== i && w.all.includes(needle));
    if (other) out.push(leak(other.n, key, `the key of ${v.n.ref}`));
  });
  return out;
}
const leak = (n, key, where) => issue('N18', 'KEY_IN_STEM', n.ref, `child view repeats ${where} "${excerpt(key)}"`, true);

// ---- N19
const SEP = /\s*(?:→|->|=>|[-–—:])\s*/;
const labelOf = (e) => { const m = /^\s*\(?([^\s)]{1,3})\)/.exec(str(e)); return m ? fold(m[1]) : null; };

function pairsOf(answer) {
  let rows = [];
  if (Array.isArray(answer)) rows = answer.map((x) => (isObj(x) ? [x.left || x.a || x.key, x.right || x.b || x.value] : str(x).split(SEP).slice(0, 2).concat([''])));
  else if (isObj(answer)) rows = Object.entries(answer);
  else {
    let lines = str(answer).split(/\n|;/).map((s) => s.trim()).filter(Boolean);
    if (lines.length < 2) lines = str(answer).split(',').map((s) => s.trim()).filter(Boolean);
    rows = lines.map((l) => { const m = SEP.exec(l); return m ? [l.slice(0, m.index), l.slice(m.index + m[0].length)] : [l, null]; });
  }
  return rows.map((r) => (r[1] == null ? null : str(r[1])));
}

function indexIn(colB, right) {
  const r = fold(right);
  if (!r) return -1;
  const byLabel = colB.findIndex((e) => labelOf(e) === r);
  if (byLabel >= 0) return byLabel;
  const byText = colB.findIndex((e) => fold(stripLabel(e)) === r || fold(e) === r);
  if (byText >= 0) return byText;
  if (/^[a-z]$/.test(r)) return r.charCodeAt(0) - 97;
  if (/^[1-9]$/.test(r)) return Number(r) - 1;
  const ur = UR_LETTERS.indexOf(right.trim());
  return ur;
}

function n19(it, ref) {
  const out = [];
  const A = Array.isArray(it.column_a) ? it.column_a : [];
  const B = Array.isArray(it.column_b) ? it.column_b : null;
  if (!B) return out;
  if (B.length <= A.length) out.push(issue('N19', 'COLUMN_B_EXTRA', ref, 'column_b has no distractor beyond column_a', false));
  if (A.length < 3) return out;
  const rights = pairsOf(it.answer);
  if (rights.length !== A.length || rights.some((r) => r == null)) return out;
  const idx = rights.map((r) => indexIn(B, r));
  if (idx.some((x) => x < 0 || x >= B.length) || new Set(idx).size !== idx.length) return out;
  if (idx.every((x, i) => x === i)) out.push(issue('N19', 'COLUMN_B_ORDER', ref, 'column_b is in the same order as the key pairs', true));
  return out;
}

function run(examJson) {
  const ls = leaves(examJson);
  const issues = n18(ls);
  ls.forEach((n) => { if (n.item.type === 'match') issues.push(...n19(n.item, n.ref)); });
  return { ok: !issues.some((i) => i.hard), issues };
}

module.exports = { id: 'N18/N19', name: 'key-leak', hard: true, modes: ['free', 'board'], LIMITS, run };
