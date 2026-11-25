import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from 'i18next';
import { MemoryRouter } from 'react-router-dom';

/**
 * bd-sil83f (queue #269) — the "?" says what it is. The operator, 24 Nov ~19:20: "instead of just it being a question
 * mark, maybe make it be the text how to use question mark ... at least on the home page. And then on the remaining pages
 * as well, if it seems like there is enough space ... not too large, not take too much space ... to make it more obvious
 * that the videos are there."
 *
 *   On every role's Home        a small pill "How to use ?" (Urdu: «استعمال کا طریقہ ؟») in the band's corner
 *                                 teacher           the help videos' "?" (HelpCorner, Film 1), as before
 *                                 coach, principal  the Observe "?" (film + indicator guides), which their Home lacked
 *   The pill                     40 px tall inside the same 56 px tap as the bare "?"; its spoken name is its words;
 *                                the "?" glyph at its end (turned for Urdu: ؟); the first-time pulse/dot as before
 *   A tap                        opens the very tray the bare "?" opens, and stops the pulse
 *   Where a page has no room     the bare "?" stays: 40 px circle, spoken "Help" (pages without `pill`)
 *   Switch off                   nothing, as before (no pill on a Home whose role has no help)
 *   Room on the band (360 px)    the pill stands in the 44 px logo row without making it taller (its 56 px tap reaches
 *                                past the row); beside it the language pill drops its glyph (its word stays), so the
 *                                Urdu row (NIETE, "English", «استعمال کا طریقہ ؟») fits; a narrower phone wraps the
 *                                corner under the mark rather than cutting it off
 */

vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../lib/recordingSession', () => ({ useRecordingSession: () => null, useLogoutGuard: (f: () => void) => f }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { firstName: 'Sample', lastName: 'Teacher', phoneNumber: '923000000000' }, loading: false, logout: vi.fn() }) }));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const cfg = { features: {} as Record<string, boolean> };
vi.mock('../../lib/useNewUi', async (orig) => ({
  ...(await orig<object>()),
  readConfigShared: () => Promise.resolve({ success: true, features: cfg.features }),
}));

import api from '../../services/api';
import { HelpButton } from './HelpButton';
import { HelpCorner } from './HelpCorner';
import { ObserveHelpButton } from './observe/ObserveHelp';
import { resetHelp } from './api';
import { HELP, HELP_COPY } from './copy';
import { LanguagePill } from '../home/look/LanguagePill';
import { HomeGreeting } from '../ui/HomeGreeting';
import lookHomeSrc from '../home/look/LookHome.tsx?raw';
import slimHomeSrc from '../../coach/card/SlimHome.tsx?raw';
import coachHomeSrc from '../../coach/pages/CoachHome.tsx?raw';
import principalHomeSrc from '../principal/HomeV6.tsx?raw';

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
let helpAnswer: { success: boolean; seen: boolean; videos: unknown[] };
let reduced = false;

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetHelp();
  cfg.features = { helpVideos: true, coachFlowV2: true };
  helpAnswer = { success: true, seen: false, videos: [] };
  reduced = false;
  http.get.mockImplementation(async (url: string) => (url === '/help' ? { data: helpAnswer } : { data: {} }));
  http.post.mockResolvedValue({ data: { success: true, seen: true } });
  window.matchMedia = ((q: string) => ({
    matches: q.includes('reduce') ? reduced : false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});
afterEach(async () => { if (i18n.isInitialized) await act(async () => { await i18n.changeLanguage('en'); }); });

const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const inRouter = (el: JSX.Element) => render(<MemoryRouter>{el}</MemoryRouter>);
const glyph = (el: Element) => el.querySelector('svg.lucide-circle-help, svg.lucide-help-circle');

describe('the words', () => {
  it('English "How to use", Urdu «استعمال کا طریقہ» (the More row and tray name, one Urdu vocabulary)', () => {
    expect(HELP_COPY.pill).toBe('How to use');
    expect(HELP.ur.pill).toBe('استعمال کا طریقہ');
    expect(HELP.ur.pill).toBe(HELP.ur.howTo);
  });
});

describe('the pill (help videos "?")', () => {
  it('reads "How to use" with the "?" glyph at its end; spoken by its words; 40 px face in the 56 px tap', async () => {
    inRouter(<HelpButton feature="start" pill onDark />);
    const btn = await screen.findByTestId('help-button');
    expect(btn.textContent).toBe('How to use');
    expect(btn.getAttribute('aria-label')).toBeNull();
    expect(btn.getAttribute('data-help-pill')).toBe('');
    expect(btn.className).toMatch(/\bh-14\b/);
    const face = btn.querySelector('[data-help-face]') as HTMLElement;
    expect(face.className).toMatch(/\bh-10\b/);
    expect(face.className).toMatch(/\bwhitespace-nowrap\b/);
    expect(face.lastElementChild && glyph(face)).toBe(face.lastElementChild);
    expect(glyph(face)?.getAttribute('class')).toMatch(/rtl:-scale-x-100/);
  });

  it('first time: it pulses; a tap opens the same tray as the "?" and stops the pulse', async () => {
    inRouter(<HelpButton feature="lessons" pill />);
    await screen.findByTestId('help-pulse');
    fireEvent.click(screen.getByTestId('help-button'));
    expect(await screen.findByTestId('help-tray')).toBeTruthy();
    expect(screen.queryByTestId('help-pulse')).toBeNull();
    await waitFor(() => expect(http.post).toHaveBeenCalledWith('/help/seen', {}));
  });

  it('reduced motion: the still dot, on the pill', async () => {
    reduced = true;
    inRouter(<HelpButton feature="lessons" pill />);
    const dot = await screen.findByTestId('help-dot');
    expect(dot.closest('[data-help-face]')).not.toBeNull();
  });

  it('in Urdu it reads «استعمال کا طریقہ»', async () => {
    if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {} });
    await act(async () => { await i18n.changeLanguage('ur'); });
    inRouter(<HelpButton feature="start" pill onDark />);
    expect((await screen.findByTestId('help-button')).textContent).toBe('استعمال کا طریقہ');
  });

  it('without `pill` it is the bare "?" it was: spoken "Help", no words', async () => {
    inRouter(<HelpButton feature="lessons" />);
    const btn = await screen.findByTestId('help-button');
    expect(btn.getAttribute('aria-label')).toBe(HELP_COPY.help);
    expect(btn.textContent).toBe('');
    expect(btn.hasAttribute('data-help-pill')).toBe(false);
  });

  it('switch off: nothing', async () => {
    cfg.features = { helpVideos: false };
    inRouter(<HelpButton feature="start" pill />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByTestId('help-button')).toBeNull();
  });
});

