import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FlnSendCard from './FlnSendCard';
import FlnSendTile from './FlnSendTile';
import { stubFetch, callsTo, ME_LEADER, ME_TEACHER } from './share/testFetch';

/**
 * bd-t7zk3t.12 — the two builder entry points (SPEC v2 §3 "Entry points for leaders"): a card on the leader home and
 * a tile in the coach Training Library. Both render NOTHING unless /me says share:true, so the pages they sit on are
 * unchanged for everyone else (and when FLN is off).
 */
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe.each([
  ['FlnSendCard', FlnSendCard],
  ['FlnSendTile', FlnSendTile],
])('%s', (_name, Entry) => {
  it('share:true → one link to /portal/fln/send, ≥48 px', async () => {
    stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_LEADER } });
    render(<MemoryRouter><Entry /></MemoryRouter>);
    const link = await screen.findByRole('link', { name: /Send a lesson plan/ });
    expect(link.getAttribute('href')).toBe('/portal/fln/send');
    expect(link.className).toMatch(/min-h-\[(48|56|150)px\]/);
  });
  it.each([
    ['share:false', { status: 200, body: ME_TEACHER }],
    ['404', { status: 404, body: { error: 'not_found' } }],
    ['401', { status: 401, body: {} }],
  ])('%s → nothing', async (_l, reply) => {
    const f = stubFetch({ '/api/portal/fln/me': reply });
    const { container } = render(<MemoryRouter><Entry /></MemoryRouter>);
    await waitFor(() => expect(callsTo(f, '/fln/me')).toHaveLength(1));
    expect(container.innerHTML).toBe('');
  });
  it('a page language passed in wins over /me (the tile follows its page)', async () => {
    stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_LEADER } });
    render(<MemoryRouter><Entry lang="ur" /></MemoryRouter>);
    expect(await screen.findByRole('link', { name: /سبق کا منصوبہ بھیجیں/ })).toBeTruthy();
  });
});
