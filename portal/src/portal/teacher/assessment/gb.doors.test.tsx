import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * Gilgit-Baltistan on Papers (operator, 9 Nov 2026: board-pattern papers "should not be the subjects for GB").
 * The bot decides it (internal-api /assessment/options: no `patternGrades` for a teacher whose region names its own
 * books — tests/books/gb-no-ict-patterns.test.js); this pins what each answer draws on the papers home:
 *   GB answer  (no patternGrades)          → New paper only, no board-pattern door
 *   ICT answer (patternGrades 5, 9-12)     → the "Board pattern papers" door above New paper, as before
 * and that a teacher with NO class (copied GB teachers have none: /me/grade-subjects → []) is not held on a loading
 * skeleton: Class shows the picker at once, and any grade + subject of the catalogue takes her on to Cover.
 */

const { portal, opts } = vi.hoisted(() => ({
  portal: {
    getAssessmentOptions: vi.fn(),
    getAssessmentPapers: vi.fn(),
    getAssessmentStatus: vi.fn(),
    takeGenerateFailure: vi.fn(() => null),
  },
  opts: { patternGrades: undefined as number[] | undefined },
}));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));
vi.mock('../../lib/useNewUi', () => ({ readConfigShared: () => Promise.resolve({ features: { assessmentGenerator: true } }) }));
vi.mock('../../lib/gradeSubjects', () => ({ loadGradeSubjects: () => Promise.resolve([]) }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { phoneNumber: '923001234567' }, loading: false }) }));
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { ASSESSMENT_V2_COPY as C } from './copy';
import { forgetCatalogue } from './api';
import { forgetPapers } from './paperCache';
import { clearPicksForTest, usePicks } from './store';
import { AssessmentHub } from './AssessmentHub';
import { ClassStep } from './NewPaperSteps';
import { ASSESSMENT_V2_BASE, newPaperPath } from './paths';

function Picks() {
  const [p] = usePicks();
  return <p data-testid="picks">{JSON.stringify({ grade: p.grade, subject: p.subject, pattern: p.pattern })}</p>;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearPicksForTest();
  forgetCatalogue();
  forgetPapers();
  sessionStorage.clear();
  opts.patternGrades = undefined;
  portal.getAssessmentOptions.mockImplementation(async (grade?: number) => {
    const top = {
      success: true, grades: [1, 5], maxQuestions: 50, defaultQuestions: 15,
      ...(opts.patternGrades ? { patternGrades: opts.patternGrades } : {}),
    };
    return grade ? { ...top, subjects: [{ subject_key: 'english', subject: 'English' }, { subject_key: 'islamiat', subject: 'Islamiat' }] } : top;
  });
  portal.getAssessmentPapers.mockResolvedValue({ success: true, papers: [], total: 0, page: 1, pageSize: 10 });
});

const hub = () => render(
  <MemoryRouter initialEntries={[ASSESSMENT_V2_BASE]}>
    <Routes><Route path={ASSESSMENT_V2_BASE} element={<AssessmentHub />} /></Routes>
  </MemoryRouter>,
);

describe('papers home: the board-pattern door follows the server', () => {
  it('a GB teacher (no patternGrades): New paper, and no board-pattern door', async () => {
    hub();
    await screen.findByText(C.newPaper);
    await waitFor(() => expect(portal.getAssessmentOptions).toHaveBeenCalled());
    await screen.findByText(C.noPapersYet);
    expect(screen.queryByTestId('fde-door')).toBeNull();
    expect(screen.queryByText(C.boardDoor)).toBeNull();
    expect(screen.queryByText(C.fdeDoor)).toBeNull();
  });

  it('an ICT teacher (patternGrades 5, 9-12): the "Board pattern papers" door, as before', async () => {
    opts.patternGrades = [5, 9, 10, 11, 12];
    hub();
    const door = await screen.findByTestId('fde-door');
    expect(door.textContent).toContain(C.boardDoor);
    expect(screen.getByText(C.newPaper)).toBeTruthy();
  });
});

describe('New paper with no class', () => {
  it('Class shows the picker (not a skeleton); any grade + subject goes on to Cover', async () => {
    render(
      <MemoryRouter initialEntries={[newPaperPath('class')]}>
        <Routes>
          <Route path={newPaperPath('class')} element={<ClassStep />} />
          <Route path={newPaperPath('cover')} element={<Picks />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(C.selectGradeSubject) }));
    fireEvent.click(screen.getByRole('radio', { name: /^Grade 1\b(?!\d)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Grade 1 · English' }));
    expect(JSON.parse((await screen.findByTestId('picks')).textContent || '{}')).toEqual({ grade: 1, subject: 'english', pattern: null });
  });
});
