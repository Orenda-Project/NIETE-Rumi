import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The R5 LOW batch (teacher QA + the red team), each through the real component:
 *  1. a count of one is singular ("1 sound" / «۱ آواز»), Urdu digits in <bdi>;
 *  2. the time-bar labels never break mid-word ("Conclusi-on");
 *  3. the Urdu video label says «ایم بی», not a Latin "MB";
 *  5. the screener's "Answer key audio" chip only when the plan has audio (the send rows; the 6–12 level chooser that
 *     also showed it is gone with bd-elc1qz);
 *  6. a leader whose sending is not switched on reads that, not "this page is for coaches";
 *  7. the plan footer labels the id "ID", never "lesson".
 */
vi.mock('../player', async (orig) => (await import('./fixtures/playerMock')).withStandIns(await orig()));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(async () => ({ data: { success: true, combos: [] } })), post: vi.fn() } }));

import { FlnProvider } from '../FlnContext';
import { LessonList } from '../LessonList';
import { TimeBar } from '../plan/TimeBar';
import { MediaVideo } from '../plan/MediaVideo';
import SendPage from '../send/SendPage';
import { stubFetch as stubShare, ME_LEADER, ME_TEACHER as ME_TEACHER_SHARE } from '../share/testFetch';
import { ME_TEACHER, rhEnG1, rhUrG1, stubFetch } from './listFixtures';
import { renderPlan } from './fixtures/renderPlan';
import { rhEn, rhUr, screenerEn } from './fixtures/plans';
import type { FlnCatalogue, FlnMe, FlnMedia, FlnPlan, FlnPlanResponse } from '../types';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.head.querySelectorAll('style[data-low-r5]').forEach((n) => n.remove()); });
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });

function renderList(cat: FlnCatalogue, me: FlnMe = ME_TEACHER) {
  stubFetch({ '/catalogue': { status: 200, body: cat } });
  const subject = cat.subject.key;
  return render(
    <MemoryRouter initialEntries={[`/portal/fln/list/${subject}?grade=1`]}>
      <FlnProvider me={me}>
        <Routes>
          <Route path="/portal/fln/list/:subject" element={<LessonList subject={subject} grade={1} level={null} />} />
        </Routes>
      </FlnProvider>
    </MemoryRouter>,
  );
}
const rowById = (id: number) => vi.waitFor(() => {
  const r = document.querySelector(`[data-fln-row="${id}"]`);
  if (!r) throw new Error(`row ${id} not drawn`);
  return r as HTMLElement;
});
const withAudio = (p: FlnPlanResponse, a: { sounds: number; words: number; narration: boolean }): FlnPlanResponse =>
  ({ ...p, plan: { ...p.plan, audio_summary: a } as FlnPlan });

describe('1 — a count of one is singular', () => {
  it('plan header: one sound reads "1 sound", never "1 sounds"', async () => {
    renderPlan(withAudio(rhEn, { sounds: 1, words: 0, narration: false }));
    await screen.findByText(rhEn.plan.title);
    const chips = document.querySelector('.fln-hchips')!.textContent!;
    expect(chips).toContain('🔊 1 sound');
    expect(chips).not.toContain('1 sounds');
  });

  it('Urdu plan header: «۱ آواز» with ۱ in <bdi>; three is «۳ آوازیں»', async () => {
    renderPlan(withAudio(rhUr, { sounds: 1, words: 0, narration: false }), { lang: 'ur' });
    await screen.findByText(rhUr.plan.title);
    const chip = Array.from(document.querySelectorAll('.fln-hc')).find((n) => n.textContent!.includes('آواز'))!;
    expect(chip.textContent).toBe('🔊 ۱ آواز');
    expect(chip.querySelector('bdi')!.textContent).toBe('۱');
    cleanup();
    renderPlan(withAudio(rhUr, { sounds: 3, words: 0, narration: false }), { lang: 'ur' });
    await screen.findByText(rhUr.plan.title);
    expect(document.querySelector('.fln-hchips')!.textContent).toContain('۳ آوازیں');
  });

  it('Urdu list: the one-sound row reads «۱ آواز», its digit inside <bdi>', async () => {
    renderList(rhUrG1(), { ...ME_TEACHER, ui_lang: 'ur' });
    const r = await rowById(9104);
    const chip = r.querySelector('.fln-mini-s')!;
    expect(chip.textContent).toBe('🔊 ۱ آواز');
    expect(chip.querySelector('bdi')?.textContent).toBe('۱');
    const six = (await rowById(9103)).querySelector('.fln-mini-s')!;
    expect(six.textContent).toBe('🔊 ۶ آوازیں');
  });
});

