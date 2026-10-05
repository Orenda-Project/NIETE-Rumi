import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QuestionFields from './QuestionFields';
import type { EditFields } from '../../services/api';

const base = { question: 'Q', marks: '1', answer: '', lines: '0', lines_default: null, lines_options: [{ id: '0', title: '0' }, { id: '4', title: '4' }], show_lines: false };

it('options: edits option text and the correct one', () => {
  const onDone = vi.fn();
  const fields: EditFields = { ...base, shape: 'options', slots: ['A) run', 'B) cat', '', '', '', ''], correct: '0',
    correct_options: [{ id: '0', title: 'A) run' }, { id: '1', title: 'B) cat' }], msq: false, show_correct: true };
  render(<QuestionFields fields={fields} rtl={false} error={null} busy={false} onDone={onDone} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText('Option 2'), { target: { value: 'B) jump' } });
  fireEvent.click(screen.getByLabelText('Option 2 is correct'));
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(onDone).toHaveBeenCalledWith({ marks: '1', slots: ['A) run', 'B) jump', '', '', '', ''], correct: '1' });
});

it('columns: edits pairs', () => {
  const onDone = vi.fn();
  render(<QuestionFields fields={{ ...base, shape: 'columns', pairs: [{ left: 'cat', right: 'meow' }, { left: '', right: '' }] }}
    rtl={false} error={null} busy={false} onDone={onDone} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText('Pair 2 left'), { target: { value: 'dog' } });
  fireEvent.change(screen.getByLabelText('Pair 2 right'), { target: { value: 'woof' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(onDone.mock.calls[0][0].pairs).toEqual([{ left: 'cat', right: 'meow' }, { left: 'dog', right: 'woof' }]);
});

it('standard: answer and lines when the type has lines', () => {
  const onDone = vi.fn();
  render(<QuestionFields fields={{ ...base, shape: 'standard', answer: 'A', lines: '4', lines_default: 4, show_lines: true }}
    rtl={false} error={null} busy={false} onDone={onDone} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText('Answer'), { target: { value: 'B' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(onDone).toHaveBeenCalledWith({ marks: '1', answer: 'B', lines: '4', linesDefault: 4 });
});

it('passage and comprehension edit the passage', () => {
  const onDone = vi.fn();
  render(<QuestionFields fields={{ ...base, shape: 'comprehension', passage: 'P', subs: [] }}
    rtl={false} error={null} busy={false} onDone={onDone} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText('Passage'), { target: { value: 'P2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(onDone.mock.calls[0][0]).toMatchObject({ passage: 'P2' });
});

it('shows the bot error and rtl direction', () => {
  const { container } = render(<QuestionFields fields={{ ...base, shape: 'standard' }} rtl error="The question cannot be empty."
    busy={false} onDone={() => {}} onCancel={() => {}} />);
  expect(screen.getByText('The question cannot be empty.')).toBeTruthy();
  expect(container.querySelector('[dir="rtl"]')).toBeTruthy();
});

it('comprehension with an empty parent question: only the passage change is sent, no question key', () => {
  const onDone = vi.fn();
  render(<QuestionFields fields={{ ...base, question: '', shape: 'comprehension', passage: 'P', subs: [] }}
    rtl={false} error={null} busy={false} onDone={onDone} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText('Passage'), { target: { value: 'P2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  const edit = onDone.mock.calls[0][0];
  expect(edit).toMatchObject({ passage: 'P2' });
  expect('question' in edit).toBe(false);
});

it('a changed question is sent', () => {
  const onDone = vi.fn();
  render(<QuestionFields fields={{ ...base, shape: 'standard' }} rtl={false} error={null} busy={false} onDone={onDone} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText('Question'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(onDone.mock.calls[0][0].question).toBe('');
});

it('msq options: sends answer, no correct, no correct radios', () => {
  const onDone = vi.fn();
  render(<QuestionFields fields={{ ...base, shape: 'options', slots: ['A', 'B', '', '', '', ''], answer: 'A, B', msq: true, correct: '0' }}
    rtl={false} error={null} busy={false} onDone={onDone} onCancel={() => {}} />);
  expect(screen.queryByLabelText('Option 1 is correct')).toBeNull();
  fireEvent.change(screen.getByLabelText('Answer'), { target: { value: 'A' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  const edit = onDone.mock.calls[0][0];
  expect(edit.answer).toBe('A');
  expect('correct' in edit).toBe(false);
});

it('options with show_correct:false (a sub-question) draw no radios and send the answer text, not correct', () => {
  const onDone = vi.fn();
  const fields: EditFields = { ...base, shape: 'options', answer: 'A) run', slots: ['A) run', 'B) cat', '', '', '', ''], correct: '0',
    correct_options: [], msq: false, show_correct: false, show_answer_text: true };
  render(<QuestionFields fields={fields} rtl={false} error={null} busy={false} onDone={onDone} onCancel={() => {}} />);
  expect(screen.queryByLabelText('Option 1 is correct')).toBeNull();
  fireEvent.change(screen.getByLabelText('Answer'), { target: { value: 'B) cat' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  const sent = onDone.mock.calls[0][0];
  expect(sent.answer).toBe('B) cat');
  expect(sent).not.toHaveProperty('correct');
});
