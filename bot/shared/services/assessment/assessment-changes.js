'use strict';
/**
 * A paper's changes, made somewhere other than WhatsApp, applied with WhatsApp's rules.
 *
 * The portal sends WHAT she changed (ids from the version she opened), never a
 * rebuilt tree, so the portal needs to know nothing about question shapes. Every
 * rule lives in assessment-edit / assessment-selection; this file only fixes the
 * order: edits, then removals and restores, then additions — appended last, so
 * no id she was given moves while the list is applied.
 *
 * Every refusal is collected, not just the first, so she fixes them all in one go.
 */
const Edit = require('./assessment-edit');
const Selection = require('./assessment-selection');
const QuestionTypes = require('./question-types');

const GONE = 'That question is no longer on this paper.';

function _rejected(err) {
  return err && err.code === 'EDIT_REJECTED';
}

// ---------------------------------------------------------------------------
// Catalogue types added from the portal (WhatsApp never calls this half).
// ---------------------------------------------------------------------------

/** Types that need a drawing; a text box cannot make one. */
const PICTURE_TYPES = new Set([
  'Label the Diagram', 'Mind Map', 'Flow Chart', 'Picture Description', 'Graphs & Geometric Problems',
]);
const OPTIONS_TYPES = new Set(['MCQs', 'MSQs', 'True/False', 'Circle the Correct Answer']);
const WORDS_TYPES = new Set(['Word Meanings', 'Word Sentences']);
const COMPREHENSION_TYPES = new Set(['Comprehension Passage', 'Reading']);
const LONG_TYPES = new Set([
  'Long Question', 'Long Questions', 'Essay Writing', 'Letter Writing',
  'Application Writing', 'Story Writing', 'Paragraph Writing',
]);
const REFUSED_KIND = "That kind of question can't be added to this paper.";

const _fail = (message) => { throw Object.assign(new Error(message), { code: 'EDIT_REJECTED' }); };
const _cp = (s) => [...String(s ?? '')].length;

function layoutOf(type) {
  if (OPTIONS_TYPES.has(type)) return 'options';
  if (type === 'Match the Column') return 'columns';
  if (WORDS_TYPES.has(type)) return 'words';
  if (COMPREHENSION_TYPES.has(type)) return 'comprehension';
  return 'standard';
}

function isLegacyKind(kind) {
  return Object.prototype.hasOwnProperty.call(Edit.NEW_DEFAULTS, kind);
}

/** Marks and lines a fresh question of this type starts with. */
function defaultsFor(type, subject, grade) {
  const layout = layoutOf(type);
  if (layout === 'options') return { marks: 1, lines: 0 };
  if (layout === 'columns' || layout === 'words') return { marks: 2, lines: 0 };
  if (layout === 'comprehension') return { marks: 0, lines: 0 };
  const { answerLinesFor } = require('./assessment-paper.renderer');
  let marks = 2;
  if (LONG_TYPES.has(type)) marks = 5;
  else if (QuestionTypes.categoryOf(type, subject, grade) === 'objective') marks = 1;
  return { marks, lines: answerLinesFor(type, {}) };
}

/** Same rule as assessment-edit's marksFrom: blank takes the default. */
function _marks(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1) _fail('Marks must be a whole number, 1 or more.');
  return n;
}

function _lines(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 0 || n > Edit.LINES_MAX) {
    _fail(`Answer lines must be a whole number from 0 to ${Edit.LINES_MAX}.`);
  }
  return n;
}

function _answer(raw, required) {
  const text = String(raw ?? '').trim();
  if (!text) { if (required) _fail('Write the answer too — it goes in the answer key.'); return ''; }
  if (_cp(text) > Edit.ANSWER_MAX) _fail(`An answer can be at most ${Edit.ANSWER_MAX} characters.`);
  return text;
}

function _questionText(raw, fallback) {
  const text = String(raw ?? '').trim();
  if (text) return text;
  if (fallback) return fallback;
  return _fail('The question cannot be empty.');
}

function _buildOptions(type, e, d) {
  const question = _questionText(e.question);
  const supplied = Array.isArray(e.slots) && e.slots.some((s) => String(s ?? '').trim());
  const raw = supplied || type !== 'True/False' ? (e.slots || []) : ['True', 'False'];
  const options = raw.map((s) => String(s ?? '').trim()).filter(Boolean);
  if (options.length < 2) _fail('A multiple-choice question needs at least two options.');
  const textAt = (i) => String(raw[Number(i)] ?? '').trim();
  let answer;
  if (type === 'MSQs') {
    const many = Array.isArray(e.correctMany) ? e.correctMany : [];
    if (!many.length) _fail('Mark the correct option — it goes in the answer key.');
    const indexes = [...new Set(many.map((i) => Number(i)))].sort((x, y) => x - y);
    const texts = indexes.map(textAt);
    if (texts.some((t) => !t)) _fail('The option you marked correct is empty.');
    answer = texts.join(', ');
  } else {
    const c = e.correct == null ? '' : String(e.correct);
    if (c === '' || c === 'none') _fail('Mark the correct option — it goes in the answer key.');
    answer = textAt(c);
    if (!answer) _fail('The option you marked correct is empty.');
  }
  return { question, options, answer, marks: _marks(e.marks, d.marks), lines: d.lines };
}

