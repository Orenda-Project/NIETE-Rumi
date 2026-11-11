import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * bd-snkn32.19 — "From your book": the text of the pages she chose, so she picks pages by what is on them. Four
 * states: loading, the pages, a page missing from our copy (she can go on), the book not loaded yet. Page pictures do
 * not exist: the footer says "design pending" and nothing stands in for them.
 */

vi.mock('../../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from '../../../services/api';
import { OWN_COPY } from './copy';
import { fetchBookPages } from './api';
import { BookPages } from './BookPages';

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const C = OWN_COPY as unknown as Parameters<typeof BookPages>[0]['C'];
const at = { lesson: 'sci8.c02.p042', lane: 'g612' as const };

beforeEach(() => { cleanup(); http.get.mockReset(); });

describe('fetchBookPages — GET /lp612/own/pages', () => {
  it('asks for her range and reads the pages and the missing ones', async () => {
    http.get.mockResolvedValue({ data: { success: true, loaded: true, pages: [{ page: 42, text: 'Pressure' }, { page: 'x' }], missing: [43, 'y'] } });
    expect(await fetchBookPages({ ...at, from: 42, to: 43 })).toEqual({ loaded: true, pages: [{ page: 42, text: 'Pressure' }], missing: [43] });
  });
  // The relay (dashboard portal-lp612-own.routes.js GET /lp612/own/pages) takes exactly one of lesson_id | segment_id,
  // plus from and to; tests/portal/lp612-own-pages-route.test.js sends these same params through it.
  it('a 6–12 lesson asks by segment_id, a 1–5 day by lesson_id, with from and to only', async () => {
    http.get.mockResolvedValue({ data: { loaded: false } });
    await fetchBookPages({ lesson: 'sci8.c02.p042', lane: 'g612', from: 42, to: 43 });
    expect(http.get).toHaveBeenLastCalledWith('/lp612/own/pages', { params: { segment_id: 'sci8.c02.p042', from: 42, to: 43 } });
    await fetchBookPages({ lesson: 'g3-eng-d12', lane: 'k5', from: 7, to: 7 });
    expect(http.get).toHaveBeenLastCalledWith('/lp612/own/pages', { params: { lesson_id: 'g3-eng-d12', from: 7, to: 7 } });
  });
  it('a book not imported is not loaded; a network failure is null', async () => {
    http.get.mockResolvedValueOnce({ data: { success: true, loaded: false } });
    expect(await fetchBookPages({ ...at, from: 1, to: 1 })).toEqual({ loaded: false, pages: [], missing: [] });
    http.get.mockRejectedValueOnce({ response: { status: 404 } });
    expect(await fetchBookPages({ ...at, from: 1, to: 1 })).toEqual({ loaded: false, pages: [], missing: [] });
    http.get.mockRejectedValueOnce(new Error('offline'));
    expect(await fetchBookPages({ ...at, from: 1, to: 1 })).toBeNull();
  });
});

describe('BookPages', () => {
  it('shows each page headed "Page N", and says pictures are design pending', async () => {
    http.get.mockResolvedValue({ data: { loaded: true, pages: [{ page: 42, text: 'Pressure in liquids' }, { page: 43, text: 'دباؤ' }], missing: [] } });
    render(<BookPages C={C} {...at} range={{ start: 42, end: 43 }} delay={0} />);
    expect(await screen.findByTestId('own-book-page-42')).toBeTruthy();
    expect(screen.getByText('Page 42')).toBeTruthy();
    expect(screen.getByText('Pressure in liquids')).toBeTruthy();
    expect(screen.getByTestId('own-book-page-43').textContent).toContain('دباؤ');
    expect(screen.getByText(OWN_COPY.picturesPending)).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });
  it('a missing page is named, and the others still show', async () => {
    http.get.mockResolvedValue({ data: { loaded: true, pages: [{ page: 42, text: 'Pressure' }], missing: [44] } });
    render(<BookPages C={C} {...at} range={{ start: 42, end: 44 }} delay={0} />);
    expect(await screen.findByText('Page 44 is missing from our copy of the book')).toBeTruthy();
    expect(screen.getByTestId('own-book-page-42')).toBeTruthy();
  });
  it('a book not loaded yet says so', async () => {
    http.get.mockResolvedValue({ data: { loaded: false } });
    render(<BookPages C={C} {...at} range={{ start: 42, end: 42 }} delay={0} />);
    expect(await screen.findByText(OWN_COPY.bookNotLoaded)).toBeTruthy();
  });
  it('loading first; nothing asked without a range', async () => {
    http.get.mockReturnValue(new Promise(() => {}));
    render(<BookPages C={C} {...at} range={{ start: 42, end: 42 }} delay={0} />);
    expect(screen.getByTestId('own-book-loading')).toBeTruthy();
    cleanup();
    http.get.mockReset();
    render(<BookPages C={C} {...at} range={null} delay={0} />);
    await new Promise((r) => setTimeout(r, 5));
    expect(http.get).not.toHaveBeenCalled();
  });
  it('a long page shows 12 lines, then Show all', async () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
    http.get.mockResolvedValue({ data: { loaded: true, pages: [{ page: 42, text }], missing: [] } });
    render(<BookPages C={C} {...at} range={{ start: 42, end: 42 }} delay={0} />);
    await screen.findByTestId('own-book-page-42');
    // Clamped on screen (jsdom draws no lines, so the clamp is read off the class).
    const body = screen.getByTestId('own-book-text-42');
    expect(body.className).toContain('line-clamp-[12]');
    fireEvent.click(screen.getByText(OWN_COPY.showAll));
    await waitFor(() => expect(body.className).not.toContain('line-clamp'));
    expect(screen.getByText(OWN_COPY.showLess)).toBeTruthy();
  });
  it('one long paragraph is clamped too (12 lines on screen), and its toggle is a 48px target', async () => {
    const text = 'Pressure acts in all directions in a liquid. '.repeat(40);
    http.get.mockResolvedValue({ data: { loaded: true, pages: [{ page: 42, text }], missing: [] } });
    render(<BookPages C={C} {...at} range={{ start: 42, end: 42 }} delay={0} />);
    await screen.findByTestId('own-book-page-42');
    const body = screen.getByTestId('own-book-text-42');
    expect(body.className).toContain('line-clamp-[12]');
    const more = screen.getByText(OWN_COPY.showAll);
    expect(more.className).toContain('min-h-[48px]');
    fireEvent.click(more);
    await waitFor(() => expect(body.className).not.toContain('line-clamp-[12]'));
  });
});
