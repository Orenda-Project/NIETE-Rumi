import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ShareBar from './ShareBar';
import { stubFetch, callsTo, ME_LEADER, ME_LEADER_UR, ME_TEACHER, PLAN_DATA } from './testFetch';

/**
 * bd-t7zk3t.12 — the leaders' Share bar on a plan page (DESIGN v2 §2 S4.7, §4 L2a/L2b): rendered ONLY when
 * GET /api/portal/fln/me (fetched on every mount, no-store) says share:true; two ≥48 px buttons in a ≤56 px bar.
 */
function mount(data = PLAN_DATA) {
  return render(<MemoryRouter><ShareBar data={data as never} /></MemoryRouter>);
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ShareBar — who sees it', () => {
  it('renders nothing for share:false', async () => {
    const f = stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_TEACHER } });
    const { container } = mount();
    await waitFor(() => expect(callsTo(f, '/fln/me')).toHaveLength(1));
    expect(container.innerHTML).toBe('');
  });
  it.each([401, 404, 500])('renders nothing when /me answers %i', async (status) => {
    const f = stubFetch({ '/api/portal/fln/me': { status, body: { error: 'x' } } });
    const { container } = mount();
    await waitFor(() => expect(callsTo(f, '/fln/me')).toHaveLength(1));
    expect(container.innerHTML).toBe('');
  });
  it('renders nothing when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    const { container } = mount();
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe('');
  });
  it('asks /me with no-store on EVERY mount (never a cached answer)', async () => {
    const f = stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_LEADER } });
    const first = mount();
    await screen.findByTestId('fln-share-bar');
    first.unmount();
    mount();
    await screen.findByTestId('fln-share-bar');
    const calls = callsTo(f, '/api/portal/fln/me');
    expect(calls).toHaveLength(2);
    for (const [, init] of calls) {
      expect(init).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
    }
  });
});

describe('ShareBar — for a leader', () => {
  it('two buttons, Send to teacher first, each ≥48 px, in a bar ≤56 px', async () => {
    stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_LEADER } });
    mount();
    const bar = await screen.findByTestId('fln-share-bar');
    const buttons = bar.querySelectorAll('button');
    expect(Array.from(buttons).map((b) => b.textContent)).toEqual(['Send to teacher', 'Share link']);
    for (const b of Array.from(buttons)) expect(b.className).toContain('min-h-[48px]');
    expect(bar.style.maxHeight).toBe('56px');
    // the page is padded by the bar's height so Homework and the footer are never covered
    expect(screen.getByTestId('fln-share-bar-spacer').style.height).toBe('64px');
  });
  it('Urdu chrome: Urdu words, rtl', async () => {
    stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_LEADER_UR } });
    mount();
    const bar = await screen.findByTestId('fln-share-bar');
    expect(bar.getAttribute('dir')).toBe('rtl');
    expect(bar.textContent).toContain('استاد کو بھیجیں');
    expect(bar.textContent).toContain('لنک شیئر کریں');
  });
  it('Share link opens the sheet: the link in full, WhatsApp with the level-not-grade message, Copy logs link_copy', async () => {
    const f = stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_LEADER }, '/api/portal/fln/events': { status: 204 } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Share link' }));
    const sheet = await screen.findByRole('dialog', { name: 'Share this lesson plan' });
    const link = `${window.location.origin}/portal/fln/p/11156`;
    expect(sheet.querySelector('[data-testid="fln-share-url"]')?.textContent).toBe(link);
    const wa = screen.getByRole('link', { name: 'Send on WhatsApp' }) as HTMLAnchorElement;
    const text = decodeURIComponent(wa.href.slice('https://wa.me/?text='.length));
    expect(wa.href.startsWith('https://wa.me/?text=')).toBe(true);
    expect(text.split('\n')).toEqual(['📘 Reading Hour · English · Level 1', PLAN_DATA.plan.title, `${link}?src=wa`]);
    expect(text).not.toMatch(/grade/i);

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByText('Link copied ✓')).toBeTruthy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(link);
    await waitFor(() => expect(callsTo(f, '/fln/events')).toHaveLength(1));
    const [, init] = callsTo(f, '/fln/events')[0];
    expect(JSON.parse(String(init?.body))).toEqual([{ kind: 'link_copy', plan: 11156 }]);

    fireEvent.click(wa);
    await waitFor(() => expect(callsTo(f, '/fln/events')).toHaveLength(2));
    expect(JSON.parse(String(callsTo(f, '/fln/events')[1][1]?.body))).toEqual([{ kind: 'share', plan: 11156 }]);
  });
  it('a failed event log never blocks the copy', async () => {
    stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_LEADER }, '/api/portal/fln/events': () => { throw new Error('down'); } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Share link' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy link' }));
    expect(await screen.findByText('Link copied ✓')).toBeTruthy();
  });
  it('Send to teacher opens the teacher sheet', async () => {
    stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_LEADER }, '/api/portal/fln/teachers': { status: 200, body: { teachers: [] } } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Send to teacher' }));
    expect(await screen.findByRole('dialog', { name: 'Send to teacher' })).toBeTruthy();
  });
  it('renders nothing without a plan in the data', async () => {
    stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_LEADER } });
    const { container } = mount({ plan: null, placement: [] } as never);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe('');
  });
});