describe('the pill (Observe "?")', () => {
  it('reads "How to use"; a tap opens the Observe tray (film + indicator guides)', async () => {
    inRouter(<ObserveHelpButton pill onDark />);
    const btn = await screen.findByTestId('observe-help-button');
    expect(btn.textContent).toBe('How to use');
    expect(btn.getAttribute('aria-label')).toBeNull();
    expect(btn.querySelector('[data-help-face]')?.className).toMatch(/\bh-10\b/);
    fireEvent.click(btn);
    expect(await screen.findByTestId('observe-help-tray')).toBeTruthy();
  });

  it('a principal (principalFlowV2) gets it too; switch off: nothing', async () => {
    cfg.features = { principalFlowV2: true };
    inRouter(<ObserveHelpButton pill onDark />);
    expect(await screen.findByTestId('observe-help-button')).toBeTruthy();
    cleanup();
    cfg.features = { coachFlowV2: false, principalFlowV2: false };
    inRouter(<ObserveHelpButton pill onDark />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByTestId('observe-help-button')).toBeNull();
  });
});

describe('every role\'s Home', () => {
  it('teacher (and a principal on the teacher Home): HelpCorner draws the pill beside the language pill', async () => {
    expect(code(lookHomeSrc)).toMatch(/<HelpCorner feature="start">/);
    inRouter(<HelpCorner feature="start"><span data-testid="lang" /></HelpCorner>);
    const btn = await screen.findByTestId('help-button');
    expect(btn.hasAttribute('data-help-pill')).toBe(true);
    expect(screen.getByTestId('lang')).toBeTruthy();
  });

  it('coach (the School card Home and the full Home) and principal (HomeV6): the Observe pill in the band\'s corner', () => {
    for (const src of [slimHomeSrc, coachHomeSrc, principalHomeSrc]) {
      expect(code(src)).toMatch(/corner=\{<ObserveHelpButton pill onDark \/>\}/);
    }
  });
});

describe('room on the Home band', () => {
  it('on the navy band the pill keeps the 44 px logo row (its 56 px tap overhangs it)', async () => {
    inRouter(<HelpButton feature="start" pill onDark />);
    expect((await screen.findByTestId('help-button')).className).toMatch(/-my-1\.5/);
    cleanup();
    inRouter(<HelpButton feature="lessons" pill />);
    expect((await screen.findByTestId('help-button')).className).not.toMatch(/-my-1\.5/);
  });

  it('beside the pill the language pill is compact: its word, no glyph; alone it keeps the glyph', async () => {
    const lang = { target: 'ur', status: 'idle', toggle: async () => undefined } as never;
    expect(code(lookHomeSrc)).toMatch(/<HelpCorner feature="start">\{\(help\) => <LanguagePill lang=\{switcher\} compact=\{help\} \/>\}<\/HelpCorner>/);
    inRouter(<HelpCorner feature="start">{(help) => <LanguagePill lang={lang} compact={help} />}</HelpCorner>);
    await screen.findByTestId('help-button');
    expect(screen.getByTestId('home-look-lang').querySelector('svg')).toBeNull();
    expect(screen.getByTestId('home-look-lang').textContent).not.toBe('');
    cleanup();
    cfg.features = { helpVideos: false };
    inRouter(<HelpCorner feature="start">{(help) => <LanguagePill lang={lang} compact={help} />}</HelpCorner>);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByTestId('help-button')).toBeNull();
    expect(screen.getByTestId('home-look-lang').querySelector('svg')).not.toBeNull();
  });

  it('a corner too wide for the phone wraps under the mark instead of running off the band', () => {
    render(<HomeGreeting title="Salaam" date="Today" brand="NIETE" logoAlt="NIETE" corner={<span data-testid="c" />} />);
    const row = (screen.getByTestId('c').closest('span.ms-auto') as HTMLElement).parentElement as HTMLElement;
    expect(row.className).toMatch(/\bflex-wrap\b/);
  });
});
