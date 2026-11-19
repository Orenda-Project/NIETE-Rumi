import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/**
 * bd-snkn32.58.1 (queue #155 A) — Amena 19 Nov, testing the goal start: "wrong flow, From textbook chapter OR Start
 * from a learning goal". Make my own opens with two equal choices.
 *
 *   Given the goal switch is on    Make my own's first screen: two equal cards (book / goal), no class picker yet
 *   Book card                      today's flow: class → chapters in own mode
 *   Goal card                      class only → the goal step for that class, with NO chapter in the address
 *   Given the switch is off        Make my own's first screen is today's class picker, unchanged
 *   The address                    a goal start needs no chapter; any other own address still does
 */

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../../lib/recordingSession', () => ({ useRecordingSession: () => null }));
vi.mock('../../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const flag = vi.hoisted(() => ({ goal: true }));
vi.mock('./flag', () => ({ useLpMakeOwn: () => true }));
vi.mock('../audience', () => ({ useLessonsLeader: () => false }));
vi.mock('./goalApi', async (orig) => ({ ...(await orig<object>()), useLpOwnGoalStart: () => flag.goal }));

import api from '../../../services/api';
import { resetLessonPlans } from '../../../newui/lessons/lessonPlansApi';
import { NewLessonPage } from '../NewLessonPage';
import { LESSONS_V2_COPY as L } from '../copy';
import { GOAL_COPY as G } from './goalCopy';
import { OWN_BOOK, OWN_GOAL, OWN_PICK, OWN_START, ownUrl, readOwn } from './state';
import { lessonsUrl } from '../paths';

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const answers: Record<string, () => unknown> = {
  '/me/grade-subjects': () => ({ success: true, combos: [
    { grade: 3, gradeCode: 'grade_3', subject: 'Mathematics', subjectKey: 'maths', source: 'class', featureKey: 'math', available: true },
  ] }),
  '/curriculum/grades': () => ({ grades: [{ grade: 3, subject_count: 1 }] }),
  '/lp612/grades': () => ({ grades: [] }),
  '/curriculum/subjects': () => ({ subjects: [{ subject_key: 'math', subject: 'Math', lesson_count: 80 }] }),
};

function Where() {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
}

const at = (path: string) => {
  const [pathname, search] = path.split('?');
  return render(
    <MemoryRouter initialEntries={[{ pathname, search: search ? `?${search}` : '' }]}>
      <Routes><Route path={pathname} element={<NewLessonPage />} /><Route path="*" element={null} /></Routes>
      <Where />
    </MemoryRouter>,
  );
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetLessonPlans();
  flag.goal = true;
  http.get.mockImplementation(async (url: string) => {
    const hit = answers[url];
    if (!hit) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: hit() };
  });
});

describe('Make my own: the first screen', () => {
  it('switch on: two equal cards, book and goal, and no class picker yet', () => {
    at(OWN_START);
    const book = screen.getByRole('link', { name: new RegExp(G.fromBook) });
    const goal = screen.getByRole('link', { name: new RegExp(G.fromGoal) });
    expect(book.getAttribute('href')).toBe(OWN_BOOK);
    expect(goal.getAttribute('href')).toBe(OWN_GOAL);
    expect(screen.queryByRole('button', { name: new RegExp(L.selectGradeSubject) })).toBeNull();
  });

  it('switch off: today\'s class picker, no cards', async () => {
    flag.goal = false;
    at(OWN_START);
    expect(await screen.findByRole('button', { name: new RegExp(L.selectGradeSubject) })).toBeTruthy();
    expect(screen.queryByRole('link', { name: new RegExp(G.fromGoal) })).toBeNull();
  });

  it('book card: class → chapters in own mode (today\'s flow)', async () => {
    at(OWN_BOOK);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(L.selectGradeSubject) }));
    const sheet = screen.getByRole('dialog', { name: L.selectGradeSubject });
    fireEvent.click(await within(sheet).findByRole('radio', { name: /^Grade 3 · Your class/ }));
    const maths = within(sheet).getByRole('link', { name: /Grade 3 · Mathematics · Your class/ });
    expect(maths.getAttribute('href')).toBe(lessonsUrl('chapters', { grade: 3, subject: 'math', key: 'maths', pick: OWN_PICK }));
  });

  it('goal card: class only → the goal step, no chapter', async () => {
    at(OWN_GOAL);
    await waitFor(() => expect(http.get).toHaveBeenCalledWith('/me/grade-subjects', { params: { feature: 'lessons' } }));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(L.selectGradeSubject) }));
    const sheet = screen.getByRole('dialog', { name: L.selectGradeSubject });
    fireEvent.click(await within(sheet).findByRole('radio', { name: /^Grade 3 · Your class/ }));
    const maths = within(sheet).getByRole('link', { name: /Grade 3 · Mathematics · Your class/ });
    const href = maths.getAttribute('href') ?? '';
    expect(href).toBe(ownUrl({ grade: 3, subject: 'math', step: 'goal', goal: { kind: null, text: '' } }));
    expect(href).not.toContain('chapter=');
  });
});

describe('the address', () => {
  it('a goal start needs no chapter', () => {
    const s = readOwn('?grade=3&subject=math&step=goal&start=goal');
    expect(s).toEqual(expect.objectContaining({ grade: 3, subject: 'math', chapter: '', step: 'goal', goal: { kind: null, text: '' } }));
  });
  it('any other own address still needs its chapter', () => {
    expect(readOwn('?grade=3&subject=math&step=size')).toBeNull();
  });
});