describe('2 — time-bar labels never break mid-word', () => {
  it('the label span: no hyphenation, no break inside a word', () => {
    const style = document.createElement('style');
    style.setAttribute('data-low-r5', '');
    style.textContent = readFileSync(resolve(__dirname, '../plan/plan.css'), 'utf8');
    document.head.appendChild(style);
    const { container } = render(
      <div className="fln-root" lang="en"><div className="fln-plan"><TimeBar plan={rhEn.plan} uiLang="en" /></div></div>,
    );
    const lab = container.querySelector('.fln-timebar-lab span')!;
    const cs = getComputedStyle(lab);
    expect(cs.getPropertyValue('hyphens')).toBe('none');
    expect(cs.getPropertyValue('overflow-wrap')).toBe('normal');
    expect(cs.getPropertyValue('word-break')).toBe('keep-all');
  });
});

describe('3 — the Urdu video label', () => {
  it('«دیکھیں — ۲ منٹ — ۹ ایم بی», no Latin MB', () => {
    const m: FlnMedia = { kind: 'video', src: 'https://m.example.org/v.mp4', duration_s: 120, bytes: 9_000_000 };
    const { container } = render(<MediaVideo media={m} uiLang="ur" />);
    const btn = container.querySelector('button')!;
    expect(btn.textContent).toContain('ایم بی');
    expect(btn.textContent).not.toMatch(/MB/);
  });
});

describe('5 — the screener answer-key chip only with audio', () => {
  const silentScreener = (): FlnCatalogue => {
    const c = rhEnG1();
    const p = c.strands[0].chapters[0].plans.find((r) => r.id === 9002)!;
    p.chips = { screener: true, sounds: 0, words: 0, narration: false };
    return c;
  };
  it('list: a screener with 0 clips shows no "Answer key audio" chip', async () => {
    renderList(silentScreener());
    const r = await rowById(9002);
    expect(r.textContent).not.toContain('Answer key audio');
  });
  it('list: a screener with sounds keeps it', async () => {
    renderList(rhEnG1());
    const r = await rowById(9002);
    expect(r.textContent).toContain('Answer key audio · teacher only');
  });
  it('plan header: a screener with no audio shows no answer-key chip', async () => {
    renderPlan(withAudio(screenerEn, { sounds: 0, words: 0, narration: false }));
    await screen.findByText(screenerEn.plan.title);
    expect(document.querySelector('.fln-hchips')!.textContent).not.toContain('Answer key audio');
  });
  it('plan header: a screener with sounds keeps it', async () => {
    renderPlan(screenerEn);
    await screen.findByText(screenerEn.plan.title);
    expect(document.querySelector('.fln-hchips')!.textContent).toContain('Answer key audio · teacher only');
  });
});

function mountSend() {
  return render(
    <MemoryRouter initialEntries={['/portal/fln/send']}>
      <Routes><Route path="/portal/fln/send" element={<SendPage />} /></Routes>
    </MemoryRouter>,
  );
}

