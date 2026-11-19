import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from 'i18next';

/**
 * My journey (spec §4), over the real components with the network stubbed:
 *   her steps by Pakistan week, newest first, the updated line, two weeks then Show more (no request per tap);
 *   nothing stored → Not ready yet; no step → Nothing yet + Lesson Plans; failed → Could not load + Try again;
 *   switch off (404) → back to Home; ?step=taught → only the taught lines of Home's 30 days; Urdu.
 */
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../lib/recordingSession', () => ({ useRecordingSession: () => null, useLogoutGuard: (f: () => void) => f }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { firstName: 'Sample', lastName: 'Teacher', phoneNumber: '923000000000' }, logout: vi.fn() }) }));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../lib/useNewUi', async (orig) => ({
  ...(await orig<object>()),
  readConfigShared: () => Promise.resolve({ success: true, features: {} }),
}));

import api from '../../services/api';
import { JourneyPage } from './JourneyPage';

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
// Wed 19 Nov 2026, 15:00 Pakistan time.
const NOW = Date.parse('2026-11-19T15:00:00+05:00');
const at = (pk: string) => new Date(Date.parse(`${pk}+05:00`)).toISOString();
const step = (kind: string, pk: string, meta: Record<string, unknown> = {}) => ({ kind, at: at(pk), refId: `${kind}-${pk}`, meta });

let answer: () => Promise<unknown>;
beforeEach(async () => {
  cleanup();
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {} });
  await act(async () => { await i18n.changeLanguage('en'); });
  http.get.mockImplementation(async (url: string) => (url === '/me/journey' ? answer() : { data: {} }));
});
afterEach(() => vi.restoreAllMocks());

const ok = (body: Record<string, unknown>) => () => Promise.resolve({ data: { success: true, ...body } });
const page = (path = '/portal/teacher/journey') => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/portal/teacher/journey" element={<JourneyPage />} />
      <Route path="*" element={<p data-testid="elsewhere">elsewhere</p>} />
    </Routes>
  </MemoryRouter>,
);
const journeyCalls = () => http.get.mock.calls.filter(([u]) => u === '/me/journey');

describe('her steps', () => {
  it('weeks newest first, rows in time order, the updated line; two weeks then Show more with no new request', async () => {
    answer = ok({ ready: true, updatedAt: at('2026-11-19T14:30:00'), steps: [
      step('taught', '2026-11-19T08:00:00', { topic: 'Rivers' }),
      step('plan_opened', '2026-11-18T09:00:00', { plan_kind: 'k5', grade: 3, subject: 'math' }),
      step('quiz', '2026-11-12T09:00:00', { topic: 'Shapes' }),
      step('coached', '2026-11-03T09:00:00', { topic: 'Fractions' }),
    ] });
    page();
    expect(await screen.findByTestId('journey-updated')).toHaveTextContent('Updated today, 2:30 PM');
    const weeks = screen.getAllByRole('region');
    expect(weeks.map((w) => w.getAttribute('aria-label'))).toEqual(['This week', 'Last week']);
    const rows = within(weeks[0]).getAllByText(/Taught in class|Opened a lesson plan/);
    expect(rows.map((r) => r.textContent)).toEqual(['Taught in class', 'Opened a lesson plan']);
    expect(screen.getByRole('link', { name: /Opened a lesson plan/ })).toHaveAttribute('href', expect.stringContaining('/portal/teacher/lessons/open?plan=k5'));
    fireEvent.click(screen.getByRole('button', { name: /Show more/ }));
    expect(screen.getAllByRole('region').map((w) => w.getAttribute('aria-label'))).toEqual(['This week', 'Last week', '2 – 8 Nov']);
    expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull();
    expect(journeyCalls()).toHaveLength(1);
  });

  it('?step=taught: title Taught in class, only taught lines of the 30 days', async () => {
    answer = ok({ ready: true, updatedAt: at('2026-11-19T01:30:00'), steps: [
      step('taught', '2026-11-19T08:00:00', { topic: 'Rivers' }),
      step('quiz', '2026-11-18T09:00:00'),
      step('taught', '2026-10-10T08:00:00', { topic: 'Too old' }),
    ] });
    page('/portal/teacher/journey?step=taught');
    expect(await screen.findByText('Rivers', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Taught in class');
    expect(screen.queryByText('Sent a quiz')).toBeNull();
    expect(screen.queryByText(/Too old/)).toBeNull();
    expect(screen.getByTestId('journey-updated')).toHaveTextContent('Updated last night');
  });
});

describe('empty and failure', () => {
  it('nothing stored yet → Not ready yet, no Lesson Plans row', async () => {
    answer = ok({ ready: false });
    page();
    expect(await screen.findByText('Not ready yet')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Lesson Plans/ })).toBeNull();
  });

  it('stored, no step → Nothing yet and a row to Lesson Plans', async () => {
    answer = ok({ ready: true, updatedAt: at('2026-11-19T14:30:00'), steps: [] });
    page();
    expect(await screen.findByText('Nothing yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Lesson Plans/ })).toBeInTheDocument();
  });

  it('a failed read → Could not load + Try again, which reads again', async () => {
    answer = () => Promise.reject(Object.assign(new Error('Network Error'), { response: undefined }));
    page();
    const retry = await screen.findByRole('button', { name: 'Try again' });
    answer = ok({ ready: false });
    fireEvent.click(retry);
    expect(await screen.findByText('Not ready yet')).toBeInTheDocument();
    expect(journeyCalls()).toHaveLength(2);
  });

  it('switch off (404) → back to Home', async () => {
    answer = () => Promise.reject(Object.assign(new Error('nf'), { response: { status: 404 } }));
    page();
    await waitFor(() => expect(screen.getByTestId('elsewhere')).toBeInTheDocument());
  });
});

describe('Urdu', () => {
  it('the title, week heading and step line in Urdu', async () => {
    await act(async () => { await i18n.changeLanguage('ur'); });
    answer = ok({ ready: true, updatedAt: at('2026-11-19T14:30:00'), steps: [step('quiz', '2026-11-19T08:00:00', { topic: 'Shapes' })] });
    page();
    expect(await screen.findByText('کوئز بھیجا گیا')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('میرا سفر');
    expect(screen.getAllByRole('region')[0].getAttribute('aria-label')).toBe('اس ہفتے');
  });
});
