import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';

/**
 * bd-t7zk3t.11 — SPEC_v2 §7 `section.test.tsx` (OPERATOR DECISION: the plan opens COLLAPSED; a band expands in place).
 * Rendered through PlanScreen (the real page) with the plan fetched over a mocked `fetch`; the audio lane's pill/grid
 * stubs are swapped for stand-ins that render `button[data-fln-clip]` / the grid testid.
 */
vi.mock('../player', async (orig) => (await import('./fixtures/playerMock')).withStandIns(await orig()));

import { fakePlayer, resetPlayerMock, warmOnOpen } from './fixtures/playerMock';
import { renderPlan } from './fixtures/renderPlan';
import { rhEn, screenerEn, numEn } from './fixtures/plans';

const band = (kind: string) => document.querySelector(`[data-fln-band="${kind}"]`) as HTMLButtonElement;

beforeEach(() => { resetPlayerMock(); window.history.replaceState(null, ''); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('plan sections are closed bands by default', () => {
  it('renders every section (and homework) closed, nothing pre-expanded', async () => {
    renderPlan(rhEn);
    await screen.findByText(rhEn.plan.title);
    for (const k of ['opening', 'explain', 'practice', 'homework']) {
      const b = band(k);
      expect(b, k).toBeTruthy();
      expect(b.getAttribute('aria-expanded')).toBe('false');
      expect(b.tagName).toBe('BUTTON');
      const panel = document.getElementById(b.getAttribute('aria-controls')!);
      expect(panel, `${k} panel`).toBeTruthy();
      expect(panel!.hidden).toBe(true);
    }
    // the closed band shows the first move on one line
    expect(band('opening').textContent).toContain('Write the word pen in the corner of the board.');
    // no move pills are rendered while closed
    expect(document.querySelectorAll('.fln-move [data-fln-clip]').length).toBe(0);
  });

  it('opens in place on tap (aria-expanded=true, ▴) and closes on a second tap', async () => {
    renderPlan(rhEn);
    await screen.findByText(rhEn.plan.title);
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    fireEvent.click(band('explain'));
    expect(band('explain').getAttribute('aria-expanded')).toBe('true');
    expect(band('explain').textContent).toContain('▴');
    const panel = document.getElementById(band('explain').getAttribute('aria-controls')!)!;
    expect(panel.hidden).toBe(false);
    expect(panel.querySelectorAll('.fln-move').length).toBe(5);
    expect(band('opening').getAttribute('aria-expanded')).toBe('false');
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(band('explain'));
    expect(band('explain').getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
  });

  it('stays open while a pill in it plays (player state changes and re-renders)', async () => {
    renderPlan(rhEn);
    await screen.findByText(rhEn.plan.title);
    fireEvent.click(band('explain'));
    const pills = document.querySelectorAll('.fln-move [data-fln-clip]');
    expect(pills.length).toBeGreaterThan(1);
    act(() => { fireEvent.click(pills[0]); });
    expect(fakePlayer.toggle).toHaveBeenCalled();
    expect(pills[0].getAttribute('data-state')).toBe('playing');
    act(() => { fireEvent.click(pills[1]); });
    expect(band('explain').getAttribute('aria-expanded')).toBe('true');
  });

  it('warms that section’s clip ids when it expands', async () => {
    renderPlan(rhEn);
    await screen.findByText(rhEn.plan.title);
    expect(warmOnOpen.mock.calls.some(([open]) => open)).toBe(false);
    fireEvent.click(band('explain'));
    const opened = warmOnOpen.mock.calls.filter(([open]) => open);
    expect(opened.length).toBeGreaterThan(0);
    expect(opened.at(-1)![1]).toEqual(['aa000001', 'aa000002']);
  });

  it('mirrors the open bands to history.state so Back/forward restores them', async () => {
    renderPlan(rhEn);
    await screen.findByText(rhEn.plan.title);
    fireEvent.click(band('practice'));
    expect(window.history.state?.flnOpen).toEqual({ plan: 90001, open: [2] });
    cleanup();
    renderPlan(rhEn);
    await screen.findByText(rhEn.plan.title);
    expect(band('practice').getAttribute('aria-expanded')).toBe('true');
    expect(band('explain').getAttribute('aria-expanded')).toBe('false');
  });
});

describe('the sound grid', () => {
  it('renders while every section is closed, between the time bar and the first section', async () => {
    renderPlan(rhEn);
    await screen.findByText(rhEn.plan.title);
    const grid = screen.getByTestId('fln-sound-grid');
    expect(grid.querySelectorAll('[data-fln-clip]').length).toBe(3);
    const bar = document.querySelector('.fln-timebar')!;
    expect(bar.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(grid.compareDocumentPosition(band('opening')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Sounds in this lesson')).toBeTruthy();
  });

  it('a screener plan renders NO grid and shows the answer-key chip', async () => {
    renderPlan(screenerEn);
    await screen.findByText(screenerEn.plan.title);
    expect(screen.queryByTestId('fln-sound-grid')).toBeNull();
    expect(screen.queryByText('Sounds in this lesson')).toBeNull();
    expect(screen.getByText('Answer key audio · teacher only')).toBeTruthy();
  });

  it('a plan without audio (Numeracy) has no grid heading', async () => {
    renderPlan(numEn);
    await screen.findByText(numEn.plan.title);
    expect(screen.queryByText('Sounds in this lesson')).toBeNull();
  });

  it('calls useFlnPlayer in the page and binds telemetry once', async () => {
    renderPlan(rhEn);
    await screen.findByText(rhEn.plan.title);
    expect(fakePlayer.onEvent).toHaveBeenCalledTimes(1);
  });
});
