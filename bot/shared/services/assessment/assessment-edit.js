'use strict';
/**
 * Editing one question.
 *
 * A multiple-choice question and a comprehension passage do not want the same
 * controls, so there is one screen per question SHAPE. This module owns three
 * things: which shape a question is, what its screen is pre-filled with, and how
 * what comes back is written into the question.
 *
 * The shape is deliberately NOT a new classification. It is the same
 * discrimination `assessment-paper.renderer` makes when it prints, in the same
 * precedence — because a question that prints as a match-the-column and edits as
 * a plain short question would lose its columns the moment she saved. A test
 * pins the two orders together.
 *
 * On adding and removing: Flow JSON has no way to grow a text box. A screen's
 * components are fixed when it is published; only labels, values and visibility
 * are data. So "add an option" is not a button — the screen carries blank inputs
 * that are already there, and a filled blank IS the new option. Clearing a
 * filled one removes it. Both directions, one save, no round-trip.
 */

/**
 * Six shapes, six screens.
 *
 * Order matters and mirrors the renderer's if/else chain exactly.
 */
const SHAPES = ['options', 'columns', 'words', 'comprehension', 'passage', 'standard'];

/**
 * How many blanks a growable list offers.
 *
 * Six options, six pairs, six words — enough for any primary-school question,
 * and it keeps the screen scrollable rather than endless. A question already at
 * six is shown no blanks, which is the honest way to say "this is full".
 */
const SLOT_CAP = 6;

/** Which screen this question gets. Mirrors renderQuestion's precedence. */
function shapeOf(question) {
  if (!question || typeof question !== 'object') return 'standard';
  if (Array.isArray(question.options) && question.options.length) return 'options';
  if (question.column_a || question.column_b) return 'columns';
  if (Array.isArray(question.words) && question.words.length) return 'words';
  if (question.passage && Array.isArray(question.questions)) return 'comprehension';
  if (question.passage) return 'passage';
  return 'standard';
}

/** A list padded with blanks up to the cap — the slots she types into. */
function slotsOf(list) {
  const filled = (list || []).map((v) => String(v ?? ''));
  const out = filled.slice(0, SLOT_CAP);
  while (out.length < SLOT_CAP) out.push('');
  return out;
}

/** What the screen shows before she touches it. */
function fieldsFor(question) {
  const q = question || {};
  const shape = shapeOf(q);
  const base = {
    shape,
    question: String(q.question || ''),
    marks: q.marks == null ? '' : String(q.marks),
  };

  if (shape === 'options') return { ...base, slots: slotsOf(q.options) };
  if (shape === 'words') return { ...base, slots: slotsOf(q.words) };

  if (shape === 'columns') {
    // Padded to the LONGER column: a ragged pair is real data and dropping the
    // unmatched side would delete half a question on the way to the screen.
    const a = q.column_a || [];
    const b = q.column_b || [];
    const n = Math.max(a.length, b.length);
    const pairs = [];
    for (let i = 0; i < Math.max(n, SLOT_CAP); i += 1) {
      if (i >= SLOT_CAP && i >= n) break;
      pairs.push({ left: String(a[i] ?? ''), right: String(b[i] ?? '') });
    }
    return { ...base, pairs };
  }

  if (shape === 'comprehension') {
    // The sub-questions are LISTED, not inlined: a passage plus three
    // sub-questions with their own wording, marks and options is nine or more
    // fields, and the passage alone wants most of the screen.
    return {
      ...base,
      passage: String(q.passage || ''),
      subs: (q.questions || []).map((sub, index) => ({
        index,
        text: typeof sub === 'string' ? sub : String(sub?.question || ''),
        marks: typeof sub === 'string' ? null : (sub?.marks ?? null),
      })),
    };
  }

  if (shape === 'passage') {
    return { ...base, passage: String(q.passage || ''), section: q.section || null };
  }

  return base;
}

function fail(message) {
  throw Object.assign(new Error(message), { code: 'EDIT_REJECTED' });
}

/** Marks: a positive whole number, or left exactly as it was. */
function marksFrom(raw, previous) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return previous;
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1) fail('Marks must be a whole number, 1 or more.');
  return n;
}

/** The non-empty slots, in order. A cleared field is a removal. */
function filledSlots(slots) {
  return (slots || []).map((s) => String(s ?? '').trim()).filter((s) => s !== '');
}

/**
 * Write her edit into the question.
 *
 * Only the fields she actually sent are touched; everything else in the question
 * is carried through untouched. Returns a NEW object — the stored tree is never
 * mutated, because the caller writes it back at a path and a half-applied edit
 * would be unrecoverable.
 */
function applyEdit(question, edit) {
  const q = JSON.parse(JSON.stringify(question || {}));
  const e = edit || {};

  // A sub-question is a question: its own wording, its own marks, its own place
  // on the printed paper. It is edited through its parent, at its own index.
  if (e.subIndex !== undefined && e.subIndex !== null) {
    const i = Number(e.subIndex);
    if (!Array.isArray(q.questions) || !q.questions[i]) fail('That sub-question is no longer there.');
    const sub = typeof q.questions[i] === 'string'
      ? { question: q.questions[i] } : { ...q.questions[i] };

    if (e.question !== undefined) {
      const text = String(e.question).trim();
      if (!text) fail('The question cannot be empty. Untick it instead to take it off the paper.');
      sub.question = text;
    }
    if (e.slots !== undefined) {
      const opts = filledSlots(e.slots);
      if (opts.length === 1) fail('A multiple-choice question needs at least two options.');
      if (opts.length) sub.options = opts; else delete sub.options;
    }
    const m = marksFrom(e.marks, sub.marks);
    if (m !== undefined) sub.marks = m;
    q.questions[i] = sub;
    return q;
  }

  if (e.question !== undefined) {
    const text = String(e.question).trim();
    if (!text) fail('The question cannot be empty. Untick it instead to take it off the paper.');
    q.question = text;
  }

  if (e.passage !== undefined) {
    const text = String(e.passage).trim();
    if (!text) fail('The passage cannot be empty.');
    q.passage = text;
  }

  if (e.slots !== undefined) {
    const values = filledSlots(e.slots);
    const shape = shapeOf(question);
    if (shape === 'options') {
      // Below two, it stops being a choice. Refused rather than silently
      // turning into a short question with a stray option attached.
      if (values.length < 2) fail('A multiple-choice question needs at least two options.');
      q.options = values;
    } else if (shape === 'words') {
      if (!values.length) fail('Keep at least one word, or untick the question.');
      q.words = values;
    }
  }

  if (e.pairs !== undefined) {
    const left = [];
    const right = [];
    for (const pair of e.pairs) {
      const l = String(pair?.left ?? '').trim();
      const r = String(pair?.right ?? '').trim();
      if (!l && !r) continue;             // both cleared — the pair is removed
      // One side cleared would shift every pair below it out of alignment. That
      // silent mismatch is the reason the two-separate-lists design was rejected;
      // refusing here is the same principle at the field level.
      if (!l || !r) fail('A pair needs both sides. Clear both to remove it.');
      left.push(l);
      right.push(r);
    }
    if (!left.length) fail('Keep at least one pair, or untick the question.');
    q.column_a = left;
    q.column_b = right;
  }

  const m = marksFrom(e.marks, q.marks);
  if (m !== undefined) q.marks = m;

  return q;
}

module.exports = { shapeOf, fieldsFor, applyEdit, SHAPES, SLOT_CAP };
