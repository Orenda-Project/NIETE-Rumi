import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * bd-snkn32.42 — the shelf and check calls:
 *   the shelf asks for this chapter's lessons; a bad row or a failure is nothing, never a throw
 *   the check queue keeps only well-formed rows; a decision posts the decision (and a reason), never who
 *   the PDF is fetched with her session and opened as a local link
 */
vi.mock('../../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const cfg = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../../../lib/useNewUi', () => ({ readConfigShared: () => Promise.resolve(cfg.value) }));
import api from '../../../services/api';
import { decideOwn, fetchReviewQueue, fetchShelf, reviewPdfUrl } from './api';

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
beforeEach(() => { http.get.mockReset(); http.post.mockReset(); });

describe('fetchShelf', () => {
  it('asks for the lessons, keeps only shelf rows', async () => {
    http.get.mockResolvedValue({ data: { plans: [
      { ownId: 'o1', lesson: 'L1', band: 'k5', lang: 'en' },
      { ownId: 'o2', lesson: 'L2', band: 'other', lang: 'en' },
      { lesson: 'L3', band: 'g612', lang: 'ur' },
    ] } });
    expect(await fetchShelf(['L1', 'L2'])).toEqual([{ ownId: 'o1', lesson: 'L1', band: 'k5', lang: 'en' }]);
    expect(http.get).toHaveBeenCalledWith('/lp612/shelf', { params: { keys: 'L1,L2' } });
  });

  it('no lessons: nothing asked; a failure: nothing', async () => {
    expect(await fetchShelf([])).toEqual([]);
    expect(http.get).not.toHaveBeenCalled();
    http.get.mockRejectedValue(new Error('404'));
    expect(await fetchShelf(['L1'])).toEqual([]);
  });
});

describe('the check', () => {
  it('the queue keeps rows with a score and their checks', async () => {
    const good = { ownId: 'o1', lesson: 'L1', band: 'g612', lang: 'en', score: 88, reviewedAt: 't', below: [], notAssessed: [] };
    http.get.mockResolvedValue({ data: { plans: [good, { ...good, ownId: 'o2', score: 'x' }] } });
    expect(await fetchReviewQueue()).toEqual([good]);
    expect(http.get).toHaveBeenCalledWith('/lp612/own/review');
  });

  it('a queue failure throws, so the page can offer Try again', async () => {
    http.get.mockRejectedValue(new Error('502'));
    await expect(fetchReviewQueue()).rejects.toThrow();
  });

  it('approve posts the decision only; reject carries the reason; a failure is false', async () => {
    http.post.mockResolvedValue({ data: { success: true } });
    expect(await decideOwn('o 1', 'approve')).toBe(true);
    expect(http.post).toHaveBeenCalledWith('/lp612/own/review/o%201', { decision: 'approve' });
    expect(await decideOwn('o1', 'reject', 'too thin')).toBe(true);
    expect(http.post).toHaveBeenLastCalledWith('/lp612/own/review/o1', { decision: 'reject', reason: 'too thin' });
    http.post.mockRejectedValue(new Error('404'));
    expect(await decideOwn('o1', 'approve')).toBe(false);
  });

  it('the PDF: a blob becomes a local link; a failure is null', async () => {
    const make = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: make });
    http.get.mockResolvedValue({ data: new Blob(['%PDF']) });
    expect(await reviewPdfUrl('o1')).toBe('blob:x');
    expect(http.get).toHaveBeenCalledWith('/lp612/own/review/o1/file', { responseType: 'blob' });
    http.get.mockRejectedValue(new Error('404'));
    expect(await reviewPdfUrl('o1')).toBeNull();
  });
});
