import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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
/** bd-snkn32.61 — her own goal sits behind "Add my own goal": open it, type, Find. */
function addOwn(text: string) {
  fireEvent.click(screen.getByTestId('own-goal-add'));
  fireEvent.change(screen.getByTestId('own-goal-topic'), { target: { value: text } });
  fireEvent.click(screen.getByTestId('own-goal-find'));
}
beforeEach(() => { cleanup(); http.get.mockReset(); });

const WATER = { segmentId: 'g7.c03', text: 'Describe the water cycle', chapter: 'Water' };
const NO_CH = { segmentId: 'g7.c03', text: 'Describe the water cycle' };
function guard(body: Record<string, unknown>) {
  http.get.mockImplementation(async (url: string) => (url === '/lp612/own/goals/match'
    ? { data: { success: true, ...body } } : { data: { success: true, outcomes: OUTCOMES } }));
}
function answer(match: unknown = null) {
  http.get.mockImplementation(async (url: string) => (url === '/lp612/own/goals/match'
    ? { data: { success: true, match } } : { data: { success: true, outcomes: OUTCOMES } }));
}

describe('goalApi', () => {
  it('reads her grade and subject; a failure is null, never an empty list', async () => {
    answer();
    expect(await fetchGoals(at)).toEqual(OUTCOMES.map(({ segmentId, text }) => ({ segmentId, text }))); // bd-snkn32.61: no chapter
    expect(http.get).toHaveBeenCalledWith('/lp612/own/goals', { params: at });
    http.get.mockRejectedValue(new Error('net'));
    expect(await fetchGoals(at)).toBeNull();
  });
  it('bd-snkn32.58.2 — the guard\'s answer: status, suggestions, a nearby grade; malformed rows dropped; failure null', async () => {
    guard({ status: 'ok', suggestions: [WATER, { text: 'x' }] });
    expect(await matchGoal(at, 'rain')).toEqual({ status: 'ok', suggestions: [NO_CH], otherGrade: null });
    expect(http.get).toHaveBeenLastCalledWith('/lp612/own/goals/match', { params: { ...at, q: 'rain' } });
    guard({ status: 'none', suggestions: [], otherGrade: { grade: 8, ...WATER } });
    expect(await matchGoal(at, 'rain')).toEqual({ status: 'none', suggestions: [], otherGrade: { grade: 8, ...NO_CH } });
    guard({ status: 'weird' });
    expect(await matchGoal(at, 'rain')).toBeNull();
  });
});

