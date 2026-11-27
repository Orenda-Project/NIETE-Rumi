import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * bd-nr8mrm.4 — FEAT-209 (Ramisha Riaz): "EG page-count option". On Check and make the teacher can say how many pages
 * the paper may take (1–5). Empty = no limit, sent exactly as before (no `pageCount` key). Shown only while the
 * app-wide setting assessment_page_fit is on (/config features.assessmentPageFit).
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

import { ASSESSMENT_V2_COPY as C } from './copy';
import { clearPicksForTest, setPicks } from './store';
import { fromSpec, newPicks, toSpec, type Picks } from './model';
import { CheckStep } from './NewPaperSteps';
import { ASSESSMENT_V2_BASE, newPaperPath } from './paths';

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

const SCIENCE = { grade: 4, subject: 'science', subjectName: 'Science', chapters: [1] };
const picks = (over: Partial<Picks>): Picks => ({ ...newPicks(15), ...SCIENCE, typesSeeded: true, seen: 0, typeCounts: { MCQs: 5 }, ...over });
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

describe('the request', () => {
  it('sends pageCount only when it is 1 to 5', () => {
    expect(toSpec(picks({}))).not.toHaveProperty('pageCount');
    expect(toSpec(picks({ pageCount: 2 }))).toMatchObject({ pageCount: 2 });
    expect(toSpec(picks({ pageCount: 5 }))).toMatchObject({ pageCount: 5 });
    [0, 6, 7, null].forEach((n) => expect(toSpec(picks({ pageCount: n }))).not.toHaveProperty('pageCount'));
  });

  it('a saved request opens with the pages she set', () => {
    expect(fromSpec(toSpec(picks({ pageCount: 3 })), 'Science').pageCount).toBe(3);
    expect(fromSpec(toSpec(picks({})), 'Science').pageCount).toBeFalsy();
    expect(fromSpec({ ...toSpec(picks({})), pageCount: 9 } as never, 'Science').pageCount).toBeFalsy();
  });
});

describe('Check and make', () => {
  it('no Pages box while the setting is off', async () => {
    config.features.assessmentPageFit = false;
    setPicks(picks({}));
    at();
    await screen.findByRole('switch', { name: C.savePaper });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('textbox', { name: C.pagesLimit })).toBeNull();
  });

  it('an empty Pages box sends no pageCount', async () => {
    setPicks(picks({}));
    at();
    expect((await pagesBox()).value).toBe('');
    fireEvent.click(make());
    await waitFor(() => expect(screen.getByTestId('request-page')).toBeTruthy());
    expect(portal.generateAssessment.mock.calls[0][0]).not.toHaveProperty('pageCount');
  });

  it('typing 2 sends pageCount: 2', async () => {
    setPicks(picks({}));
    at();
    fireEvent.change(await pagesBox(), { target: { value: '2' } });
    fireEvent.click(make());
    await waitFor(() => expect(screen.getByTestId('request-page')).toBeTruthy());
    expect(portal.generateAssessment.mock.calls[0][0]).toMatchObject({ pageCount: 2 });
  });

  it('typing 7 says choose 1 to 5 and Make does not send', async () => {
    setPicks(picks({}));
    at();
    fireEvent.change(await pagesBox(), { target: { value: '7' } });
    expect((await screen.findAllByText(C.pagesLimitError)).length).toBeGreaterThan(0);
    fireEvent.click(make());
    await new Promise((r) => setTimeout(r, 20));
    expect(portal.generateAssessment).not.toHaveBeenCalled();
  });
});

describe('copy', () => {
  it('has Urdu for every Pages string, with Western digits as the portal uses', async () => {
    const { ASSESSMENT_V2_COPY_UR: U } = await import('./copy');
    expect(U.pagesLimit).toBeTruthy();
    expect(U.pagesLimitHint).toBeTruthy();
    expect(U.pagesLimitError).toMatch(/1.*5/);
    expect(U.pagesLimitError).not.toMatch(/[٠-٩۰-۹]/);
  });
});
