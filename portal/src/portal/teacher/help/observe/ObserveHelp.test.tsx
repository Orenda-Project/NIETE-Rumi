import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18n from 'i18next';
import { MemoryRouter } from 'react-router-dom';

/**
 * bd-3xf7vb.1 (queue #217) — the "?" on the coach and principal Observe pages, BDD over the real components:
 *
 *   Given the v6 switch is off      no "?" in the header of an Observe or observation screen
 *   Given it is on                  the "?" sits at the end of the header (never on the recording screen)
 *   When she taps it                the tray: the how-to film (or "Video coming soon") and Indicator guide with
 *                                   Grades 1–5 and Grades 6–12; inside a visit its own band comes first, "This visit"
 *   When she opens a band           its indicators: a chip per code first, a search under them; a code opens its card:
 *                                   what it looks at, the example with its level, levels 1–4, and N/A only where
 *                                   approved (#216: v6.1 C2 C3 C5 D4; FICO-S v1.2 C2 C3)
 *   In Urdu                         the same, from the guide's own Urdu
 *   On the Feedback Form            "Examples" under an indicator (bd-o15qnr.37) opens THAT indicator's card in the tray,
 *                                   its band's guide; FICO17 (fico17_v6) → 1–5, FICO-S (fico_s_v1_1 / v1_2) → 6–12; switch
 *                                   off: no guide, so no "Examples"
 *   A principal's own screens       Observe home, My observations, Pick the teacher carry the "?" too
 */

vi.mock('../../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../../lib/recordingSession', () => ({ useRecordingSession: () => null, useLogoutGuard: (f: () => void) => f }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { firstName: 'Sample', lastName: 'Coach', phoneNumber: '923000000000' }, loading: false, logout: vi.fn() }) }));
vi.mock('../../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const cfg = { features: {} as Record<string, boolean> };
vi.mock('../../../lib/useNewUi', async (orig) => ({
  ...(await orig<object>()),
  readConfigShared: () => Promise.resolve({ success: true, features: cfg.features }),
}));

import api from '../../../services/api';
import TeacherPage from '../../TeacherPage';
import { resetHelp } from '../api';
import { ObserveHelp, ObserveHelpButton } from './ObserveHelp';
import { AboutLine } from '../../../coach/reports/FormV7';
import { GUIDES, bandOfRubric, matches, type Guide } from './guides';
import observePageSrc from '../../../coach/observe/ObservePage.tsx?raw';
import reportsFrameSrc from '../../../coach/reports/ReportsFrame.tsx?raw';
import obs612FormSrc from '../../../coach/reports/Obs612Form.tsx?raw';
import principalObserveSrc from '../../principal/ObserveV6.tsx?raw';
import principalPickSrc from '../../principal/PickTeacher.tsx?raw';

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
let helpAnswer: { success: boolean; seen: boolean; videos: unknown[] } | null;

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetHelp();
  cfg.features = { coachFlowV2: true };
  helpAnswer = null;
  http.get.mockImplementation(async (url: string) => {
    if (url === '/help') {
      if (!helpAnswer) throw Object.assign(new Error('404'), { response: { status: 404 } });
      return { data: helpAnswer };
    }
    return { data: {} };
  });
  http.post.mockResolvedValue({ data: { success: true, seen: true } });
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
});

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const page = (band?: '1-5' | '6-12') => render(
  <MemoryRouter>
    <TeacherPage title="Feedback Form" crumb="Observe" backTo="/portal/coach" action={<ObserveHelpButton band={band} />}><p>body</p></TeacherPage>
  </MemoryRouter>,
);
const openTray = async () => {
  fireEvent.click(await screen.findByTestId('observe-help-button'));
  return screen.findByTestId('observe-help-tray');
};
const items = (g: Guide) => g.sections.flatMap((s) => s.items);

