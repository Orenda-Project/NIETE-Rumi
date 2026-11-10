import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * bd-snkn32.20 — "Your plans for this chapter" on Make my own's first step:
 *
 *   Given she made plans in this chapter   each shows its lesson or day, and the changes she has left
 *   When she taps one                      it opens in Preparing on that plan's id (viewer, sections, Change)
 *   Given she made none, or the read fails nothing is drawn
 */

vi.mock('../../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from '../../../services/api';
import { MyOwnPlans } from './MyOwnPlans';
import { fetchMyOwnPlans } from './api';
import { OWN_COPY as C } from './copy';

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const at = { grade: 7, subject: 'science', chapter: 'ch3' };
const L1 = { id: 'l1', number: 1, title: 'Pressure', pages: 'p.42–45', lane: 'g612' as const };
const L2 = { id: 'l2', number: 2, title: 'Gases', pages: 'p.46–48', lane: 'g612' as const };
const D1 = { id: 'd1', number: 4, title: 'Counting', pages: 'p.2', lane: 'k5' as const };
const row = (over: object) => ({ ownId: 'o1', rootId: 'o1', lesson: 'l1', band: 'g612', status: 'ready', changesLeft: 2, round: 0, createdAt: '2026-11-10T08:00:00Z', ...over });

const show = (plans = [L1, L2]) => render(<MemoryRouter><MyOwnPlans at={at} plans={plans} /></MemoryRouter>);

beforeEach(() => { cleanup(); http.get.mockReset(); });

describe('fetchMyOwnPlans', () => {
  it('asks for her plans on these lessons, comma-joined', async () => {
    http.get.mockResolvedValue({ data: { success: true, plans: [row({})] } });
    const out = await fetchMyOwnPlans(['l1', 'l2']);
    expect(http.get).toHaveBeenCalledWith('/lp612/own/mine', { params: { keys: 'l1,l2' } });
    expect(out).toEqual([row({})]);
  });
  it('no lessons: no request, nothing', async () => {
    expect(await fetchMyOwnPlans([])).toEqual([]);
    expect(http.get).not.toHaveBeenCalled();
  });
  it('a failure, or a malformed row, is dropped', async () => {
    http.get.mockResolvedValueOnce({ data: { plans: [row({}), { ownId: 5 }, null] } });
    expect(await fetchMyOwnPlans(['l1'])).toEqual([row({})]);
    http.get.mockRejectedValueOnce(new Error('502'));
    expect(await fetchMyOwnPlans(['l1'])).toEqual([]);
  });
});

describe('MyOwnPlans', () => {
  it('lists each plan by its lesson, with the changes left, linked to Preparing on its own id', async () => {
    http.get.mockResolvedValue({ data: { plans: [row({ ownId: 'o2', rootId: 'o1', lesson: 'l2', changesLeft: 1, round: 1 }), row({})] } });
    show();
    expect(await screen.findByText(C.myPlans)).toBeTruthy();
    expect(screen.getByText('Lesson 2 · Gases')).toBeTruthy();
    expect(screen.getByText(C.changesLeft(1))).toBeTruthy();
    expect(screen.getByText(C.changesLeft(2))).toBeTruthy();
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '');
    expect(links[0]).toContain('render=o2');
    expect(links[0]).toContain('lesson=l2');
    expect(links[1]).toContain('render=o1');
  });
  it('a 1–5 day reads "Day N"; none left says so; one still being made says so', async () => {
    http.get.mockResolvedValue({ data: { plans: [row({ lesson: 'd1', band: 'k5', changesLeft: 0 }), row({ ownId: 'o3', lesson: 'd1', band: 'k5', status: 'authoring' })] } });
    show([D1]);
    expect(await screen.findAllByText('Day 4 · Counting')).toHaveLength(2);
    expect(screen.getByText(C.changesLeft(0))).toBeTruthy();
    expect(screen.getByText(C.beingMade)).toBeTruthy();
  });
  it('no plans: nothing at all', async () => {
    http.get.mockResolvedValue({ data: { plans: [] } });
    const { container } = show();
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });
});
