import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * bd-nr8mrm.8 — FEAT-209 (Ramisha Riaz): BEFORE the paper is made, Check and make says when her questions will not fit
 * the pages she asked for: "These questions need about 3 pages. Make it 3, or remove some questions." A warning, never a
 * block: Make still sends. Only while assessment_page_fit is on, and only when she has set a page count.
 */

const { portal, config } = vi.hoisted(() => ({
  portal: {
    getAssessmentOptions: vi.fn(),
    getAssessmentChapters: vi.fn(),
    generateAssessment: vi.fn(),
    getAssessmentStatus: vi.fn(),
    getAssessmentPapers: vi.fn(),
  },
  config: { features: { assessmentGenerator: true, assessmentEditing: true, assessmentPageFit: true } },
}));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));
vi.mock('../../lib/useNewUi', () => ({ readConfigShared: () => Promise.resolve(config) }));
vi.mock('../../lib/gradeSubjects', () => ({ loadGradeSubjects: () => Promise.resolve([]) }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { phoneNumber: '923001234567' }, loading: false }) }));
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { ASSESSMENT_V2_COPY as C, ASSESSMENT_V2_COPY_UR as U } from './copy';
import { clearPicksForTest, setPicks } from './store';
import { newPicks, type Picks } from './model';
import { CheckStep } from './NewPaperSteps';
import { ASSESSMENT_V2_BASE, newPaperPath } from './paths';
import { estimatePages } from './pageEstimate';

const SCIENCE = { grade: 4, subject: 'science', subjectName: 'Science', chapters: [1] };
const picks = (over: Partial<Picks>): Picks => ({ ...newPicks(15), ...SCIENCE, typesSeeded: true, seen: 0, typeCounts: { MCQs: 5 }, ...over });

describe('estimatePages', () => {
  it('a short objective paper is one page', () => {
    expect(estimatePages(picks({ typeCounts: { MCQs: 5 } }))).toBe(1);
  });

  it('ten long questions need four pages', () => {
    expect(estimatePages(picks({ typeCounts: { 'Long Questions': 10 } }))).toBe(4);
  });

  it('more questions never need fewer pages', () => {
    const a = estimatePages(picks({ typeCounts: { 'Short Questions': 10 } }));
    const b = estimatePages(picks({ typeCounts: { 'Short Questions': 30 } }));
    expect(b).toBeGreaterThan(a);
  });

  it('counts seen questions too', () => {
    const unseenOnly = estimatePages(picks({ typeCounts: { 'Long Questions': 6 } }));
    const both = estimatePages(picks({ typeCounts: { 'Long Questions': 6 }, seen: 0, seenTypeCounts: { 'Long Questions': 6 } }));
    expect(both).toBeGreaterThan(unseenOnly);
  });

  it('a type it has not measured still counts, as its kind', () => {
    expect(estimatePages(picks({ typeCounts: { 'Some New Essay': 12 } }))).toBeGreaterThan(1);
  });

  it('Urdu script takes more room', () => {
    const tc = { 'Short Questions': 47 };
    expect(estimatePages(picks({ subject: 'urdu', typeCounts: tc }))).toBeGreaterThan(estimatePages(picks({ typeCounts: tc })));
  });

  it('no questions, no estimate', () => {
    expect(estimatePages(picks({ typeCounts: {} }))).toBeNull();
  });
});

function at() {
  return render(
    <MemoryRouter initialEntries={[newPaperPath('check')]}>
      <Routes>
        <Route path={newPaperPath('check')} element={<CheckStep />} />
        <Route path={`${ASSESSMENT_V2_BASE}/request/:id`} element={<p data-testid="request-page" />} />
        <Route path="*" element={<p data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
}
const LONG = { typeCounts: { 'Long Questions': 10 } }; // about 4 pages
const pagesBox = async () => (await screen.findByRole('textbox', { name: C.pagesLimit })) as HTMLInputElement;
const make = () => screen.getByRole('button', { name: new RegExp(C.makePaper) });

beforeEach(() => {
  vi.clearAllMocks();
  clearPicksForTest();
  sessionStorage.clear();
  config.features.assessmentPageFit = true;
  portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'queued' });
  portal.generateAssessment.mockResolvedValue({ success: true, requestId: 'req-9' });
});

describe('Check and make', () => {
  it('2 pages for 4 pages of questions: says so, and Make still sends', async () => {
    setPicks(picks({ ...LONG, pageCount: 2 }));
    at();
    expect(await screen.findByText(C.pagesNeed(4))).toBeTruthy();
    fireEvent.click(make());
    await waitFor(() => expect(screen.getByTestId('request-page')).toBeTruthy());
    expect(portal.generateAssessment.mock.calls[0][0]).toMatchObject({ pageCount: 2 });
  });

  it('when the questions fit, no warning', async () => {
    setPicks(picks({ ...LONG, pageCount: 4 }));
    at();
    await pagesBox();
    expect(screen.queryByText(C.pagesNeed(4))).toBeNull();
    expect(screen.getByText(C.pagesLimitHint)).toBeTruthy();
  });

  it('an empty Pages box: no warning', async () => {
    setPicks(picks({ ...LONG }));
    at();
    await pagesBox();
    expect(screen.queryByText(C.pagesNeed(4))).toBeNull();
  });

  it('typing a smaller number brings the warning up', async () => {
    setPicks(picks({ ...LONG }));
    at();
    fireEvent.change(await pagesBox(), { target: { value: '1' } });
    expect(await screen.findByText(C.pagesNeed(4))).toBeTruthy();
  });

  it('no warning while the setting is off', async () => {
    config.features.assessmentPageFit = false;
    setPicks(picks({ ...LONG, pageCount: 2 }));
    at();
    await screen.findByRole('switch', { name: C.savePaper });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(C.pagesNeed(4))).toBeNull();
  });
});

describe('copy', () => {
  it('English says the number twice', () => {
    expect(C.pagesNeed(3)).toBe('These questions need about 3 pages. Make it 3, or remove some questions.');
  });
  it('Urdu has it, the number isolated and in Western digits', () => {
    const s = U.pagesNeed(3);
    expect(s).toMatch(/[؀-ۿ]/);
    expect(s.match(/⁦3⁩/g)?.length).toBe(2);
    expect(s).not.toMatch(/[٠-٩۰-۹]/);
  });
});