describe('6 — a leader without share on /portal/fln/send', () => {
  it('a coach with share off reads "Sending isn\'t switched on for your account yet."', async () => {
    stubShare({ '/api/portal/fln/me': { status: 200, body: { ...ME_LEADER, share: false } } });
    mountSend();
    expect(await screen.findByText("Sending isn't switched on for your account yet.")).toBeTruthy();
    expect(screen.queryByText(/This page is for coaches/)).toBeNull();
  });
  it('Urdu: «آپ کے اکاؤنٹ کے لیے بھیجنا ابھی شروع نہیں ہوا۔»', async () => {
    stubShare({ '/api/portal/fln/me': { status: 200, body: { ...ME_LEADER, share: false, ui_lang: 'ur' } } });
    mountSend();
    expect(await screen.findByText('آپ کے اکاؤنٹ کے لیے بھیجنا ابھی شروع نہیں ہوا۔')).toBeTruthy();
  });
  it('a teacher keeps the existing copy', async () => {
    stubShare({ '/api/portal/fln/me': { status: 200, body: ME_TEACHER_SHARE } });
    mountSend();
    expect(await screen.findByText('This page is for coaches, principals and other school leaders.')).toBeTruthy();
  });
});

describe('7 — the footer labels the id "ID", not "lesson"', () => {
  it('EN: "FDE FLN programme 2025 · ID 90001"', async () => {
    renderPlan(rhEn);
    await screen.findByText(rhEn.plan.title);
    expect(document.querySelector('.fln-plan-foot')!.textContent).toBe('FDE FLN programme 2025 · ID 90001');
  });
  it('UR p23: «… — آئی ڈی ۹۰۰۰۲», the id in <bdi>, no «سبق»', async () => {
    renderPlan({ ...rhUr, plan: { ...rhUr.plan, programme: 'p23' } as FlnPlan }, { lang: 'ur' });
    await screen.findByText(rhUr.plan.title);
    const foot = document.querySelector('.fln-plan-foot')!;
    expect(foot.textContent).toBe('اضافی مشق — ۲۰۲۳–۲۴ پروگرام — آئی ڈی ۹۰۰۰۲');
    expect(foot.textContent).not.toContain('سبق');
    expect(within(foot as HTMLElement).getByText('۹۰۰۰۲').tagName).toBe('BDI');
  });
});

describe('5 — the screener chip on the send rows', () => {
  const sendRow = (id: number, chips: Record<string, unknown>, label: string | null = null) => ({
    id, title: `Plan ${id}`, lang: 'en', dir: 'ltr', minutes: 30, chips, opened: false, label,
    url: `https://portal.example.test/portal/fln/p/${id}`, level: 1, grades: [1], chapter_title_en: 'Unit 1', chapter_title_ur: null, pos: 1, count: 3,
  });
  const sendRows = (rows: unknown[]) => {
    stubShare({ '/api/portal/fln/me': { status: 200, body: ME_LEADER }, '/api/portal/fln/links': { status: 200, body: { rows } } });
    return render(
      <MemoryRouter initialEntries={['/portal/fln/send?grade=1&subject=num&level=1']}>
        <Routes><Route path="/portal/fln/send" element={<SendPage />} /></Routes>
      </MemoryRouter>,
    );
  };
  it('send: a silent screener row has no answer-key chip; a screener with sounds keeps it', async () => {
    sendRows([sendRow(10, { screener: true, sounds: 0, words: 0, narration: false }, 'screener'), sendRow(11, { screener: true, sounds: 4 }, 'screener')]);
    const silent = await screen.findByTestId('fln-send-row-10');
    expect(silent.textContent).not.toContain('Answer key audio');
    expect(screen.getByTestId('fln-send-row-11').textContent).toContain('Answer key audio · teacher only');
  });
  it('send: one sound reads "1 sound"', async () => {
    sendRows([sendRow(12, { sounds: 1 }), sendRow(13, { sounds: 3 })]);
    expect((await screen.findByTestId('fln-send-row-12')).textContent).toContain('1 sound');
    expect(screen.getByTestId('fln-send-row-12').textContent).not.toContain('1 sounds');
    expect(screen.getByTestId('fln-send-row-13').textContent).toContain('3 sounds');
  });
});
