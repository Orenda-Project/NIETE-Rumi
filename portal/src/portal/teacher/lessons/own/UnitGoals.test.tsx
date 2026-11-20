import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/**
 * bd-snkn32.59.4 (queue #165, phase 2) — "A whole unit" from her learning goals, with NO textbook. Amena 20 Nov:
 * "learning goals wont be related to the textbook, it could be any few goals that need a plan, pls dont link the
 * textbook for learning goals".
 *
 *   Start            the chapters screen offers "From learning goals" (both switches on); the goals screen asks for no chapter
 *   Her goals        2-8, from the skill list or her own words ("Add my own goal", still checked), in the order she adds them
 *   Pace + days      the day counts come from how many goals she has; See the days saves goals only (no book, no chapter)
 *   Her days         review and check days are labelled by the goals they cover and are MADE (no book day to open)
 */

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../../lib/recordingSession', () => ({ useRecordingSession: () => null }));
vi.mock('../../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
const flag = vi.hoisted(() => ({ goal: true, unit: true }));
vi.mock('./flag', () => ({ useLpMakeOwn: () => true }));
vi.mock('./goalApi', async (orig) => ({ ...(await orig<object>()), useLpOwnGoalStart: () => flag.goal }));
vi.mock('./unitApi', async (orig) => ({ ...(await orig<object>()), useLpOwnUnit: () => flag.unit }));

import api from '../../../services/api';
import { UNIT_COPY as U } from './unitCopy';
import { GOAL_COPY as G } from './goalCopy';
import { LESSONS_UNIT, LESSONS_UNIT_GOALS, LESSONS_UNIT_NEW, unitGoalsUrl, unitNewUrl, unitUrl } from './unitPaths';
import { UnitNewPage } from './UnitNewPage';
import { UnitGoalsPage } from './UnitGoalsPage';
import { UnitPage } from './UnitPage';

const http = api as unknown as Record<'get' | 'post' | 'put', ReturnType<typeof vi.fn>>;
const ID = '11111111-2222-4333-8444-555555555555';
const OUTCOMES = [
  { segmentId: 'grade_3_math_ch2_seg1', text: 'Add 2-digit numbers', group: 'add_sub', code: 'M-03-AD-02' },
  { segmentId: 'grade_3_math_ch2_seg5', text: 'Subtract 2-digit numbers', group: 'add_sub', code: 'M-03-SU-01' },
];
const gday = (n: number, kind: string, ids: string[], topic: string, covers?: [number, number]) => ({ day: n, kind, chapter: 1, lesson_ids: ids, topic, plan: null, ...(covers ? { covers } : {}) });
const GUNIT = {
  id: ID, grade: 3, subject: 'math', book_stem: null, chapter_from: null, chapter_to: null, start_kind: 'goals',
  goals: ['Add 2-digit numbers', 'Telling the time'], period_minutes: 35, pace: 'recommended', status: 'active', next: 1,
  days: [gday(1, 'lesson', ['goal_1'], 'Add 2-digit numbers'), gday(2, 'lesson', ['goal_2'], 'Telling the time'),
    gday(3, 'review', ['review_1'], '', [1, 2]), gday(4, 'test', ['check'], '', [1, 2])],
};
const answers: Record<string, (p?: { params?: Record<string, unknown> }) => unknown> = {
  '/lp/own/unit/chapters': () => ({ success: true, book: 'g3_math', period: 35, chapters: [{ number: 2, title: 'Plus and Minus', days: 11 }] }),
  '/lp/own/unit/paces': (p) => ({ success: true, counts: p?.params?.start === 'goals' ? { recommended: 4, slower: 6, faster: null } : { recommended: 11, slower: 12, faster: 10 } }),
  '/lp612/own/goals': () => ({ success: true, outcomes: OUTCOMES }),
  '/lp612/own/goals/match': () => ({ success: true, status: 'none', suggestions: [], otherGrade: null }),
  [`/lp/own/units/${ID}`]: () => ({ success: true, unit: GUNIT }),
};

function Where() {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
}
const at = (path: string) => {
  const [pathname, search] = path.split('?');
  return render(
    <MemoryRouter initialEntries={[{ pathname, search: search ? `?${search}` : '' }]}>
      <Routes>
        <Route path={LESSONS_UNIT_NEW} element={<UnitNewPage />} />
        <Route path={LESSONS_UNIT_GOALS} element={<UnitGoalsPage />} />
        <Route path={LESSONS_UNIT} element={<UnitPage />} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
};
const where = () => screen.getByTestId('where').textContent ?? '';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* none */ }
  flag.goal = true;
  flag.unit = true;
  http.get.mockImplementation(async (url: string, p?: { params?: Record<string, unknown> }) => {
    const hit = answers[url];
    if (!hit) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: hit(p) };
  });
});

