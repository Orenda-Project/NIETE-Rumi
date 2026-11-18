import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * bd-ipoxhx.5 — ICT Feedback AG row 30: "Save paper", a tighter A4 page so more questions fit on each side.
 * Off unless she turns it on; an ordinary request is sent exactly as before (no `compact` key at all).
 */

const { portal, config } = vi.hoisted(() => ({
  portal: {
    getAssessmentOptions: vi.fn(),
    getAssessmentChapters: vi.fn(),
    generateAssessment: vi.fn(),
    getAssessmentStatus: vi.fn(),
    getAssessmentPapers: vi.fn(),
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
import { clearPicksForTest, setPicks } from './store';
import { fromSpec, newPicks, toSpec, type Picks } from './model';
import { CheckStep } from './NewPaperSteps';
import routes from './routes';
import { ASSESSMENT_V2_BASE, newPaperPath } from './paths';

function at(path: string, routePath: string, el: JSX.Element) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
        <Route path={newPaperPath('check')} element={<p data-testid="check-page" />} />
        <Route path={`${ASSESSMENT_V2_BASE}/request/:id`} element={<p data-testid="request-page" />} />
        <Route path="*" element={<p data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const SCIENCE = { grade: 4, subject: 'science', subjectName: 'Science', chapters: [1] };
const picks = (over: Partial<Picks>): Picks => ({ ...newPicks(15), ...SCIENCE, ...over });
const box = async (name: string) => (await screen.findByRole('textbox', { name: C.typeCount(name) })) as HTMLInputElement;
const marksBox = async () => (await screen.findByRole('textbox', { name: C.totalMarks })) as HTMLInputElement;
beforeEach(() => {
  vi.clearAllMocks();
  clearPicksForTest();
  sessionStorage.clear();
  portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'queued' });
});

describe('the request', () => {
  it('sends compact only when Save paper is on', () => {
    expect(toSpec(picks({ typeCounts: { MCQs: 5 } }))).not.toHaveProperty('compact');
    expect(toSpec(picks({ typeCounts: { MCQs: 5 }, compact: true }))).toMatchObject({ compact: true });
  });

  it('a saved request opens with Save paper as she left it', () => {
    const spec = toSpec(picks({ typeCounts: { MCQs: 5 }, compact: true }));
    expect(fromSpec(spec, 'Science').compact).toBe(true);
    expect(fromSpec(toSpec(picks({ typeCounts: { MCQs: 5 } })), 'Science').compact).toBeFalsy();
  });
});

describe('Check and make', () => {
  it('has a Save paper switch, off, and turning it on sends compact: true', async () => {
    setPicks(picks({ typesSeeded: true, seen: 0, typeCounts: { MCQs: 5 } }));
    portal.generateAssessment.mockResolvedValue({ success: true, requestId: 'req-9' });
    at(newPaperPath('check'), newPaperPath('check'), <CheckStep />);
    const save = await screen.findByRole('switch', { name: C.savePaper });
    expect(save.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(save);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(C.makePaper) }));
    await waitFor(() => expect(screen.getByTestId('request-page')).toBeTruthy());
    expect(portal.generateAssessment.mock.calls[0][0]).toMatchObject({ compact: true, answerLines: true });
  });
});