describe('the switch', () => {
  it('off (no coachFlowV2 / principalFlowV2): no "?"', async () => {
    cfg.features = { coachFlowV2: false, principalFlowV2: false };
    page();
    await waitFor(() => expect(http.get).not.toHaveBeenCalledWith('/never'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('observe-help-button')).toBeNull();
  });

  it('on for a coach (coachFlowV2) or a principal (principalFlowV2): the "?" is in the header', async () => {
    page();
    expect(await screen.findByTestId('observe-help-button')).toBeTruthy();
    cleanup();
    cfg.features = { principalFlowV2: true };
    page();
    expect(await screen.findByTestId('observe-help-button')).toBeTruthy();
  });

  it('both frames carry it (the tray wraps the whole screen), and neither draws it on the recording screen (bare)', () => {
    for (const src of [observePageSrc, reportsFrameSrc]) {
      const code = stripComments(src);
      expect(code).toMatch(/<ObserveHelp band=\{helpBand\}>/);
      // the header's action is the "?" only when the screen is not bare (a recording); not just any `!bare` in the file
      expect(code).toMatch(/action=\{!bare \? <ObserveHelpButton \/> : undefined\}/);
    }
  });

  it("a FICO-S form names its visit's band; a principal's own Observe screens carry the \"?\"", () => {
    expect(stripComments(obs612FormSrc).match(/helpBand=\{bandOfRubric\(draft\.rubricId\)\}/g)).toHaveLength(2);
    expect(stripComments(principalObserveSrc).match(/action=\{<ObserveHelpButton \/>\}/g)).toHaveLength(2);
    expect(stripComments(principalPickSrc)).toMatch(/action=\{<ObserveHelpButton \/>\}/);
  });
});

describe('the tray', () => {
  it('shows the film slot ("Video coming soon" while none is up) and both bands, 1–5 first', async () => {
    page();
    const tray = await openTray();
    expect(within(tray).getByText('How to observe')).toBeTruthy();
    expect(within(tray).getByTestId('help-coming-soon')).toBeTruthy();
    const rows = within(tray).getAllByTestId('observe-guide-row');
    expect(rows.map((r) => r.getAttribute('data-band'))).toEqual(['1-5', '6-12']);
    expect(within(tray).queryByText('This visit')).toBeNull();
  });

  it('inside a 6–12 visit: 6–12 comes first, marked "This visit"', async () => {
    page('6-12');
    const tray = await openTray();
    const rows = within(tray).getAllByTestId('observe-guide-row');
    expect(rows.map((r) => r.getAttribute('data-band'))).toEqual(['6-12', '1-5']);
    expect(within(rows[0]).getByText('This visit')).toBeTruthy();
  });

  it('plays the observe film when one is up for her', async () => {
    cfg.features = { coachFlowV2: true, helpVideos: true };
    helpAnswer = { success: true, seen: true, videos: [{ feature: 'observe', lang: 'en', title: 'How to observe', url: 'https://cdn.example/help/v1/observe-en.mp4', urlSmall: null, poster: null, seconds: 75, bytes: 4_000_000 }] };
    page();
    const tray = await openTray();
    expect(await within(tray).findByTestId('help-watch')).toBeTruthy();
    expect(within(tray).queryByTestId('help-coming-soon')).toBeNull();
  });
});

describe('the guide', () => {
  it('a band opens its indicators: a chip per code, then search', async () => {
    page();
    const tray = await openTray();
    fireEvent.click(within(tray).getAllByTestId('observe-guide-row')[0]);
    const chips = await screen.findAllByTestId('guide-code');
    expect(chips.map((c) => c.textContent)).toEqual(items(GUIDES['1-5']).map((i) => i.code));
    expect(chips).toHaveLength(17);
    expect(screen.getByTestId('guide-search')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Grades 6–12' }));
    expect(await screen.findAllByTestId('guide-code')).toHaveLength(23);
  });

  it('a code opens its card: looks at, example with level, levels 1–4, its own N/A', async () => {
    page();
    const tray = await openTray();
    fireEvent.click(within(tray).getAllByTestId('observe-guide-row')[0]);
    fireEvent.click((await screen.findAllByTestId('guide-code')).find((c) => c.textContent === 'C2')!);
    const card = await screen.findByTestId('guide-card-C2');
    expect(within(card).getByText('What it looks at')).toBeTruthy();
    expect(within(card).getByText('Example · level 3')).toBeTruthy();
    expect(within(card).getAllByTestId('guide-level')).toHaveLength(4);
    expect(within(card).getByText('N/A · No child was wrong')).toBeTruthy();
  });

  it('search: a code narrows to that card; a word searches names and meanings; nothing found says so', async () => {
    page();
    const tray = await openTray();
    fireEvent.click(within(tray).getAllByTestId('observe-guide-row')[0]);
    const search = (await screen.findByTestId('guide-search')) as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'D4' } });
    expect(screen.getAllByTestId(/^guide-card-/).map((c) => c.getAttribute('data-code'))).toEqual(['D4']);
    fireEvent.change(search, { target: { value: 'group' } });
    expect(screen.getAllByTestId(/^guide-card-/).map((c) => c.getAttribute('data-code'))).toContain('C7');
    fireEvent.change(search, { target: { value: 'zzzz' } });
    expect(screen.getByTestId('guide-none')).toBeTruthy();
  });

  it('in Urdu: the Urdu names and the Urdu N/A', async () => {
    if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {} });
    await act(async () => { await i18n.changeLanguage('ur'); });
    page();
    const tray = await openTray();
    fireEvent.click(within(tray).getAllByTestId('observe-guide-row')[0]);
    fireEvent.click((await screen.findAllByTestId('guide-code')).find((c) => c.textContent === 'C2')!);
    const card = await screen.findByTestId('guide-card-C2');
    expect(card.textContent).toContain('غلط جواب پر بچے کی مدد');
    expect(card.textContent).toContain('لاگو نہیں · کوئی غلط جواب نہیں');
    await act(async () => { await i18n.changeLanguage('en'); });
  });
});

