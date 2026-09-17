/**
 * Shared harness for the RELIGIOUS_MARKS unit suites.
 *
 * Extracted when the English-medium rulings (bd-xo6mb, bd-c61xh) pushed
 * `religious-marks-false-positives.test.js` past the 300-line limit. Nothing here is new — it is
 * the same fixture handling those suites already used, in one place so a third suite does not
 * copy it a third time.
 */
const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', '..', 'bot', 'vendor', 'lp-v9');
const { lint } = require(path.join(V, 'lint_lp.js'));

const BASE = path.join(__dirname, '..', '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(BASE, 'utf8');

/** `lint()` returns { fails, warns } — a BLOCKING defect is in `fails`. */
const fails = (doc) => (lint(doc).fails || []).map(String);
const religious = (doc) => fails(doc).filter((e) => e.startsWith('RELIGIOUS_MARKS'));
const blocked = (doc) => religious(doc).length > 0;

/**
 * Put `text` in a teacher-facing prose slot, with the human-review hold already set.
 *
 * It MUTATES the fixture's existing `paragraph` block rather than substituting a block of its
 * own. An invented block shape fails SCHEMA, `lint` stops at the schema tier and never reaches
 * the religious gate at all — so every "does not block" assertion would pass while asserting
 * nothing. Mutating a block the fixture already validates keeps the document schema-clean and
 * the gate actually running.
 */
function withProse(text) {
  const d = JSON.parse(raw);
  d.needs_human_review = true;               // isolate checks 1-5 from check 6
  const para = d.sections[1].blocks.find((b) => b.type === 'paragraph');
  para.text = text;
  return d;
}

/** A second teacher-facing prose slot, for the cases that need the trigger and the defect apart. */
function setSecondProse(d, text) {
  d.sections[1].blocks.find((b) => b.type === 'key_points').items = [text];
  return d;
}

/** The untouched fixture — a document with no religious content at all. */
const cleanDoc = () => JSON.parse(raw);

module.exports = { lint, fails, religious, blocked, withProse, setSecondProse, cleanDoc };
