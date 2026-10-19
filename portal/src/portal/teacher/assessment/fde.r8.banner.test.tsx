import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from 'i18next';

/**
 * The "Paper ready" banner over the dock. The banner is fixed above the bottom menu (and the strip); a step's dock is
 * sticky at the menu + the strip's height. Until now only the strip's height reached the page (`--notice-h`), so
 * on the board-pattern Check at UR 360 the banner sat over Make and the teacher had to close it first.
 *
 * Now the host measures the banner and gives its height to the page (`--notice-banner-h`), and the New paper dock
 * (the board-pattern Check and every plain step, one StepFrame) is padded by it while it shows. The real host and
 * the real step frame are mounted together; only the network is mocked.
 */
vi.mock('../../services/api', () => {
  const get = vi.fn();
  const post = vi.fn();
  return {
    default: { get, post },
    portal: {
      getAssessmentStatus: async (id: string) => (await get(`/assessment/status/${id}`)).data,
      generateAssessment: async (spec: unknown) => (await post('/assessment/generate', spec)).data,
    },
  };
});
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import api from '../../services/api';
import { NoticeHost } from '../notices/NoticeHost';
import { noticeTracker } from '../notices/tracker';
import type { NewNotice } from '../notices/model';
import { StepFrame } from './ui';
import { FDE_STEPS } from './model';

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const BANNER_PX = 228;
const banner = () => document.documentElement.style.getPropertyValue('--notice-banner-h');

const paper = (ref = 'req1'): NewNotice => ({
  kind: 'paper', ref, title: 'English', grade: 5, subject: 'English', questions: 35,
  waitHref: `/portal/teacher/assessment/request/${ref}`, spec: { grade: 5, subject: 'english', questionCount: 35 },
});

function screenWith(step: 'check' | 'questions', fde: boolean) {
  return render(
    <MemoryRouter initialEntries={['/portal/teacher/assessment/new/check']}>
      <StepFrame
        step={step}
        steps={fde ? FDE_STEPS : undefined}
        backTo="/portal/teacher/assessment"
        hint={fde ? 'Ready in about 3 min' : undefined}
        next={{ label: 'Make paper', why: null, onPress: () => {} }}
      >
        <p>rows</p>
      </StepFrame>
      <NoticeHost userKey="fde-teacher" />
    </MemoryRouter>,
  );
}

let rect: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  noticeTracker.reset();
  document.documentElement.style.removeProperty('--notice-h');
  document.documentElement.style.removeProperty('--notice-banner-h');
  http.get.mockImplementation(async (url: string) => {
    if (url.startsWith('/assessment/status/')) return { data: { success: true, status: 'ready', paperId: 'p9' } };
    throw new Error(`unmocked ${url}`);
  });
  // jsdom has no layout: the banner's slot measures what a 360px Urdu banner measures.
  rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const h = this.querySelector('[data-testid="ready-banner"]') && !this.closest('[data-testid="ready-banner"]') && this.dataset.testid === 'notice-banner-slot' ? BANNER_PX : 0;
    return { x: 0, y: 0, top: 0, left: 0, right: 360, bottom: h, width: 360, height: h, toJSON: () => ({}) } as DOMRect;
  });
  if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {} });
  await act(async () => { await i18n.changeLanguage('en'); });
});
afterEach(() => { rect.mockRestore(); vi.useRealTimers(); noticeTracker.reset(); });

const dockOf = () => screen.getByTestId('step-next').closest('[data-testid="step-dock"]') as HTMLElement | null;

describe('the Paper ready banner never covers Make', () => {
  it('fde check: while the banner shows, the dock is padded by the banner height', async () => {
    noticeTracker.track(paper());
    screenWith('check', true);
    await tick(4000);
    expect(screen.getByTestId('ready-banner')).toHaveTextContent('Paper ready');
    expect(banner()).toBe(`${BANNER_PX}px`);
    const dock = dockOf();
    expect(dock).not.toBeNull();
    expect(dock?.style.paddingBottom).toBe('var(--notice-banner-h, 0px)');
  });

  it('fde check: when the banner is closed the pad lets go', async () => {
    noticeTracker.track(paper());
    screenWith('check', true);
    await tick(4000);
    fireEvent.click(within(screen.getByTestId('ready-banner')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('ready-banner')).toBeNull();
    expect(banner()).toBe('');
  });

  it('fde check: when the banner runs out the pad lets go, and unmounting leaves nothing behind', async () => {
    noticeTracker.track(paper());
    const { unmount } = screenWith('check', true);
    await tick(4000);
    expect(banner()).toBe(`${BANNER_PX}px`);
    await tick(11_000);
    expect(screen.queryByTestId('ready-banner')).toBeNull();
    expect(banner()).toBe('');
    unmount();
    expect(banner()).toBe('');
  });

  it('plain make step: the same dock, the same pad', async () => {
    noticeTracker.track(paper());
    screenWith('questions', false);
    await tick(4000);
    expect(banner()).toBe(`${BANNER_PX}px`);
    expect(dockOf()?.style.paddingBottom).toBe('var(--notice-banner-h, 0px)');
  });

  it('fde check: a red "Couldn\'t make it" banner pads the dock the same way', async () => {
    http.get.mockImplementation(async () => ({ data: { success: true, status: 'failed', errorCode: 'GENERATION_FAILED' } }));
    noticeTracker.track(paper());
    screenWith('check', true);
    await tick(4000);
    expect(screen.getByTestId('ready-banner')).toHaveAttribute('role', 'alert');
    expect(banner()).toBe(`${BANNER_PX}px`);
    expect(dockOf()?.style.paddingBottom).toBe('var(--notice-banner-h, 0px)');
  });

  it('no banner: no variable, and the strip keeps its own (--notice-h unchanged)', async () => {
    http.get.mockImplementation(async () => ({ data: { success: true, status: 'generating' } }));
    noticeTracker.track(paper());
    screenWith('check', true);
    await tick(4000);
    expect(screen.queryByTestId('ready-banner')).toBeNull();
    expect(banner()).toBe('');
    expect(parseInt(document.documentElement.style.getPropertyValue('--notice-h'), 10)).toBeGreaterThanOrEqual(64);
  });
});
