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
 * BOARD RULING (bd-5jmnfj.38.30): in a board paper (40-80 MCQs) an MCQ key found only among ANOTHER item's
 * options is ordinary distractor reuse, not a leak. Its stem/passage/stimulus (and a printed word box) still count,
 * and every other key (srq, fill-blank) is still searched in other items' options.
 * BOARD RULING part 2: a single-word MCQ key (articles and bare units aside, no digit) in ANOTHER item's stem or
 * stimulus is chapter vocabulary ("distance", "the same", "m/s"), so that issue is soft. Numbers with or without
 * units, multi-word keys, every non-MCQ key, and an MCQ key in its own stem or stimulus stay hard.
 * OWN STEM (round 4): a key of numbers and units only, in its own stem that asks for a calculation, is the given
 * data ("Calculate ... in kJ/mol", key "-1312 kJ/mol"), so it is soft; a unit asked for by name stays hard. A signed
 * number must match with its sign in every view ("-1/2" is not in "+1/2").
 * CROSS-ITEM (round 5, board only): a key that is a unit alone ("m/s^2") is never a leak in another item; a number
 * or quantity key ("20 m/s", "9.8 m/s^2") in another item's stem is soft (board papers give g as data); a concept
 * phrase stays hard. The blame is always on the item whose stem carries the text, never the keyed item, fresh or
 * not. usedKeys() gives the repair ask the numeric and multi-word keys already in the paper.
 * ROUND 6 (board only): refs are the shared walk's (walk.js), the form the registry maps to ids, so a stimulus child's (_walk-local now stamps them for every check),
 * issue can be dropped. Leading determiners and pronouns are set aside from a key before comparing ("Its
 * acceleration" -> "acceleration"). A concept key in another SECTION's stem is soft; in the same section it stays hard
 * and the issue names the keyed item (`keyed_ref`) and the `phrase`, for the writer's second rewrite.
 */
const { leaves } = require('./_walk-local');
const { childFields } = require('./_child-view');
const { fold, stripLabel, tokens, str, issue, excerpt } = require('./_text-norm');

const LIMITS = { minTokens: 2, minLetters: 5, minDigits: 3 }; // design_pending: no source
const SKIP_KEYS = new Set(['true', 'false', 'correct', 'incorrect', 'yes', 'no', 'صحیح', 'غلط']);
const UR_LETTERS = ['الف', 'ب', 'ج', 'د'];
const padded = (s) => ` ${tokens(s).join(' ')} `;
const ARTICLES = new Set(['a', 'an', 'the']);
const UNITS = new Set(['m', 's', 'kg', 'g', 'n', 'j', 'w', 'v', 'k', 'pa', 'hz', 'mol', 'cm', 'mm', 'km', 'ms', 'h', 'min', 'kj', 'kpa', 'ev', 'nm', 'ml', 'mg']); // design_pending
const CALC = /\b(?:calculate|compute|find|work out|determine|evaluate|how (?:much|many|long|far))\b/i; // design_pending
const SIGNED = /[+\-\u2212]\s*\d[\d./]*/g;
const signedOf = (s) => (fold(s).replace(/\u2212/g, '-').match(SIGNED) || []).map((x) => x.replace(/\s+/g, ''));
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const LEAD = /^\s*(?:its|the|a|an|his|her|their)\s+/i; // design_pending: the coordinator's list (round 6)
const bareKey = (key) => (key ? key.replace(LEAD, '') : key);
// design_pending (board seat to confirm): FBISE collects the Section A objective sheet before Sections B and C are
// written, so a key quoted in another section's stem cannot help the student; such a leak is soft.
const crossSection = (a, b) => !!(a.sectionId && b.sectionId && a.sectionId !== b.sectionId);

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

/** Every signed number of the key is in the text with its sign ("-1/2" is not in "+1/2"). */
const signsIn = (key, raw) => { const t = fold(raw).replace(/\u2212/g, '-').replace(/\s+/g, ''); return signedOf(key).every((x) => t.includes(x)); };
/** Only numbers and units: in its own calculation stem it is the given data, not a leak. */
const givenData = (key) => tokens(key).every((x) => /\p{N}/u.test(x) || UNITS.has(x));

/** Only units once exponents are set aside ("m/s^2", "m s^-1", "kJ/mol"). */
const unitOnly = (key) => { const t = tokens(str(key).replace(/\^\s*[-\u2212]?\d+/g, ' ').replace(/[\u00b2\u00b3\u00b9\u2070-\u209f]/g, ' ')); return t.length > 0 && t.every((x) => UNITS.has(x)); };
/** A number with or without units: data a board paper may give in any stem. */
const quantity = (key) => givenData(key) && tokens(key).some((x) => /\p{N}/u.test(x));

/** One word once articles and bare units are set aside, and no digit: chapter vocabulary in a board paper. */
function vocabulary(key) {
  const t = tokens(key);
  return !t.some((x) => /\p{N}/u.test(x)) && t.filter((x) => !ARTICLES.has(x) && !UNITS.has(x)).length <= 1;
}

function n18(ls, board) {
  const views = ls.map((n) => {
    const fields = childFields(n);
    const raw = (keep) => fields.filter(keep).map((f) => f.text).join(' . ');
    return {
      n,
      ownRaw: raw((f) => f.field !== 'options' && f.field !== 'words'),
      allRaw: raw(() => true),
      noOptionsRaw: raw((f) => f.field !== 'options'),
      own: padded(fields.filter((f) => f.field !== 'options' && f.field !== 'words').map((f) => f.text).join(' . ')),
      all: padded(fields.map((f) => f.text).join(' . ')),
      noOptions: padded(fields.filter((f) => f.field !== 'options').map((f) => f.text).join(' . ')),
    };
  });
  const out = [];
  views.forEach((v, i) => {
    const key = board ? bareKey(keyOf(v.n.item)) : keyOf(v.n.item);
    if (!key || !searchable(key)) return;
    const needle = padded(key);
    if (v.own.includes(needle) && signsIn(key, v.ownRaw)) { out.push(leak(v.n, key, 'its own stem', !(givenData(key) && CALC.test(v.ownRaw)))); return; }
    const reuseOk = board && Array.isArray(v.n.item.options) && v.n.item.options.length > 1; // an MCQ key
    const other = views.find((w, j) => j !== i && (reuseOk ? w.noOptions : w.all).includes(needle) && signsIn(key, reuseOk ? w.noOptionsRaw : w.allRaw));
    if (!other || (board && unitOnly(key))) return;
    const soft = (reuseOk && vocabulary(key)) || (board && (quantity(key) || crossSection(v.n, other.n)));
    out.push({ ...leak(other.n, key, `the key of ${v.n.ref}`, !soft), ...(board ? { keyed_ref: v.n.ref, phrase: key.trim() } : {}) });
  });
  return out;
}
/** The numeric and multi-word keys of a paper, in walk order, once each (the repair ask is told not to state them). */
function usedKeys(examJson) {
  const out = [];
  leaves(examJson).forEach((n) => {
    const key = keyOf(n.item);
    if (key && searchable(key) && !vocabulary(key) && !out.includes(key.trim())) out.push(key.trim());
  });
  return out;
}
const leak = (n, key, where, hard = true) => issue('N18', 'KEY_IN_STEM', n.ref, `child view repeats ${where} "${excerpt(key)}"`, hard);

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

function run(examJson, ctx) {
  const ls = leaves(examJson);
  const issues = n18(ls, !!ctx && ctx.mode === 'board');
  ls.forEach((n) => { if (n.item.type === 'match') issues.push(...n19(n.item, n.ref)); });
  return { ok: !issues.some((i) => i.hard), issues };
}

module.exports = { id: 'N18/N19', name: 'key-leak', hard: true, modes: ['free', 'board'], LIMITS, run, usedKeys };
