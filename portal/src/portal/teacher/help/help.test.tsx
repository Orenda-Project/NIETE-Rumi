import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * bd-ik5e8j.4 (queue #85) — the help entry, BDD over the real components (the network stubbed):
 *
 *   Given the switch is off      no "?" on a page, no How to use row in More, nothing read from /help
 *   Given it is on               the "?" sits in the header of Home, Lesson Plans, Digital Coaching and Training
 *   And she never opened one     it pulses (a still dot instead when the phone asks for reduced motion)
 *   When she taps it             the tray opens, the pulse stops, /help/seen is posted once
 *   And there is no video yet    the tray says "Video coming soon", the list says "Videos coming soon"
 *   And there is one             nothing is fetched before Watch; Watch sets the video's source
 */

vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../lib/recordingSession', () => ({ useRecordingSession: () => null, useLogoutGuard: (f: () => void) => f }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { firstName: 'Sample', lastName: 'Teacher', phoneNumber: '923000000000' }, logout: vi.fn() }) }));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const cfg = { features: { helpVideos: true } as Record<string, boolean> };
vi.mock('../../lib/useNewUi', async (orig) => ({
  ...(await orig<object>()),
  readConfigShared: () => Promise.resolve({ success: true, features: cfg.features }),
}));

import api from '../../services/api';
import TeacherPage from '../TeacherPage';
import More from '../pages/More';
import HelpListPage from './HelpListPage';
import { ListRow } from '../ui/ListRow';
import { resetHelp } from './api';
import { HELP, HELP_COPY } from './copy';
import lessonsSrc from '../lessons/LessonsHome.tsx?raw';
import coachingSrc from '../coaching/CoachingHome.tsx?raw';
import trainingSrc from '../training/TrainingHub.tsx?raw';
import homeSrc from '../home/look/LookHome.tsx?raw';

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
let helpAnswer: { success: boolean; seen: boolean; videos: unknown[] };
let reduced = false;

const VIDEO = { feature: 'lessons', lang: 'en', title: 'Lesson plans', url: 'https://cdn.example/help/v1/lessons-en.mp4', urlSmall: null, poster: null, seconds: 89, bytes: 2_100_000 };

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetHelp();
  cfg.features = { helpVideos: true };
  helpAnswer = { success: true, seen: false, videos: [] };
  reduced = false;
  http.get.mockImplementation(async (url: string) => (url === '/help' ? { data: helpAnswer } : { data: {} }));
  http.post.mockResolvedValue({ data: { success: true, seen: true } });
  window.matchMedia = ((q: string) => ({
    matches: q.includes('reduce') ? reduced : false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});

const page = (help?: 'lessons' | 'start') => render(
  <MemoryRouter>
    <TeacherPage title="Lesson Plans" crumb="Home" backTo="/portal/teacher" help={help}><p>body</p></TeacherPage>
  </MemoryRouter>,
);
const helpCalls = () => http.get.mock.calls.filter(([u]) => u === '/help');
const seenPosts = () => http.post.mock.calls.filter(([u]) => u === '/help/seen');

describe('switch off', () => {
  it('draws no "?", reads nothing from /help, and More has no How to use row', async () => {
    cfg.features = { helpVideos: false };
    page('lessons');
    render(<MemoryRouter><More /></MemoryRouter>);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByTestId('help-button')).toBeNull();
    expect(screen.queryByTestId('more-row-howto')).toBeNull();
    expect(helpCalls()).toEqual([]);
  });

  it('a page without the help prop never draws one, even with the switch on', async () => {
    page(undefined);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('help-button')).toBeNull();
  });
});

