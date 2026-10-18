import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';

/**
 * bd-t7zk3t.18 (R5 Q1 FAIL QL-openlink) — the receiver's `open_link` event (contracts/deep-link.md, Events):
 *  - a `/go` landing (`?src=send`, from fln-go-target.js) → ONE `open_link` with result `send`;
 *  - a shared link (`?src=wa`, from share/message.ts withSrc) opened with an empty referrer → ONE `open_link`, result `wa`;
 *  - never on a 404 (no open is logged for a hidden/unknown plan), never without `src`, never twice for one landing;
 *  - `src` is then stripped from the address bar, so a reload or a forward is not counted again.
 */
vi.mock('../player', async (orig) => (await import('./fixtures/playerMock')).withStandIns(await orig()));
vi.mock('../../services/api', () => ({ default: { get: vi.fn().mockResolvedValue({ data: { success: true, combos: [] } }), post: vi.fn() } }));

import { resetPlayerMock } from './fixtures/playerMock';
import { renderPlan } from './fixtures/renderPlan';
import { rhEn } from './fixtures/plans';

const posts = (calls: Array<{ url: string; init?: RequestInit }>) =>
  calls.filter((c) => c.url.endsWith('/events')).map((c) => JSON.parse(String(c.init?.body)));

function land(path: string) {
  window.history.replaceState(null, '', path);
}

beforeEach(() => { resetPlayerMock(); land('/'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); land('/'); });

describe('open_link on a link landing', () => {
  it('?src=send → one open_link, result send, then src leaves the address bar', async () => {
    land('/portal/fln/p/90001?src=send');
    const { calls } = renderPlan(rhEn, { entries: ['/portal/fln/p/90001?src=send'] });
    await screen.findByText(rhEn.plan.title);
    await act(async () => { await Promise.resolve(); });
    expect(posts(calls)).toEqual([[{ kind: 'open_link', plan: 90001, result: 'send' }]]);
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/portal/fln/p/90001');
  });

  it('?src=wa with an empty referrer → one open_link, result wa', async () => {
    vi.spyOn(document, 'referrer', 'get').mockReturnValue('');
    land('/portal/fln/p/90001?src=wa');
    const { calls } = renderPlan(rhEn, { entries: ['/portal/fln/p/90001?src=wa'] });
    await screen.findByText(rhEn.plan.title);
    await act(async () => { await Promise.resolve(); });
    expect(posts(calls)).toEqual([[{ kind: 'open_link', plan: 90001, result: 'wa' }]]);
    expect(window.location.search).toBe('');
  });

  it('?src=wa reached from inside the portal (a referrer) → no open_link', async () => {
    vi.spyOn(document, 'referrer', 'get').mockReturnValue('https://portal.example/portal/teacher/lessons');
    const { calls } = renderPlan(rhEn, { entries: ['/portal/fln/p/90001?src=wa'] });
    await screen.findByText(rhEn.plan.title);
    await act(async () => { await Promise.resolve(); });
    expect(posts(calls)).toEqual([]);
  });

  it('a hidden/unknown plan (404) with ?src=send → no open_link', async () => {
    const { calls } = renderPlan(null, { status: 404, entries: ['/portal/fln/p/123?src=send'] });
    await screen.findByText("This lesson isn't available");
    await act(async () => { await Promise.resolve(); });
    expect(posts(calls)).toEqual([]);
  });

  it('no src → no open_link (the plan GET is the open)', async () => {
    const { calls } = renderPlan(rhEn);
    await screen.findByText(rhEn.plan.title);
    await act(async () => { await Promise.resolve(); });
    expect(posts(calls)).toEqual([]);
  });
});
