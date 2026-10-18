import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { FlnPlayerProvider } from '../player/useFlnPlayer';
import { SoundPill } from '../player/SoundPill';
import { SoundTile } from '../player/SoundTile';
import { SoundGrid } from '../plan/SoundGrid';
import type { FlnPlanLike, FlnPlayer, PlayerState, StateListener } from '../player/types';
import { AUDIO_STRINGS, audioActionLabel, audioStrings } from '../strings.audio';

/** A FlnPlayer that only records: the test pushes states through the subscribe callbacks itself. */
function fakePlayer() {
  const listeners = new Map<string, Set<StateListener>>();
  const calls: { method: string; id?: string; owner?: string; ids?: string[]; at: number }[] = [];
  let tick = 0;
  const player: FlnPlayer = {
    register() {},
    warm(ids) { calls.push({ method: 'warm', ids: [...ids], at: ++tick }); },
    toggle(id, owner) { calls.push({ method: 'toggle', id, owner, at: ++tick }); },
    stopAll() {},
    subscribe(id, cb) {
      if (!listeners.has(id)) listeners.set(id, new Set());
      listeners.get(id)!.add(cb);
      cb('idle', 0);
      return () => { listeners.get(id)?.delete(cb); };
    },
    onEvent() { return () => {}; },
    dispose() {},
  };
  const emit = (id: string, state: PlayerState, progress = 0, owner?: string) =>
    act(() => { listeners.get(id)?.forEach((cb) => cb(state, progress, owner)); });
  return { player, calls, emit, toggles: () => calls.filter((c) => c.method === 'toggle'), warms: () => calls.filter((c) => c.method === 'warm') };
}

function withPlayer(player: FlnPlayer, ui: ReactNode) {
  return render(<FlnPlayerProvider player={player}>{ui}</FlnPlayerProvider>);
}

const aud = (sha8: string, extra: Record<string, unknown> = {}) => ({ kind: 'audio', src: `https://m.example/${sha8}.mp3`, sha8, ...extra });

const EN_PLAN: FlnPlanLike = {
  key: 'en-1', lang: 'en', dir: 'ltr',
  sections: [
    { kind: 'opening', groups: [{ items: [{ text: 'Story time', media: [aud('nar1', { role: 'narration', label_en: 'Story' })] }] }] },
    { kind: 'explain', groups: [{ items: [
      { text: 'Say **c**', media: [aud('c001', { label_en: 'c', caption_en: 'as in Cat' })] },
      { text: 'Say **k**', media: [aud('k001', { label_en: 'k' }), aud('c001', { label_en: 'c' })] },
      { text: 'Word', media: [aud('cat1', { label_en: 'cat', role: 'word' })] },
    ] }] },
  ],
};

