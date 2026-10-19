import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';

/**
 * The plan page: 404 → "This lesson isn't available" + the list button; 503 → calm line + retry;
 * kicker from placement pos/count (never `seq`); no Share slot for a teacher; Back for a link-opened plan; telemetry
 * batched (plan id added, ≤1 batch / 5 s, flush on pagehide); the page never logs an open itself.
 */
vi.mock('../player', async (orig) => (await import('./fixtures/playerMock')).withStandIns(await orig()));
// The teacher's own grades (`loadGradeSubjects('lessons')`) come over the portal's axios client — its network boundary.
vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from '../../services/api';
const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const combos = (...grades: Array<number | null>) => ({
  data: { success: true, combos: grades.map((g) => ({ grade: g, gradeCode: `g${g}`, subject: 'English', subjectKey: 'english', source: 'class' })) },
});

import { eventSinks, resetPlayerMock, useFlnPlayerSpy } from './fixtures/playerMock';
import { renderPlan } from './fixtures/renderPlan';
import { numEn, rhEn, rhUr } from './fixtures/plans';
import { linkBackTarget } from '../PlanPage';

beforeEach(() => {
  resetPlayerMock();
  window.history.replaceState(null, '');
  http.get.mockReset();
  http.get.mockResolvedValue(combos());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('plan page states', () => {
  it('404 → not-available page with the lesson-list button', async () => {
    renderPlan(null, { status: 404, entries: ['/portal/fln/p/123'] });
    expect(await screen.findByText("This lesson isn't available")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to the lesson list' }));
    expect(screen.getByTestId('probe').textContent).toBe('/portal/teacher/lessons');
  });

  it('503 → the calm line and a retry that refetches', async () => {
    const { calls } = renderPlan(rhEn, { status: 503 });
    expect(await screen.findByText("Reading Hour plans aren't available right now")).toBeTruthy();
    const before = calls.filter((c) => c.url.includes('/plan/')).length;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await act(async () => { await Promise.resolve(); });
    expect(calls.filter((c) => c.url.includes('/plan/')).length).toBe(before + 1);
  });

  it('while loading shows the header skeleton and skeleton sections', () => {
    renderPlan(rhEn, { status: -1 });
    expect(document.querySelector('.fln-plan-skel')).toBeTruthy();
    expect(document.querySelectorAll('.fln-skel-sec').length).toBeGreaterThanOrEqual(3);
  });

  it('only GETs the plan (no client-side open) and calls useFlnPlayer in the page', async () => {
    const { calls } = renderPlan(rhEn);
    await screen.findByText(rhEn.plan.title);
    expect(calls.map((c) => c.url)).toEqual(['/api/portal/fln/plan/90001']);
    expect(useFlnPlayerSpy.mock.calls.at(-1)![0]).toEqual(rhEn.plan);
  });
});

describe('header', () => {
  it('kicker on two lines from placement pos/count, not seq', async () => {
    renderPlan({ ...rhEn, plan: { ...rhEn.plan, seq: 3 } as typeof rhEn.plan });
    await screen.findByText(rhEn.plan.title);
    const k = [...document.querySelectorAll('.fln-kicker')].map((e) => e.textContent);
    expect(k).toEqual(['Reading Hour · English', 'Level 1 · Lesson 24/48']);
    expect(document.querySelector('.fln-plan-header h1')!.getAttribute('lang')).toBe('en');
    expect(document.querySelector('.fln-plan-header')!.textContent).toContain('30 min');
  });

  it('?grade= above 5 never picks a placement row: the kicker reads placement[0] (FLN is Grades 1–5, bd-elc1qz)', async () => {
    const placement = [{ ...numEn.placement[0], grade: 2, pos: 7 }, { ...numEn.placement[0], grade: 7, pos: 9 }];
    renderPlan({ ...numEn, placement }, { entries: [`/portal/fln/p/${numEn.plan.id}?grade=7`] });
    await screen.findByText(numEn.plan.title);
    const k = [...document.querySelectorAll('.fln-kicker')].map((e) => e.textContent);
    expect(k).toEqual(['Numeracy', 'Level 2 · Lesson 7/30']);
  });

  it('a guide (pos 0) shows the level only', async () => {
    renderPlan({ ...numEn, placement: [{ ...numEn.placement[0], pos: 0, label: 'guide' }] });
    await screen.findByText(numEn.plan.title);
    const k = [...document.querySelectorAll('.fln-kicker')].map((e) => e.textContent);
    expect(k).toEqual(['Numeracy', 'Level 2']);
  });

  it('Urdu kicker: «سطح ۱ — سبق ۲۷ (کل ۵۸)»', async () => {
    renderPlan(rhUr, { lang: 'ur' });
    await screen.findByText(rhUr.plan.title);
    const k = [...document.querySelectorAll('.fln-kicker')].map((e) => e.textContent);
    expect(k).toEqual(['ریڈنگ آور — اردو', 'سطح ۱ — سبق ۲۷ (کل ۵۸)']);
  });
});

describe('details and time bar', () => {
  it('goal line = first SLO; Full details expands in place to SLOs, Bring, Before class', async () => {
    renderPlan(rhEn);
    await screen.findByText(rhEn.plan.title);
    expect(screen.getByText(rhEn.plan.slo[0])).toBeTruthy();
    const more = screen.getByRole('button', { name: /Full details/ });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(rhEn.plan.slo[1])).toBeTruthy();
    expect(screen.getByText('Marker')).toBeTruthy();
    expect(screen.getByText('Draw the word wall before class.')).toBeTruthy();
    expect(document.querySelector('.fln-details img')).toBeTruthy();
  });

  it('time bar: one segment per section sized by minutes; Urdu «۵ منٹ», never ′', async () => {
    renderPlan(rhUr, { lang: 'ur' });
    await screen.findByText(rhUr.plan.title);
    const segs = [...document.querySelectorAll('.fln-timebar-seg')] as HTMLElement[];
    expect(segs.map((s) => s.style.flexGrow)).toEqual(['5', '20', '12', '3']);
    expect(segs[0].textContent).toBe('۵ منٹ');
    expect(document.querySelector('.fln-timebar')!.textContent).not.toContain('′');
  });
});

describe('leaders, back, footer, telemetry', () => {
  it('no Share slot and no bottom padding when me.share is false; padding when true', async () => {
    renderPlan(rhEn);
    await screen.findByText(rhEn.plan.title);
    expect(document.querySelector('[data-fln-share-slot]')).toBeNull();
    expect(document.querySelector('.fln-plan')!.classList.contains('fln-plan--share')).toBe(false);
    cleanup();
    renderPlan(rhEn, { share: true });
    await screen.findByText(rhEn.plan.title);
    expect(document.querySelector('.fln-plan')!.classList.contains('fln-plan--share')).toBe(true);
  });

  it('Back on a link-opened G1 plan → the level list for its subject and first grade', async () => {
    renderPlan(rhEn);
    await screen.findByText(rhEn.plan.title);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((await screen.findByTestId('probe')).textContent).toBe('/portal/fln/list/rh-en?grade=1');
  });

  it('Back by link, teacher of grades 8 and 9 only → the plan’s own grade, never a 6–12 list (FLN is Grades 1–5, bd-elc1qz)', async () => {
    http.get.mockResolvedValue(combos(9, 8, 9));
    renderPlan(rhEn);
    await screen.findByText(rhEn.plan.title);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((await screen.findByTestId('probe')).textContent).toBe('/portal/fln/list/rh-en?grade=1');
    expect(http.get).toHaveBeenCalledWith('/me/grade-subjects', { params: { feature: 'lessons' } });
  });

  it('Back by link, teacher of grades 9 and 4 → their Grade 4, the only grade FLN serves', async () => {
    http.get.mockResolvedValue(combos(9, 4));
    renderPlan(rhEn);
    await screen.findByText(rhEn.plan.title);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((await screen.findByTestId('probe')).textContent).toBe('/portal/fln/list/rh-en?grade=4');
  });

  it('linkBackTarget: a 6–12 grade is never a target; nothing to go on → Grade 1', () => {
    expect(linkBackTarget('num', undefined, [])).toBe('/portal/fln/list/num?grade=1');
    expect(linkBackTarget('num', undefined, [7, 11])).toBe('/portal/fln/list/num?grade=1');
    expect(linkBackTarget('num', [{ ...numEn.placement[0], grades: [8] }], [])).toBe('/portal/fln/list/num?grade=1');
  });

  it('Back by link, teacher of grade 3 (a grade-1 plan) → her own grade, not the plan’s', async () => {
    http.get.mockResolvedValue(combos(null, 3, 5));
    renderPlan(rhEn);
    await screen.findByText(rhEn.plan.title);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((await screen.findByTestId('probe')).textContent).toBe('/portal/fln/list/rh-en?grade=3');
  });

  it('Back by link, no grades (a leader, or a failed read) → the placement grade', async () => {
    http.get.mockResolvedValue(combos());
    renderPlan(numEn);
    await screen.findByText(numEn.plan.title);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((await screen.findByTestId('probe')).textContent).toBe('/portal/fln/list/num?grade=2');
    expect(http.get).toHaveBeenCalledTimes(1);
    cleanup();
    http.get.mockRejectedValue(new Error('502'));
    renderPlan(numEn);
    await screen.findByText(numEn.plan.title);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((await screen.findByTestId('probe')).textContent).toBe('/portal/fln/list/num?grade=2');
  });

  it('Back on a link-opened Level 2 plan uses placement[0].grades[0]', async () => {
    renderPlan(numEn);
    await screen.findByText(numEn.plan.title);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((await screen.findByTestId('probe')).textContent).toBe('/portal/fln/list/num?grade=2');
  });

  it('Back with an in-app previous entry goes back', async () => {
    renderPlan(rhEn, { entries: ['/somewhere', '/portal/fln/p/90001'] });
    await screen.findByText(rhEn.plan.title);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('probe').textContent).toBe('/somewhere');
    expect(http.get).not.toHaveBeenCalled();
  });

  it('footer names the programme and the id', async () => {
    renderPlan(rhEn);
    await screen.findByText(rhEn.plan.title);
    expect(document.querySelector('.fln-plan-foot')!.textContent).toBe('FDE FLN programme 2025 · ID 90001');
  });

  it('batches player events with the plan id: ≤1 batch / 5 s, flush on pagehide', async () => {
    const { calls } = renderPlan(rhEn);
    await screen.findByText(rhEn.plan.title);
    vi.useFakeTimers();
    const posts = () => calls.filter((c) => c.url.endsWith('/events'));
    act(() => { eventSinks[0]({ kind: 'audio_play', clip: 'aa000001', ms: 300, result: 'ok-mirror' }); });
    act(() => { vi.advanceTimersByTime(10); });
    expect(posts().length).toBe(1);
    expect(JSON.parse(String(posts()[0].init!.body))).toEqual([{ kind: 'audio_play', clip: 'aa000001', ms: 300, result: 'ok-mirror', plan: 90001 }]);
    act(() => { eventSinks[0]({ kind: 'audio_play', clip: 'aa000002', ms: 200, result: 'ok-orig' }); });
    act(() => { eventSinks[0]({ kind: 'audio_error', clip: 'aa000003', result: 'error-404' }); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(posts().length).toBe(1);
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(posts().length).toBe(2);
    expect(JSON.parse(String(posts()[1].init!.body)).map((e: { clip: string }) => e.clip)).toEqual(['aa000002', 'aa000003']);
  });
});