describe('switch on', () => {
  it('the four hub pages ask for their "?" (Home: Film 1, the others their own)', () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(strip(lessonsSrc)).toMatch(/help="lessons"/);
    expect(strip(coachingSrc)).toMatch(/help="coaching"/);
    expect(strip(trainingSrc)).toMatch(/help="training"/);
    expect(strip(homeSrc)).toMatch(/<HelpCorner feature="start">/);
  });

  it('More shows How to use, linking to the list', async () => {
    render(<MemoryRouter><More /></MemoryRouter>);
    const row = await screen.findByTestId('more-row-howto');
    expect(row.getAttribute('href')).toBe('/portal/teacher/help');
  });

  it('never opened one: the "?" pulses; opening the tray stops it and posts seen once', async () => {
    page('lessons');
    const btn = await screen.findByTestId('help-button');
    expect(btn.getAttribute('aria-label')).toBe(HELP_COPY.help);
    await screen.findByTestId('help-pulse');
    fireEvent.click(btn);
    expect(screen.queryByTestId('help-pulse')).toBeNull();
    fireEvent.click(btn);
    await waitFor(() => expect(seenPosts()).toHaveLength(1));
  });

  it('opened one before (the server says so): no pulse', async () => {
    helpAnswer = { ...helpAnswer, seen: true };
    page('lessons');
    await screen.findByTestId('help-button');
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByTestId('help-pulse')).toBeNull();
    expect(screen.queryByTestId('help-dot')).toBeNull();
  });

  it('reduced motion: a still dot, no pulse', async () => {
    reduced = true;
    page('lessons');
    await screen.findByTestId('help-dot');
    expect(screen.queryByTestId('help-pulse')).toBeNull();
  });

  it('no video yet: the tray says "Video coming soon" and links to all videos', async () => {
    page('lessons');
    fireEvent.click(await screen.findByTestId('help-button'));
    expect((await screen.findByTestId('help-coming-soon')).textContent).toBe(HELP_COPY.comingSoon);
    expect(screen.getByTestId('help-all').getAttribute('href')).toBe('/portal/teacher/help');
  });

  it('the How to use list with no videos: "Videos coming soon"', async () => {
    render(<MemoryRouter><HelpListPage /></MemoryRouter>);
    expect((await screen.findByTestId('help-list-empty')).textContent).toBe(HELP_COPY.allComingSoon);
  });

  it('a video: nothing is fetched before Watch; Watch sets its source, inline', async () => {
    helpAnswer = { ...helpAnswer, videos: [VIDEO] };
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    page('lessons');
    fireEvent.click(await screen.findByTestId('help-button'));
    const watch = await screen.findByTestId('help-watch');
    expect(document.querySelector('video')).toBeNull();
    fireEvent.click(watch);
    const v = (await screen.findByTestId('help-video')) as HTMLVideoElement;
    expect(v.getAttribute('src')).toBe(VIDEO.url);
    expect(v.getAttribute('preload')).toBe('none');
    expect(v.hasAttribute('playsinline')).toBe(true);
    playSpy.mockRestore();
  });

  it('asks /help in the page language', async () => {
    page('lessons');
    await screen.findByTestId('help-button');
    await waitFor(() => expect(helpCalls().length).toBeGreaterThan(0));
    expect(helpCalls()[0][1]).toEqual({ params: { lang: expect.stringMatching(/^(en|ur)$/) } });
  });
});

// bd-ik5e8j.6 — the operator on the phone, 12 Nov ~10:20: "How to Use might be a better name, And also we need icons for
// these." On production the rows' icon boxes were EMPTY: HelpListPage passes ListRow a `glyph` that only sandbox's ListRow
// had (bd-x1tl95), so staging/main dropped it. These pin the name, each film's icon, and ListRow's glyph slot itself.
describe('How to Use: the name and each film\'s icon (bd-ik5e8j.6)', () => {
  const FILMS = ['start', 'lessons', 'coaching', 'training'].map((feature) => ({ ...VIDEO, feature }));

  it('the English name is "How to Use" (and Film 1 "How to Use NIETE"); the Urdu stays', () => {
    expect(HELP_COPY.howTo).toBe('How to Use');
    expect(HELP_COPY.start).toBe('How to Use NIETE');
    expect(HELP.ur.howTo).toBe('استعمال کا طریقہ');
  });

  it('More\'s row reads "How to Use"', async () => {
    render(<MemoryRouter><More /></MemoryRouter>);
    expect((await screen.findByTestId('more-row-howto')).textContent).toContain('How to Use');
  });

  it('every film in the list has its icon: Film 1 the NIETE mark, the others their Home tile art', async () => {
    helpAnswer = { ...helpAnswer, videos: FILMS };
    render(<MemoryRouter><HelpListPage /></MemoryRouter>);
    await screen.findByText('How to Use NIETE');
    const leads = screen.getAllByTestId('listrow-lead');
    expect(leads).toHaveLength(4);
    expect(leads[0].querySelector('img[data-help-art="start"]')).not.toBeNull();
    expect(leads[1].querySelector('svg[data-feature-art="lessons"]')).not.toBeNull();
    expect(leads[2].querySelector('svg[data-feature-art="coaching"]')).not.toBeNull();
    expect(leads[3].querySelector('svg[data-feature-art="training"]')).not.toBeNull();
  });

  it('ListRow draws a glyph in its lead box (the slot the list\'s icons ride on)', () => {
    render(<MemoryRouter><ListRow variant="row" label="x" glyph={<i data-testid="the-glyph" />} onPress={() => undefined} /></MemoryRouter>);
    expect(screen.getByTestId('listrow-lead').querySelector('[data-testid="the-glyph"]')).not.toBeNull();
  });
});
