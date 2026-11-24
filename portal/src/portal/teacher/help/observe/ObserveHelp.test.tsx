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
 *   When she opens a band           its indicators from Dr Rifat Yasmeen's FICO Observer Manual (the operator 23 Nov:
 *                                   "This is the artifact we want to attach as a guide for fico in the ?"): her name and
 *                                   a link to the full manual at that part, a chip per code first, a search under them;
 *                                   a code opens its card in her words: what it measures, who sets it, how it is scored
 *                                   or where to look, levels 1–4 each with its example (closed until tapped) and why,
 *                                   her watch-outs; with the form's own name, level names and N/A (#216: v6.1 C2 C3 C5
 *                                   D4; FICO-S v1.2 C2 C3), and a link to that indicator in her manual
 *   Who sets a level                1–5: "Digital Coach suggests · you check" or "Set from the room"; 6–12 (her 24 Nov
 *                                   edit, queue #259): "Pre-filled in the app · you review" for 22, E2 included as the
 *                                   bot pre-fills it (queue #267, the operator 24 Nov ~19:00: "For E2, lets for now let
 *                                   the manual match the indicator"); "You fill this yourself" for E3 only
 *   The data                        loads only when a guide opens (the coach's first-open budget); the form knows the
 *                                   codes from a small index
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
import { BANDS, INDEX, bandOfRubric, hasIndicator, matches, type Guide } from './guides';
import V6 from './fico_v6.manual';
import MH from './fico_mh.manual';
import guidesSrc from './guides.ts?raw';
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
const GUIDE: Record<'1-5' | '6-12', Guide> = { '1-5': V6 as unknown as Guide, '6-12': MH as unknown as Guide };
const items = (g: Guide) => g.sections.flatMap((s) => s.items);
const MANUAL = 'https://claude.ai/artifact/S8YWPruD7MhtcSGttXXByJ?sk=KLt0neaCUZQKQRmcNnEb5A';
const C2_LOOK = 'It only applies when an answer was actually wrong.';
/** Rifat's FICO M/H "how", 24 Nov (queue #259): pre-filled from the recording, or the observer's own. Queue #267: E2 is
 * pre-filled too (the bot holds back only E3), so 22 pre-filled and E3 alone by hand. */
const MH_PRE = 'The app pre-fills the level and evidence from the lesson recording. Review it against your notes. You may change it; if you do, fix the evidence so it supports the new level.';
const MH_SELF = 'You fill this yourself in the app, in every observation: it comes from your own check at the end of the lesson, not from the recording.';
const MH_PRE_UR = 'ایپ سبق کی ریکارڈنگ سے لیول اور ثبوت پہلے سے بھر دیتی ہے۔';

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
    expect(rows[0].textContent).toContain('FICO v6 · 17 indicators');
    expect(rows[1].textContent).toContain('FICO M/H · 23 indicators');
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

describe("the guide (Dr Rifat Yasmeen's FICO Observer Manual)", () => {
  it('a band opens its indicators: her manual named and linked at that part, a chip per code, then search', async () => {
    page();
    const tray = await openTray();
    fireEvent.click(within(tray).getAllByTestId('observe-guide-row')[0]);
    const chips = await screen.findAllByTestId('guide-code');
    expect(chips.map((c) => c.textContent)).toEqual(items(GUIDE['1-5']).map((i) => i.code));
    expect(chips).toHaveLength(17);
    expect(screen.getByTestId('guide-search')).toBeTruthy();
    expect(screen.getByText('Designed and reviewed by Dr Rifat Yasmeen')).toBeTruthy();
    const full = screen.getByTestId('guide-manual') as HTMLAnchorElement;
    expect(full.getAttribute('href')).toBe(`${MANUAL}#v6-start`);
    expect(full.getAttribute('target')).toBe('_blank');
    expect(full.textContent).toContain('Open the full manual');
    fireEvent.click(screen.getByRole('button', { name: 'Grades 6–12' }));
    expect(await screen.findAllByTestId('guide-code')).toHaveLength(23);
    expect(screen.getByTestId('guide-manual').getAttribute('href')).toBe(`${MANUAL}#s-start`);
  });

  it('a code opens its card in her words: measures, who sets it, how scored, levels 1–4 with closed examples, watch out, the N/A, the manual there', async () => {
    page();
    const tray = await openTray();
    fireEvent.click(within(tray).getAllByTestId('observe-guide-row')[0]);
    fireEvent.click((await screen.findAllByTestId('guide-code')).find((c) => c.textContent === 'C2')!);
    const card = await screen.findByTestId('guide-card-C2');
    expect(within(card).getByText('What it measures')).toBeTruthy();
    expect(card.textContent).toContain(C2_LOOK);
    expect(within(card).getByText('Digital Coach suggests · you check')).toBeTruthy();
    expect(within(card).getByText('How it is scored')).toBeTruthy();
    const levels = within(card).getAllByTestId('guide-level');
    expect(levels).toHaveLength(4);
    expect(levels.map((l) => within(l).getByTestId('guide-level-name').textContent)).toEqual(['Not Observed', 'Developing', 'Proficient', 'Highly Effective']);
    const examples = within(card).getAllByTestId('guide-example') as HTMLDetailsElement[];
    expect(examples).toHaveLength(4);
    expect(examples.every((d) => d.tagName === 'DETAILS' && !d.open)).toBe(true);
    expect(within(examples[2]).getByText('Example')).toBeTruthy();
    expect(examples[2].textContent).toContain('Why this level');
    expect(within(card).getByText('Watch out')).toBeTruthy();
    expect(within(card).getByText('N/A · No child was wrong')).toBeTruthy();
    const here = within(card).getByTestId('guide-card-manual');
    expect(here.getAttribute('href')).toBe(`${MANUAL}#v6-ind-C2`);
    expect(here.getAttribute('target')).toBe('_blank');
  });

  it('a level she sets from the room says so; a 6–12 card has what to look for, and who sets it (her 24 Nov edit, queue #259)', async () => {
    page();
    const tray = await openTray();
    fireEvent.click(within(tray).getAllByTestId('observe-guide-row')[0]);
    fireEvent.click((await screen.findAllByTestId('guide-code')).find((c) => c.textContent === 'C3')!);
    expect(within(await screen.findByTestId('guide-card-C3')).getByText('Set from the room')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Grades 6–12' }));
    fireEvent.click((await screen.findAllByTestId('guide-code')).find((c) => c.textContent === 'A2')!);
    const a2 = await screen.findByTestId('guide-card-A2');
    expect(within(a2).getByText('What to look for')).toBeTruthy();
    expect(within(a2).getAllByTestId('guide-look-for')).toHaveLength(4);
    // Rifat, 24 Nov: the app pre-fills the levels and their evidence from the recording; the observer reviews (22 of 23, #267).
    expect(within(a2).getByText('Pre-filled in the app · you review')).toBeTruthy();
    expect(within(a2).getByText('How it is scored')).toBeTruthy();
    expect(within(a2).queryByText('Where to look')).toBeNull();
    expect(within(a2).queryByText('Set from the room')).toBeNull();
    expect(a2.textContent).toContain(MH_PRE);
    expect(within(a2).getByTestId('guide-card-manual').getAttribute('href')).toBe(`${MANUAL}#s-ind-A2`);
    // Queue #267: E2 is pre-filled by the Digital Coach, as the bot does (only E3 is starred); the observer reviews it.
    fireEvent.click(screen.getAllByTestId('guide-code').find((c) => c.textContent === 'E2')!);
    const e2 = await screen.findByTestId('guide-card-E2');
    expect(within(e2).getByText('Pre-filled in the app · you review')).toBeTruthy();
    expect(within(e2).queryByText('You fill this yourself')).toBeNull();
    expect(within(e2).getByText('How it is scored')).toBeTruthy();
    expect(e2.textContent).toContain(MH_PRE);
    expect(e2.textContent).not.toContain(MH_SELF);
    // E3 alone comes from the observer's own check at the end of the lesson.
    fireEvent.click(screen.getAllByTestId('guide-code').find((c) => c.textContent === 'E3')!);
    const e3 = await screen.findByTestId('guide-card-E3');
    expect(within(e3).getByText('You fill this yourself')).toBeTruthy();
    expect(within(e3).queryByText('Pre-filled in the app · you review')).toBeNull();
    expect(e3.textContent).toContain(MH_SELF);
  });

  it('search: a code narrows to that card; a word searches names and meanings; nothing found says so', async () => {
    page();
    const tray = await openTray();
    fireEvent.click(within(tray).getAllByTestId('observe-guide-row')[0]);
    const search = (await screen.findByTestId('guide-search')) as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'D4' } });
    expect(screen.getAllByTestId(/^guide-card-[A-F]\d$/).map((c) => c.getAttribute('data-code'))).toEqual(['D4']);
    fireEvent.change(search, { target: { value: 'group' } });
    expect(screen.getAllByTestId(/^guide-card-[A-F]\d$/).map((c) => c.getAttribute('data-code'))).toContain('C7');
    fireEvent.change(search, { target: { value: 'zzzz' } });
    expect(screen.getByTestId('guide-none')).toBeTruthy();
  });

  it("in Urdu: the form's Urdu name, level names and N/A; her Urdu words", async () => {
    if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {} });
    await act(async () => { await i18n.changeLanguage('ur'); });
    page();
    const tray = await openTray();
    fireEvent.click(within(tray).getAllByTestId('observe-guide-row')[0]);
    fireEvent.click((await screen.findAllByTestId('guide-code')).find((c) => c.textContent === 'C2')!);
    const card = await screen.findByTestId('guide-card-C2');
    expect(card.textContent).toContain('غلط جواب پر بچے کی مدد');
    expect(card.textContent).toContain('لاگو نہیں · کوئی غلط جواب نہیں');
    expect(card.textContent).toContain('مشاہدے میں نہیں آیا');
    expect(card.textContent).toContain('یہ صرف تب لاگو ہوتا ہے جب واقعی کوئی جواب غلط ہو');
    expect(screen.getByText('ڈیزائن اور نظرِ ثانی: ڈاکٹر رفعت یاسمین')).toBeTruthy();
    await act(async () => { await i18n.changeLanguage('en'); });
  });

  it('in Urdu, a 6–12 card says who sets it in her Urdu (24 Nov): pre-filled, or yours', async () => {
    if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {} });
    await act(async () => { await i18n.changeLanguage('ur'); });
    try { // English again even when it fails, so the tests after it read English
      page('6-12');
      const tray = await openTray();
      fireEvent.click(within(tray).getAllByTestId('observe-guide-row')[0]);
      fireEvent.click((await screen.findAllByTestId('guide-code')).find((c) => c.textContent === 'A1')!);
      const a1 = await screen.findByTestId('guide-card-A1');
      expect(within(a1).getByText('ایپ میں پہلے سے بھرا · آپ جانچتے ہیں')).toBeTruthy();
      expect(within(a1).getByText('لیول کیسے لگتا ہے')).toBeTruthy();
      expect(a1.textContent).toContain(MH_PRE_UR);
      // Queue #267: E2 reads pre-filled in Urdu too, in her own pre-filled words.
      fireEvent.click(screen.getAllByTestId('guide-code').find((c) => c.textContent === 'E2')!);
      const e2 = await screen.findByTestId('guide-card-E2');
      expect(within(e2).getByText('ایپ میں پہلے سے بھرا · آپ جانچتے ہیں')).toBeTruthy();
      expect(within(e2).queryByText('یہ آپ خود بھرتے ہیں')).toBeNull();
      expect(e2.textContent).toContain(MH_PRE_UR);
      expect(e2.textContent).not.toContain('ریکارڈنگ سے نہیں');
      fireEvent.click(screen.getAllByTestId('guide-code').find((c) => c.textContent === 'E3')!);
      const e3 = await screen.findByTestId('guide-card-E3');
      expect(within(e3).getByText('یہ آپ خود بھرتے ہیں')).toBeTruthy();
      expect(e3.textContent).toContain('ریکارڈنگ سے نہیں');
    } finally {
      await act(async () => { await i18n.changeLanguage('en'); });
    }
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
    expect(await within(tray).findAllByTestId('guide-code')).toHaveLength(17);
    const card = within(tray).getByTestId('guide-card-C2');
    expect(within(card).getByText('What it measures')).toBeTruthy();
    expect(within(card).getByText('N/A · No child was wrong')).toBeTruthy();
    expect(within(tray).getAllByText('What it measures')).toHaveLength(1);
  });

  it('a FICO-S indicator (v1.2 or a v1.1 draft) opens in the 6–12 guide', async () => {
    formPage('6-12', 'fico_s_v1_1', 'A3');
    fireEvent.click(await screen.findByRole('button', { name: 'Examples' }));
    const tray = await screen.findByTestId('observe-help-tray');
    expect(await within(tray).findAllByTestId('guide-code')).toHaveLength(23);
    expect(within(within(tray).getByTestId('guide-card-A3')).getByText('What it measures')).toBeTruthy();
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
  it("is Rifat's manual: her provenance, her credit, her canvas; no training-clip links copied (public repo)", () => {
    for (const b of BANDS) {
      const g = GUIDE[b] as unknown as { provenance: string; manual: { url: string; part: string }; credit: { en: string } };
      expect(g.provenance).toContain('S8YWPruD7MhtcSGttXXByJ');
      expect(g.manual.url).toBe(MANUAL);
      expect(g.credit.en).toBe('Designed and reviewed by Dr Rifat Yasmeen');
    }
    expect(items(GUIDE['1-5']).find((i) => i.code === 'C2')!.means.en).toContain(C2_LOOK);
    expect(JSON.stringify([V6, MH])).not.toMatch(/claude\.ai\/artifact\/(?!S8YWPruD7MhtcSGttXXByJ)/);
  });

  it('who sets each level (her 24 Nov manual, queue #259; E2 as the bot, queue #267): 1–5 Digital Coach or the room; 6–12 pre-filled but E3', () => {
    const who = (b: '1-5' | '6-12') => Object.fromEntries(items(GUIDE[b]).map((i) => [i.code, i.who]));
    expect(who('1-5')).toEqual({
      C1: 'dc', C2: 'dc', C3: 'hitl', C4: 'dc', C5: 'hitl', C6: 'dc', C7: 'hitl', C8: 'dc',
      D1: 'dc', D2: 'hitl', D3: 'hitl', D4: 'hitl', D5: 'dc', F1: 'dc', F2: 'dc', F3: 'dc', F4: 'dc',
    });
    const mh = items(GUIDE['6-12']);
    expect(mh.filter((i) => i.who === 'self').map((i) => i.code)).toEqual(['E3']);
    expect(mh.filter((i) => i.who === 'pre')).toHaveLength(22);
    expect(mh.find((i) => i.code === 'E2')!.who).toBe('pre');
    expect(mh.find((i) => i.code === 'E2')!.how.ur).toContain(MH_PRE_UR);
    // The one place the guide departs from her canvas is said in the data itself, so the next sync keeps it.
    expect((GUIDE['6-12'] as unknown as { provenance: string }).provenance).toContain('E2');
    for (const i of mh) expect(i.how.en, i.code).toBe(i.who === 'self' ? MH_SELF : MH_PRE);
  });

  it('N/A sits exactly where #216 approved it', () => {
    expect(items(GUIDE['1-5']).filter((i) => i.na).map((i) => i.code)).toEqual(['C2', 'C3', 'C5', 'D4']);
    expect(items(GUIDE['6-12']).filter((i) => i.na).map((i) => i.code)).toEqual(['C2', 'C3']);
  });

  it('every indicator: name, what it measures, how, four levels each with words, example and why, in both languages', () => {
    for (const g of Object.values(GUIDE)) {
      for (const it of items(g)) {
        expect(it.levels.map((l) => l.n)).toEqual([1, 2, 3, 4]);
        for (const lang of ['en', 'ur'] as const) {
          expect(it.name[lang], `${it.code} name ${lang}`).toBeTruthy();
          expect(it.means[lang], `${it.code} means ${lang}`).toBeTruthy();
          expect(it.how[lang], `${it.code} how ${lang}`).toBeTruthy();
          it.levels.forEach((l) => {
            expect(l.text[lang], `${it.code} L${l.n} ${lang}`).toBeTruthy();
            expect(l.example[lang], `${it.code} L${l.n} example ${lang}`).toBeTruthy();
            expect(l.why[lang], `${it.code} L${l.n} why ${lang}`).toBeTruthy();
          });
          it.tips.forEach((t) => expect(t[lang], `${it.code} tip ${lang}`).toBeTruthy());
        }
      }
    }
  });

  it('Urdu text keeps Western digits 0-9, as the bot: no ۰-۹ / ٠-٩', () => {
    const ur: string[] = [];
    const walk = (v: unknown, k = ''): void => {
      if (typeof v === 'string') { if (k === 'ur') ur.push(v); return; }
      if (Array.isArray(v)) v.forEach((x) => walk(x));
      else if (v && typeof v === 'object') Object.entries(v).forEach(([kk, x]) => walk(x, kk));
    };
    walk([V6, MH]);
    expect(ur.length).toBeGreaterThan(500);
    expect(ur.filter((s) => /[٠-٩۰-۹]/.test(s))).toEqual([]);
  });

  it("loads only when a guide opens (coach first-open budget); the form's index has each band's codes", () => {
    const code = stripComments(guidesSrc);
    expect(code).not.toMatch(/import\s+\w+\s+from\s+'\.\/fico_(v6|mh)\.manual'/);
    expect(code).toMatch(/import\('\.\/fico_v6\.manual'\)/);
    expect(code).toMatch(/import\('\.\/fico_mh\.manual'\)/);
    for (const b of BANDS) expect(INDEX.bands[b].codes).toEqual(items(GUIDE[b]).map((i) => i.code));
    expect(hasIndicator('1-5', 'D5')).toBe(true);
    expect(hasIndicator('1-5', 'E1')).toBe(false);
    expect(hasIndicator('6-12', 'E1')).toBe(true);
  });

  it('bandOfRubric: FICO-S visits are 6–12, FICO17 visits 1–5, anything else none', () => {
    expect(bandOfRubric('fico_s_v1_1')).toBe('6-12');
    expect(bandOfRubric('fico17_v6')).toBe('1-5');
    expect(bandOfRubric('obs612-x')).toBeUndefined();
    expect(bandOfRubric(undefined)).toBeUndefined();
  });

  it('matches: a code prefix matches codes only; words must all appear', () => {
    const c2 = items(GUIDE['1-5']).find((i) => i.code === 'C2')!;
    expect(matches(c2, 'c2')).toBe(true);
    expect(matches(c2, 'C')).toBe(true);
    expect(matches(c2, 'D')).toBe(false);
    expect(matches(c2, 'wrong child')).toBe(true);
    expect(matches(c2, 'wrong elephant')).toBe(false);
    expect(matches(c2, '')).toBe(true);
  });
});
