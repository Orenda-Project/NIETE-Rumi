import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

/**
 * bd-t7zk3t.11 — qa-render r1 defects (outputs/lanes/m-app/workers/qa-render_REPORT.md), each through the real page:
 *  D4  a group whose steps carry their OWN numbers ("1. There are a total of 6 tasks.") gets no badges, so the
 *      teacher never reads "2  1. There are…" (screener 10221).
 *  D5  a trailing "+" belongs to its Latin run ("A-Z+") in Urdu text, so it does not jump to the other end.
 *  D2  a time-bar segment holds ONE inline child: as bare flex children the <bdi> number and «منٹ» lost their space.
 */
vi.mock('../player', async (orig) => (await import('./fixtures/playerMock')).withStandIns(await orig()));

import { resetPlayerMock } from './fixtures/playerMock';
import { renderPlan } from './fixtures/renderPlan';
import { rhUr, screenerEn } from './fixtures/plans';
import { isolate } from '../plan/text';
import type { FlnPlanResponse } from '../types';

beforeEach(() => { resetPlayerMock(); window.history.replaceState(null, ''); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const selfNumbered: FlnPlanResponse = {
  ...screenerEn,
  plan: {
    ...screenerEn.plan,
    sections: [
      { kind: 'opening', minutes: 5, groups: [{ header: 'Teacher’s Instructions', level: null, items: [
        { kind: 'instruction', text: 'These instructions are for the teacher.', media: [] },
        { kind: 'instruction', text: '1. There are a total of 6 tasks.', media: [] },
        { kind: 'instruction', text: '2. Call students one by one.', media: [] },
      ] }] },
      ...screenerEn.plan.sections.slice(1),
    ],
  },
};

describe('qa r1', () => {
  it('D4: a group with its own step numbers renders no number badges; other groups keep theirs', async () => {
    renderPlan(selfNumbered);
    await screen.findByText(selfNumbered.plan.title);
    fireEvent.click(document.querySelector('[data-fln-band="opening"]') as HTMLButtonElement);
    fireEvent.click(document.querySelector('[data-fln-band="explain"]') as HTMLButtonElement);
    const badges = (kind: string) => Array.from(document.querySelector(`[data-fln-band="${kind}"]`)!
      .closest('section')!.querySelectorAll('.fln-no')).map((e) => e.textContent);
    expect(badges('opening')).toEqual(['', '', '']);
    expect(screen.getByText('1. There are a total of 6 tasks.')).toBeTruthy();
    expect(badges('explain')).toEqual(['1']);
  });

  it('D5: "A-Z+" stays one isolated run in Urdu text', () => {
    const { container } = render(<p dir="rtl">{isolate('سطح ۳ — بنیادی A-Z+', true)}</p>);
    expect(Array.from(container.querySelectorAll('bdi')).map((b) => b.textContent)).toEqual(['۳', 'A-Z+']);
  });

  it('D2: each Urdu time-bar segment wraps its text in one span, so «۵ منٹ» keeps its space', async () => {
    renderPlan(rhUr, { lang: 'ur' });
    await screen.findByText(rhUr.plan.title);
    const segs = Array.from(document.querySelectorAll('.fln-timebar-seg'));
    expect(segs.length).toBeGreaterThan(0);
    for (const seg of segs) {
      expect(seg.childNodes.length).toBe(1);
      expect(seg.textContent).toMatch(/^[۰-۹]+ منٹ$/);
    }
  });
});
