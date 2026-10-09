import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * bd-fmf24g.34 — the Assessment home is New paper, Being made and Recent papers (her latest, collapsible, the
 * Lesson Plans pattern) with See all leading to All papers: the total, a class filter and every paper by day.
 */

const { portal, config } = vi.hoisted(() => ({
  portal: { getAssessmentOptions: vi.fn(), getAssessmentChapters: vi.fn(), getAssessmentPapers: vi.fn(), getAssessmentStatus: vi.fn() },
  config: { features: { assessmentGenerator: true, assessmentEditing: true } },
}));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));
vi.mock('../../lib/useNewUi', () => ({ readConfigShared: () => Promise.resolve(config) }));
vi.mock('../../lib/gradeSubjects', () => ({
  loadGradeSubjects: () => Promise.resolve([
    { grade: 4, subject: 'Science', featureKey: 'science', available: true, subjectKey: 'science' },
    { grade: 5, subject: 'Maths', featureKey: 'maths', available: true, subjectKey: 'maths' },
  ]),
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { phoneNumber: '923001234567' }, loading: false }) }));
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { ASSESSMENT_V2_COPY as C } from './copy';
import { forgetCatalogue } from './api';
import { forgetPapers } from './paperCache';
import { AssessmentHub } from './AssessmentHub';
import { AssessmentAll } from './AssessmentAll';
import routes from './routes';
import { ASSESSMENT_ALL, ASSESSMENT_V2_BASE } from './paths';

const paper = (n: number, over: Record<string, unknown> = {}) => ({
  paper_id: `p-${n}`, grade: 4, subject_key: 'science', subject: 'Science', chapter_number: n,
  question_count: 10 + n, total_marks: 20, ready_at: '2026-10-08T05:00:00Z', version: 1, ...over,
});

function at(path: string, el: JSX.Element, routePath: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
        <Route path="*" element={<p data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetCatalogue();
  forgetPapers();
  sessionStorage.clear();
  config.features = { assessmentGenerator: true, assessmentEditing: true };
  portal.getAssessmentOptions.mockResolvedValue({ success: true, grades: [4], maxQuestions: 50, defaultQuestions: 15 });
});

describe('Assessment home: Recent papers', () => {
  it('shows Recent papers with her latest, a See all link to All papers, and no class filter', async () => {
    portal.getAssessmentPapers.mockResolvedValue({ success: true, papers: [paper(1), paper(2)], total: 2, page: 1, pageSize: 10 });
    at(ASSESSMENT_V2_BASE, <AssessmentHub />, ASSESSMENT_V2_BASE);
    const heading = await screen.findByText(C.recent);
    expect(heading).toBeTruthy();
    expect(screen.getByText(C.chapterShort(1))).toBeTruthy();
    const see = screen.getAllByRole('link', { name: /See all/i });
    expect(see.length).toBeGreaterThan(0);
    for (const a of see) expect(a.getAttribute('href')).toBe(ASSESSMENT_ALL);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    // the home asks for the latest page only, with no class filter
    const ask = portal.getAssessmentPapers.mock.calls[0][0];
    expect(ask.page).toBe(1);
    expect(ask.grade).toBeUndefined();
    expect(ask.subject).toBeUndefined();
  });

  it('with no papers yet it says so under Recent papers', async () => {
    portal.getAssessmentPapers.mockResolvedValue({ success: true, papers: [], total: 0, page: 1, pageSize: 10 });
    at(ASSESSMENT_V2_BASE, <AssessmentHub />, ASSESSMENT_V2_BASE);
    expect(await screen.findByText(C.recent)).toBeTruthy();
    expect(await screen.findByText(C.noPapersYet)).toBeTruthy();
  });

  it('registers the All papers page under the assessment base', () => {
    expect(routes.map((r) => r.path)).toContain(ASSESSMENT_ALL);
    expect(ASSESSMENT_ALL).toBe(`${ASSESSMENT_V2_BASE}/all`);
  });
});

describe('All papers', () => {
  it('shows the total, every paper by day, and Show more for the rest', async () => {
    portal.getAssessmentPapers.mockImplementation(async ({ page }: { page: number }) => ({
      success: true, papers: page === 1 ? [paper(1), paper(2)] : [paper(3)], total: 3, page, pageSize: 10,
    }));
    at(ASSESSMENT_ALL, <AssessmentAll />, ASSESSMENT_ALL);
    expect(await screen.findByText(C.allPapers)).toBeTruthy();
    expect(await screen.findByText(C.chapterShort(2))).toBeTruthy();
    expect(screen.getByText(C.papersTotal)).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Show more/i }));
    await waitFor(() => expect(screen.getByText(C.chapterShort(3))).toBeTruthy());
  });

  it('filters by one of her classes, server-side', async () => {
    portal.getAssessmentPapers.mockResolvedValue({ success: true, papers: [paper(1)], total: 1, page: 1, pageSize: 10 });
    at(ASSESSMENT_ALL, <AssessmentAll />, ASSESSMENT_ALL);
    const group = await screen.findByRole('radiogroup');
    fireEvent.click(await within(group).findByRole('radio', { name: /Grade 4 · Science/ }));
    await waitFor(() => expect(portal.getAssessmentPapers).toHaveBeenCalledWith(expect.objectContaining({ grade: 4, subject: 'science' })));
  });
});
