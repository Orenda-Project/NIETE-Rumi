import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FlnPlayerProvider } from '../player/useFlnPlayer';
import { SoundTile } from '../player/SoundTile';
import type { FlnPlayer, PlayerState, StateListener } from '../player/types';
import { AUDIO_STRINGS } from '../strings.audio';

/**
 * AUDIO_BAR A11 (RT5-URTILE-SHIFT): a sound tile's box must not change when its state changes. On an Urdu plan the
 * state line «چل رہی ہے…» used to appear only on tap and wrap to two Nastaliq lines, growing the grid row 77 → 125 px.
 * jsdom has no layout, so this pins the structural guarantee: the state line is the SAME element in every state, it is
 * there while idle too, and its own rule keeps it to one line of fixed height (the real stylesheet, read from disk).
 */

const css = readFileSync(resolve(__dirname, '../player/player.css'), 'utf8');
beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
});
afterEach(() => cleanup());

function fakePlayer() {
  const listeners = new Map<string, Set<StateListener>>();
  const player: FlnPlayer = {
    register() {},
    warm() {},
    toggle() {},
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
  const emit = (id: string, state: PlayerState, progress = 0) =>
    act(() => { listeners.get(id)?.forEach((cb) => cb(state, progress)); });
  return { player, emit };
}

const STATES: PlayerState[] = ['loading', 'playing', 'error', 'idle'];

describe.each([
  { name: 'Urdu tile without a caption (plan 10152)', lang: 'ur', dir: 'rtl', label: 'ب', caption: undefined },
  { name: 'Urdu tile with a caption', lang: 'ur', dir: 'rtl', label: 'ب', caption: 'بطخ' },
  { name: 'English tile with a caption', lang: 'en', dir: 'ltr', label: 'ck', caption: 'as in duck' },
])('SoundTile box is state-independent — $name', ({ lang, dir, label, caption }) => {
  it('the state line exists in every state and is the same element', () => {
    const f = fakePlayer();
    render(<FlnPlayerProvider player={f.player}><SoundTile clipId="x001" label={label} caption={caption} lang={lang} dir={dir} /></FlnPlayerProvider>);
    const btn = screen.getByRole('button');
    const sub0 = btn.querySelector('.fln-snd__sub');
    expect(sub0, 'idle tile reserves the state line').not.toBeNull();
    const shape = () => Array.from(btn.children).filter((c) => !c.classList.contains('fln-snd__bar')).map((c) => c.className);
    const idleShape = shape();
    for (const s of STATES) {
      f.emit('x001', s, 0.4);
      expect(btn).toHaveAttribute('data-fln-state', s);
      expect(btn.querySelector('.fln-snd__sub')).toBe(sub0);
      expect(shape()).toEqual(idleShape);
    }
    const strings = AUDIO_STRINGS[lang as 'en' | 'ur'];
    f.emit('x001', 'playing');
    expect(sub0).toHaveTextContent(strings.playing);
    f.emit('x001', 'error');
    expect(sub0).toHaveTextContent(strings.error);
  });

  it('the state line is one line of fixed height (nowrap + ellipsis + height)', () => {
    const f = fakePlayer();
    render(<FlnPlayerProvider player={f.player}><SoundTile clipId="x001" label={label} caption={caption} lang={lang} dir={dir} /></FlnPlayerProvider>);
    const btn = screen.getByRole('button');
    for (const s of STATES) {
      f.emit('x001', s);
      const sub = btn.querySelector('.fln-snd__sub') as HTMLElement;
      const cs = getComputedStyle(sub);
      expect(cs.whiteSpace).toBe('nowrap');
      expect(cs.overflow).toBe('hidden');
      expect(cs.textOverflow).toBe('ellipsis');
      expect(cs.display).toBe('block');
      expect(cs.height).toMatch(/^\d+(\.\d+)?(px|em)$/);
      expect(cs.flexShrink).toBe('0');
    }
  });
});