function _buildColumns(e, d) {
  const left = [];
  const right = [];
  for (const pair of Array.isArray(e.pairs) ? e.pairs : []) {
    const l = String(pair?.left ?? '').trim();
    const r = String(pair?.right ?? '').trim();
    if (!l && !r) continue;
    if (!l || !r) _fail('A pair needs both sides. Clear both to remove it.');
    left.push(l); right.push(r);
  }
  if (!left.length) _fail('Add at least one pair.');
  const n = right.length;
  // Rotated by one so no right answer sits beside its own left (n >= 2).
  const shuffled = n >= 2 ? right.map((_, i) => right[(i + 1) % n]) : right.slice();
  return {
    question: _questionText(e.question, 'Match column A with column B.'),
    column_a: left, column_b: shuffled,
    answer: left.map((l, i) => `${l} → ${right[i]}`).join('; '),
    marks: _marks(e.marks, d.marks), lines: d.lines,
  };
}

/**
 * Word Meanings: every word needs its meaning, typed beside it, and the key
 * lists them one per line. A meaning is a fact; a sample sentence (Word
 * Sentences) is one of many right answers, so that one stays optional.
 */
function _wordMeanings(e) {
  const slots = Array.isArray(e.slots) ? e.slots : [];
  const meanings = Array.isArray(e.meanings) ? e.meanings : [];
  const lines = [];
  for (let i = 0; i < Math.max(slots.length, meanings.length); i += 1) {
    const word = String(slots[i] ?? '').trim();
    const meaning = String(meanings[i] ?? '').trim();
    if (!word && meaning) _fail(`Meaning ${i + 1} has no word beside it.`);
    if (!word) continue;
    if (!meaning) _fail(`Write the meaning of "${word}" too — it goes in the answer key.`);
    lines.push(`${word} — ${_answer(meaning, true)}`);
  }
  return lines.join('\n');
}

function _buildWords(type, e, d) {
  const words = (Array.isArray(e.slots) ? e.slots : []).map((s) => String(s ?? '').trim()).filter(Boolean);
  if (!words.length) _fail('Add at least one word.');
  const out = {
    question: _questionText(e.question, type === 'Word Meanings'
      ? 'Write the meaning of each word.' : 'Use each word in a sentence.'),
    words, marks: _marks(e.marks, d.marks), lines: d.lines,
  };
  const answer = type === 'Word Meanings' ? _wordMeanings(e) : _answer(e.answer, false);
  if (answer) out.answer = answer;
  return out;
}

function _buildComprehension(e) {
  const passage = String(e.passage ?? '').trim();
  if (!passage) _fail('The passage cannot be empty.');
  const subs = Array.isArray(e.subs) ? e.subs : [];
  if (!subs.length) _fail('Add at least one question about the passage.');
  const questions = subs.map((s, i) => {
    const question = String(s?.question ?? '').trim();
    const answer = String(s?.answer ?? '').trim();
    if (!question || !answer) _fail(`Part ${i + 1} needs its question and its answer.`);
    const sub = { question, answer: _answer(answer, true), marks: _marks(s.marks, 1) };
    const lines = _lines(s.lines, null);
    if (lines !== null) sub.lines = lines;
    return sub;
  });
  return { question: _questionText(e.question, 'Read the passage and answer the questions.'), passage, questions };
}

/** A question of any catalogue type, built from what the portal sent. */
function buildAdded(kind, edit, { subject, grade } = {}) {
  if (isLegacyKind(kind)) return Edit.newQuestion(kind, edit);
  const offered = QuestionTypes.forSubject(subject, grade).some((t) => t.id === kind);
  if (!kind || !offered || PICTURE_TYPES.has(kind)) _fail(REFUSED_KIND);
  const e = edit || {};
  const d = defaultsFor(kind, subject, grade);
  const layout = layoutOf(kind);
  let built;
  if (layout === 'options') built = _buildOptions(kind, e, d);
  else if (layout === 'columns') built = _buildColumns(e, d);
  else if (layout === 'words') built = _buildWords(kind, e, d);
  else if (layout === 'comprehension') built = _buildComprehension(e);
  else {
    built = {
      question: _questionText(e.question), answer: _answer(e.answer, true),
      marks: _marks(e.marks, d.marks), lines: _lines(e.lines, d.lines),
    };
  }
  return { ...built, source: 'teacher' };
}

const _ALIAS_GROUPS = [
  ['short questions', 'short answer'],
  ['long question', 'long questions', 'long answers', 'detailed answers'],
].map((g) => new Set(g.map((k) => _norm(k))));

