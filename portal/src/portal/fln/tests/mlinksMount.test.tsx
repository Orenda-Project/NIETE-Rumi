import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
vi.mock('../player', async (orig) => (await import('./fixtures/playerMock')).withStandIns(await orig()));
import { renderPlan } from './fixtures/renderPlan';
import { rhEn } from './fixtures/plans';
import FlnRoutes from '../FlnRoutes';
import { stubFetch, ME_LEADER } from '../share/testFetch';

/**
 * bd-t7zk3t.12 (PR-D) — the two one-line hooks m-links adds to m-app's FLN pages, executed through the real pages:
 *   PlanPage.tsx   `{me.share ? <ShareBar plan={p} placement={placement} me={me} /> : null}`
 *   FlnRoutes.tsx  `<Route path="send" element={<SendPage />} />`
 */
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('PlanPage — the Share bar slot', () => {
  it('a leader sees the Share bar with both actions', async () => {
    renderPlan(rhEn, { share: true });
    await screen.findByText(rhEn.plan.title);
    expect(await screen.findByTestId('fln-share-bar')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Send to teacher/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Share link/ })).toBeTruthy();
  });
  it('a teacher never does', async () => {
    renderPlan(rhEn);
    await screen.findByText(rhEn.plan.title);
    expect(screen.queryByTestId('fln-share-bar')).toBeNull();
  });
});

describe('FlnRoutes — send', () => {
  it('/portal/fln/send mounts the link builder behind the FLN gate', async () => {
    stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_LEADER }, '/api/portal/fln/links': { status: 200, body: { rows: [], total: 0 } } });
    render(
      <MemoryRouter initialEntries={['/portal/fln/send']}>
        <Routes><Route path="/portal/fln/*" element={<FlnRoutes />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('fln-send-page', {}, { timeout: 5000 })).toBeTruthy();
  });
});
