import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import summaries from './fixtures/fde-summaries.json';

/**
 * bd-5jmnfj.4: the board pattern serves Grades 1 and 2 beside Grade 5. The door, its chips, its picker and the held
 * note follow the grades /assessment/options advertises (`patternGrades`), never a fixed Grade 5.
 */

const { portal, config, opts } = vi.hoisted(() => ({
  portal: {
    getAssessmentOptions: vi.fn(),
    getAssessmentChapters: vi.fn(),
    generateAssessment: vi.fn(),
    getAssessmentStatus: vi.fn(),
    getAssessmentPapers: vi.fn(),
    getAssessmentDownload: vi.fn(),
    getAssessmentVersions: vi.fn(),
    takeGenerateFailure: vi.fn(() => null),
  },
  config: { features: { assessmentGenerator: true, assessmentEditing: true } },
  opts: { patternGrades: [1, 2, 5] as number[], islamiatAt: [5] as number[] },
}));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));
vi.mock('../../lib/useNewUi', () => ({ readConfigShared: () => Promise.resolve(config) }));
vi.mock('../../lib/gradeSubjects', () => ({ loadGradeSubjects: () => Promise.resolve([]) }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { phoneNumber: 'fde-teacher' }, loading: false }) }));
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { ASSESSMENT_V2_COPY as C, ASSESSMENT_V2_COPY_UR as CU } from './copy';
import { forgetCatalogue } from './api';
import { forgetPapers } from './paperCache';
import { clearPicksForTest, setPicks, usePicks } from './store';
import { newPicks } from './model';
import { AssessmentHub } from './AssessmentHub';
import { ClassStep } from './NewPaperSteps';
import { ASSESSMENT_V2_BASE as B, newPaperPath } from './paths';

const MATHS = (summaries as Record<string, unknown>).maths as Record<string, unknown>;
const subjectsAt = (g: number) => [
  { subject_key: 'maths', subject: 'Maths' },
  ...(opts.islamiatAt.includes(g) ? [{ subject_key: 'islamiat', subject: 'Islamiat' }] : []),
];

function Where() {
  const loc = useLocation();
  const [p] = usePicks();
  return <p data-testid="where">{JSON.stringify({ path: loc.pathname, grade: p.grade, subject: p.subject, pattern: p.pattern })}</p>;
}
const where = () => JSON.parse(screen.getByTestId('where').textContent || '{}');

function at(path: string, routePath: string, el: JSX.Element) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const doorPicks = () => setPicks({ ...newPicks(15), grade: null, coverBy: 'fde', style: 'fde', pattern: null, patternIntent: 'fde' });

beforeEach(() => {
  vi.clearAllMocks();
  clearPicksForTest();
  forgetCatalogue();
  forgetPapers();
  sessionStorage.clear();
  opts.patternGrades = [1, 2, 5];
  opts.islamiatAt = [5];
  portal.getAssessmentOptions.mockImplementation(async (grade?: number, subject?: string) => {
    const top = { success: true, grades: [1, 2, 5], maxQuestions: 50, defaultQuestions: 15, patternGrades: opts.patternGrades };
    if (grade && subject) {
      const on = subject === 'maths' && opts.patternGrades.includes(grade);
      return { ...top, types: [], ...(on ? { patterns: [{ ...MATHS, id: grade === 5 ? 'fde_g5_2027' : `fde_g${grade}_2026` }] } : {}) };
    }
    if (grade) return { ...top, subjects: subjectsAt(grade) };
    return top;
  });
  portal.getAssessmentPapers.mockResolvedValue({ success: true, papers: [], total: 0, page: 1, pageSize: 10 });
});

describe('door chips', () => {
  it('Grade 5 alone keeps today\'s chips, date and all', () => {
    expect(C.fdeDoorChips([5])).toBe('Grade 5 · Feb 2027 · Marking scheme');
    expect(CU.fdeDoorChips([5])).toBe('جماعت 5 · فروری 2027 · مارکنگ اسکیم');
  });

  it('several grades name them all and claim no exam date', () => {
    expect(C.fdeDoorChips([1, 2, 5])).toBe('Grades 1, 2, 5 · Marking scheme');
    expect(CU.fdeDoorChips([1, 2])).toBe('جماعت 1، 2 · مارکنگ اسکیم');
    expect(C.fdeDoorChips([1])).toBe('Grade 1 · Marking scheme');
  });
});

describe('hub door', () => {
  it('shows every advertised grade and leaves the grade to the Class step', async () => {
    at(B, B, <AssessmentHub />);
    const door = await screen.findByTestId('fde-door');
    expect(door.textContent).toContain('Grades 1, 2, 5');
    expect(door.textContent).not.toContain('Feb 2027');
    fireEvent.click(door);
    await waitFor(() => expect(where().path).toBe(newPaperPath('class')));
    expect(where().grade).toBeNull();
  });

  it('a single advertised grade is still preset, as today', async () => {
    opts.patternGrades = [5];
    at(B, B, <AssessmentHub />);
    fireEvent.click(await screen.findByTestId('fde-door'));
    await waitFor(() => expect(where().path).toBe(newPaperPath('class')));
    expect(where().grade).toBe(5);
  });
});

describe('door Class step', () => {
  it('a Grade 1 subject is picked with its own pattern', async () => {
    doorPicks();
    at(newPaperPath('class'), newPaperPath('class'), <ClassStep />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(C.selectGradeSubject) }));
    fireEvent.click(await screen.findByRole('button', { name: /^Grade 1 · Maths/ }));
    await waitFor(() => expect(where().path).toBe(newPaperPath('check')));
    expect(where()).toMatchObject({ grade: 1, subject: 'maths', pattern: 'fde_g1_2026' });
  });

  it('no Islamiat in any door grade: no held note', async () => {
    opts.patternGrades = [1, 2];
    doorPicks();
    at(newPaperPath('class'), newPaperPath('class'), <ClassStep />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(C.selectGradeSubject) }));
    expect(await screen.findByRole('button', { name: /^Grade 1 · Maths/ })).toBeTruthy();
    expect(screen.queryByTestId('fde-held-note')).toBeNull();
  });

  it('Islamiat listed at Grade 1 only: the held note shows', async () => {
    opts.patternGrades = [1, 2];
    opts.islamiatAt = [1];
    doorPicks();
    at(newPaperPath('class'), newPaperPath('class'), <ClassStep />);
    expect(await screen.findByTestId('fde-held-note')).toBeTruthy();
  });
});
