'use strict';
/**
 * D17 near-dup (bd-5jmnfj.38.30 round 8): two MCQs in one section that ask the same thing with the same key.
 * A live G11 chemistry paper asked "number of orbitals in a d sub-shell" twice (key 5) and "shape of an s
 * orbital" twice (spherical / spherically symmetrical). Hard on the LATER item, so the shortfall drops it and
 * the slot's extras absorb it.
 *
 * Same question = the content words of the two stems overlap by >= stemOverlap of the shorter stem (each stem
 * with >= minWords content words), AND the key bodies match (equal, or one's content words contain the other's).
 * Passage MCQs compare on their own stems, never the shared passage. Pure.
 */
const { leaves } = require('./walk');
const { issue } = require('./common');
const T = require('./option-text');
const { tokens } = require('./_text-norm');

const LIMITS = { stemOverlap: 0.8, minWords: 2 };
const ID = 'D17';
// function words plus the book-reference / question-frame words writers add without changing the question
const STOP = new Set(('a an the of in on at to for from by with and or is are was were be been it its this that these '
  + 'those which what how many much does do did make makes made up called known following given according book '
  + 'value values number numbers total').split(' '));
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
function sameQuestion(x, y) {
  const n = Math.min(x.stem.size, y.stem.size);
  if (n < LIMITS.minWords) return false;
  const shared = [...x.stem].filter((w) => y.stem.has(w)).length;
  return shared / n >= LIMITS.stemOverlap && (subset(x.key, y.key) || subset(y.key, x.key));
}

function run(examJson) {
  const out = [];
  const seen = new Map(); // sectionId -> shapes so far
  leaves(examJson).forEach((l) => {
    if (!Array.isArray(l.item.options) || l.sectionId == null) return;
    const s = shape(l);
    if (!s) return;
    const prior = seen.get(l.sectionId) || [];
    const twin = prior.find((p) => sameQuestion(p, s));
    if (twin) out.push(issue(ID, 'NEAR_DUP', l.ref, `asks the same as ${twin.leaf.ref} with the same key`, true, l.slot == null ? undefined : l.slot));
    else prior.push(s);
    seen.set(l.sectionId, prior);
  });
  return { ok: out.length === 0, issues: out };
}

module.exports = { id: ID, name: 'near-dup', hard: true, modes: ['board'], LIMITS, run };
