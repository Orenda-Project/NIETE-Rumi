import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

/**
 * bd-snkn32.21 — her own Make my own plan, opened from Home's card or the "ready" banner, carries what the viewer
 * needs for "Change this plan" and the section cards (state.own), as the Preparing page's open does:
 *
 *   Given her finished plan is her own   the viewer is opened with own: the plan id, its band, the changes left
 *   Given an ordinary 6–12 plan          the viewer is opened as before, with no own
 *   Given the status cannot be read      the plan still opens, without own
 */

const openPlan = vi.fn();
vi.mock('../../lib/lessonPlanOpen', () => ({ useLessonPlanOpener: () => openPlan }));
const status = vi.fn();
vi.mock('../../newui/lessons/lessonPlansApi', () => ({ lessonPlans: { status: (id: string) => status(id) } }));

import { useOpenNotice } from './useOpenNotice';

const wrap = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const at = { grade: 9, subject: 'physics', chapter: 'c02', lesson: 'grade_9_physics.c02.p037-038', render: 'own-1' };
const item = { kind: 'lesson' as const, title: 'Motion', grade: 9, subject: 'physics', renderId: 'own-1', lessonId: at.lesson, at };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { openPlan.mockReset(); status.mockReset(); });

describe('useOpenNotice — a finished 6–12 plan', () => {
  it('her own plan opens with Change this plan: own carries the id, band and changes left', async () => {
    status.mockResolvedValue({ state: 'ready', source: { lane: 'g612', renderId: 'own-1' }, own: { changesLeft: 2, band: 'g612' } });
    const { result } = renderHook(() => useOpenNotice(), { wrapper: wrap });
    result.current(item);
    await flush();
    expect(status).toHaveBeenCalledWith('own-1');
    const opts = openPlan.mock.calls[0][2];
    expect(opts.state.own).toMatchObject({ own: 'own-1', band: 'g612', left: 2, grade: 9, subject: 'physics', lesson: at.lesson });
    expect(opts.state.dc).toBeTruthy();
  });
  it('an ordinary plan opens as before, with no own', async () => {
    status.mockResolvedValue({ state: 'ready', source: { lane: 'g612', renderId: 'r-1' } });
    const { result } = renderHook(() => useOpenNotice(), { wrapper: wrap });
    result.current({ ...item, renderId: 'r-1' });
    await flush();
    expect(openPlan.mock.calls[0][0]).toEqual({ lane: 'g612', renderId: 'r-1' });
    expect(openPlan.mock.calls[0][2].state.own).toBeUndefined();
  });
  it('a status that cannot be read still opens the plan', async () => {
    status.mockRejectedValue(new Error('502'));
    const { result } = renderHook(() => useOpenNotice(), { wrapper: wrap });
    result.current(item);
    await flush();
    expect(openPlan).toHaveBeenCalledTimes(1);
    expect(openPlan.mock.calls[0][2].state.own).toBeUndefined();
  });
});
