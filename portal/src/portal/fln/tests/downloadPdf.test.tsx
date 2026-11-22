import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';

/**
 * bd-s0ccn5.2.4 — the plan page's Download PDF button (text and pictures; a PDF has no sound). It shows only when
 * GET /plan/:id/pdf answers with a link, so a plan whose PDF was never rendered shows nothing. A tap asks for a
 * FRESH link (the server's is short-lived and the tab may have been open a while) and downloads it in place.
 */
vi.mock('../player', async (orig) => (await import('./fixtures/playerMock')).withStandIns(await orig()));
vi.mock('../../services/api', () => ({ default: { get: vi.fn().mockResolvedValue({ data: { combos: [] } }), post: vi.fn() } }));

import { resetPlayerMock } from './fixtures/playerMock';
import { renderPlan } from './fixtures/renderPlan';
import { rhEn, rhUr } from './fixtures/plans';

const LINK = 'https://bucket.example.test/fln/pdf/v1/90001.pdf?sig=1';
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetPlayerMock();
  window.history.replaceState(null, '');
  assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign, href: window.location.href });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Download PDF', () => {
  it('shown when the PDF link exists; a tap fetches a fresh link and downloads it', async () => {
    const fresh = `${LINK}&fresh=1`;
    const { calls } = renderPlan(rhEn, { pdf: [{ status: 200, url: LINK }, { status: 200, url: fresh }] });
    await screen.findByText(rhEn.plan.title);
    const btn = await screen.findByRole('button', { name: 'Download PDF' });
    fireEvent.click(btn);
    await settle();
    expect(calls.filter((c) => c.url === '/api/portal/fln/plan/90001/pdf')).toHaveLength(2);
    expect(assign).toHaveBeenCalledWith(fresh);
  });

  it('hidden when no PDF was rendered (404) — and when the answer carries no https link', async () => {
    renderPlan(rhEn, { pdf: { status: 404 } });
    await screen.findByText(rhEn.plan.title);
    await settle();
    expect(screen.queryByRole('button', { name: 'Download PDF' })).toBeNull();
    cleanup();
    renderPlan(rhEn, { pdf: { status: 200, url: 'javascript:alert(1)' } });
    await screen.findByText(rhEn.plan.title);
    await settle();
    expect(screen.queryByRole('button', { name: 'Download PDF' })).toBeNull();
  });

  it('hidden when the probe fails (503), never an error page', async () => {
    renderPlan(rhEn, { pdf: { status: 503 } });
    await screen.findByText(rhEn.plan.title);
    await settle();
    expect(screen.queryByRole('button', { name: 'Download PDF' })).toBeNull();
    expect(screen.getByText(rhEn.plan.title)).toBeTruthy();
  });

  it('the link gone by the time of the tap → a calm line, no navigation', async () => {
    renderPlan(rhEn, { pdf: [{ status: 200, url: LINK }, { status: 404 }] });
    fireEvent.click(await screen.findByRole('button', { name: 'Download PDF' }));
    await settle();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByText("The PDF isn't available right now")).toBeTruthy();
  });

  it('Urdu label', async () => {
    renderPlan(rhUr, { lang: 'ur', pdf: { status: 200, url: LINK } });
    expect(await screen.findByRole('button', { name: 'پی ڈی ایف ڈاؤن لوڈ کریں' })).toBeTruthy();
  });
});
