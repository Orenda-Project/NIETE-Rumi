import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';

/**
 * R5 QL-backlink (qa-links 190611): a receiver signs in from a shared link; the gate → login and login → plan steps both
 * `replace`, so the plan is the app's FIRST history entry while its router key is no longer "default". Back must then
 * take the link-opened path (the subject list), not `navigate(-1)` out of the app (about:blank in WhatsApp's browser).
 * Driven through a real BrowserRouter on jsdom's history, so `history.state.idx` is the router's own.
 */
vi.mock('../player', async (orig) => (await import('./fixtures/playerMock')).withStandIns(await orig()));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from '../../services/api';
import { resetPlayerMock } from './fixtures/playerMock';
import { mockPlanFetch } from './fixtures/renderPlan';
import { rhEn } from './fixtures/plans';
import { PlanScreen } from '../PlanPage';
import type { FlnMe } from '../types';

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const ME: FlnMe = { lessons: true, share: false, role: 'teacher', ui_lang: 'en' };
const PLAN = `/portal/fln/p/${rhEn.plan.id}`;

function Probe() {
  const loc = useLocation();
  return <div data-testid="probe">{loc.pathname + loc.search}</div>;
}
function Home() {
  return <Link to={PLAN}>open</Link>;
}
function app() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/portal/login" element={<Navigate replace to={PLAN} />} />
        <Route path="/portal/home" element={<Home />} />
        <Route path="/portal/fln/p/:id" element={<PlanScreen me={ME} lang="en" />} />
        <Route path="/portal/fln/list/:subject" element={<Probe />} />
      </Routes>
    </BrowserRouter>
  );
}

beforeEach(() => {
  resetPlayerMock();
  http.get.mockReset();
  http.get.mockResolvedValue({ data: { success: true, combos: [] } });
  mockPlanFetch(rhEn);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Back after signing in from a link', () => {
  it('plan reached by replace from sign-in (idx 0, key not "default") → the subject list, not out of the app', async () => {
    window.history.replaceState(null, '', `/portal/login?next=${encodeURIComponent(PLAN)}`);
    render(app());
    await screen.findByText(rhEn.plan.title);
    expect((window.history.state as { idx?: number }).idx).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((await screen.findByTestId('probe')).textContent).toBe('/portal/fln/list/rh-en?grade=1');
  });

  it('plan reached in-app (idx 1) → the browser step back', async () => {
    window.history.replaceState(null, '', '/portal/home');
    render(app());
    fireEvent.click(await screen.findByRole('link', { name: 'open' }));
    await screen.findByText(rhEn.plan.title);
    expect((window.history.state as { idx?: number }).idx).toBe(1);
    const back = vi.spyOn(window.history, 'go');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(back).toHaveBeenCalledWith(-1);
    back.mockRestore();
  });
});
