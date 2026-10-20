import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * bd-7tgiyc — Paper ready for a plain New paper (canvas "New paper · new flow", NReady / NReadyKey):
 *
 *   chips      Ready · 15 questions · 30 marks
 *   above      Edit (editing on) · Answer key, which swaps the paper for its key in the same viewer ("Back to paper")
 *   the paper  in the portal's own PDF viewer, the lesson plan one (components/LessonPlanViewer), read through
 *              /assessment/paper/:id/file
 *   dock       Send on WhatsApp · Download PDF (the kit's ShareActions)
 *
 * No Make another, no Word (operator, 2026-10-20: "Remove that button altogether"; "lets just do PDFs").
 */

const { portal, config, apiGet, toast } = vi.hoisted(() => ({
  portal: {
    getAssessmentOptions: vi.fn(),
    getAssessmentStatus: vi.fn(),
    getAssessmentPapers: vi.fn(),
    getAssessmentDownload: vi.fn(),
    getAssessmentPaperView: vi.fn(() => Promise.resolve({ success: true, paper: {}, sections: [] })),
  },
  config: { features: { assessmentGenerator: true, assessmentEditing: true } as Record<string, boolean> },
  apiGet: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../../services/api', () => ({ default: { get: apiGet, post: vi.fn() }, portal }));
vi.mock('../../lib/useNewUi', () => ({ readConfigShared: () => Promise.resolve(config) }));
vi.mock('../../lib/gradeSubjects', () => ({ loadGradeSubjects: () => Promise.resolve([]) }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { phoneNumber: '923001234567' }, loading: false }) }));
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
// The viewer itself (pdf.js) has its own tests; here: what it is opened with, and its "nothing there" answer.
vi.mock('../../components/LessonPlanViewer', () => ({
  default: (p: { view: { source: unknown }; chrome?: string; onNotReady: () => void }) => (
    <div data-testid="lesson-plan-viewer" data-source={JSON.stringify(p.view.source)} data-chrome={p.chrome}>
      <button type="button" onClick={p.onNotReady}>nothing there</button>
    </div>
  ),
}));

import { ASSESSMENT_V2_COPY as C } from './copy';
import { forgetCatalogue } from './api';
import { forgetPapers } from './paperCache';
import { RequestPage } from './RequestPage';
import { ASSESSMENT_V2_BASE, editPath, paperPath, requestPath } from './paths';

const JOBS = 'assessment-jobs:v1:923001234567';

function openReady() {
  sessionStorage.setItem(JOBS, JSON.stringify([{
    requestId: 'req-2', label: 'Green Guardians of Earth', startedAt: Date.now(), status: 'writing',
    spec: { grade: 4, subject: 'science', questionCount: 15, totalMarks: 30 },
  }]));
  portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'ready', paperId: 'p-9' });
  return render(
    <MemoryRouter initialEntries={[requestPath('req-2')]}>
      <Routes>
        <Route path={`${ASSESSMENT_V2_BASE}/request/:requestId`} element={<RequestPage />} />
        <Route path="*" element={<p data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const shown = () => JSON.parse(screen.getByTestId('lesson-plan-viewer').getAttribute('data-source') || 'null');

beforeEach(() => {
  vi.clearAllMocks();
  forgetCatalogue();
  forgetPapers();
  sessionStorage.clear();
  config.features = { assessmentGenerator: true, assessmentEditing: true };
  portal.getAssessmentOptions.mockResolvedValue({ success: true, grades: [4], maxQuestions: 50, defaultQuestions: 15, subjects: [] });
  portal.getAssessmentPapers.mockResolvedValue({ success: true, papers: [], total: 0, page: 1, pageSize: 10 });
  apiGet.mockResolvedValue({ data: {} });
});

describe('Paper ready (plain New paper)', () => {
  it('shows the paper itself in the viewer, under the page heading', async () => {
    openReady();
    await screen.findByTestId('lesson-plan-viewer');
    expect(shown()).toEqual({ lane: 'paper', paperId: 'p-9', artifact: 'paper' });
    expect(screen.getByTestId('lesson-plan-viewer').getAttribute('data-chrome')).toBe('none');
    expect(screen.getByText(C.ready)).toBeTruthy();
    expect(screen.getByText(C.questionsCount(15))).toBeTruthy();
    expect(screen.getByText(C.marksCount(30))).toBeTruthy();
  });

  it('has no Make another, no Word, and no row to open the paper elsewhere', async () => {
    openReady();
    await screen.findByTestId('lesson-plan-viewer');
    expect(screen.queryByRole('button', { name: new RegExp(C.makeAnother) })).toBeNull();
    expect(screen.queryByRole('link', { name: new RegExp(C.makeAnother) })).toBeNull();
    expect(screen.queryByText(/word/i)).toBeNull();
    expect(document.querySelector(`a[href="${paperPath('p-9')}"]`)).toBeNull();
  });

  it('Answer key swaps the paper for its key in the same viewer, and Back to paper swaps it back', async () => {
    openReady();
    const key = await screen.findByRole('button', { name: new RegExp(C.answerKey) });
    expect(key).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(key);
    await waitFor(() => expect(shown()).toEqual({ lane: 'paper', paperId: 'p-9', artifact: 'answer_key' }));
    const back = screen.getByRole('button', { name: new RegExp(C.backToPaper) });
    expect(back).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(back);
    await waitFor(() => expect(shown()).toEqual({ lane: 'paper', paperId: 'p-9', artifact: 'paper' }));
  });

  it('a paper with no answer key says so and goes back to the paper', async () => {
    openReady();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(C.answerKey) }));
    await waitFor(() => expect(shown().artifact).toBe('answer_key'));
    fireEvent.click(screen.getByRole('button', { name: 'nothing there' }));
    await waitFor(() => expect(shown().artifact).toBe('paper'));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: C.noKey }));
  });

  it('Edit goes to the editor when editing is on, and is not there when it is off', async () => {
    openReady();
    const edit = await screen.findByRole('link', { name: new RegExp(C.edit) });
    expect(edit).toHaveAttribute('href', editPath('p-9'));
  });

  it('no Edit with editing off', async () => {
    config.features = { assessmentGenerator: true, assessmentEditing: false };
    openReady();
    await screen.findByTestId('lesson-plan-viewer');
    await waitFor(() => expect(screen.queryByRole('link', { name: new RegExp(C.edit) })).toBeNull());
  });

  it('the dock: Send on WhatsApp and Download PDF', async () => {
    openReady();
    await screen.findByTestId('lesson-plan-viewer');
    expect(screen.getByRole('button', { name: new RegExp(C.downloadPdf) })).toBeTruthy();
    // Send on WhatsApp, or its locked face ("Not available yet") until a template exists on this deployment.
    expect(screen.getAllByText(/Send on WhatsApp|Not available yet/).length).toBeGreaterThan(0);
  });
});
