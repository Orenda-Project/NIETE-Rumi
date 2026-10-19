import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FlnGate } from '../FlnGate';
import FlnLoginBanner from '../login/FlnLoginBanner';
import FlnSendCard from '../FlnSendCard';
import FlnSendTile from '../FlnSendTile';
import ShareBar from '../share/ShareBar';
import { Sheet } from '../share/Sheet';
import { stubFetch, ME_LEADER, ME_TEACHER, PLAN_DATA } from '../share/testFetch';

/**
 * R5 RT5-ROOT100VH (red-team-r5 185935, qa-links 190613/190617): the page rule — full-height grey ground — belongs to
 * the gate's root only. Every EMBEDDED surface that carries `.fln-root` for its lang/dir/type (Share bar, sign-in banner,
 * leader card, coach tile, sheet) must not inherit it: a 100vh fixed Share bar hid the whole plan from every leader.
 */
// vitest runs with css:false (a `?raw` import comes back empty), so read the stylesheet from disk.
const css = readFileSync(resolve(__dirname, '../fln.css'), 'utf8');
let style: HTMLStyleElement;
beforeAll(() => { style = document.createElement('style'); style.textContent = css; document.head.appendChild(style); });
afterAll(() => style.remove());
afterEach(() => { cleanup(); });

const isPage = (el: Element) => {
  const cs = getComputedStyle(el);
  return cs.minHeight === '100vh' || /fln-ground/.test(cs.backgroundColor) || /238, 240, 243/.test(cs.backgroundColor);
};

describe('the page rule is scoped to the gate root', () => {
  it.each([
    ['ok', { status: 200, body: ME_TEACHER }],
    ['not available', { status: 404, body: { error: 'not_found' } }],
    ['unavailable', { status: 503, body: {} }],
  ])('FlnGate root (%s) keeps min-height 100vh on the ground colour', async (l, me) => {
    stubFetch({ '/api/portal/fln/me': me });
    const { container } = render(
      <MemoryRouter initialEntries={['/portal/fln/list/rh-en']}>
        <Routes><Route path="/portal/fln/*" element={<FlnGate><p data-testid="child" /></FlnGate>} /></Routes>
      </MemoryRouter>,
    );
    if (l === 'ok') await screen.findByTestId('child');
    else await screen.findByText(/./, { selector: '.fln-state-line' });
    const root = container.querySelector('.fln-root') as HTMLElement;
    expect(getComputedStyle(root).minHeight).toBe('100vh');
    expect(isPage(root)).toBe(true);
  });

  it('Share bar (fixed bottom) is not a full-height grey page', () => {
    render(<MemoryRouter><ShareBar plan={PLAN_DATA.plan as never} placement={PLAN_DATA.placement as never} me={ME_LEADER as never} /></MemoryRouter>);
    expect(isPage(screen.getByTestId('fln-share-bar').closest('.fln-root')!)).toBe(false);
  });

  it('sign-in banner is not a full-height grey page', async () => {
    stubFetch({ '/api/portal/fln/title/11158': { status: 200, body: { title: 'Sounds', lang: 'en', dir: 'ltr' } } });
    render(<MemoryRouter initialEntries={[`/portal/login?next=${encodeURIComponent('/portal/fln/p/11158?src=wa')}`]}><FlnLoginBanner /></MemoryRouter>);
    expect(isPage(await screen.findByTestId('fln-login-banner'))).toBe(false);
  });

  it.each([['FlnSendCard', FlnSendCard], ['FlnSendTile', FlnSendTile]])('%s is not a full-height grey page', async (_n, Entry) => {
    stubFetch({ '/api/portal/fln/me': { status: 200, body: ME_LEADER } });
    render(<MemoryRouter><Entry /></MemoryRouter>);
    const link = await screen.findByRole('link', { name: /Send a lesson plan/ });
    expect(isPage(link.closest('.fln-root')!)).toBe(false);
  });

  it('Sheet wrapper is transparent, so its dimmed backdrop shows the page beneath', () => {
    render(<Sheet lang="en" title="Send" onClose={() => undefined} testId="sheet"><p /></Sheet>);
    expect(isPage(screen.getByTestId('sheet').closest('.fln-root')!)).toBe(false);
  });
});
