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

/** Most lines a written answer can be given from the edit screen. */
const LINES_MAX = 15;

/** A TextArea holds 600 characters; an answer longer than that cannot be edited. */
const ANSWER_MAX = 600;

/** A RadioButtonsGroup option title is clipped at 30 characters on the device. */
const RADIO_TITLE_MAX = 30;

const cp = (s) => [...String(s ?? '')].length;

function _fitRadio(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (cp(t) <= RADIO_TITLE_MAX) return t;
  return `${[...t].slice(0, RADIO_TITLE_MAX - 1).join('')}…`;
}

/**
 * Which option the answer key names, as the id of that option on the screen.
 *
 * The generator stores the correct option's TEXT ("C) 600,000"); some papers
 * store only its letter. An exact match wins; else the leading letter; else
 * 'none', which leaves the stored answer alone.
 */
function correctIndexOf(question) {
  const options = Array.isArray(question?.options) ? question.options.map((o) => String(o ?? '').trim()) : [];
  const answer = String(question?.answer ?? '').trim();
  if (!answer || !options.length) return 'none';
  const exact = options.findIndex((o) => o === answer);
  if (exact >= 0) return String(exact);
  const letter = answer.match(/^\s*([A-F])\b/i);
  if (letter) {
    const L = letter[1].toUpperCase();
    const byLetter = options.findIndex((o) => {
      const m = o.match(/^\s*\(?([A-F])\)?[).:\s]/i);
      return m && m[1].toUpperCase() === L;
    });
    if (byLetter >= 0) return String(byLetter);
    // A bare letter with options that carry no letters: A is the first, B the second.
    if (/^\s*[A-F]\s*$/i.test(answer)) {
      const i = L.charCodeAt(0) - 65;
      if (i < options.length) return String(i);
    }
  }
  return 'none';
}

/**
 * What the paper prints for this question — the renderer's own answer, so the
 * screen can never pre-fill a number the paper would not print. The renderer
 * believes a stored `lines` only inside 0–15; anything else (one production
 * question carries 20) prints the type's default, and that is what she sees.
 */
function _effectiveLines(question, type) {
  return require('./assessment-paper.renderer').answerLinesFor(type, question);
}

/** Whether the stored `lines` is one the renderer prints as it is. */
function _storedLines(question) {
  return require('./assessment-paper.renderer').storedLines(question?.lines);
}

function _linesOptions() {
  const out = [];
  for (let i = 0; i <= LINES_MAX; i += 1) out.push({ id: String(i), title: String(i) });
  return out;
}

/**
 * What the screen shows before she touches it.
 *
 * `type` is the question type the paper prints it under — it decides whether a
 * written answer gets ruled lines (the renderer's NO_LINES) and whether an
 * options question is single- or multi-select. `labels` carries the two radio
 * titles that are words rather than her data, in her language.
 */
function fieldsFor(question, { type = '', labels = {} } = {}) {
  const q = question || {};
  const shape = shapeOf(q);
  const typeKey = String(type || '').trim().toLowerCase();
  const { NO_LINES } = require('./assessment-paper.renderer');
  const effective = _effectiveLines(q, type);
  const base = {
    shape,
    question: String(q.question || ''),
    marks: q.marks == null ? '' : String(q.marks),
    answer: q.answer == null ? '' : String(q.answer),
    lines: String(effective),
    lines_default: _storedLines(q) === null ? effective : null,
    lines_options: _linesOptions(),
    show_lines: shape === 'standard' && !NO_LINES.has(typeKey),
  };

  if (shape === 'options') {
    const slots = slotsOf(q.options);
    const filled = (q.options || []).slice(0, SLOT_CAP).length;
    const newLabel = labels.newOption || 'Option {n} (new)';
    const correctOptions = slots.slice(0, filled).map((text, i) => ({ id: String(i), title: _fitRadio(text) || `${i + 1}` }));
    if (filled < SLOT_CAP) correctOptions.push({ id: String(filled), title: _fitRadio(newLabel.replace('{n}', String(filled + 1))) });
    correctOptions.push({ id: 'none', title: _fitRadio(labels.notSet || '— not set —') });
    const msq = /msq/i.test(typeKey);
    return {
      ...base,
      slots,
      correct: correctIndexOf(q),
      correct_options: correctOptions,
      msq,
      show_correct: !msq,
      show_answer_text: msq,
    };
  }
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

/** Her text, trimmed — but only written if it differs from what is there. */
function _setText(target, key, raw, emptyMessage) {
  const text = String(raw).trim();
  if (!text) fail(emptyMessage);
  if (text !== String(target[key] ?? '').trim()) target[key] = text;
}

/** An answer-key entry: trimmed, capped, and cleared when she empties it. */
function _setAnswer(target, raw) {
  const text = String(raw ?? '').trim();
  if (cp(text) > ANSWER_MAX) fail(`An answer can be at most ${ANSWER_MAX} characters.`);
  if (!text) { delete target.answer; return; }
  if (text !== String(target.answer ?? '').trim()) target.answer = text;
}

/** Lines: blank leaves them; else 0–15 (or the stored value); the default is not an edit. */
function _setLines(target, raw, linesDefault) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return;
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 0 || n > LINES_MAX) {
    fail(`Answer lines must be a whole number from 0 to ${LINES_MAX}.`);
  }
  const stored = _storedLines(target);
  // Choosing the number the paper already prints by default is not an edit.
  if (stored === null && linesDefault != null && n === Number(linesDefault)) return;
  if (n !== stored) target.lines = n;
}

