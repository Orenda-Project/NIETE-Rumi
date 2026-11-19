import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * bd-snkn32.56 (queue #134 E) — the goal screen: her grade's learning goals as a list (GET /lp612/own/goals), or a
 * topic she types, matched to the closest lesson (GET /lp612/own/goals/match). Either way the pick carries the lesson
 * the plan is written over. A topic with no lesson behind it is said plainly, never guessed.
 */
vi.mock('../../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from '../../../services/api';
import { GoalStep } from './GoalStep';
import { fetchGoals, matchGoal } from './goalApi';
import { GOAL_COPY as C } from './goalCopy';

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const OUTCOMES = [
  { segmentId: 'g7.c01', text: 'Compare plant and animal cells', chapter: 'Cells' },
  { segmentId: 'g7.c03', text: 'Describe the water cycle', chapter: 'Water' },
];
const at = { grade: 7, subject: 'General Science' };
beforeEach(() => { cleanup(); http.get.mockReset(); });

function answer(match: unknown = null) {
  http.get.mockImplementation(async (url: string) => (url === '/lp612/own/goals/match'
    ? { data: { success: true, match } } : { data: { success: true, outcomes: OUTCOMES } }));
}

describe('goalApi', () => {
  it('reads her grade and subject; a failure is null, never an empty list', async () => {
    answer();
    expect(await fetchGoals(at)).toEqual(OUTCOMES);
    expect(http.get).toHaveBeenCalledWith('/lp612/own/goals', { params: at });
    http.get.mockRejectedValue(new Error('net'));
    expect(await fetchGoals(at)).toBeNull();
  });
  it('a match is the lesson, or null; a malformed row is dropped', async () => {
    answer({ segmentId: 'g7.c03', title: 'Describe the water cycle' });
    expect(await matchGoal(at, 'rain')).toEqual({ segmentId: 'g7.c03', title: 'Describe the water cycle' });
    expect(http.get).toHaveBeenLastCalledWith('/lp612/own/goals/match', { params: { ...at, q: 'rain' } });
    answer({ title: 'x' });
    expect(await matchGoal(at, 'rain')).toBeNull();
  });
});

describe('GoalStep', () => {
  it('picking a learning goal hands back the goal and its lesson', async () => {
    answer();
    const onPick = vi.fn();
    render(<GoalStep at={at} goal={{ kind: null, text: '' }} onPick={onPick} />);
    fireEvent.click(await screen.findByRole('button', { name: /Water/ })); // bd-snkn32.58.1: grouped, the chapter opens first
    fireEvent.click(screen.getByText('Describe the water cycle'));
    expect(onPick).toHaveBeenCalledWith({ kind: 'outcome', text: 'Describe the water cycle' }, 'g7.c03');
  });

  it('a typed topic is matched, and the closest lesson is named', async () => {
    answer({ segmentId: 'g7.c03', title: 'Describe the water cycle' });
    const onPick = vi.fn();
    render(<GoalStep at={at} goal={{ kind: null, text: '' }} onPick={onPick} />);
    fireEvent.change(screen.getByTestId('own-goal-topic'), { target: { value: 'Rain at home' } });
    fireEvent.click(screen.getByTestId('own-goal-find'));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith({ kind: 'topic', text: 'Rain at home' }, 'g7.c03'));
    expect(screen.getByTestId('own-goal-closest').textContent).toBe(C.closest('Describe the water cycle'));
  });

  it('a topic with no lesson behind it says so and picks nothing', async () => {
    answer(null);
    const onPick = vi.fn();
    render(<GoalStep at={at} goal={{ kind: null, text: '' }} onPick={onPick} />);
    fireEvent.change(screen.getByTestId('own-goal-topic'), { target: { value: 'Volcanoes' } });
    fireEvent.click(screen.getByTestId('own-goal-find'));
    await waitFor(() => expect(screen.getByTestId('own-goal-nomatch').textContent).toBe(C.noMatch));
    expect(onPick).not.toHaveBeenCalled();
  });

  it('no goals listed for the subject: says so, the topic box still works', async () => {
    http.get.mockResolvedValue({ data: { success: true, outcomes: [] } });
    render(<GoalStep at={at} goal={{ kind: null, text: '' }} onPick={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('own-goal-none').textContent).toBe(C.noOutcomes));
    expect(screen.getByTestId('own-goal-topic')).toBeTruthy();
  });
});

/**
 * bd-snkn32.58.1 (queue #155 A) — grades 1–5 goals are skill-sized and grouped by skill: two taps to a goal (the skill,
 * then the goal), a search box on top as the second way. Goals of one day share its id, so each is its own row.
 */
describe('GoalStep grouped by skill', () => {
  const SKILLS = [
    { segmentId: 'd3', text: 'Add up to 4-digit numbers', chapter: 'Numbers', group: 'add_sub', code: 'M-03-AS-01' },
    { segmentId: 'd9', text: 'Multiply 2 digit numbers by 1 digit number', chapter: 'Times', group: 'mul_div', code: 'M-03-MU-04' },
    { segmentId: 'd9', text: 'Solve word problems involving multiplication', chapter: 'Times', group: 'mul_div', code: 'M-03-MU-06' },
  ];
  const k5 = { grade: 3, subject: 'math' };
  const serve = () => http.get.mockResolvedValue({ data: { success: true, outcomes: SKILLS } });

  it('fetchGoals keeps the group and code', async () => {
    serve();
    expect((await fetchGoals(k5))?.[1]).toEqual(SKILLS[1]);
  });

  it('shows the skills with their counts; a skill opens to its goals; a goal is picked (two taps)', async () => {
    serve();
    const onPick = vi.fn();
    render(<GoalStep at={k5} goal={{ kind: null, text: '' }} onPick={onPick} />);
    const mul = await screen.findByRole('button', { name: new RegExp(`${C.groups.mul_div}.*${C.goalsCount(2)}`) });
    expect(screen.getByRole('button', { name: new RegExp(C.groups.add_sub) })).toBeTruthy();
    expect(screen.queryByText('Solve word problems involving multiplication')).toBeNull();
    fireEvent.click(mul);
    fireEvent.click(screen.getByText('Solve word problems involving multiplication'));
    expect(onPick).toHaveBeenCalledWith({ kind: 'outcome', text: 'Solve word problems involving multiplication' }, 'd9');
  });

  it('the picked goal\'s skill is open when she comes back', async () => {
    serve();
    render(<GoalStep at={k5} goal={{ kind: 'outcome', text: 'Add up to 4-digit numbers' }} onPick={vi.fn()} />);
    const row = await screen.findByRole('radio', { name: /Add up to 4-digit numbers/ });
    expect(row.getAttribute('aria-checked')).toBe('true');
  });

  it('searching filters the goals across skills', async () => {
    serve();
    render(<GoalStep at={k5} goal={{ kind: null, text: '' }} onPick={vi.fn()} />);
    await screen.findByRole('button', { name: new RegExp(C.groups.mul_div) });
    fireEvent.change(screen.getByTestId('own-goal-topic'), { target: { value: 'multiply' } });
    expect(screen.getByText('Multiply 2 digit numbers by 1 digit number')).toBeTruthy();
    expect(screen.queryByText('Add up to 4-digit numbers')).toBeNull();
  });

  it('a 6–12 list (no skill groups) is grouped by chapter', async () => {
    answer();
    render(<GoalStep at={at} goal={{ kind: null, text: '' }} onPick={vi.fn()} />);
    expect(await screen.findByRole('button', { name: /Cells/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Water/ })).toBeTruthy();
  });
});