describe('starting a unit from learning goals', () => {
  it('the chapters screen offers "From learning goals", which goes to the goals screen (no chapter asked)', async () => {
    at(unitNewUrl({ grade: 3, subject: 'math' }));
    fireEvent.click(await screen.findByRole('radio', { name: U.fromGoals }));
    await waitFor(() => expect(where()).toBe(unitGoalsUrl({ grade: 3, subject: 'math', period: 35 }))); // her saved period comes along
  });
  it('goal switch off: no goal start on the chapters screen', async () => {
    flag.goal = false;
    at(unitNewUrl({ grade: 3, subject: 'math' }));
    await screen.findByTestId('unit-ch-2');
    expect(screen.queryByRole('radio', { name: U.fromGoals })).toBeNull();
  });
});

describe('her goals', () => {
  it('a skill goal and her own words, in her order; See the days saves the goals only, no book and no chapter', async () => {
    http.post.mockResolvedValue({ data: { success: true, unit: GUNIT } });
    at(unitGoalsUrl({ grade: 3, subject: 'math' }));
    // one skill group: it is open already (GoalStep's rule)
    fireEvent.click(await screen.findByRole('radio', { name: 'Add 2-digit numbers' }));
    expect(screen.getByTestId('unit-goals-picked').textContent).toContain('Add 2-digit numbers');
    expect((screen.getByTestId('unit-see-days') as HTMLButtonElement).disabled).toBe(true); // one goal is not a unit
    fireEvent.click(screen.getByTestId('own-goal-add'));
    fireEvent.change(screen.getByTestId('own-goal-topic'), { target: { value: 'Telling the time' } });
    fireEvent.click(screen.getByTestId('own-goal-find'));
    fireEvent.click(await screen.findByRole('button', { name: G.useMine }));
    const picked = screen.getByTestId('unit-goals-picked');
    expect(within(picked).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('Add 2-digit numbers'), expect.stringContaining('Telling the time'),
    ]);
    await waitFor(() => expect(screen.getByTestId('unit-paces').textContent).toContain('Recommended · 4 days'));
    expect(http.get).toHaveBeenCalledWith('/lp/own/unit/paces', { params: { start: 'goals', count: 2, period: 35 } });
    fireEvent.click(screen.getByTestId('unit-see-days'));
    await waitFor(() => expect(where()).toBe(unitUrl(ID)));
    const body = http.post.mock.calls[0][1];
    expect(body).toEqual({ start: 'goals', grade: 3, subject: 'math', period: 35, pace: 'recommended',
      goals: [{ kind: 'outcome', text: 'Add 2-digit numbers', code: 'M-03-AD-02' }, { kind: 'topic', text: 'Telling the time' }] });
    expect(JSON.stringify(body)).not.toMatch(/seg|chapter|from|pages/);
  });
  it('a goal can be taken out again', async () => {
    at(unitGoalsUrl({ grade: 3, subject: 'math' }));
    // one skill group: it is open already (GoalStep's rule)
    fireEvent.click(await screen.findByRole('radio', { name: 'Add 2-digit numbers' }));
    fireEvent.click(screen.getByRole('button', { name: `${U.remove} · Add 2-digit numbers` }));
    expect(screen.queryByTestId('unit-goals-picked')).toBeNull();
  });
});

describe('a goal unit\'s days', () => {
  it('review and check days say which goals they cover; opening the check day makes it (no book day)', async () => {
    http.post.mockResolvedValue({ status: 202, data: { success: true, state: 'authoring', renderId: 'own-7' } });
    at(unitUrl(ID));
    expect((await screen.findByTestId('unit-day-3')).textContent).toContain(U.reviewGoals(1, 2));
    expect(screen.getByTestId('unit-day-4').textContent).toContain(U.checkGoals);
    const cls = screen.getByTestId('unit-class');
    fireEvent.click(within(cls).getByRole('radio', { name: '31 – 50' }));
    fireEvent.click(within(cls).getByRole('radio', { name: 'Mixed' }));
    fireEvent.click(screen.getByTestId('unit-open-4'));
    await waitFor(() => expect(http.post).toHaveBeenCalledTimes(1));
    expect(http.post.mock.calls[0][0]).toBe(`/lp/own/units/${ID}/days/4/open`);
    await waitFor(() => expect(where()).toContain('render=own-7'));
    expect(where()).not.toContain('chapter=');
  });
});