const formPage = (band: '1-5' | '6-12' | undefined, rubric: string, code: string) => render(
  <MemoryRouter>
    <ObserveHelp band={band}>
      <TeacherPage title="Feedback Form" crumb="Observe" backTo="/portal/coach" action={<ObserveHelpButton />}>
        <AboutLine text="What the indicator looks at." rubric={rubric} code={code} />
      </TeacherPage>
    </ObserveHelp>
  </MemoryRouter>,
);

describe('the Feedback Form (bd-o15qnr.37 Examples)', () => {
  it('"Examples" under a FICO17 indicator opens its card in the 1–5 guide, inside the tray', async () => {
    formPage('1-5', 'fico17_v6', 'C2');
    fireEvent.click(await screen.findByRole('button', { name: 'Examples' }));
    const tray = await screen.findByTestId('observe-help-tray');
    expect(within(tray).getAllByTestId('guide-code')).toHaveLength(17);
    const card = within(tray).getByTestId('guide-card-C2');
    expect(within(card).getByText('What it looks at')).toBeTruthy();
    expect(within(card).getByText('N/A · No child was wrong')).toBeTruthy();
    expect(within(tray).getAllByText('What it looks at')).toHaveLength(1);
  });

  it('a FICO-S indicator (v1.2 or a v1.1 draft) opens in the 6–12 guide', async () => {
    formPage('6-12', 'fico_s_v1_1', 'A3');
    fireEvent.click(await screen.findByRole('button', { name: 'Examples' }));
    const tray = await screen.findByTestId('observe-help-tray');
    expect(within(tray).getAllByTestId('guide-code')).toHaveLength(23);
    expect(within(within(tray).getByTestId('guide-card-A3')).getByText('What it looks at')).toBeTruthy();
  });

  it('the "?" after Examples opens the menu again, not the last indicator', async () => {
    formPage('1-5', 'fico17_v6', 'C2');
    fireEvent.click(await screen.findByRole('button', { name: 'Examples' }));
    await screen.findByTestId('guide-card-C2');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(await screen.findByTestId('observe-help-button'));
    const tray = await screen.findByTestId('observe-help-tray');
    expect(within(tray).getAllByTestId('observe-guide-row')).toHaveLength(2);
  });

  it('a code the guide does not have, or another rubric: no Examples', async () => {
    formPage('1-5', 'fico17_v6', 'Z9');
    expect(await screen.findByTestId('observe-help-button')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Examples' })).toBeNull();
    cleanup();
    formPage(undefined, 'obs612-gen', 'C2');
    expect(await screen.findByTestId('observe-help-button')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Examples' })).toBeNull();
  });

  it('switch off: no guide for the form, so no Examples (and no "?")', async () => {
    cfg.features = { coachFlowV2: false, principalFlowV2: false };
    formPage('1-5', 'fico17_v6', 'C2');
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: 'Examples' })).toBeNull();
    expect(screen.queryByTestId('observe-help-button')).toBeNull();
  });
});