const UR_PLAN: FlnPlanLike = {
  key: 'ur-1', lang: 'ur', dir: 'rtl',
  sections: [{ kind: 'explain', groups: [{ items: [
    { media: [aud('b001', { label_ur: 'ب' }), aud('m001', { label_ur: 'م' })] },
    { media: [aud('n001', { label_ur: 'ن' }), aud('a001', { label_ur: 'ا' })] },
  ] }] }],
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('SoundPill', () => {
  it('a tap calls toggle(id, owner) synchronously, inside the click handler', () => {
    const f = fakePlayer();
    withPlayer(f.player, <SoundPill clipId="c001" label="c" caption="as in Cat" lang="en" dir="ltr" />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('type', 'button');
    fireEvent.click(btn);
    // No await between the click and this line: the call must already be recorded.
    expect(f.toggles()).toHaveLength(1);
    expect(f.toggles()[0].id).toBe('c001');
    expect(typeof f.toggles()[0].owner).toBe('string');
    expect(f.toggles()[0].owner!.length).toBeGreaterThan(0);
  });

  it('renders each of the four states with its data-fln-state, text and aria', () => {
    const f = fakePlayer();
    withPlayer(f.player, <SoundPill clipId="c001" label="c" caption="as in Cat" lang="en" dir="ltr" />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('data-fln-clip', 'c001');
    expect(btn).toHaveAttribute('data-fln-state', 'idle');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn).toHaveAttribute('aria-label', 'Play c');
    expect(btn).toHaveTextContent('as in Cat');
    expect(btn.querySelector('bdi')).toHaveTextContent('c');

    f.emit('c001', 'loading');
    expect(btn).toHaveAttribute('data-fln-state', 'loading');
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toHaveTextContent('Loading…');

    f.emit('c001', 'playing', 0.4);
    expect(btn).toHaveAttribute('data-fln-state', 'playing');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).not.toHaveAttribute('aria-busy');
    expect(btn).toHaveAttribute('aria-label', 'Stop c');
    expect(btn).toHaveTextContent('Playing…');
    const bar = btn.querySelector('.fln-snd__bar') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.getPropertyValue('--fln-snd-p')).toBe('40%');

    f.emit('c001', 'error');
    expect(btn).toHaveAttribute('data-fln-state', 'error');
    expect(btn).toHaveTextContent("Couldn't play. Tap to try again");
    // The error line replaces the caption, and the bar is gone.
    expect(btn).not.toHaveTextContent('as in Cat');
    expect(btn.querySelector('.fln-snd__bar')).toBeNull();
    expect(btn).toHaveAttribute('aria-label', 'Play c');
  });

  it('two pills of one clip keep their own state: only the tapping owner shows playing', () => {
    const f = fakePlayer();
    withPlayer(f.player, <>
      <SoundPill clipId="c001" label="c" lang="en" />
      <SoundPill clipId="c001" label="c" lang="en" />
    </>);
    const [a, b] = screen.getAllByRole('button');
    fireEvent.click(b);
    const owner = f.toggles()[0].owner;
    fireEvent.click(a);
    expect(f.toggles()[1].owner).not.toBe(owner);
    f.emit('c001', 'playing', 0.2, owner);
    expect(b).toHaveAttribute('data-fln-state', 'playing');
    expect(a).toHaveAttribute('data-fln-state', 'idle');
  });

  it('Urdu: the Urdu state strings and the label-first aria order', () => {
    const f = fakePlayer();
    withPlayer(f.player, <SoundPill clipId="b001" label="ب" lang="ur" dir="rtl" />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('dir', 'rtl');
    expect(btn).toHaveAttribute('aria-label', 'ب چلائیں');
    f.emit('b001', 'loading');
    expect(btn).toHaveTextContent('لوڈ ہو رہا ہے…');
    f.emit('b001', 'playing', 0.5);
    expect(btn).toHaveTextContent('چل رہی ہے…');
    expect(btn).toHaveAttribute('aria-label', 'ب روکیں');
    f.emit('b001', 'error');
    expect(btn).toHaveTextContent('آواز نہیں چلی۔ دوبارہ کوشش کریں');
  });

  it('shows the iOS hint under the first pill on an iOS user agent only', () => {
    const f = fakePlayer();
    const ua = vi.spyOn(navigator, 'userAgent', 'get');
    ua.mockReturnValue('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 WhatsApp');
    const { unmount } = withPlayer(f.player, <SoundPill clipId="c001" label="c" lang="en" first />);
    expect(screen.queryByText(AUDIO_STRINGS.en.iosHint)).toBeNull();
    unmount();

    ua.mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15');
    withPlayer(f.player, <>
      <SoundPill clipId="c001" label="c" lang="en" first />
      <SoundPill clipId="k001" label="k" lang="en" />
    </>);
    expect(screen.getAllByText(AUDIO_STRINGS.en.iosHint)).toHaveLength(1);
  });
});

describe('SoundTile', () => {
  it('a tap toggles synchronously; four states render', () => {
    const f = fakePlayer();
    withPlayer(f.player, <SoundTile clipId="b001" label="ب" caption="بطخ" lang="ur" dir="rtl" />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(f.toggles()).toHaveLength(1);
    expect(btn).toHaveTextContent('بطخ');
    for (const [state, text] of [['loading', 'لوڈ ہو رہا ہے…'], ['playing', 'چل رہی ہے…'], ['error', 'آواز نہیں چلی۔ دوبارہ کوشش کریں']] as const) {
      f.emit('b001', state, 0.4);
      expect(btn).toHaveAttribute('data-fln-state', state);
      expect(btn).toHaveTextContent(text);
    }
    f.emit('b001', 'idle');
    expect(btn).toHaveAttribute('data-fln-state', 'idle');
    expect(btn).toHaveTextContent('بطخ');
  });

  it('a narration tile says "Listen to the story" and spans two columns', () => {
    const f = fakePlayer();
    withPlayer(f.player, <SoundTile clipId="nar1" label="story-file" lang="en" role="narration" />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent('Listen to the story');
    expect(btn).not.toHaveTextContent('story-file');
    expect(btn.className).toContain('fln-snd-tile--wide');
    expect(btn).toHaveAttribute('aria-label', 'Play Listen to the story');
  });
});

describe('SoundGrid', () => {
  it('tiles in first-appearance order, narrations last, distinct by clip', () => {
    const f = fakePlayer();
    withPlayer(f.player, <SoundGrid plan={EN_PLAN} />);
    const ids = screen.getAllByRole('button').map((b) => b.getAttribute('data-fln-clip'));
    expect(ids).toEqual(['c001', 'k001', 'cat1', 'nar1']);
    expect(screen.getByRole('region', { name: 'Sounds in this lesson' })).toBeInTheDocument();
    expect(screen.getByText('Listen to the story')).toBeInTheDocument();
  });

  it('warms the grid ids once on mount, in grid order', () => {
    const f = fakePlayer();
    const { rerender } = withPlayer(f.player, <SoundGrid plan={EN_PLAN} />);
    rerender(<FlnPlayerProvider player={f.player}><SoundGrid plan={EN_PLAN} /></FlnPlayerProvider>);
    expect(f.warms()).toHaveLength(1);
    expect(f.warms()[0].ids).toEqual(['c001', 'k001', 'cat1', 'nar1']);
  });

  it('renders nothing (and warms nothing) on a screener plan', () => {
    const f = fakePlayer();
    const { container } = withPlayer(f.player, <SoundGrid plan={EN_PLAN} screener />);
    expect(container).toBeEmptyDOMElement();
    expect(f.warms()).toHaveLength(0);
  });

  it('renders nothing on a plan with no audio', () => {
    const f = fakePlayer();
    const plan: FlnPlanLike = { lang: 'en', sections: [{ kind: 'explain', groups: [{ items: [{ text: 'count', media: [{ kind: 'image', src: 'https://m.example/x.png' }] }] }] }] };
    const { container } = withPlayer(f.player, <SoundGrid plan={plan} />);
    expect(container).toBeEmptyDOMElement();
    expect(f.warms()).toHaveLength(0);
  });

  it('an Urdu plan: dir="rtl", the Urdu title, letters in plan order', () => {
    const f = fakePlayer();
    const { container } = withPlayer(f.player, <SoundGrid plan={UR_PLAN} />);
    const section = container.querySelector('section')!;
    expect(section).toHaveAttribute('dir', 'rtl');
    expect(section).toHaveAttribute('lang', 'ur');
    expect(section).toHaveAttribute('aria-label', 'اس سبق کی آوازیں');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['ب', 'م', 'ن', 'ا']);
  });
});

describe('strings.audio', () => {
  it('has every key in both languages, with real Urdu', () => {
    expect(Object.keys(AUDIO_STRINGS.ur).sort()).toEqual(Object.keys(AUDIO_STRINGS.en).sort());
    for (const v of Object.values(AUDIO_STRINGS.ur)) expect(v).toMatch(/[؀-ۿ]/);
    expect(audioStrings('ur').gridTitle).toBe('اس سبق کی آوازیں');
    expect(audioStrings('xx').gridTitle).toBe('Sounds in this lesson');
    expect(audioActionLabel('en', 'play', 'c')).toBe('Play c');
    expect(audioActionLabel('ur', 'stop', 'ب')).toBe('ب روکیں');
  });
});
