import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * bd-fmf24g.6 — what a teacher with portal_teacher_v2 can do on the v2 Assessment pages, over today's routes
 * (services/api `portal.*`, mocked here): Make paper sends every option the WhatsApp Flow offers; the Types
 * step holds Next until her counts add up; the paper page offers Download, Answer key only when the paper
 * has one, Edit and Versions only when editing is on — and never WhatsApp; the hub shows a paper being
 * made, and Coming soon when the generator is off.
 */

const { portal, config } = vi.hoisted(() => ({
  portal: {
    getAssessmentOptions: vi.fn(),
    getAssessmentChapters: vi.fn(),
    generateAssessment: vi.fn(),
    getAssessmentStatus: vi.fn(),
    getAssessmentPapers: vi.fn(),
    getAssessmentDownload: vi.fn(),
    getAssessmentVersions: vi.fn(),
  },
  config: { features: { assessmentGenerator: true, assessmentEditing: true } },
}));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));
vi.mock('../../lib/useNewUi', () => ({ readConfigShared: () => Promise.resolve(config) }));
vi.mock('../../lib/gradeSubjects', () => ({ loadGradeSubjects: () => Promise.resolve([]) }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { phoneNumber: '923001234567' }, loading: false }) }));
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { ASSESSMENT_V2_COPY as C } from './copy';
import { forgetCatalogue } from './api';
import { forgetPapers } from './paperCache';
import { clearPicksForTest, setPicks } from './store';
import { newPicks } from './model';
import { AssessmentHub } from './AssessmentHub';
import { CheckStep, TypesStep } from './NewPaperSteps';
import { PaperPage } from './PaperPage';
import { RequestPage } from './RequestPage';
import { ASSESSMENT_V2_BASE, newPaperPath, paperPath, requestPath } from './paths';

function at(path: string, routePath: string, el: JSX.Element) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
        <Route path={`${ASSESSMENT_V2_BASE}/request/:id`} element={<p data-testid="request-page" />} />
        <Route path="*" element={<p data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clearPicksForTest();
  forgetCatalogue();
  forgetPapers();
  sessionStorage.clear();
  config.features = { assessmentGenerator: true, assessmentEditing: true };
  portal.getAssessmentOptions.mockImplementation(async (grade?: number, subject?: string) => {
    if (grade && subject) {
      return { success: true, grades: [4], maxQuestions: 50, defaultQuestions: 15, types: [
        { id: 'MCQs', category: 'objective' }, { id: 'True/False', category: 'objective' }, { id: 'Brief Answers', category: 'subjective' },
      ] };
    }
    if (grade) return { success: true, grades: [4], maxQuestions: 50, defaultQuestions: 15, subjects: [{ subject_key: 'science', subject: 'Science' }] };
    return { success: true, grades: [4], maxQuestions: 50, defaultQuestions: 15 };
  });
  portal.getAssessmentChapters.mockResolvedValue({ success: true, chapters: [
    { chapter_number: 1, chapter_title: 'Green Guardians of Earth', page_start: 1, page_end: 28, page_count: 28 },
    { chapter_number: 2, chapter_title: 'Inside The Animal World', page_start: 29, page_end: 46, page_count: 18 },
  ] });
  portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'queued' });
});

describe('Check and make', () => {
  it('sends every choice — Mix with a book count, her per-type counts, a marks budget — and opens the request', async () => {
    setPicks({
      ...newPicks(15), grade: 4, subject: 'science', subjectName: 'Science', chapters: [2, 1],
      source: 'both', count: 15, seen: 5, typeMode: 'pick', typeCounts: { MCQs: 6, 'Brief Answers': 4 }, marks: 40,
    });
    portal.generateAssessment.mockResolvedValue({ success: true, requestId: 'req-9' });
    at(newPaperPath('check'), newPaperPath('check'), <CheckStep />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(C.makePaper) }));
    await waitFor(() => expect(screen.getByTestId('request-page')).toBeTruthy());
    expect(portal.generateAssessment).toHaveBeenCalledWith({
      grade: 4, subject: 'science', chapterNumbers: [1, 2], pageRanges: null,
      questionCount: 15, contentSource: 'both', seenCount: 5,
      questionTypes: [{ id: 'MCQs', count: 6 }, { id: 'Brief Answers', count: 4 }],
      totalMarks: 40, answerLines: true, outputFormat: 'pdf',
    });
  });

  it('a request the server refuses stays on the page and says why', async () => {
    setPicks({ ...newPicks(15), grade: 4, subject: 'science', subjectName: 'Science', chapters: [1] });
    portal.generateAssessment.mockRejectedValue({ response: { data: { error: 'Leave room for new questions.' } } });
    at(newPaperPath('check'), newPaperPath('check'), <CheckStep />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(C.makePaper) }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Leave room for new questions.');
  });
});