function _norm(key) {
  return String(key ?? '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/s$/, '');
}

/** The same heading under another spelling (MCQ / MCQs, Short questions / Short Questions). */
function _sameHeading(a, b) {
  const x = _norm(a);
  const y = _norm(b);
  if (x === y) return true;
  return _ALIAS_GROUPS.some((g) => g.has(x) && g.has(y));
}

/** Put a question under its own heading, joining the heading if the paper has it. */
function placeTyped(tree, { type: wanted, subject, grade } = {}, question) {
  let type = wanted;
  const next = JSON.parse(JSON.stringify(tree || {}));
  let found = null;
  for (const section of ['seen', 'unseen']) {
    const branch = next[section];
    if (!branch || typeof branch !== 'object') continue;
    for (const [category, types] of Object.entries(branch)) {
      if (types && typeof types === 'object' && !found && Object.prototype.hasOwnProperty.call(types, type)) {
        found = { section, category };
      }
    }
  }
  if (!found) {
    let key = null;
    for (const section of ['seen', 'unseen']) {
      const branch = next[section];
      if (!branch || typeof branch !== 'object') continue;
      for (const [category, types] of Object.entries(branch)) {
        if (!types || typeof types !== 'object' || found) continue;
        const hit = Object.keys(types).find((k) => _sameHeading(k, type));
        if (hit) { found = { section, category }; key = hit; }
      }
    }
    if (key) type = key;
  }
  if (!found) {
    found = {
      section: next.unseen && typeof next.unseen === 'object' ? 'unseen' : 'seen',
      category: QuestionTypes.categoryOf(type, subject, grade),
    };
  }
  const sec = next[found.section] || (next[found.section] = {});
  const cat = sec[found.category] || (sec[found.category] = {});
  let path = [found.section, found.category, type];
  let list;
  const entry = cat[type];
  if (entry && !Array.isArray(entry) && typeof entry === 'object') {
    const subKeys = Object.keys(entry).filter((k) => Array.isArray(entry[k]));
    const subType = subKeys[subKeys.length - 1];
    if (subType) { list = entry[subType]; path = [...path, subType]; }
  }
  if (!list) {
    if (!Array.isArray(cat[type])) cat[type] = [];
    list = cat[type];
  }
  const added = { ...JSON.parse(JSON.stringify(question)) };
  if (added.main_question === undefined) {
    const sibling = [...list].reverse().find((q) => q && q.main_question);
    if (sibling) added.main_question = sibling.main_question;
  }
  list.push(added);
  return { tree: next, id: Selection.questionId(path, list.length - 1) };
}

function applyChanges(tree, changes = {}, { subject, grade } = {}) {
  const edits = changes.edits || [];
  const removed = changes.removed || [];
  const restored = changes.restored || [];
  const added = changes.added || [];
  if (!edits.length && !removed.length && !restored.length && !added.length) {
    return { ok: false, code: 'NO_CHANGES', errors: [] };
  }

  const known = new Set(Selection.indexQuestions(tree).map((q) => q.id));
  const errors = [];
  let next = JSON.parse(JSON.stringify(tree || {}));

  for (const { id, edit } of edits) {
    if (!known.has(id)) { errors.push({ id, message: GONE }); continue; }
    const current = Selection.indexQuestions(next).find((q) => q.id === id).question;
    try {
      next = Selection.replaceAt(next, id, Edit.applyEdit(current, edit));
    } catch (err) {
      if (!_rejected(err)) throw err;
      const e = { id, message: err.message };
      if (edit && edit.subIndex != null) e.subIndex = Number(edit.subIndex);
      errors.push(e);
    }
  }

  for (const [list, flag] of [[removed, true], [restored, false]]) {
    for (const id of list) {
      const t = known.has(id) ? Selection.setRemoved(next, id, flag) : null;
      if (!t) { errors.push({ id, message: GONE }); continue; }
      next = t;
    }
  }

  added.forEach((a, addedIndex) => {
    try {
      const kind = a && a.kind;
      if (isLegacyKind(kind)) {
        const question = Edit.newQuestion(kind, a.edit);
        next = Selection.appendQuestion(next, { kind, subject, grade }, question).tree;
      } else {
        const question = buildAdded(kind, a && a.edit, { subject, grade });
        next = placeTyped(next, { type: kind, subject, grade }, question).tree;
      }
    } catch (err) {
      if (!_rejected(err)) throw err;
      errors.push({ addedIndex, message: err.message });
    }
  });

  if (errors.length) return { ok: false, code: 'INVALID_CHANGES', errors };
  if (!Selection.indexQuestions(next).some((q) => !q.removed)) {
    return { ok: false, code: 'EMPTY_SELECTION', errors: [] };
  }
  return { ok: true, tree: next };
}

module.exports = {
  applyChanges, GONE, buildAdded, placeTyped, layoutOf, defaultsFor, isLegacyKind, PICTURE_TYPES,
};
