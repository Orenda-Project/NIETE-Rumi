'use strict';
/**
 * D17 near-dup (bd-5jmnfj.38.30 round 8): two MCQs in one section that ask the same thing with the same key.
 * A live G11 chemistry paper asked "number of orbitals in a d sub-shell" twice (key 5) and "shape of an s
 * orbital" twice (spherical / spherically symmetrical). Hard on the LATER item, so the shortfall drops it and
 * the slot's extras absorb it.
 *
 * Same question = the content words of the two stems overlap by >= stemOverlap of the shorter stem (each stem
 * with >= minWords content words), AND the key bodies match (equal, or one's content words contain the other's).
 * Passage MCQs compare on their own stems, never the shared passage.
 * Round 9: written items (SRQ/ERQ, no options) in one section pair on stem overlap alone (>= stemOverlap of the
 * shorter stem, each with >= minWrittenWords content words); the branches and parts of one question never pair. Pure.
 */
const { leaves } = require('./walk');
const { issue } = require('./common');
const T = require('./option-text');
const { tokens } = require('./_text-norm');

const LIMITS = { stemOverlap: 0.8, minWords: 2, minWrittenWords: 4 };
const ID = 'D17';
// function words plus the book-reference / question-frame words writers add without changing the question
const STOP = new Set(('a an the of in on at to for from by with and or is are was were be been it its this that these '
  + 'those which what how many much does do did make makes made up called known following given according book '
  + 'value values number numbers total one').split(' '));
// "number" is a stop word for the stem only: "the number of orbitals" and "how many orbitals" ask the same

const stem = (w) => {
  let s = w;
  for (let i = 0; i < 3 && s.length > 4; i += 1) {
    const m = s.match(/(ally|ly|ies|es|s|al|ing|ed)$/);
    if (!m) break;
    s = s.slice(0, -m[0].length) + (m[0] === 'ies' ? 'y' : '');
  }
  return s;
};
const words = (s, stop) => new Set(tokens(s).filter((w) => !stop.has(w)).map(stem));
const KEY_STOP = new Set('a an the of and or'.split(' '));

function shape(l) {
  const k = T.keyIndex(l.item);
  if (k < 0) return null;
  return { leaf: l, stem: words(l.item.question, STOP), key: words(T.stripLabel(l.item.options[k]), KEY_STOP) };
}

const subset = (a, b) => a.size > 0 && [...a].every((w) => b.has(w));
const sameSet = (a, b) => a.size >= LIMITS.minWords && a.size === b.size && [...a].every((w) => b.has(w));
function sameQuestion(x, y) {
  if (sameSet(x.stem, y.stem)) return true; // round 10: the same stem twice tests the same fact, whatever the key
  return overlap(x.stem, y.stem, LIMITS.minWords) && (subset(x.key, y.key) || subset(y.key, x.key));
}

const overlap = (a, b, min) => {
  const n = Math.min(a.size, b.size);
  return n >= min && [...a].filter((w) => b.has(w)).length / n >= LIMITS.stemOverlap;
};
const topOf = (ref) => (String(ref).match(/^[^#]*#\d+/) || [ref])[0];

function writtenDups(examJson, out) {
  const seen = new Map(); // sectionId -> written shapes so far
  leaves(examJson).forEach((l) => {
    const q = l.item;
    if (Array.isArray(q.options) || typeof q.question !== 'string' || l.sectionId == null) return;
    const s = { leaf: l, top: topOf(l.ref), stem: words(q.question, STOP) };
    const prior = seen.get(l.sectionId) || [];
    const twin = prior.find((p) => p.top !== s.top && overlap(p.stem, s.stem, LIMITS.minWrittenWords));
    if (twin) out.push(issue(ID, 'NEAR_DUP', l.ref, `asks the same as ${twin.leaf.ref}`, true, l.slot == null ? undefined : l.slot));
    else prior.push(s);
    seen.set(l.sectionId, prior);
  });
}

/** bd-qyi45h.15: would D17 pair items a and b? Two MCQs as in run (both keys found), two written items on stem
 * overlap alone; an MCQ and a written item never. Pure. */
function twins(a, b) {
  const mcq = (q) => Array.isArray(q.options);
  if (mcq(a) !== mcq(b) || typeof a.question !== 'string' || typeof b.question !== 'string') return false;
  if (!mcq(a)) return overlap(words(a.question, STOP), words(b.question, STOP), LIMITS.minWrittenWords);
  const x = shape({ item: a });
  const y = shape({ item: b });
  return !!(x && y && sameQuestion(x, y));
}

function run(examJson) {
  const out = [];
  const seen = new Map(); // sectionId -> shapes so far
  writtenDups(examJson, out);
  leaves(examJson).forEach((l) => {
    if (!Array.isArray(l.item.options) || l.sectionId == null) return;
    const s = shape(l);
    if (!s) return;
    const prior = seen.get(l.sectionId) || [];
    const twin = prior.find((p) => sameQuestion(p, s));
    if (twin) out.push(issue(ID, 'NEAR_DUP', l.ref, `asks the same as ${twin.leaf.ref}`, true, l.slot == null ? undefined : l.slot));
    else prior.push(s);
    seen.set(l.sectionId, prior);
  });
  return { ok: out.length === 0, issues: out };
}

module.exports = { id: ID, name: 'near-dup', hard: true, modes: ['board'], LIMITS, run, twins };
