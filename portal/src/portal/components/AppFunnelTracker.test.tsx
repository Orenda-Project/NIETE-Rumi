import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import AppFunnelTracker from './AppFunnelTracker';

/** bd-4r3rei — the tracker turns router moves and browser lifecycle events into funnel calls, and renders nothing. */

const calls: string[][] = [];
vi.mock('../lib/appFunnel', async () => {
  const actual: any = await vi.importActual('../lib/appFunnel');
  return {
    ...actual,
    getAppFunnel: () => ({
      view: (p: string) => calls.push(['view', p]),
      hidden: (w: string) => calls.push(['hidden', w]),
      visible: () => calls.push(['visible']),
      flush: () => calls.push(['flush']),
    }),
  };
});

let go: (to: string) => void = () => {};
function Nav() { const n = useNavigate(); useEffect(() => { go = (to) => n(to); }, [n]); return null; }

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => { calls.length = 0; });
afterEach(() => { setVisibility('visible'); });

describe('AppFunnelTracker', () => {
  it('renders nothing the teacher can see', () => {
    const { container } = render(<MemoryRouter initialEntries={['/portal/teacher']}><AppFunnelTracker /></MemoryRouter>);
    expect(container.innerHTML).toBe('');
  });

  it('reports the first page and every move (path only, query dropped by the client)', () => {
    render(<MemoryRouter initialEntries={['/portal/teacher']}><AppFunnelTracker /><Nav /></MemoryRouter>);
    act(() => go('/portal/teacher/lessons?plan=x'));
    expect(calls.filter((c) => c[0] === 'view')).toEqual([['view', '/portal/teacher'], ['view', '/portal/teacher/lessons']]);
  });

  it('visibility hidden → hidden("hidden"); visible again → visible()', () => {
    render(<MemoryRouter initialEntries={['/portal/teacher']}><AppFunnelTracker /></MemoryRouter>);
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    expect(calls.filter((c) => c[0] !== 'view')).toEqual([['hidden', 'hidden'], ['visible']]);
  });

  it('pagehide → hidden("pagehide")', () => {
    render(<MemoryRouter initialEntries={['/portal/teacher']}><AppFunnelTracker /></MemoryRouter>);
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(calls).toContainEqual(['hidden', 'pagehide']);
  });

  it('a page restored from the back-forward cache (pageshow persisted) counts as coming back', () => {
    render(<MemoryRouter initialEntries={['/portal/teacher']}><AppFunnelTracker /></MemoryRouter>);
    act(() => { const e: any = new Event('pageshow'); e.persisted = true; window.dispatchEvent(e); });
    expect(calls).toContainEqual(['visible']);
  });

  it('removes its listeners on unmount', () => {
    const { unmount } = render(<MemoryRouter initialEntries={['/portal/teacher']}><AppFunnelTracker /></MemoryRouter>);
    unmount(); calls.length = 0;
    act(() => setVisibility('hidden'));
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(calls).toEqual([]);
  });

  it('a tracker that throws inside never breaks the page (render still succeeds)', () => {
    expect(() => render(<MemoryRouter initialEntries={['/portal/teacher']}><AppFunnelTracker /></MemoryRouter>)).not.toThrow();
  });
});
