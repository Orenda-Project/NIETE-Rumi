import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AddQuestionFields from './AddQuestionFields';
import type { AddKind } from '../../services/api';

const mk = (o: Partial<AddKind>): AddKind => ({ kind: 'Short Questions', label: 'Short question', layout: 'standard', section: 'subjective', marks: 2, lines: 4, ...o });
const setup = (kind: AddKind, extra: { rtl?: boolean; error?: string | null } = {}) => {
  const onDone = vi.fn();
  const utils = render(<AddQuestionFields kind={kind} slotCap={6} rtl={!!extra.rtl} error={extra.error ?? null} busy={false} onDone={onDone} onCancel={() => {}} />);
  return { onDone, ...utils };
};
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const done = () => fireEvent.click(screen.getByRole('button', { name: 'Done' }));

it('standard: sends question, answer, marks and lines as typed; placeholders show defaults', () => {
  const { onDone } = setup(mk({}));
  expect(screen.getByLabelText('Marks').getAttribute('placeholder')).toBe('2');
  expect(screen.getByLabelText('Answer lines').getAttribute('placeholder')).toBe('4');
  type('Question', 'What is a noun?'); type('Answer', 'A name'); type('Marks', '3'); type('Answer lines', '5');
  done();
  expect(onDone).toHaveBeenCalledWith({ question: 'What is a noun?', answer: 'A name', marks: '3', lines: '5' });
});

it('standard: blank marks and lines are sent blank', () => {
  const { onDone } = setup(mk({}));
  type('Question', 'Q'); done();
  expect(onDone).toHaveBeenCalledWith({ question: 'Q', answer: '', marks: '', lines: '' });
});

it('options: single correct sends slots (6) and correct index', () => {
  const { onDone } = setup(mk({ kind: 'MCQs', layout: 'options', section: 'objective', marks: 1, lines: 0 }));
  expect(screen.queryByLabelText('Answer lines')).toBeNull();
  type('Question', 'Pick'); type('Option 1', 'a'); type('Option 2', 'b');
  fireEvent.click(screen.getByLabelText('Option 2 is correct'));
  done();
  expect(onDone).toHaveBeenCalledWith({ question: 'Pick', slots: ['a', 'b', '', '', '', ''], correct: '1', marks: '' });
});

it('options: MSQ uses checkboxes and sends correctMany', () => {
  const { onDone } = setup(mk({ kind: 'MSQs', layout: 'options', section: 'objective', msq: true }));
  const one = screen.getByLabelText('Option 1 is correct') as HTMLInputElement;
  expect(one.type).toBe('checkbox');
  type('Question', 'Pick'); type('Option 1', 'a'); type('Option 3', 'c');
  fireEvent.click(one); fireEvent.click(screen.getByLabelText('Option 3 is correct'));
  done();
  expect(onDone).toHaveBeenCalledWith({ question: 'Pick', slots: ['a', '', 'c', '', '', ''], correctMany: ['0', '2'], marks: '' });
});

it('options: True/False shows the preset options prefilled', () => {
  const { onDone } = setup(mk({ kind: 'True/False', layout: 'options', section: 'objective', presetOptions: ['True', 'False'] }));
  expect((screen.getByLabelText('Option 1') as HTMLInputElement).value).toBe('True');
  expect((screen.getByLabelText('Option 2') as HTMLInputElement).value).toBe('False');
  type('Question', 'Sky is blue'); fireEvent.click(screen.getByLabelText('Option 1 is correct')); done();
  expect(onDone).toHaveBeenCalledWith({ question: 'Sky is blue', slots: ['True', 'False', '', '', '', ''], correct: '0', marks: '' });
});

it('columns: starts with 2 pairs, Add pair gives 3, sends pairs in order', () => {
  const { onDone } = setup(mk({ kind: 'Match the Column', layout: 'columns', section: 'objective' }));
  expect(screen.queryByLabelText('Pair 3 left')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add pair' }));
  type('Pair 1 left', 'cat'); type('Pair 1 right', 'meow');
  type('Pair 2 left', 'dog'); type('Pair 2 right', 'woof');
  type('Pair 3 left', 'cow'); type('Pair 3 right', 'moo');
  type('Question', 'Match'); done();
  expect(onDone).toHaveBeenCalledWith({ question: 'Match', pairs: [{ left: 'cat', right: 'meow' }, { left: 'dog', right: 'woof' }, { left: 'cow', right: 'moo' }], marks: '' });
});

it('columns: Add pair stops at slotCap', () => {
  setup(mk({ layout: 'columns' }));
  for (let i = 0; i < 10; i++) { const b = screen.queryByRole('button', { name: 'Add pair' }); if (b) fireEvent.click(b); }
  expect(screen.getByLabelText('Pair 6 left')).toBeTruthy();
  expect(screen.queryByLabelText('Pair 7 left')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Add pair' })).toBeNull();
});

it('words: 6 word boxes, sends slots and answer', () => {
  const { onDone } = setup(mk({ kind: 'Jumbled Words', layout: 'words', section: 'objective' }));
  for (let i = 1; i <= 6; i++) expect(screen.getByLabelText(`Word ${i}`)).toBeTruthy();
  type('Word 1', 'sat'); type('Word 2', 'cat'); type('Answer', 'cat sat');
  done();
  expect(onDone).toHaveBeenCalledWith({ question: '', slots: ['sat', 'cat', '', '', '', ''], answer: 'cat sat', marks: '' });
});

it('comprehension: add and remove parts, sends passage and subs', () => {
  const { onDone } = setup(mk({ kind: 'Comprehension', layout: 'comprehension' }));
  expect(screen.queryByRole('button', { name: 'Remove part' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add part' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add part' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove part' })[2]);
  type('Passage', 'Once upon');
  type('Part 1 question', 'Who?'); type('Part 1 answer', 'Tom'); type('Part 1 marks', '1');
  type('Part 2 question', 'Where?'); type('Part 2 answer', 'Home');
  done();
  expect(onDone).toHaveBeenCalledWith({ question: '', passage: 'Once upon',
    subs: [{ question: 'Who?', answer: 'Tom', marks: '1' }, { question: 'Where?', answer: 'Home', marks: '' }] });
});

it('shows the bot error and rtl direction, with the buttons row ltr', () => {
  const { container } = setup(mk({}), { rtl: true, error: 'The question cannot be empty.' });
  expect(screen.getByText('The question cannot be empty.')).toBeTruthy();
  expect(container.querySelector('form, div[dir="rtl"]')?.getAttribute('dir')).toBe('rtl');
  expect(screen.getByRole('button', { name: 'Done' }).parentElement?.getAttribute('dir')).toBe('ltr');
});