describe('Question types', () => {
  it('holds Next until her counts add up to the new questions', async () => {
    setPicks({ ...newPicks(15), grade: 4, subject: 'science', subjectName: 'Science', chapters: [1], count: 3, typeMode: 'pick' });
    at(newPaperPath('types'), newPaperPath('types'), <TypesStep />);
    const next = () => screen.getByRole('button', { name: new RegExp(C.next) }) as HTMLButtonElement;
    expect(next().disabled).toBe(true);
    fireEvent.click(await screen.findByRole('checkbox', { name: /MCQs/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Brief Answers/ }));
    expect(next().disabled).toBe(true);
    fireEvent.click(within(screen.getByRole('checkbox', { name: /MCQs/ }).parentElement!.parentElement!).getByRole('button', { name: C.more }));
    await waitFor(() => expect(screen.getByRole('link', { name: new RegExp(C.next) })).toBeTruthy());
  });
});

describe('Paper page', () => {
  const paper = {
    paper_id: 'p-1', grade: 4, subject_key: 'science', subject: 'Science', chapter_number: 2,
    question_count: 14, total_marks: 20, ready_at: '2026-10-08T05:00:00Z', version: 2,
  };

  it('Download, Answer key when there is one, Edit and Versions with editing on — and no WhatsApp', async () => {
    portal.getAssessmentPapers.mockResolvedValue({ success: true, papers: [{ ...paper, has_answer_key: true }], total: 1, page: 1, pageSize: 20 });
    at(paperPath('p-1'), `${ASSESSMENT_V2_BASE}/paper/:paperId`, <PaperPage />);
    expect(await screen.findByRole('button', { name: new RegExp(C.download) })).toBeTruthy();
    expect(await screen.findByRole('button', { name: new RegExp(C.answerKey) })).toBeTruthy();
    expect(screen.getByRole('link', { name: new RegExp(C.edit) })).toBeTruthy();
    expect(screen.getByRole('link', { name: new RegExp(C.versions) })).toBeTruthy();
    expect(screen.queryByText(/whatsapp/i)).toBeNull();
  });

  it('no Answer key without one; no Edit or Versions with editing off', async () => {
    config.features = { assessmentGenerator: true, assessmentEditing: false };
    portal.getAssessmentPapers.mockResolvedValue({ success: true, papers: [{ ...paper, has_answer_key: false }], total: 1, page: 1, pageSize: 20 });
    at(paperPath('p-1'), `${ASSESSMENT_V2_BASE}/paper/:paperId`, <PaperPage />);
    expect(await screen.findByRole('button', { name: new RegExp(C.download) })).toBeTruthy();
    expect(screen.queryByRole('button', { name: new RegExp(C.answerKey) })).toBeNull();
    expect(screen.queryByRole('link', { name: new RegExp(C.edit) })).toBeNull();
  });
});

describe('Assessment hub', () => {
  it('shows a paper being made, from her tracked jobs', async () => {
    sessionStorage.setItem('assessment-jobs:v1:923001234567', JSON.stringify([{
      requestId: 'req-1', label: 'Green Guardians of Earth', startedAt: Date.now(), status: 'writing',
      spec: { grade: 4, subject: 'science', questionCount: 15 },
    }]));
    portal.getAssessmentPapers.mockResolvedValue({ success: true, papers: [], total: 0, page: 1, pageSize: 10 });
    at(ASSESSMENT_V2_BASE, ASSESSMENT_V2_BASE, <AssessmentHub />);
    // One word for one state: the section heading and the row's chip both say Being made.
    expect((await screen.findAllByText(C.beingMade)).length).toBe(2);
    expect(C.writing).toBe(C.beingMade);
    expect(screen.getByText('Green Guardians of Earth')).toBeTruthy();
  });

  it('Coming soon when the generator is off on this deployment', async () => {
    config.features = { assessmentGenerator: false, assessmentEditing: false };
    portal.getAssessmentPapers.mockResolvedValue({ success: true, papers: [], total: 0, page: 1, pageSize: 10 });
    at(ASSESSMENT_V2_BASE, ASSESSMENT_V2_BASE, <AssessmentHub />);
    expect(await screen.findByText(C.comingSoon)).toBeTruthy();
    expect(screen.queryByText(C.newPaper)).toBeNull();
  });
});

describe('Request page', () => {
  it('ready: the paper card is the row itself, so its rounded corners clip the row lead (bd-fmf24g.16)', async () => {
    sessionStorage.setItem('assessment-jobs:v1:923001234567', JSON.stringify([{
      requestId: 'req-2', label: 'Green Guardians of Earth', startedAt: Date.now(), status: 'writing',
      spec: { grade: 4, subject: 'science', questionCount: 15 },
    }]));
    // Her tracked job comes back ready on its first poll.
    portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'ready', paperId: 'p-9' });
    at(requestPath('req-2'), `${ASSESSMENT_V2_BASE}/request/:requestId`, <RequestPage />);
    const card = await waitFor(() => {
      const a = screen.getAllByTestId('history-lead').map((l) => l.closest('a')).find(Boolean);
      expect(a).toBeTruthy();
      return a as HTMLAnchorElement;
    });
    expect(card).toHaveAttribute('href', paperPath('p-9'));
    const cls = card.className.split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining(['overflow-hidden', 'rounded-2xl', 'items-stretch', 'min-h-[76px]']));
    // No padding between the card's edge and the row: the lead column sits flush with the card's start edge.
    expect(cls.some((c) => /^(p|ps|pl|py|pt|pb)-/.test(c))).toBe(false);
  });
});
