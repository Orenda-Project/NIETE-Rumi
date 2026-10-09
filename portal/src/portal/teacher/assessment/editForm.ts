import type { AddKind, EditFields } from '../../services/api';

/**
 * bd-fmf24g.6 — the boxes of Edit a question / Add a question and what they send. The keys are exactly
 * today's editor's (components/assessment-edit QuestionFields.done, AddQuestionFields.done): which boxes
 * a shape has is drawing, not a rule; whether the values are acceptable is the bot's call
 * (POST /assessment/edit/:id/validate, then /save).
 */

export type Pair = { left: string; right: string };
export type Part = { question: string; answer: string; marks: string };

export type FormValues = {
  question: string;
  marks: string;
  answer: string;
  lines: string;
  slots: string[];
  correct: string;
  correctMany: string[];
  pairs: Pair[];
  passage: string;
  meanings: string[];
  subs: Part[];
};

/** How many option / word boxes a new question starts with (today's editor's SLOTS). */
export const NEW_SLOTS = 6;

/** An options question with one correct choice to tick. */
export const showCorrect = (f: EditFields) => f.shape === 'options' && f.show_correct !== false && !f.msq;
/** An options question whose answer is written (several correct, or the type writes it). */
export const showAnswerBox = (f: EditFields) => f.shape === 'options' && !showCorrect(f) && (!!f.msq || !!f.show_answer_text);

export function valuesFromFields(f: EditFields): FormValues {
  return {
    question: f.question ?? '',
    marks: f.marks ?? '',
    answer: f.answer ?? '',
    lines: f.lines ?? '',
    slots: [...(f.slots ?? [])],
    correct: f.correct ?? 'none',
    correctMany: [],
    pairs: (f.pairs ?? []).map((p) => ({ ...p })),
    passage: f.passage ?? '',
    meanings: [],
    subs: [],
  };
}

/** Today's QuestionFields.done(): the question only when she changed it (the bot refuses ''). */
export function existingEdit(f: EditFields, v: FormValues): Record<string, unknown> {
  const edit: Record<string, unknown> = { marks: v.marks };
  if (v.question !== f.question) edit.question = v.question;
  if (f.shape === 'options') {
    edit.slots = v.slots;
    if (showCorrect(f)) edit.correct = v.correct;
    else if (showAnswerBox(f)) edit.answer = v.answer;
  } else if (f.shape === 'columns') {
    edit.pairs = v.pairs;
  } else if (f.shape === 'words') {
    edit.slots = v.slots;
    edit.answer = v.answer;
  } else if (f.shape === 'passage') {
    edit.passage = v.passage;
    edit.answer = v.answer;
  } else if (f.shape === 'comprehension') {
    edit.passage = v.passage;
  } else {
    edit.answer = v.answer;
    if (f.show_lines) {
      edit.lines = v.lines;
      edit.linesDefault = f.lines_default;
    }
  }
  return edit;
}

export function blankValues(k: AddKind): FormValues {
  return {
    question: '', marks: '', answer: '', lines: '',
    slots: Array.from({ length: NEW_SLOTS }, (_, i) => k.presetOptions?.[i] ?? ''),
    correct: '', correctMany: [],
    pairs: [{ left: '', right: '' }, { left: '', right: '' }],
    passage: '',
    meanings: Array.from({ length: NEW_SLOTS }, () => ''),
    subs: [{ question: '', answer: '', marks: '' }],
  };
}

/** Today's AddQuestionFields.done(): the keys the bot's buildAdded reads, as typed. */
export function addedEdit(k: AddKind, v: FormValues): Record<string, unknown> {
  const edit: Record<string, unknown> = { question: v.question };
  if (k.layout === 'standard') {
    edit.answer = v.answer;
    edit.marks = v.marks;
    edit.lines = v.lines;
    return edit;
  }
  if (k.layout === 'options') {
    edit.slots = v.slots;
    if (k.msq) edit.correctMany = v.correctMany; else edit.correct = v.correct;
  } else if (k.layout === 'columns') {
    edit.pairs = v.pairs;
  } else if (k.layout === 'words') {
    edit.slots = v.slots;
    if (k.meanings) edit.meanings = v.meanings; else edit.answer = v.answer;
  } else {
    edit.passage = v.passage;
    edit.subs = v.subs;
  }
  if (k.layout !== 'comprehension') edit.marks = v.marks;
  return edit;
}
