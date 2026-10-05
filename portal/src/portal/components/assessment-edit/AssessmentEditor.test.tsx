import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
const field = (q: string) => ({ shape: 'standard', question: q, marks: '2', answer: 'a', lines: '4', lines_default: 4, lines_options: [{ id: '4', title: '4' }], show_lines: true });
vi.mock('../../services/api', () => ({
  portal: {
    getAssessmentEditQuestions: vi.fn(),
    getAssessmentAddKinds: vi.fn().mockResolvedValue({ kinds: [{ kind: 'short', label: 'Short question', marks: 2, lines: 4, needsOptions: false }], slotCap: 6 }),
    validateAssessmentEdit: vi.fn(),
    saveAssessmentVersion: vi.fn(),
    getAssessmentDownload: vi.fn().mockResolvedValue({ available: true, url: 'https://x' }),
  },
}));
import { portal } from '../../services/api';
import AssessmentEditor from './AssessmentEditor';

const PAPER = { paperId: 'v1', version: 1, grade: 3, subject: 'english', chapterNumber: 2, rtl: false, questionCount: 2, marks: 4 };
const ITEMS = [
  { id: 'unseen.subjective.Short Questions.0', number: 1, removed: false, type: 'Short Questions', section: 'subjective', marks: 2, text: 'What is a noun?', fields: field('What is a noun?') },
  { id: 'unseen.subjective.Short Questions.1', number: 2, removed: false, type: 'Short Questions', section: 'subjective', marks: 2, text: 'What is a verb?', fields: field('What is a verb?') },
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(portal.getAssessmentEditQuestions).mockResolvedValue({ paper: PAPER, items: ITEMS } as never);
});

const card = (text: string) => screen.getByText(text).closest('[data-question]') as HTMLElement;

it('Make my paper is disabled until something changes; remove/restore toggles it', async () => {
  render(<AssessmentEditor paperId="v1" open onClose={() => {}} onSaved={() => {}} />);
  await screen.findByText('What is a noun?');
  const make = screen.getByRole('button', { name: 'Make my paper' });
  expect(make).toBeDisabled();
  fireEvent.click(within(card('What is a noun?')).getByRole('button', { name: 'Remove' }));
  expect(within(card('What is a noun?')).getByText('Removed')).toBeTruthy();
  expect(screen.getByText(/1 questions · 2 marks/)).toBeTruthy();
  expect(make).not.toBeDisabled();
  fireEvent.click(within(card('What is a noun?')).getByRole('button', { name: 'Restore' }));
  expect(make).toBeDisabled();
});

it('removing every question keeps Make my paper disabled', async () => {
  render(<AssessmentEditor paperId="v1" open onClose={() => {}} onSaved={() => {}} />);
  await screen.findByText('What is a noun?');
  fireEvent.click(within(card('What is a noun?')).getByRole('button', { name: 'Remove' }));
  fireEvent.click(within(card('What is a verb?')).getByRole('button', { name: 'Remove' }));
  expect(screen.getByRole('button', { name: 'Make my paper' })).toBeDisabled();
});