function _sameList(a, b) {
  const x = (a || []).map((v) => String(v ?? '').trim());
  const y = (b || []).map((v) => String(v ?? '').trim());
  return x.length === y.length && x.every((v, i) => v === y[i]);
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
      _setText(sub, 'question', e.question, 'The question cannot be empty. Untick it instead to take it off the paper.');
    }
    if (e.slots !== undefined) {
      const opts = filledSlots(e.slots);
      if (opts.length === 1) fail('A multiple-choice question needs at least two options.');
      if (!_sameList(opts, sub.options)) {
        if (opts.length) sub.options = opts; else delete sub.options;
      }
    }
    if (e.answer !== undefined) _setAnswer(sub, e.answer);
    const m = marksFrom(e.marks, sub.marks);
    if (m !== undefined) sub.marks = m;
    q.questions[i] = sub;
    return q;
  }

  if (e.question !== undefined) {
    _setText(q, 'question', e.question, 'The question cannot be empty. Untick it instead to take it off the paper.');
  }

  if (e.passage !== undefined) {
    _setText(q, 'passage', e.passage, 'The passage cannot be empty.');
  }

  if (e.slots !== undefined) {
    const values = filledSlots(e.slots);
    const shape = shapeOf(question);
    if (shape === 'options') {
      // Below two, it stops being a choice. Refused rather than silently
      // turning into a short question with a stray option attached.
      if (values.length < 2) fail('A multiple-choice question needs at least two options.');
      if (!_sameList(values, q.options)) q.options = values;
    } else if (shape === 'words') {
      if (!values.length) fail('Keep at least one word, or untick the question.');
      if (!_sameList(values, q.words)) q.words = values;
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
    if (!_sameList(left, q.column_a) || !_sameList(right, q.column_b)) {
      q.column_a = left;
      q.column_b = right;
    }
  }

  if (e.answer !== undefined) _setAnswer(q, e.answer);

  // The correct option, for a single-choice question. Stored as the option's
  // TEXT, the way the generator stores it, and read from the RAW slot she
  // marked (before blanks are closed up), so the index means what she saw.
  if (e.correct !== undefined && e.correct !== null && shapeOf(question) === 'options') {
    const c = String(e.correct);
    if (c !== 'none' && c !== '') {
      const i = Number(c);
      const raw = e.slots !== undefined ? (e.slots || [])[i] : (question.options || [])[i];
      const text = String(raw ?? '').trim();
      if (!Number.isInteger(i) || !text) fail('The option you marked correct is empty.');
      const unchanged = correctIndexOf(question) === c
        && String((question.options || [])[i] ?? '').trim() === text;
      if (!unchanged) q.answer = text;
    }
  }

  _setLines(q, e.lines, e.linesDefault);

  const m = marksFrom(e.marks, q.marks);
  if (m !== undefined) q.marks = m;

  // Last, so an edit made in the same save survives a later add-back.
  if (e.remove === true) q.removed = true;

  return q;
}

/** Marks and lines a question she adds starts with, by kind. */
const NEW_DEFAULTS = {
  short: { marks: 2, lines: 4 },
  long: { marks: 5, lines: 8 },
  mcq: { marks: 1, lines: 0 },
  fill: { marks: 1, lines: 0 },
};

/**
 * A question she writes herself. Every paper ships with an answer key, so an
 * added question must come with its answer — for an MCQ, a correct option.
 * Its place in the tree (and its shared instruction) is appendQuestion's job.
 */
function newQuestion(kind, edit) {
  const d = NEW_DEFAULTS[kind];
  if (!d) fail('Choose what kind of question to add.');
  const e = edit || {};
  const question = String(e.question ?? '').trim();
  if (!question) fail('The question cannot be empty.');

  const out = { question };
  if (kind === 'mcq') {
    const options = filledSlots(e.slots);
    if (options.length < 2) fail('A multiple-choice question needs at least two options.');
    const c = e.correct == null ? '' : String(e.correct);
    if (c === '' || c === 'none') fail('Mark the correct option — it goes in the answer key.');
    const text = String((e.slots || [])[Number(c)] ?? '').trim();
    if (!text) fail('The option you marked correct is empty.');
    out.options = options;
    out.answer = text;
  } else {
    const answer = String(e.answer ?? '').trim();
    if (!answer) fail('Write the answer too — it goes in the answer key.');
    if (cp(answer) > ANSWER_MAX) fail(`An answer can be at most ${ANSWER_MAX} characters.`);
    out.answer = answer;
  }

  out.marks = marksFrom(e.marks, d.marks);
  const lines = e.lines == null || String(e.lines).trim() === '' ? d.lines : Number(String(e.lines).trim());
  if (!Number.isInteger(lines) || lines < 0 || lines > LINES_MAX) {
    fail(`Answer lines must be a whole number from 0 to ${LINES_MAX}.`);
  }
  out.lines = lines;
  out.source = 'teacher';
  if (e.main_question) out.main_question = String(e.main_question);
  return out;
}

module.exports = {
  shapeOf, fieldsFor, applyEdit, SHAPES, SLOT_CAP,
  correctIndexOf, newQuestion, NEW_DEFAULTS, LINES_MAX, ANSWER_MAX, RADIO_TITLE_MAX,
};
