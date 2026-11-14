import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ShelfPlans } from './ShelfPlans';
import { SHELF_COPY as C } from './copy';

/**
 * bd-snkn32.42 — "Made by a teacher" on the chapter page:
 *
 *   Given approved plans on this chapter's lessons   a "Made by a teacher" list, each named by its lesson
 *   When she taps one                                it opens on Preparing by its own id, like her own plans
 *   Never                                            who made it
 *   Given none, or the read failed                   nothing is drawn
 */
vi.mock('../../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from '../../../services/api';

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const at = { grade: 4, subject: 'math', chapter: '3' };
const list = [
  { id: 'L1', kind: 'day', number: 4, title: 'Counting', lane: 'k5' },
  { id: 'W1', kind: 'worksheet', number: null, title: 'Worksheet', lane: 'k5' },
];
const show = () => render(<MemoryRouter><ShelfPlans at={at} list={list} /></MemoryRouter>);

beforeEach(() => { cleanup(); http.get.mockReset(); });

describe('ShelfPlans', () => {
  it('lists approved plans by their lesson, opening on Preparing with the plan id, never the author', async () => {
    http.get.mockResolvedValue({ data: { plans: [{ ownId: 'o1', lesson: 'L1', band: 'k5', lang: 'ur', userId: 'u9' }] } });
    show();
    expect(await screen.findByText(C.shelfTitle)).toBeTruthy();
    const link = screen.getByRole('link', { name: /Day 4 · Counting/ });
    const href = link.getAttribute('href') ?? '';
    expect(href).toContain('/preparing?');
    expect(href).toContain('render=o1');
    expect(href).toContain('lesson=L1');
    expect(screen.getByText(C.langs.ur)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/u9/);
    expect(http.get).toHaveBeenCalledWith('/lp612/shelf', { params: { keys: 'L1' } });
  });

  it('none, or the read failed: nothing', async () => {
    http.get.mockResolvedValue({ data: { plans: [] } });
    show();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('own-shelf')).toBeNull();
    cleanup();
    http.get.mockRejectedValue(new Error('404'));
    show();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('own-shelf')).toBeNull();
  });
});
