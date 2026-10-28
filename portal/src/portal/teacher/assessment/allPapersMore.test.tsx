import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * All papers: "Show more" asks for the NEXT page once. With 12 papers at 10 a page, two quick taps
 * while page 2 was still loading asked for page 3 (past her last paper, so the server failed) and
 * threw away page 2, so papers 11 and 12 never showed. A second tap while a page is loading is ignored.
 */

const { portal, config } = vi.hoisted(() => ({
  portal: { getAssessmentOptions: vi.fn(), getAssessmentChapters: vi.fn(), getAssessmentPapers: vi.fn(), getAssessmentStatus: vi.fn() },
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
import { AssessmentAll } from './AssessmentAll';
import { ASSESSMENT_ALL } from './paths';

const paper = (n: number) => ({
  paper_id: `p-${n}`, grade: 4, subject_key: 'science', subject: 'Science', chapter_number: n,
  question_count: 10, total_marks: 20, ready_at: '2026-10-08T05:00:00Z', version: 1,
});
const TOTAL = 12;
const pageOf = (page: number) => Array.from({ length: 10 }, (_, i) => (page - 1) * 10 + i + 1).filter((n) => n <= TOTAL).map(paper);

beforeEach(() => {
  vi.clearAllMocks();
  forgetCatalogue();
  forgetPapers();
  sessionStorage.clear();
});

describe('All papers: Show more', () => {
  it('a second tap while the next page is loading does not skip it or ask past the end', async () => {
    const pending: Array<() => void> = [];
    portal.getAssessmentPapers.mockImplementation(({ page }: { page: number }) => {
      const res = { success: true, papers: pageOf(page), total: TOTAL, page, pageSize: 10 };
      if (page === 1) return Promise.resolve(res);
      return new Promise((ok) => { pending.push(() => ok(res)); });
    });
    render(
      <MemoryRouter initialEntries={[ASSESSMENT_ALL]}>
        <Routes><Route path={ASSESSMENT_ALL} element={<AssessmentAll />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(C.chapterShort(10))).toBeTruthy();

    const more = screen.getByRole('button', { name: /Show more/i });
    fireEvent.click(more);
    fireEvent.click(more);

    await act(async () => { pending.forEach((f) => f()); });
    await waitFor(() => expect(screen.getByText(C.chapterShort(12))).toBeTruthy());
    const pages = portal.getAssessmentPapers.mock.calls.map(([q]: [{ page: number }]) => q.page);
    expect(pages).toEqual([1, 2]);
    expect(screen.getByText(C.chapterShort(11))).toBeTruthy();
  });
});