it('Done shows the bot error under the question and keeps it open', async () => {
  vi.mocked(portal.validateAssessmentEdit).mockRejectedValue({ response: { status: 400, data: { error: 'The question cannot be empty.' } } });
  render(<AssessmentEditor paperId="v1" open onClose={() => {}} onSaved={() => {}} />);
  await screen.findByText('What is a noun?');
  fireEvent.click(within(card('What is a noun?')).getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Question'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(await screen.findByText('The question cannot be empty.')).toBeTruthy();
  expect(screen.getByLabelText('Question')).toBeTruthy();
});

it('a valid edit is tagged Edited and saved as a changes list', async () => {
  vi.mocked(portal.validateAssessmentEdit).mockResolvedValue({ ok: true, marks: 3, text: 'Define a noun.' } as never);
  vi.mocked(portal.saveAssessmentVersion).mockResolvedValue({ status: 'ready', paperId: 'v2', version: 2, questionCount: 2, marks: 5 } as never);
  const onSaved = vi.fn();
  render(<AssessmentEditor paperId="v1" open onClose={() => {}} onSaved={onSaved} />);
  await screen.findByText('What is a noun?');
  fireEvent.click(within(card('What is a noun?')).getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Define a noun.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(await screen.findByText('Edited')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Make my paper' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ paperId: 'v2', version: 2 }));
  const [, changes] = vi.mocked(portal.saveAssessmentVersion).mock.calls[0];
  expect(changes.edits).toEqual([{ id: 'unseen.subjective.Short Questions.0', edit: expect.objectContaining({ question: 'Define a noun.' }) }]);
  expect(localStorage.getItem('assessment-edit-draft:v1')).toBeNull();
});

it('adds a question of an offered kind', async () => {
  vi.mocked(portal.validateAssessmentEdit).mockResolvedValue({ ok: true, marks: 2, text: 'New one?' } as never);
  render(<AssessmentEditor paperId="v1" open onClose={() => {}} onSaved={() => {}} />);
  await screen.findByText('What is a noun?');
  fireEvent.click(screen.getAllByRole('button', { name: /Add a question/ })[0]);
  fireEvent.click(await screen.findByRole('button', { name: 'Short question' }));
  fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'New one?' } });
  fireEvent.change(screen.getByLabelText('Answer'), { target: { value: 'Yes' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(await screen.findByText('New')).toBeTruthy();
  expect(vi.mocked(portal.validateAssessmentEdit).mock.calls[0][1]).toMatchObject({ kind: 'short' });
});

it('save failure keeps the draft and says the service could not be reached', async () => {
  vi.mocked(portal.saveAssessmentVersion).mockRejectedValue(new Error('Network Error'));
  render(<AssessmentEditor paperId="v1" open onClose={() => {}} onSaved={() => {}} />);
  await screen.findByText('What is a noun?');
  fireEvent.click(within(card('What is a noun?')).getByRole('button', { name: 'Remove' }));
  fireEvent.click(screen.getByRole('button', { name: 'Make my paper' }));
  expect(await screen.findByText(/couldn't reach the paper service/)).toBeTruthy();
  expect(localStorage.getItem('assessment-edit-draft:v1')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Make my paper' })).not.toBeDisabled();
});

it('save with INVALID_CHANGES shows each message under its question', async () => {
  vi.mocked(portal.saveAssessmentVersion).mockRejectedValue({ response: { status: 400, data: { code: 'INVALID_CHANGES',
    errors: [{ id: 'unseen.subjective.Short Questions.1', message: 'The question cannot be empty.' }] } } });
  render(<AssessmentEditor paperId="v1" open onClose={() => {}} onSaved={() => {}} />);
  await screen.findByText('What is a noun?');
  fireEvent.click(within(card('What is a noun?')).getByRole('button', { name: 'Remove' }));
  fireEvent.click(screen.getByRole('button', { name: 'Make my paper' }));
  expect(await within(card('What is a verb?')).findByText('The question cannot be empty.')).toBeTruthy();
});

it('a saved draft is offered back on reopen', async () => {
  localStorage.setItem('assessment-edit-draft:v1', JSON.stringify({ parentId: 'v1', edits: {}, removed: ['unseen.subjective.Short Questions.1'], restored: [], added: [] }));
  render(<AssessmentEditor paperId="v1" open onClose={() => {}} onSaved={() => {}} />);
  expect(await screen.findByText(/unsaved changes from before/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Keep them' }));
  expect(within(card('What is a verb?')).getByText('Removed')).toBeTruthy();
});

it('rtl for urdu', async () => {
  vi.mocked(portal.getAssessmentEditQuestions).mockResolvedValue({ paper: { ...PAPER, rtl: true }, items: ITEMS } as never);
  render(<AssessmentEditor paperId="v1" open onClose={() => {}} onSaved={() => {}} />);
  await screen.findByText('What is a noun?');
  expect(card('What is a noun?').getAttribute('dir')).toBe('rtl');
});
