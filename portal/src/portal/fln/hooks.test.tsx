import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/**
 * bd-t7zk3t.12 — the one-line hooks PR-D adds to shared pages (SPEC v2 §3 "Sign-in return — HOOKs", "Entry points for
 * leaders"), each driven through the real page:
 *   TeacherGate.tsx:29          a signed-out visit goes to /portal/login?next=<the page it wanted>
 *   PortalLogin.tsx :60/:124/:175  after sign-in (already signed in · code · password) → safeNext(next) ?? home
 *   PortalLogin.tsx             the FLN sign-in banner for a shared plan link
 *   LeaderHome.tsx:89           the "Send a lesson plan" card (only when /me.share)
 *   LibraryPages.tsx LibraryHome the builder tile (only when /me.share)
 */
const navigateSpy = vi.fn();
let spyNavigate = false;
vi.mock('react-router-dom', async (orig) => {
  const real = await orig<typeof import('react-router-dom')>();
  return { ...real, useNavigate: () => (spyNavigate ? navigateSpy : real.useNavigate()) };
});
vi.mock('../hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../services/api', () => ({
  portal: { getConfig: vi.fn() },
  auth: { requestCode: vi.fn(), verifyCode: vi.fn() },
  leader: { getOverview: vi.fn() },
}));

import { useAuth } from '../hooks/useAuth';
import { auth, leader, portal } from '../services/api';
import TeacherGate from '../teacher/TeacherGate';
import { resetTeacherV2Memory } from '../teacher/useTeacherV2';
import PortalLogin from '../pages/PortalLogin';
import LeaderHome from '../pages/LeaderHome';
import { stubFetch, ME_LEADER, ME_TEACHER } from './share/testFetch';

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

beforeEach(() => { vi.clearAllMocks(); spyNavigate = false; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

describe('TeacherGate:29 — signed out keeps where it was going', () => {
  it('→ /portal/login?next=<path+search>', async () => {
    resetTeacherV2Memory();
    vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: {} } as never);
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false } as never);
    const path = '/portal/teacher/lessons/open?plan=fln:11156';
    window.history.replaceState({}, '', path);
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/portal/teacher/lessons/open" element={<TeacherGate><p>v2 page</p></TeacherGate>} />
          <Route path="/portal/login" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    await settle();
    expect(screen.getByTestId('where').textContent).toBe(`/portal/login?next=${encodeURIComponent(path)}`);
  });
});

describe('PortalLogin — next= after sign-in', () => {
  function renderLogin(authValue: Record<string, unknown>, search: string) {
    spyNavigate = true;
    vi.mocked(useAuth).mockReturnValue({ login: vi.fn(), checkAuth: vi.fn(async () => undefined), ...authValue } as never);
    stubFetch({ '/api/portal/fln/title/': { status: 404 } });
    return render(<MemoryRouter initialEntries={[`/portal/login${search}`]}><PortalLogin /></MemoryRouter>);
  }

  it(':60 an already signed-in user goes to a safe next=', async () => {
    renderLogin({ user: { firstName: 'A', role: 'teacher' }, loading: false }, `?next=${encodeURIComponent('/portal/fln/p/11156?src=wa')}`);
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/portal/fln/p/11156?src=wa', { replace: true }));
  });

  it(':60 an unsafe next= is ignored: home as before', async () => {
    renderLogin({ user: { firstName: 'A', role: 'coach' }, loading: false }, `?next=${encodeURIComponent('//evil.example/portal/fln/p/1')}`);
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/portal/leader', { replace: true }));
  });

  it(':124 the code sign-in goes to next=', async () => {
    vi.mocked(auth.requestCode).mockResolvedValue({} as never);
    vi.mocked(auth.verifyCode).mockResolvedValue({ user: { role: 'teacher' } } as never);
    const { container } = renderLogin({ user: null, loading: false }, '?next=/portal/fln/p/11156');
    fireEvent.change(container.querySelector('#phoneNumber') as HTMLInputElement, { target: { value: '923001234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await waitFor(() => expect(container.querySelector('#code')).not.toBeNull());
    fireEvent.change(container.querySelector('#code') as HTMLInputElement, { target: { value: '123456' } });
    fireEvent.submit((container.querySelector('#code') as HTMLInputElement).form as HTMLFormElement);
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/portal/fln/p/11156', { replace: true })); // m-app 161033: Back must not return to login
  });

  it(':175 the password sign-in goes to next=', async () => {
    const login = vi.fn(async () => ({ success: true, user: { role: 'coach' } }));
    const { container } = renderLogin({ user: null, loading: false, login }, '?next=/portal/fln/send');
    fireEvent.click(screen.getByRole('button', { name: 'Use password instead' }));
    fireEvent.change(container.querySelector('#phoneNumber') as HTMLInputElement, { target: { value: '923001234567' } });
    fireEvent.change(container.querySelector('#password') as HTMLInputElement, { target: { value: 'pw123456' } });
    fireEvent.submit((container.querySelector('#password') as HTMLInputElement).form as HTMLFormElement);
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/portal/fln/send', { replace: true }));
  });

  it(':175 with no next= the password sign-in goes home exactly as before', async () => {
    const login = vi.fn(async () => ({ success: true, user: { role: 'coach' } }));
    const { container } = renderLogin({ user: null, loading: false, login }, '');
    fireEvent.click(screen.getByRole('button', { name: 'Use password instead' }));
    fireEvent.change(container.querySelector('#phoneNumber') as HTMLInputElement, { target: { value: '923001234567' } });
    fireEvent.change(container.querySelector('#password') as HTMLInputElement, { target: { value: 'pw123456' } });
    fireEvent.submit((container.querySelector('#password') as HTMLInputElement).form as HTMLFormElement);
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/portal/leader'));
  });

  it('a shared plan link shows the bilingual banner on the sign-in form', async () => {
    renderLogin({ user: null, loading: false }, '?next=/portal/fln/p/11156');
    expect(await screen.findByTestId('fln-login-banner')).toBeTruthy();
    expect(screen.getByText('Sign in to open')).toBeTruthy();
    expect(screen.getByText('کھولنے کے لیے سائن اِن کریں')).toBeTruthy();
  });

  it('no banner without a plan link', async () => {
    renderLogin({ user: null, loading: false }, '');
    await settle();
    expect(screen.queryByTestId('fln-login-banner')).toBeNull();
  });
});

describe('LeaderHome:89 — the builder card', () => {
  const OVERVIEW = { totalTeachers: 1, onRumi: 1, notOnRumi: 0, totalCoachingSessions: 0, totalLessonPlans: 0, teachersMarkingAttendance: 0, teachersInTraining: 0, focus: [] };
  function renderHome() {
    vi.mocked(useAuth).mockReturnValue({ user: { firstName: 'N', role: 'principal' }, loading: false, logout: vi.fn() } as never);
    vi.mocked(leader.getOverview).mockResolvedValue({ success: true, overview: OVERVIEW } as never);
    vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: {} } as never);
    return render(<MemoryRouter><LeaderHome /></MemoryRouter>);
  }
  it('share:true → the card after the feature-reach grid, linking to the builder', async () => {
    stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_LEADER } });
    renderHome();
    const card = await screen.findByTestId('fln-send-card');
    expect(card.getAttribute('href')).toBe('/portal/fln/send');
    const reach = screen.getByTestId('feature-reach');
    // eslint-disable-next-line no-bitwise
    expect(reach.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('share:false → no card', async () => {
    stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_TEACHER } });
    renderHome();
    await screen.findByTestId('feature-reach');
    await settle();
    expect(screen.queryByTestId('fln-send-card')).toBeNull();
  });
});
