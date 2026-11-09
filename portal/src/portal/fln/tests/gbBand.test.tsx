import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from 'i18next';

/**
 * Gilgit-Baltistan and Reading Hour & Numeracy (operator, 9 Nov 2026: "Those should not be the subjects for GB").
 * The portal server decides it (dashboard/lib/fln-access.js: a user whose region names its own books gets
 * lessons:false, share:false — tests/portal/fln-access-gb.test.js); this pins what each /fln/me answer draws:
 *   GB teacher  { lessons: false } → no band at all (no heading, no skeleton, no catalogue read)
 *   ICT teacher { lessons: true }  → the band, as before
 * Both teachers teach Grade 1, so only the server's answer differs.
 */

vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../../services/api';
import { FlnBand } from '../FlnBand';
import { flnStrings } from '../strings';
import type { FlnMe } from '../types';
import { numG2, rhEnG1, rhUrG1, stubFetch } from './listFixtures';

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const EN = flnStrings('en');
const GB_TEACHER: FlnMe = { lessons: false, share: false, role: 'teacher', ui_lang: 'en' };
const ICT_TEACHER: FlnMe = { lessons: true, share: false, role: 'teacher', ui_lang: 'en' };

function catalogueFor(url: URL) {
  const subject = url.searchParams.get('subject');
  const base = subject === 'num' ? numG2() : subject === 'rh-ur' ? rhUrG1() : rhEnG1();
  return { status: 200, body: { ...base, grade: 1, level: 1 } };
}

beforeEach(async () => {
  vi.clearAllMocks();
  if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {} });
  await act(async () => { await i18n.changeLanguage('en'); });
  http.get.mockImplementation(async (url: string) => {
    if (url === '/me/grade-subjects') {
      return { data: { success: true, combos: [{ grade: 1, gradeCode: 'grade_1', subject: 'English', subjectKey: 'english', source: 'class', featureKey: 'English', available: true }] } };
    }
    throw Object.assign(new Error('404'), { response: { status: 404 } });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the Reading Hour & Numeracy band: GB vs ICT', () => {
  it('a GB teacher (lessons:false) → nothing at all, and no catalogue is asked for', async () => {
    const f = stubFetch({ '/me': { status: 200, body: GB_TEACHER }, '/catalogue': catalogueFor });
    const { container } = render(<MemoryRouter><FlnBand /></MemoryRouter>);
    await waitFor(() => expect(f).toHaveBeenCalled());
    for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(container.innerHTML).toBe('');
    expect(screen.queryByText(EN.band.title)).toBeNull();
    expect(f.mock.calls.filter(([u]) => String(u).includes('/catalogue'))).toHaveLength(0);
  });

  it('an ICT teacher of the same grade (lessons:true) → the band, as before', async () => {
    stubFetch({ '/me': { status: 200, body: ICT_TEACHER }, '/catalogue': catalogueFor });
    render(<MemoryRouter><FlnBand /></MemoryRouter>);
    const rows = await screen.findAllByRole('link', {}, { timeout: 5000 });
    expect(screen.getByText(EN.band.title)).toBeInTheDocument();
    expect(rows.map((r) => r.getAttribute('href'))).toEqual(
      ['rh-en', 'rh-ur', 'num'].map((s) => `/portal/fln/list/${s}?grade=1`),
    );
  });
});
