import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/** bd-fmf24g.31 — the paper page shows the paper itself, from the paper's own structured questions. */

const { portal, config } = vi.hoisted(() => ({
  portal: { getAssessmentPapers: vi.fn(), getAssessmentPaperView: vi.fn(), getAssessmentDownload: vi.fn() },
  config: { features: { assessmentGenerator: true, assessmentEditing: false } },
}));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));
vi.mock('../../lib/useNewUi', () => ({ readConfigShared: () => Promise.resolve(config) }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { phoneNumber: '923001234567' }, loading: false }) }));
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { ASSESSMENT_V2_COPY as C } from './copy';
import { forgetPapers } from './paperCache';
import { PaperPage } from './PaperPage';
import { ASSESSMENT_V2_BASE, paperPath } from './paths';

const paper = {
  paper_id: 'p-1', grade: 4, subject_key: 'science', subject: 'Science', chapter_number: 2,
  question_count: 3, total_marks: 6, ready_at: '2026-10-08T05:00:00Z', version: 1, has_answer_key: true,
};
const view = (over: object = {}, rtl = false) => ({
  success: true,
  paper: { paperId: 'p-1', version: 1, grade: 4, subject: 'science', chapterNumber: 2, rtl, questionCount: 3, marks: 6 },
  sections: [
    { heading: 'MCQs', lead: null, questions: [
      { number: 1, shape: 'options', text: 'Which part takes in water?', marks: 1, options: ['A) Roots', 'B) Stem'] },
    ] },
    { heading: 'True/False', lead: 'Write True or False', questions: [
      { number: 2, shape: 'standard', text: 'Seeds need light.', marks: 1 },
    ] },
    { heading: 'Comprehension', lead: null, questions: [
      { number: 3, shape: 'comprehension', text: 'Read and answer.', marks: 4, passage: 'A crow was thirsty.', subs: [
        { letter: 'a', text: 'Who was thirsty?', marks: 2, options: [] }, { letter: 'b', text: 'Pick', marks: 2, options: ['A) a'] },
      ] },
    ] },
    { heading: null, lead: null, questions: [
      { number: 4, shape: 'columns', text: 'Match.', marks: 2, pairs: [{ left: 'Sun', right: 'Day' }] },
    ] },
  ],
  ...over,
});

function open() {
  return render(
    <MemoryRouter initialEntries={[paperPath('p-1')]}>
      <Routes><Route path={`${ASSESSMENT_V2_BASE}/paper/:paperId`} element={<PaperPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetPapers();
  portal.getAssessmentPapers.mockResolvedValue({ success: true, papers: [paper], total: 1, page: 1, pageSize: 20 });
});

describe('the paper on the paper page', () => {
  it('renders sections in order with numbered questions, marks, options, parts and columns', async () => {
    portal.getAssessmentPaperView.mockResolvedValue(view());
    open();
    const body = await screen.findByTestId('paper-body');
    expect(portal.getAssessmentPaperView).toHaveBeenCalledWith('p-1');
    expect(within(body).getAllByTestId('paper-section').map((s) => s.querySelector('h3')?.textContent ?? '')).toEqual(['MCQs', 'True/False', 'Comprehension', '']);
    expect(within(body).getAllByTestId('paper-question').map((q) => q.querySelector('span')?.textContent)).toEqual(['1', '2', '3', '4']);
    expect(within(body).getByText('Which part takes in water?')).toBeTruthy();
    expect(within(body).getByText('A) Roots')).toBeTruthy();
    expect(within(body).getByText('Write True or False')).toBeTruthy();
    expect(within(body).getByText('A crow was thirsty.')).toBeTruthy();
    expect(within(body).getByText('Who was thirsty?')).toBeTruthy();
    expect(within(body).getByText(C.columnA)).toBeTruthy();
    expect(within(body).getByText('Day')).toBeTruthy();
    expect(within(body).getAllByText(C.marksCount(2)).length).toBeGreaterThan(0);
  });

  it('keeps the actions: Download, Answer key', async () => {
    portal.getAssessmentPaperView.mockResolvedValue(view());
    open();
    await screen.findByTestId('paper-body');
    expect(screen.getByRole('button', { name: new RegExp(C.download) })).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(C.answerKey) })).toBeTruthy();
  });

  it('an Urdu paper reads right to left, its text as written', async () => {
    portal.getAssessmentPaperView.mockResolvedValue(view({ sections: [{ heading: null, lead: null, questions: [
      { number: 1, shape: 'standard', text: 'پودے کیسے بڑھتے ہیں؟', marks: 2 },
    ] }] }, true));
    open();
    const body = await screen.findByTestId('paper-body');
    expect(body).toHaveAttribute('dir', 'rtl');
    expect(within(body).getByText('پودے کیسے بڑھتے ہیں؟')).toBeTruthy();
  });

  it('a version with no stored questions says Download to view, and the actions stay', async () => {
    portal.getAssessmentPaperView.mockResolvedValue(view({ sections: [] }));
    open();
    expect(await screen.findByText(C.downloadToView)).toBeTruthy();
    expect(screen.queryByTestId('paper-body')).toBeNull();
    expect(screen.getByRole('button', { name: new RegExp(C.download) })).toBeTruthy();
  });

  it('a failed read of the questions falls back the same way and never blocks the actions', async () => {
    portal.getAssessmentPaperView.mockRejectedValue(new Error('x'));
    open();
    await waitFor(() => expect(screen.getByText(C.downloadToView)).toBeTruthy());
    expect(screen.getByRole('button', { name: new RegExp(C.answerKey) })).toBeTruthy();
  });
});
