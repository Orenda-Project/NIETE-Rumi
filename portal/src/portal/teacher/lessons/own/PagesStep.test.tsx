import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

/**
 * bd-snkn32.19 — step 1 for every band: the lessons as a radio list; once picked, one card with Change, the book pages
 * right under it, the book's text, and (6–12, the range reaching the next lesson's end) how she teaches both.
 */

vi.mock('../../../services/api', () => ({ default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn() } }));
import api from '../../../services/api';
import { OWN_COPY } from './copy';
import { PagesStep } from './PagesStep';

const C = OWN_COPY as unknown as Parameters<typeof PagesStep>[0]['C'];
const L1 = { id: 'l1', number: 1, title: 'Pressure', pages: 'p.42–45', lane: 'g612' as const };
const L2 = { id: 'l2', number: 2, title: 'Gases', pages: 'p.46–48', lane: 'g612' as const };
const D1 = { id: 'd1', number: 1, title: 'Counting', pages: 'p.2', lane: 'k5' as const };
const D2 = { id: 'd2', number: 2, title: 'Adding', pages: 'p.3-4', lane: 'k5' as const };

const props = (over: Partial<Parameters<typeof PagesStep>[0]> = {}) => ({
  C, plans: [L1, L2], seg: null, next: null, start: null, ext: null,
  onPick: vi.fn(), onClear: vi.fn(), onPages: vi.fn(), onExt: vi.fn(), ...over,
});

beforeEach(() => { cleanup(); });

describe('PagesStep', () => {
  it('her book is asked for by the picked row\'s lane: segment_id for a 6–12 lesson, lesson_id for a 1–5 day', async () => {
    const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
    get.mockClear();
    render(<PagesStep {...props({ seg: L1, next: L2 })} />);
    await new Promise((r) => setTimeout(r, 450));
    expect(get).toHaveBeenLastCalledWith('/lp612/own/pages', { params: { segment_id: 'l1', from: 42, to: 45 } });
    cleanup();
    render(<PagesStep {...props({ plans: [D1, D2], seg: D2, next: null })} />);
    await new Promise((r) => setTimeout(r, 450));
    expect(get).toHaveBeenLastCalledWith('/lp612/own/pages', { params: { lesson_id: 'd2', from: 3, to: 4 } });
  });
  it('before a pick: a radio list, "Lesson N · title", pages under it', () => {
    const p = props();
    render(<PagesStep {...p} />);
    expect(screen.getByRole('radiogroup')).toBeTruthy();
    expect(screen.getByTestId('own-opt-l1').textContent).toContain('Lesson 1 · Pressure');
    expect(screen.getByTestId('own-opt-l1').textContent).toContain('p.42–45');
    fireEvent.click(screen.getByTestId('own-opt-l2'));
    expect(p.onPick).toHaveBeenCalledWith('l2');
    expect(screen.queryByTestId('own-pg-box')).toBeNull();
  });

  it('grades 1–5 name days', () => {
    render(<PagesStep {...props({ plans: [D1, D2] })} />);
    expect(screen.getByTestId('own-opt-d2').textContent).toContain('Day 2 · Adding');
  });

  it('after a pick: one card with Change, the page boxes for 6–12 too, the book strip, scrolled to the top', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const p = props({ seg: L1, next: L2 });
    render(<PagesStep {...p} />);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByTestId('own-pg-card').textContent).toContain('Lesson 1 · Pressure · p.42–45');
    expect((screen.getByTestId('own-pg-from') as HTMLInputElement).value).toBe('42');
    expect((screen.getByTestId('own-pg-to') as HTMLInputElement).value).toBe('45');
    expect(screen.getByText(OWN_COPY.pagesOneHint)).toBeTruthy();
    expect(screen.getByTestId('own-book')).toBeTruthy();
    expect(scroll).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('own-pg-change'));
    expect(p.onClear).toHaveBeenCalled();
  });

  it('6–12: a range inside the lesson is fine; running past it is refused unless it ends at the next lesson', () => {
    const p = props({ seg: L1, next: L2 });
    render(<PagesStep {...p} />);
    fireEvent.change(screen.getByTestId('own-pg-to'), { target: { value: '42' } });
    expect(p.onPages).toHaveBeenLastCalledWith({ range: { start: 42, end: 42 }, both: false });
    fireEvent.change(screen.getByTestId('own-pg-to'), { target: { value: '47' } });
    expect(p.onPages).toHaveBeenLastCalledWith(null);
    expect(screen.getByTestId('own-pg-bad').textContent).toBe(OWN_COPY.badPages612);
    expect(screen.queryByTestId('own-ext')).toBeNull();
  });

  it('6–12: "+ Add the next lesson\'s pages" runs to its end and asks how she teaches both, none pre-picked', () => {
    const p = props({ seg: L1, next: L2 });
    render(<PagesStep {...p} />);
    fireEvent.click(screen.getByTestId('own-pg-next'));
    expect((screen.getByTestId('own-pg-to') as HTMLInputElement).value).toBe('48');
    expect(p.onPages).toHaveBeenLastCalledWith({ range: { start: 42, end: 48 }, both: true });
    const chips = screen.getByRole('radiogroup', { name: OWN_COPY.bothHow });
    expect(chips.querySelectorAll('[aria-checked="true"]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('radio', { name: OWN_COPY.extends.double }));
    expect(p.onExt).toHaveBeenCalledWith('double');
  });

  it('the add-next label names the next lesson\'s pages; none on the last lesson', () => {
    render(<PagesStep {...props({ seg: L1, next: L2 })} />);
    expect(screen.getByTestId('own-pg-next').textContent).toBe("Add the next lesson's pages (p.46-48)");
    cleanup();
    render(<PagesStep {...props({ seg: L2, next: null })} />);
    expect(screen.queryByTestId('own-pg-next')).toBeNull();
  });

  it('grades 1–5 keep their own check and words', () => {
    const p = props({ plans: [D1, D2], seg: D1, next: D2 });
    render(<PagesStep {...p} />);
    expect(screen.getByTestId('own-pg-next').textContent).toBe("Add the next day's pages (p.3-4)");
    fireEvent.change(screen.getByTestId('own-pg-from'), { target: { value: '9' } });
    expect(screen.getByTestId('own-pg-bad').textContent).toBe(OWN_COPY.badPages);
    expect(screen.queryByTestId('own-ext')).toBeNull();
  });

  it('starts from her pages when she has some', () => {
    render(<PagesStep {...props({ seg: L1, next: L2, start: { start: 43, end: 48 }, ext: 'one_period' })} />);
    expect((screen.getByTestId('own-pg-from') as HTMLInputElement).value).toBe('43');
    expect(screen.getByRole('radio', { name: OWN_COPY.extends.one_period }).getAttribute('aria-checked')).toBe('true');
  });
});
