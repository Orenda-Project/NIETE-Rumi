import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from 'i18next';

/**
 * The team view in Analytics (spec §5), over the real components with the network stubbed:
 *   "Where teachers get to": one row per rung, reached as a bar and a number, "Stopped here: n", the largest drop amber;
 *   tap a rung → the teachers who stopped there (20, then Show more) → tap one → her journey, read-only;
 *   switch off, nothing stored, or a failed read → no section at all; the page's region goes to the server.
 */
vi.mock('../../services/api', () => ({ default: { get: vi.fn() } }));
import api from '../../services/api';
import { JourneySection } from './JourneySection';

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const NOW = Date.parse('2026-11-19T15:00:00+05:00');
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86400000).toISOString();

const TEAM = {
  success: true, ready: true, updatedAt: new Date(Date.parse('2026-11-19T14:30:00+05:00')).toISOString(), windowDays: 30, tracked: 5,
  largestDrop: 'plan_opened',
  steps: [
    { step: 'none', reached: 5, stopped: 1 }, { step: 'plan_opened', reached: 4, stopped: 1 }, { step: 'taught', reached: 3, stopped: 1 },
    { step: 'coached', reached: 2, stopped: 0 }, { step: 'report', reached: 2, stopped: 0 }, { step: 'quiz', reached: 2, stopped: 2 },
  ],
};
const teachers = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, name: `Teacher ${i} Testwala`, school: 'Test School', lastKind: 'quiz', lastAt: iso(3) }));

let routes: Record<string, () => Promise<unknown>>;
beforeEach(async () => {
  cleanup();
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {} });
  await act(async () => { await i18n.changeLanguage('en'); });
  routes = {
    '/analytics/journey': async () => ({ data: TEAM }),
    '/analytics/journey/teachers': async () => ({ data: { success: true, ready: true, teachers: teachers(25) } }),
  };
  http.get.mockImplementation((url: string) => {
    if (url.startsWith('/analytics/journey/teacher/')) {
      return Promise.resolve({ data: { success: true, ready: true, name: 'Teacher 0 Testwala', school: 'Test School', updatedAt: TEAM.updatedAt,
        steps: [{ kind: 'coached', at: iso(1), refId: 's1', meta: { topic: 'Fractions' } }] } });
    }
    return (routes[url] ?? (async () => { throw Object.assign(new Error('nf'), { response: { status: 404 } }); }))();
  });
});
afterEach(() => vi.restoreAllMocks());

const view = (region: string | null = null) => render(
  <MemoryRouter initialEntries={['/portal/analytics/schools/lp']}>
    <Routes><Route path="/portal/analytics/schools/:tab" element={<JourneySection region={region} />} /></Routes>
  </MemoryRouter>,
);

describe('Where teachers get to', () => {
  it('a row per rung: reached, Stopped here, the largest drop amber; the updated line', async () => {
    view('Sihala');
    const section = await screen.findByTestId('section-journey');
    expect(within(section).getByText('Where teachers get to')).toBeInTheDocument();
    expect(within(section).getByText('Updated today, 2:30 PM')).toBeInTheDocument();
    const rows = within(section).getAllByRole('link');
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Nothing yet: 5', 'Opened a lesson plan: 4', 'Taught in class: 3', 'DC observation: 2', 'Read the report: 2', 'Sent a quiz: 2',
    ]);
    const drop = within(rows[1]).getByText('Stopped here: 1');
    expect(drop.className).toContain('bg-nu-chip-warning-bg');
    expect(within(rows[2]).getByText('Stopped here: 1').className).toContain('bg-nu-chip-info-bg');
    expect(http.get).toHaveBeenCalledWith('/analytics/journey', { params: { region: 'Sihala' } });
  });

  it('tap a rung → the teachers who stopped there, 20 then Show more → tap one → her journey, read-only', async () => {
    view();
    fireEvent.click(await screen.findByRole('link', { name: 'Sent a quiz: 2' }));
    expect(await screen.findByText('Teacher 0 Testwala')).toBeInTheDocument();
    expect(http.get).toHaveBeenCalledWith('/analytics/journey/teachers', { params: { step: 'quiz' } });
    expect(screen.getAllByText(/Testwala/)).toHaveLength(20);
    fireEvent.click(screen.getByRole('button', { name: /Show more/ }));
    expect(screen.getAllByText(/Testwala/)).toHaveLength(25);
    fireEvent.click(screen.getByRole('link', { name: /Teacher 0 Testwala/ }));
    expect(await screen.findByText('DC observation')).toBeInTheDocument();
    expect(http.get).toHaveBeenCalledWith('/analytics/journey/teacher/t0', { params: {} });
    expect(within(screen.getByTestId('journey-list')).queryAllByRole('link')).toEqual([]);
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    expect(await screen.findByText('Teacher 1 Testwala')).toBeInTheDocument();
  });

  it.each([
    ['switch off (404)', async () => { throw Object.assign(new Error('nf'), { response: { status: 404 } }); }],
    ['nothing stored yet', async () => ({ data: { success: true, ready: false } })],
    ['a failed read', async () => { throw new Error('Network Error'); }],
  ])('%s → no section', async (_n, answer) => {
    routes['/analytics/journey'] = answer;
    const { container } = view();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByTestId('section-journey')).toBeNull();
    expect(container.textContent).toBe('');
  });
});
