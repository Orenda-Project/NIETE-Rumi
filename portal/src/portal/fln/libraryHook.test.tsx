import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from 'i18next';

/**
 * The one-line hook in the coach Training Library (LibraryPages.tsx LibraryHome tiles grid): the
 * "Send a lesson plan" tile, only when /me.share, inside the providers grid, in the page's own language.
 */
vi.mock('../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'coach', phoneNumber: '92300' }, loading: false }) }));
vi.mock('../coach/useCoachV2', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useCoachV2: () => true }));
vi.mock('../lib/recordingSession', () => ({ useRecordingSession: () => null }));
const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('../services/api', () => ({
  default: http,
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));

import { LibraryHome } from '../coach/training/LibraryPages';
import { stubFetch, ME_LEADER, ME_TEACHER } from './share/testFetch';

const LIBRARY = { vendors: [{ vendor_key: 'ISAPS', vendor_name: 'I-SAPS', levels: [] }] };

beforeEach(async () => {
  vi.clearAllMocks();
  http.get.mockImplementation(async (url: string) => {
    if (url === '/training/library') return { data: LIBRARY };
    throw new Error(`unmocked ${url}`);
  });
  if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {} });
  await act(async () => { await i18n.changeLanguage('en'); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('LibraryHome — the builder tile', () => {
  it('share:true → the tile inside the providers grid, linking to the builder', async () => {
    stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_LEADER } });
    render(<MemoryRouter><LibraryHome /></MemoryRouter>);
    const tile = await screen.findByTestId('fln-send-tile');
    expect(tile.getAttribute('href')).toBe('/portal/fln/send');
    expect(within(screen.getByTestId('library-providers')).getByTestId('fln-send-tile')).toBe(tile);
    expect(tile.getAttribute('lang')).toBe('en');
  });
  it('share:false → no tile; the providers are unchanged', async () => {
    stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_TEACHER } });
    render(<MemoryRouter><LibraryHome /></MemoryRouter>);
    await screen.findByTestId('provider-ISAPS');
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('fln-send-tile')).toBeNull();
  });
});
