import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * bd-snkn32.5 — "My own plans" on Lesson Plans home (operator, 10 Nov: "it should be able to open either through
 * whatsapp iab or the portal directly"):
 *
 *   Given Make my own is on and she made plans   each shows its lesson and the changes she has left
 *   When she taps one                            it opens in Preparing on that plan's id, in its own grade, subject
 *                                                and chapter (viewer, sections, Change this plan)
 *   Given Make my own is off                     nothing is asked for, nothing is drawn
 *   Given she made none, or the read fails       nothing is drawn
 */

vi.mock('../../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const flag = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock('./flag', () => ({ useLpMakeOwn: () => flag.on }));
import api from '../../../services/api';
import { RecentOwnPlans } from './RecentOwnPlans';
import { fetchRecentOwnPlans } from './api';
import { OWN_COPY as C } from './copy';

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const row = (over: object) => ({
  ownId: 'o1', rootId: 'o1', lesson: 'S9', band: 'g612', status: 'ready', changesLeft: 2, round: 0, createdAt: '2026-11-10T08:00:00Z',
  grade: 9, subject: 'Physics', chapter: 'c02', title: 'Speed', ...over,
});
const show = () => render(<MemoryRouter><RecentOwnPlans /></MemoryRouter>);

beforeEach(() => { cleanup(); http.get.mockReset(); flag.on = true; });

describe('fetchRecentOwnPlans', () => {
  it('asks for her recent plans; keeps only well-formed rows; a failure is nothing', async () => {
    http.get.mockResolvedValueOnce({ data: { success: true, plans: [row({}), row({ grade: 'x' }), { ownId: 5 }, null] } });
    expect(await fetchRecentOwnPlans()).toEqual([row({})]);
    expect(http.get).toHaveBeenCalledWith('/lp612/own/recent');
    http.get.mockRejectedValueOnce(new Error('502'));
    expect(await fetchRecentOwnPlans()).toEqual([]);
  });
});

describe('RecentOwnPlans', () => {
  it('lists each plan with its changes left, linked to Preparing on its own id in its own chapter', async () => {
    http.get.mockResolvedValue({ data: { plans: [
      row({ ownId: 'o2', rootId: 'o1', changesLeft: 1, round: 1 }),
      row({ ownId: 'k1', rootId: 'k1', lesson: 'grade_3_urdu_ch4_seg2', band: 'k5', grade: 3, subject: 'urdu', chapter: '4', title: 'Haroof', status: 'authoring' }),
    ] } });
    show();
    expect(await screen.findByText(C.myOwnPlans)).toBeTruthy();
    expect(screen.getByText('Speed')).toBeTruthy();
    expect(screen.getByText(C.changesLeft(1))).toBeTruthy();
    expect(screen.getByText(C.beingMade)).toBeTruthy();
    const [a, b] = screen.getAllByRole('link').map((l) => new URL(l.getAttribute('href') ?? '', 'http://x'));
    expect(a.searchParams.get('render')).toBe('o2');
    expect(a.searchParams.get('lesson')).toBe('S9');
    expect(a.searchParams.get('chapter')).toBe('c02');
    expect(b.searchParams.get('render')).toBe('k1');
    expect(b.searchParams.get('lesson')).toBe('grade_3_urdu_ch4_seg2');
    expect(b.searchParams.get('subject')).toBe('urdu');
  });

  it('Make my own off: no request, nothing drawn', async () => {
    flag.on = false;
    const { container } = show();
    await new Promise((r) => setTimeout(r, 20));
    expect(http.get).not.toHaveBeenCalled();
    expect(container.textContent).toBe('');
  });

  it('none, or the read fails: nothing drawn', async () => {
    http.get.mockResolvedValue({ data: { plans: [] } });
    const { container } = show();
    await new Promise((r) => setTimeout(r, 20));
    expect(http.get).toHaveBeenCalled();
    expect(container.textContent).toBe('');
  });
});
