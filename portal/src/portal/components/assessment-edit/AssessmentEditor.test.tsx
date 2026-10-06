import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
const field = (q: string) => ({ shape: 'standard', question: q, marks: '2', answer: 'a', lines: '4', lines_default: 4, lines_options: [{ id: '4', title: '4' }], show_lines: true });
vi.mock('../../services/api', () => ({
  portal: {
    getAssessmentEditQuestions: vi.fn(),
    getAssessmentAddKinds: vi.fn().mockResolvedValue({ kinds: [{ kind: 'short', label: 'Short question', layout: 'standard', section: 'subjective', marks: 2, lines: 4 }], slotCap: 6 }),
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
  fireEvent.click(screen.getAllByRole('button', { name: /Add a question/ }).slice(-1)[0]); // Subjective (F5: short is only offered there)
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

it('M1: a transport failure tells her the save may still have finished', async () => {
  vi.mocked(portal.saveAssessmentVersion).mockRejectedValue(new Error('timeout'));
  render(<AssessmentEditor paperId="v1" open onClose={() => {}} onSaved={() => {}} />);
  await screen.findByText('What is a noun?');
  fireEvent.click(within(card('What is a noun?')).getByRole('button', { name: 'Remove' }));
  fireEvent.click(screen.getByRole('button', { name: 'Make my paper' }));
  expect(await screen.findByText(/Check Versions before trying again/)).toBeTruthy();
});

it('I3: reopening Edit shows her earlier text, and a second Done keeps both changes', async () => {
  vi.mocked(portal.validateAssessmentEdit).mockResolvedValue({ ok: true, marks: 2, text: 'Define a noun.' } as never);
  vi.mocked(portal.saveAssessmentVersion).mockResolvedValue({ status: 'ready', paperId: 'v2', version: 2, questionCount: 2, marks: 5 } as never);
  render(<AssessmentEditor paperId="v1" open onClose={() => {}} onSaved={() => {}} />);
  await screen.findByText('What is a noun?');
  fireEvent.click(within(card('What is a noun?')).getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Define a noun.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  await screen.findByText('Edited');
  fireEvent.click(within(card('Define a noun.')).getByRole('button', { name: 'Edit' }));
  expect((screen.getByLabelText('Question') as HTMLTextAreaElement).value).toBe('Define a noun.');
  fireEvent.change(screen.getByLabelText('Marks'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.queryByLabelText('Marks')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Make my paper' }));
  await waitFor(() => expect(portal.saveAssessmentVersion).toHaveBeenCalled());
  const [, changes] = vi.mocked(portal.saveAssessmentVersion).mock.calls[0];
  expect(changes.edits).toEqual([{ id: 'unseen.subjective.Short Questions.0', edit: expect.objectContaining({ question: 'Define a noun.', marks: '5' }) }]);
});

it('M2: Remove on a newly added question is disabled while a question is open for editing', async () => {
  vi.mocked(portal.validateAssessmentEdit).mockResolvedValue({ ok: true, marks: 2, text: 'New one?' } as never);
  render(<AssessmentEditor paperId="v1" open onClose={() => {}} onSaved={() => {}} />);
  await screen.findByText('What is a noun?');
  fireEvent.click(screen.getAllByRole('button', { name: /Add a question/ }).slice(-1)[0]);
  fireEvent.click(await screen.findByRole('button', { name: 'Short question' }));
  fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'New one?' } });
  fireEvent.change(screen.getByLabelText('Answer'), { target: { value: 'Yes' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  await screen.findByText('New');
  const added = document.querySelector('[data-question="added-0"]') as HTMLElement;
  expect(within(added).getByRole('button', { name: 'Remove' })).not.toBeDisabled();
  fireEvent.click(within(card('What is a verb?')).getByRole('button', { name: 'Edit' }));
  expect(within(added).getByRole('button', { name: 'Remove' })).toBeDisabled();
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

const COMP = {
  id: 'unseen.subjective.Comprehension.0', number: 3, removed: false, type: 'Comprehension', section: 'subjective', marks: 2, text: 'Read the passage.',
  fields: { ...field('Read the passage.'), shape: 'comprehension' },
  subs: [
    { index: 0, fields: { ...field('Who ran?'), marks: '1' } },
    { index: 1, fields: { ...field('Where?'), marks: '1' } },
  ],
};

it('F1: an unanswered stored draft survives close; edits are locked until answered', async () => {
  const stored = JSON.stringify({ parentId: 'v1', edits: {}, removed: ['unseen.subjective.Short Questions.1'], restored: [], added: [] });
  localStorage.setItem('assessment-edit-draft:v1', stored);
  const { unmount } = render(<AssessmentEditor paperId="v1" open onClose={() => {}} onSaved={() => {}} />);
  await screen.findByText(/unsaved changes from before/);
  expect(within(card('What is a noun?')).getByRole('button', { name: 'Remove' })).toBeDisabled();
  unmount();
  expect(localStorage.getItem('assessment-edit-draft:v1')).toBe(stored);
});

it('F2/F3: a sub edit shows the sub text, keeps the parent text, and adds its marks delta', async () => {
  vi.mocked(portal.getAssessmentEditQuestions).mockResolvedValue({ paper: PAPER, items: [COMP] } as never);
  vi.mocked(portal.validateAssessmentEdit).mockResolvedValue({ ok: true, marks: 4, text: 'Read the passage.' } as never);
  render(<AssessmentEditor paperId="v1" open onClose={() => {}} onSaved={() => {}} />);
  await screen.findByText('Who ran?');
  fireEvent.click(within(screen.getByText('Who ran?').closest('div')!.parentElement!).getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Who won?' } });
  fireEvent.change(screen.getByLabelText('Marks'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(await screen.findByText('Who won?')).toBeTruthy();
  expect(screen.getAllByText('Read the passage.').length).toBe(1);
  expect(screen.getByText(/Comprehension · 4 marks/)).toBeTruthy();
});

it('F4/F5/F6: added errors do not go stale; picker is section-scoped; orphan errors reach the footer', async () => {
  vi.mocked(portal.getAssessmentAddKinds).mockResolvedValue({ kinds: [
    { kind: 'short', label: 'Short question', layout: 'standard', section: 'subjective', marks: 2, lines: 4 },
    { kind: 'mcq', label: 'Multiple choice', layout: 'options', section: 'objective', marks: 1, lines: 0 },
  ], slotCap: 6 } as never);
  vi.mocked(portal.validateAssessmentEdit).mockResolvedValue({ ok: true, marks: 2, text: 'Added Q' } as never);
  vi.mocked(portal.saveAssessmentVersion).mockRejectedValue({ response: { status: 400, data: { code: 'INVALID_CHANGES',
    errors: [{ addedIndex: 1, message: 'Bad added.' }, { message: 'Orphan problem.' }] } } });
  render(<AssessmentEditor paperId="v1" open onClose={() => {}} onSaved={() => {}} />);
  await screen.findByText('What is a noun?');
  for (let n = 0; n < 2; n++) {
    const btns = screen.getAllByRole('button', { name: /Add a question/ });
    fireEvent.click(btns[btns.length - 1]);
    expect(screen.queryByRole('button', { name: 'Multiple choice' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Short question' }));
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: `Added Q` } });
    fireEvent.change(screen.getByLabelText('Answer'), { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getAllByText('New').length).toBe(n + 1));
  }
  fireEvent.click(screen.getByRole('button', { name: 'Make my paper' }));
  expect(await screen.findByText('Bad added.')).toBeTruthy();
  expect(screen.getByText(/Orphan problem\./)).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove' }).filter((b) => b.closest('[data-question^="added-"]'))[0]);
  expect(screen.queryByText('Bad added.')).toBeNull();
});

const KINDS = [
  { kind: 'MCQs', label: 'MCQs', layout: 'options', section: 'objective', marks: 1, lines: 0 },
  { kind: 'Match the Column', label: 'Match the Column', layout: 'columns', section: 'objective', marks: 4, lines: 0 },
  { kind: 'Essay Writing', label: 'Essay Writing', layout: 'standard', section: 'subjective', marks: 5, lines: 12 },
];

it('picker lists kinds by their section', async () => {
  vi.mocked(portal.getAssessmentAddKinds).mockResolvedValue({ kinds: KINDS, slotCap: 6 } as never);
  render(<AssessmentEditor paperId="v1" open onClose={() => {}} onSaved={() => {}} />);
  await screen.findByText('What is a noun?');
  const btns = screen.getAllByRole('button', { name: /Add a question/ });
  fireEvent.click(btns[btns.length - 1]);
  expect(await screen.findByRole('button', { name: 'Essay Writing' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'MCQs' })).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: /Add a question/ })[0]);
  expect(await screen.findByRole('button', { name: 'Match the Column' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'MCQs' })).toBeTruthy();
});

it('adding a Match the Column validates with its pairs and shows the New card under Objective', async () => {
  vi.mocked(portal.getAssessmentAddKinds).mockResolvedValue({ kinds: KINDS, slotCap: 6 } as never);
  vi.mocked(portal.validateAssessmentEdit).mockResolvedValue({ ok: true, marks: 4, text: 'Match these' } as never);
  render(<AssessmentEditor paperId="v1" open onClose={() => {}} onSaved={() => {}} />);
  await screen.findByText('What is a noun?');
  fireEvent.click(screen.getAllByRole('button', { name: /Add a question/ })[0]);
  fireEvent.click(await screen.findByRole('button', { name: 'Match the Column' }));
  fireEvent.change(screen.getByLabelText('Pair 1 left'), { target: { value: 'cat' } });
  fireEvent.change(screen.getByLabelText('Pair 1 right'), { target: { value: 'meow' } });
  fireEvent.change(screen.getByLabelText('Pair 2 left'), { target: { value: 'dog' } });
  fireEvent.change(screen.getByLabelText('Pair 2 right'), { target: { value: 'woof' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  const added = await screen.findByText('Match these');
  expect(vi.mocked(portal.validateAssessmentEdit).mock.calls[0][1]).toEqual({ kind: 'Match the Column',
    edit: expect.objectContaining({ pairs: [{ left: 'cat', right: 'meow' }, { left: 'dog', right: 'woof' }] }) });
  const objective = screen.getByText('Objective').closest('section')!;
  expect(objective.contains(added)).toBe(true);
  expect(screen.getByText('Subjective').closest('section')!.contains(added)).toBe(false);
});

it('a legacy stored draft entry without a section still renders under Subjective', async () => {
  localStorage.setItem('assessment-edit-draft:v1', JSON.stringify({ parentId: 'v1', edits: {}, removed: [], restored: [],
    added: [{ kind: 'short', edit: { question: 'Old one' }, marks: 2, text: 'Old one' }] }));
  render(<AssessmentEditor paperId="v1" open onClose={() => {}} onSaved={() => {}} />);
  await screen.findByText(/unsaved changes from before/);
  fireEvent.click(screen.getByRole('button', { name: 'Keep them' }));
  const old = await screen.findByText('Old one');
  expect(screen.getByText('Subjective').closest('section')!.contains(old)).toBe(true);
});
