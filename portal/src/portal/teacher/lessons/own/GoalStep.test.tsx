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
    fireEvent.click(await screen.findByText('Describe the water cycle'));
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