describe('GoalStep', () => {
  it('picking a learning goal hands back the goal and its lesson', async () => {
    answer();
    const onPick = vi.fn();
    render(<GoalStep at={at} goal={{ kind: null, text: '' }} onPick={onPick} />);
    fireEvent.click(await screen.findByText('Describe the water cycle')); // bd-snkn32.61: 6–12 is one list, no chapters
    expect(screen.queryByText('Water')).toBeNull();
    expect(onPick).toHaveBeenCalledWith({ kind: 'outcome', text: 'Describe the water cycle' }, 'g7.c03');
  });

  it('bd-snkn32.58.2 — a typed topic offers "Did you mean" goals; nothing is picked until she taps one', async () => {
    guard({ status: 'ok', suggestions: [WATER] });
    const onPick = vi.fn();
    render(<GoalStep at={at} goal={{ kind: null, text: '' }} onPick={onPick} />);
    addOwn('Rain at hme');
    expect(await screen.findByText(C.didYouMean)).toBeTruthy();
    expect(screen.getByTestId('own-goal-didyoumean').textContent).not.toContain('Water'); // bd-snkn32.61: no chapter
    expect(screen.queryByTestId('own-goal-nohits')).toBeNull(); // not "no goal has these words" above the suggestions
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByTestId('own-goal-didyoumean')).getByRole('radio', { name: /Describe the water cycle/ }));
    expect(onPick).toHaveBeenCalledWith({ kind: 'outcome', text: 'Describe the water cycle' }, 'g7.c03');
  });

  it('bd-snkn32.58.2 — a goal of another grade: the grade line, use it anyway or see her own', async () => {
    guard({ status: 'none', suggestions: [], otherGrade: { grade: 8, segmentId: 'g8.c01', text: 'Explain air pressure', chapter: 'Air' } });
    const onPick = vi.fn();
    render(<GoalStep at={at} goal={{ kind: null, text: '' }} onPick={onPick} />);
    addOwn('air pressure');
    expect((await screen.findByTestId('own-goal-grade')).textContent).toContain(C.otherGrade(8));
    fireEvent.click(screen.getByRole('button', { name: C.useAnyway }));
    expect(onPick).toHaveBeenCalledWith({ kind: 'outcome', text: 'Explain air pressure' }, 'g8.c01');
  });

  it('bd-snkn32.58.2 — a blocked word: a calm refusal, nothing picked', async () => {
    guard({ status: 'blocked', suggestions: [] });
    const onPick = vi.fn();
    render(<GoalStep at={at} goal={{ kind: null, text: '' }} onPick={onPick} />);
    addOwn('something bad');
    await waitFor(() => expect(screen.getByTestId('own-goal-nomatch').textContent).toBe(C.blocked));
    expect(onPick).not.toHaveBeenCalled();
  });

  it('a topic with no lesson behind it says so and picks nothing', async () => {
    guard({ status: 'none', suggestions: [] });
    const onPick = vi.fn();
    render(<GoalStep at={at} goal={{ kind: null, text: '' }} onPick={onPick} />);
    addOwn('Volcanoes');
    await waitFor(() => expect(screen.getByTestId('own-goal-nomatch').textContent).toBe(C.noMatch));
    expect(onPick).not.toHaveBeenCalled();
  });

  it('no goals listed for the subject: says so, Add my own goal still works', async () => {
    http.get.mockResolvedValue({ data: { success: true, outcomes: [] } });
    render(<GoalStep at={at} goal={{ kind: null, text: '' }} onPick={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('own-goal-none').textContent).toBe(C.noOutcomes));
    fireEvent.click(screen.getByTestId('own-goal-add'));
    expect(screen.getByTestId('own-goal-topic')).toBeTruthy();
  });

  /** bd-snkn32.61 (Amena 20 Nov: "if teachers want something else, they are free to add those") — her own words. */
  it('Add my own goal: her words pass the check, then "Use my words" picks them over her grade\'s closest day', async () => {
    guard({ status: 'ok', suggestions: [WATER] });
    const onPick = vi.fn();
    render(<GoalStep at={at} goal={{ kind: null, text: '' }} onPick={onPick} />);
    expect(screen.queryByTestId('own-goal-topic')).toBeNull(); // closed until she asks for it
    addOwn('Rain and clouds');
    fireEvent.click(await screen.findByRole('button', { name: C.useMine }));
    expect(onPick).toHaveBeenCalledWith({ kind: 'topic', text: 'Rain and clouds' }, 'g7.c03');
  });

  it('her own words with nothing in her grade behind them cannot be used', async () => {
    guard({ status: 'none', suggestions: [] });
    render(<GoalStep at={at} goal={{ kind: null, text: '' }} onPick={vi.fn()} />);
    addOwn('Volcanoes');
    await screen.findByTestId('own-goal-nomatch');
    expect(screen.queryByRole('button', { name: C.useMine })).toBeNull();
  });

  it('coming back with her own goal: the box is open with her words', async () => {
    answer();
    render(<GoalStep at={at} goal={{ kind: 'topic', text: 'Rain and clouds' }} onPick={vi.fn()} />);
    expect((await screen.findByTestId('own-goal-topic') as HTMLInputElement).value).toBe('Rain and clouds');
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
    const { chapter: _c, ...noChapter } = SKILLS[1];
    expect((await fetchGoals(k5))?.[1]).toEqual(noChapter);
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
    fireEvent.change(screen.getByTestId('own-goal-search'), { target: { value: 'multiply' } });
    expect(screen.getByText('Multiply 2 digit numbers by 1 digit number')).toBeTruthy();
    expect(screen.queryByText('Add up to 4-digit numbers')).toBeNull();
  });

  it('bd-snkn32.61 — no chapter name anywhere: not under a skill\'s goals, not in search, not as a 6–12 heading', async () => {
    serve(); // an older server still sending `chapter` must not put it on screen
    render(<GoalStep at={k5} goal={{ kind: null, text: '' }} onPick={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(C.groups.mul_div) }));
    expect(screen.getByText('Solve word problems involving multiplication')).toBeTruthy();
    expect(screen.queryByText('Times')).toBeNull();
    fireEvent.change(screen.getByTestId('own-goal-search'), { target: { value: 'add' } });
    expect(screen.queryByText('Numbers')).toBeNull();
    cleanup();
    answer();
    render(<GoalStep at={at} goal={{ kind: null, text: '' }} onPick={vi.fn()} />);
    expect(await screen.findByText('Compare plant and animal cells')).toBeTruthy();
    expect(screen.queryByText('Cells')).toBeNull();
    expect(screen.queryByText('Water')).toBeNull();
  });
});