describe('the guide data', () => {
  it('N/A sits exactly where #216 approved it', () => {
    expect(items(GUIDES['1-5']).filter((i) => i.na).map((i) => i.code)).toEqual(['C2', 'C3', 'C5', 'D4']);
    expect(items(GUIDES['6-12']).filter((i) => i.na).map((i) => i.code)).toEqual(['C2', 'C3']);
  });

  it('every indicator has its meaning, example and four levels in both languages', () => {
    for (const g of Object.values(GUIDES)) {
      for (const it of items(g)) {
        for (const lang of ['en', 'ur'] as const) {
          expect(it.name[lang], `${it.code} name ${lang}`).toBeTruthy();
          expect(it.means[lang], `${it.code} means ${lang}`).toBeTruthy();
          expect(it.example[lang], `${it.code} example ${lang}`).toBeTruthy();
          expect(it.levels.map((l) => l.n)).toEqual([1, 2, 3, 4]);
          it.levels.forEach((l) => expect(l[lang], `${it.code} L${l.n} ${lang}`).toBeTruthy());
        }
      }
    }
  });

  it('Urdu text keeps Western digits 0-9, as the bot (teacher-facing; vocabulary.guard.test.ts): no ۰-۹ / ٠-٩', () => {
    const urTexts = Object.values(GUIDES).flatMap((g) => [g.intro.ur, g.legend.ur, g.grades.ur, ...items(g).flatMap((i) => [
      i.name.ur, i.means.ur, i.example.ur, ...i.levels.map((l) => l.ur), i.na?.title.ur ?? '', i.na?.when.ur ?? '', i.note?.ur ?? '', i.where?.ur ?? '',
    ])]);
    expect(urTexts.filter((s) => /[\u0660-\u0669\u06F0-\u06F9]/.test(s))).toEqual([]);
  });

  it('bandOfRubric: FICO-S visits are 6–12, FICO17 visits 1–5, anything else none', () => {
    expect(bandOfRubric('fico_s_v1_1')).toBe('6-12');
    expect(bandOfRubric('fico17_v6')).toBe('1-5');
    expect(bandOfRubric('obs612-x')).toBeUndefined();
    expect(bandOfRubric(undefined)).toBeUndefined();
  });

  it('matches: a code prefix matches codes only; words must all appear', () => {
    const c2 = items(GUIDES['1-5']).find((i) => i.code === 'C2')!;
    expect(matches(c2, 'c2')).toBe(true);
    expect(matches(c2, 'C')).toBe(true);
    expect(matches(c2, 'D')).toBe(false);
    expect(matches(c2, 'wrong child')).toBe(true);
    expect(matches(c2, 'wrong elephant')).toBe(false);
    expect(matches(c2, '')).toBe(true);
  });
});
