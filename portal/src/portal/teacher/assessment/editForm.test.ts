import { describe, it, expect } from 'vitest';
import type { AddKind, EditFields } from '../../services/api';
import { addedEdit, blankValues, existingEdit, showAnswerBox, showCorrect, valuesFromFields } from './editForm';

/**
 * bd-fmf24g.6 — Edit a question / Add a question send the bot exactly the keys today's editor sends
 * (components/assessment-edit QuestionFields.done / AddQuestionFields.done); the bot owns every rule.
 */

const fields = (over: Partial<EditFields>): EditFields => ({
  shape: 'standard', question: 'Q', marks: '2', answer: 'A', lines: '3', lines_default: 3,
  lines_options: [], show_lines: true, ...over,
});

describe('existingEdit', () => {
  it('standard: answer, marks, lines (+ linesDefault); the question only when she changed it', () => {
    const f = fields({});
    expect(existingEdit(f, { ...valuesFromFields(f), answer: 'B' })).toEqual({ marks: '2', answer: 'B', lines: '3', linesDefault: 3 });
    expect(existingEdit(f, { ...valuesFromFields(f), question: 'Q2' })).toMatchObject({ question: 'Q2' });
  });

  it('standard without lines sends no lines', () => {
    const f = fields({ show_lines: false });
    expect(existingEdit(f, valuesFromFields(f))).toEqual({ marks: '2', answer: 'A' });
  });

  it('options with a correct choice: slots + correct', () => {
    const f = fields({ shape: 'options', slots: ['a', 'b', 'c', 'd'], correct: '1', show_correct: true });
    expect(showCorrect(f)).toBe(true);
    expect(existingEdit(f, { ...valuesFromFields(f), correct: '2' })).toEqual({ marks: '2', slots: ['a', 'b', 'c', 'd'], correct: '2' });
  });

  it('several-correct options use the answer box instead', () => {
    const f = fields({ shape: 'options', slots: ['a', 'b'], msq: true });
    expect(showCorrect(f)).toBe(false);
    expect(showAnswerBox(f)).toBe(true);
    expect(existingEdit(f, valuesFromFields(f))).toEqual({ marks: '2', slots: ['a', 'b'], answer: 'A' });
  });

  it('columns, words, passage, comprehension', () => {
    const cols = fields({ shape: 'columns', pairs: [{ left: 'x', right: 'y' }] });
    expect(existingEdit(cols, valuesFromFields(cols))).toEqual({ marks: '2', pairs: [{ left: 'x', right: 'y' }] });
    const words = fields({ shape: 'words', slots: ['w1', 'w2'] });
    expect(existingEdit(words, valuesFromFields(words))).toEqual({ marks: '2', slots: ['w1', 'w2'], answer: 'A' });
    const passage = fields({ shape: 'passage', passage: 'P' });
    expect(existingEdit(passage, valuesFromFields(passage))).toEqual({ marks: '2', passage: 'P', answer: 'A' });
    const comp = fields({ shape: 'comprehension', passage: 'P' });
    expect(existingEdit(comp, valuesFromFields(comp))).toEqual({ marks: '2', passage: 'P' });
  });
});

const kind = (over: Partial<AddKind>): AddKind => ({
  kind: 'Short Questions', label: 'Short', layout: 'standard', section: 'subjective', marks: 2, lines: 3, ...over,
});

describe('addedEdit', () => {
  it('standard: question, answer, marks, lines as typed', () => {
    const k = kind({});
    expect(addedEdit(k, { ...blankValues(k), question: 'Q', answer: 'A', marks: '3', lines: '4' }))
      .toEqual({ question: 'Q', answer: 'A', marks: '3', lines: '4' });
  });

  it('options: one correct, or several (msq); True/False starts from its preset options', () => {
    const tf = kind({ kind: 'True/False', layout: 'options', presetOptions: ['True', 'False'] });
    const v = blankValues(tf);
    expect(v.slots.slice(0, 2)).toEqual(['True', 'False']);
    expect(addedEdit(tf, { ...v, question: 'Q', correct: '0', marks: '1' })).toMatchObject({ question: 'Q', slots: v.slots, correct: '0', marks: '1' });
    const msq = kind({ kind: 'MSQs', layout: 'options', msq: true });
    expect(addedEdit(msq, { ...blankValues(msq), correctMany: ['0', '2'] })).toMatchObject({ correctMany: ['0', '2'] });
  });

  it('words with meanings send meanings; without, an answer', () => {
    const wm = kind({ kind: 'Word Meanings', layout: 'words', meanings: true });
    expect(addedEdit(wm, blankValues(wm))).toHaveProperty('meanings');
    const w = kind({ kind: 'Missing Letters', layout: 'words' });
    expect(addedEdit(w, blankValues(w))).toHaveProperty('answer');
  });

  it('comprehension: question, passage and parts, no marks of its own', () => {
    const c = kind({ kind: 'Comprehension Passage', layout: 'comprehension' });
    const out = addedEdit(c, { ...blankValues(c), passage: 'P' });
    expect(out).toEqual({ question: '', passage: 'P', subs: [{ question: '', answer: '', marks: '' }] });
  });
});
