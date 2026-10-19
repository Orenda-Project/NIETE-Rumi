import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WHATSAPP_URL_PICKER } from '@/lib/whatsapp';
import ShareBar from './ShareBar';
import { stubFetch, callsTo, ME_LEADER, ME_LEADER_UR, ME_TEACHER, PLAN_DATA } from './testFetch';

/**
 * The leaders' Share bar on a plan page (DESIGN v2 §2 S4.7, §4 L2a/L2b). Props {plan, placement, me}:
 * the plan page fetches /me on every mount and passes it in; the bar renders ONLY when me.share is true, and never asks
 * /me itself. Two ≥48 px buttons in a ≤56 px bar.
 */
function mount(me: unknown, data: { plan: unknown; placement: unknown } = PLAN_DATA) {
  return render(<MemoryRouter><ShareBar plan={data.plan as never} placement={data.placement as never} me={me as never} /></MemoryRouter>);
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ShareBar — who sees it', () => {
  it.each([
    ['share:false', ME_TEACHER],
    ['no me', null],
    ['me undefined', undefined],
    ['share missing', { ui_lang: 'en' }],
  ])('%s → nothing', (_l, me) => {
    const { container } = mount(me);
    expect(container.innerHTML).toBe('');
  });
  it('never fetches /me itself (the page owns that read)', () => {
    const f = stubFetch({});
    mount(ME_LEADER);
    expect(screen.getByTestId('fln-share-bar')).toBeTruthy();
    expect(callsTo(f, '/fln/me')).toHaveLength(0);
  });
  it('m-app\'s plan shape (minutes as {total}) is accepted', () => {
    mount(ME_LEADER, { plan: { ...PLAN_DATA.plan, minutes: { total: 36, opening: 5 } }, placement: PLAN_DATA.placement });
    expect(screen.getByTestId('fln-share-bar')).toBeTruthy();
  });
});

describe('ShareBar — for a leader', () => {
  it('two buttons, Send to teacher first, each ≥48 px, in a bar ≤56 px', async () => {
    mount(ME_LEADER);
    const bar = await screen.findByTestId('fln-share-bar');
    const buttons = bar.querySelectorAll('button');
    expect(Array.from(buttons).map((b) => b.textContent)).toEqual(['Send to teacher', 'Share link']);
    for (const b of Array.from(buttons)) expect(b.className).toContain('min-h-[48px]');
    expect(bar.style.maxHeight).toBe('56px');
  });
  it('Urdu chrome: Urdu words, rtl', async () => {
    mount(ME_LEADER_UR);
    const bar = await screen.findByTestId('fln-share-bar');
    expect(bar.getAttribute('dir')).toBe('rtl');
    expect(bar.textContent).toContain('استاد کو بھیجیں');
    expect(bar.textContent).toContain('لنک شیئر کریں');
  });
  it('Share link opens the sheet: the link in full, WhatsApp with the level-not-grade message, Copy logs link_copy', async () => {
    const f = stubFetch({ '/api/portal/fln/events': { status: 204 } });
    mount(ME_LEADER);
    fireEvent.click(await screen.findByRole('button', { name: 'Share link' }));
    const sheet = await screen.findByRole('dialog', { name: 'Share this lesson plan' });
    const link = `${window.location.origin}/portal/fln/p/11156`;
    expect(sheet.querySelector('[data-testid="fln-share-url"]')?.textContent).toBe(link);
    const wa = screen.getByRole('link', { name: 'Send on WhatsApp' }) as HTMLAnchorElement;
    const pre = `${WHATSAPP_URL_PICKER}?text=`;
    const text = decodeURIComponent(wa.href.slice(pre.length));
    expect(wa.href.startsWith(pre)).toBe(true);
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
    stubFetch({ '/api/portal/fln/events': () => { throw new Error('down'); } });
    mount(ME_LEADER);
    fireEvent.click(await screen.findByRole('button', { name: 'Share link' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy link' }));
    expect(await screen.findByText('Link copied ✓')).toBeTruthy();
  });
  it('Send to teacher opens the teacher sheet', async () => {
    stubFetch({ '/api/portal/fln/teachers': { status: 200, body: { teachers: [] } } });
    mount(ME_LEADER);
    fireEvent.click(await screen.findByRole('button', { name: 'Send to teacher' }));
    expect(await screen.findByRole('dialog', { name: 'Send to teacher' })).toBeTruthy();
  });
  it('renders nothing without a plan in the data', () => {
    const { container } = mount(ME_LEADER, { plan: null, placement: [] });
    expect(container.innerHTML).toBe('');
  });
});
