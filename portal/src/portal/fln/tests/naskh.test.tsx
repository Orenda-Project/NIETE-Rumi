import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * R5 RT5-NASKH (red-team-r5 191850, RUBRIC B2 ⛔): Urdu body and chrome in Nastaliq. FLN's chrome language is /me's,
 * not <html lang> (the teacher app's), so FLN cannot lean on index.css's `html[lang="ur"] *` rule; and its own `bdi`
 * rule forced the Latin stack onto Urdu letters and digits (tile letters, kicker, minutes, chapter headers).
 * Every element with Arabic-script text under an Urdu FLN root must compute the Urdu stack (whose Nastaliq face is
 * unicode-range limited, so Latin runs still fall through to the Latin font).
 */
vi.mock('../player', async (orig) => (await import('./fixtures/playerMock')).withStandIns(await orig()));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(async () => ({ data: { success: true, combos: [] } })), post: vi.fn() } }));
import { resetPlayerMock } from './fixtures/playerMock';
import { renderPlan } from './fixtures/renderPlan';
import { rhUr } from './fixtures/plans';
import { FlnProvider } from '../FlnContext';
import { LessonList } from '../LessonList';
import { rhUrG1, stubFetch } from './listFixtures';

// vitest runs with css:false (a `?raw` import comes back empty), so read the stylesheets from disk.
const css = ['../fln.css', '../plan/plan.css', '../player/player.css']
  .map((p) => { try { return readFileSync(resolve(__dirname, p), 'utf8'); } catch { return ''; } })
  .join('\n');
let style: HTMLStyleElement;
beforeAll(() => {
  style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  document.documentElement.lang = 'en'; // the teacher app in English, FLN chrome in Urdu (/me ui_lang)
});
afterAll(() => style.remove());
beforeEach(() => resetPlayerMock());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const ARABIC = /[؀-ۿ]/;
function notNastaliq(root: Element): string[] {
  const bad: string[] = [];
  for (const el of root.querySelectorAll('*')) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
    if (!ARABIC.test(own)) continue;
    const ff = getComputedStyle(el).fontFamily;
    // jsdom leaves font-family empty when a `font:` shorthand with var() wins its cascade (kicker, goal label, minutes);
    // those are proven in a real browser (fix lane, naskh_browser.json), not here.
    if (ff === '') continue;
    if (!/^var\(--font-urdu\)/.test(ff)) bad.push(`${el.tagName.toLowerCase()}.${el.className}|${ff}|${own.trim().slice(0, 16)}`);
  }
  return bad;
}

describe('Urdu FLN text is in the Urdu (Nastaliq) stack, whatever <html lang> says', () => {
  it('Urdu plan: kicker, goal, minutes, tile letters', async () => {
    const { container } = renderPlan(rhUr, { lang: 'ur' });
    await screen.findByText(rhUr.plan.title);
    expect(notNastaliq(container)).toEqual([]);
  });

  it('Urdu list: chapter headers, row numbers, chips', async () => {
    stubFetch({ '/catalogue': rhUrG1 });
    const { container } = render(
      <div className="fln-root" lang="ur" dir="rtl">
        <MemoryRouter initialEntries={['/portal/fln/list/rh-ur?grade=1']}>
          <FlnProvider me={{ lessons: true, share: false, role: 'teacher', ui_lang: 'ur' }}>
            <Routes><Route path="/portal/fln/list/:subject" element={<LessonList subject="rh-ur" grade={1} level={null} />} /></Routes>
          </FlnProvider>
        </MemoryRouter>
      </div>,
    );
    await screen.findAllByRole('link');
    expect(notNastaliq(container)).toEqual([]);
  });
});
