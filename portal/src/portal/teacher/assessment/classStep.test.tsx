import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * bd-fmf24g.14 — New paper 1 · Class is the kit's ClassPicker (option A): ONE control instead of the "My classes |
 * All grades" tabs. Any grade and subject of the live catalogue (/assessment/options), her classes
 * (GET /me/grade-subjects?feature=assessment) starred; a grade the catalogue has no book for is off; a pick goes on
 * to step 2 with the catalogue's own subject key.
 */

const { portal } = vi.hoisted(() => ({ portal: { getAssessmentOptions: vi.fn() } }));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));
vi.mock('../../lib/useNewUi', () => ({ readConfigShared: () => Promise.resolve({ features: { assessmentGenerator: true } }) }));
vi.mock('../../lib/gradeSubjects', () => ({
  loadGradeSubjects: () => Promise.resolve([
    { grade: 4, gradeCode: 'grade_4', subject: 'Science', subjectKey: 'science', source: 'class', featureKey: 'science', available: true },
  ]),
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { phoneNumber: '923001234567' }, loading: false }) }));
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { ASSESSMENT_V2_COPY as C } from './copy';
import { forgetCatalogue } from './api';
import { clearPicksForTest, usePicks } from './store';
import { ClassStep } from './NewPaperSteps';
import { newPaperPath } from './paths';

function Picks() {
  const [p] = usePicks();
  return <p data-testid="picks">{JSON.stringify({ grade: p.grade, subject: p.subject })}</p>;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearPicksForTest();
  forgetCatalogue();
  sessionStorage.clear();
  portal.getAssessmentOptions.mockImplementation(async (grade?: number) => (grade
    ? { success: true, grades: [3, 4], maxQuestions: 50, defaultQuestions: 15, subjects: grade === 4
      ? [{ subject_key: 'english', subject: 'English' }, { subject_key: 'science', subject: 'Science' }]
      : [{ subject_key: 'urdu', subject: 'Urdu' }] }
    : { success: true, grades: [3, 4], maxQuestions: 50, defaultQuestions: 15 }));
});

describe('New paper 1 · Class', () => {
  it('one control, no tabs; her grade starred and already picked (her only grade); a grade with no book is off', async () => {
    render(
      <MemoryRouter initialEntries={[newPaperPath('class')]}>
        <Routes>
          <Route path={newPaperPath('class')} element={<ClassStep />} />
          <Route path={newPaperPath('cover')} element={<Picks />} />
        </Routes>
      </MemoryRouter>,
    );
    const trigger = await screen.findByRole('button', { name: new RegExp(C.selectGradeSubject) });
    expect(screen.queryByRole('tab')).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole('radio', { name: /^Grade 4 · Your class/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /^Grade 3/ })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /^Grade 5/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Grade 4 · English' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Grade 4 · Science · Your class' }));
    await waitFor(() => expect(screen.getByTestId('picks').textContent).toBe(JSON.stringify({ grade: 4, subject: 'science' })));
  });

  it('any other grade and subject: the catalogue\'s own key', async () => {
    render(
      <MemoryRouter initialEntries={[newPaperPath('class')]}>
        <Routes>
          <Route path={newPaperPath('class')} element={<ClassStep />} />
          <Route path={newPaperPath('cover')} element={<Picks />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(C.selectGradeSubject) }));
    fireEvent.click(screen.getByRole('radio', { name: /^Grade 3/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Grade 3 · Urdu' }));
    await waitFor(() => expect(screen.getByTestId('picks').textContent).toBe(JSON.stringify({ grade: 3, subject: 'urdu' })));
  });
});
