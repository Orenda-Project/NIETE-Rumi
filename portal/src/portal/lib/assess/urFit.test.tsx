import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderHook, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ getSwitches: vi.fn() }));
vi.mock('../../services/api', () => ({ childTestSa: api }));

import { useUrFit, UR_FIT_CLASS } from './urFit';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('useUrFit (sa_ur_fit on the Learning assessment pages)', () => {
  beforeEach(() => { document.documentElement.classList.remove(UR_FIT_CLASS); api.getSwitches.mockReset(); });

  it('ON: the page marks <html> while it is open, and unmarks it when it closes', async () => {
    api.getSwitches.mockResolvedValue({ urFit: true });
    const h = renderHook(() => useUrFit());
    await waitFor(() => expect(document.documentElement.classList.contains(UR_FIT_CLASS)).toBe(true));
    h.unmount();
    expect(document.documentElement.classList.contains(UR_FIT_CLASS)).toBe(false);
  });

  it('OFF: no mark (switch off, absent, or unreadable)', async () => {
    for (const answer of [() => Promise.resolve({ urFit: false }), () => Promise.resolve({}), () => Promise.reject(new Error('down'))]) {
      api.getSwitches.mockImplementationOnce(answer);
      const h = renderHook(() => useUrFit());
      await flush(); await flush();
      expect(document.documentElement.classList.contains(UR_FIT_CLASS)).toBe(false);
      h.unmount();
    }
  });

  it('a page closed before the answer never marks <html>', async () => {
    let answer: (v: unknown) => void = () => {};
    api.getSwitches.mockReturnValue(new Promise((r) => { answer = r; }));
    const h = renderHook(() => useUrFit());
    h.unmount();
    answer({ urFit: true });
    await flush(); await flush();
    expect(document.documentElement.classList.contains(UR_FIT_CLASS)).toBe(false);
  });

  it('its stylesheet touches Urdu pages with the mark only (English and OFF unchanged)', () => {
    const css = readFileSync(path.join(__dirname, 'urFit.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = css.split('}').map((r) => r.split('{')[0].trim()).filter(Boolean).flatMap((s) => s.split(/,(?![^(]*\))/).map((x) => x.trim()));
    expect(selectors.length).toBeGreaterThan(4);
    selectors.forEach((s) => expect(s.startsWith(`html[lang="ur"].${UR_FIT_CLASS} `)).toBe(true));
  });
});

describe('the four Learning assessment pages call it', () => {
  it.each(['LeaderAssess', 'LeaderAssessDashboard', 'LeaderAssessResults', 'LeaderAssessReview'])('%s', (p) => {
    const src = readFileSync(path.join(__dirname, '../../pages', `${p}.tsx`), 'utf8');
    expect(src).toMatch(/import \{ useUrFit \} from '\.\.\/lib\/assess\/urFit';/);
    expect(src).toMatch(/\n\s+useUrFit\(\);\n/);
  });
});
