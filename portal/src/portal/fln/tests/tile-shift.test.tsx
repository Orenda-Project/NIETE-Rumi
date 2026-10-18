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
 * there while idle too, and its own rule keeps it a fixed two-line box (RT5-CAPTION-CLIP; the real stylesheet, read from disk).
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

  it('the state line is a fixed TWO-line box in every state (RT5-CAPTION-CLIP: "as in Monkey", «Couldn\'t play» fit)', () => {
    const f = fakePlayer();
    render(<FlnPlayerProvider player={f.player}><SoundTile clipId="x001" label={label} caption={caption} lang={lang} dir={dir} /></FlnPlayerProvider>);
    const btn = screen.getByRole('button');
    for (const s of STATES) {
      f.emit('x001', s);
      const sub = btn.querySelector('.fln-snd__sub') as HTMLElement;
      const cs = getComputedStyle(sub);
      const fs = parseFloat(cs.fontSize);
      const lh = cs.lineHeight.endsWith('px') ? parseFloat(cs.lineHeight) : parseFloat(cs.lineHeight) * fs;
      const h = cs.height.endsWith('em') ? parseFloat(cs.height) * fs : parseFloat(cs.height);
      expect(cs.whiteSpace).not.toBe('nowrap'); // a keyword caption wraps to its second line instead of "as in Mo…"
      expect(cs.overflow).toBe('hidden');
      expect(h).toBeCloseTo(2 * lh, 3); // exactly two lines, whatever the state: a tap moves the grid 0 px
      expect(cs.flexShrink).toBe('0');
    }
  });
});

/* ── Second commit: the word pills (same A11 defect) ─────────────────────────────────────────────────────────────
   A pill sits inside a line of text, so its box must be identical in every state: the same element set, the same
   in-flow (visible) text, the same padding. Text that changes with the state may only live out of flow. */

/** Text of every node that takes part in layout (skips anything absolutely positioned, i.e. out of flow). */
function inFlowText(el: Element): string {
  let out = '';
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) { out += n.textContent; return; }
    if (n instanceof Element && getComputedStyle(n).position !== 'absolute') out += inFlowText(n);
  });
  return out;
}
/** The element skeleton (tag + class), ignoring the progress bar (absolute) and the icon's svg (it changes shape). */
function skeleton(el: Element): string[] {
  const out: string[] = [];
  el.querySelectorAll('*').forEach((n) => {
    if (n.closest('svg') || n.closest('.fln-snd__bar')) return;
    out.push(`${n.tagName}.${n.getAttribute('class') ?? ''}`);
  });
  return out;
}
const PAD = ['padding', 'padding-top', 'padding-bottom', 'padding-block', 'padding-block-end', 'padding-inline', 'padding-left', 'padding-right'];
const pad = (el: Element) => PAD.map((p) => `${p}=${getComputedStyle(el).getPropertyValue(p)}`).join(';');

describe.each([
  { name: 'English word pill, no caption', lang: 'en', dir: 'ltr', label: 'cat', caption: undefined },
  { name: 'English pill with a caption', lang: 'en', dir: 'ltr', label: 'c', caption: 'as in Cat' },
  { name: 'Urdu word pill, no caption', lang: 'ur', dir: 'rtl', label: 'بطخ', caption: undefined },
])('SoundPill box is state-independent — $name', ({ lang, dir, label, caption }) => {
  it('same element set, same in-flow text and same padding in every state', async () => {
    const { SoundPill } = await import('../player/SoundPill');
    const f = fakePlayer();
    render(<FlnPlayerProvider player={f.player}><SoundPill clipId="p001" label={label} caption={caption} lang={lang} dir={dir} /></FlnPlayerProvider>);
    const btn = screen.getByRole('button');
    const idle = { sk: skeleton(btn), text: inFlowText(btn), pad: pad(btn) };
    // A11 covers loading/playing (and back to idle). A failure is not "audio loading": A6 requires its retry line to
    // be SHOWN, so the error state may swap the caption for the retry text (checked separately below); its padding
    // still never changes.
    for (const s of STATES) {
      f.emit('p001', s, 0.5);
      expect(btn).toHaveAttribute('data-fln-state', s);
      expect.soft(pad(btn), `padding in ${s}`).toBe(idle.pad);
      if (s === 'error') continue;
      expect.soft(skeleton(btn), `elements in ${s}`).toEqual(idle.sk);
      expect.soft(inFlowText(btn), `in-flow text in ${s}`).toBe(idle.text);
    }
  });

  it('the state is still announced and the retry sentence stays reachable', async () => {
    const { SoundPill } = await import('../player/SoundPill');
    const f = fakePlayer();
    render(<FlnPlayerProvider player={f.player}><SoundPill clipId="p001" label={label} caption={caption} lang={lang} dir={dir} /></FlnPlayerProvider>);
    const btn = screen.getByRole('button');
    const strings = AUDIO_STRINGS[lang as 'en' | 'ur'];
    f.emit('p001', 'playing');
    expect(btn).toHaveTextContent(strings.playing);
    f.emit('p001', 'error');
    expect(btn).toHaveTextContent(strings.error);
    // A6: the retry line is SHOWN — in flow, not only in the visually-hidden state element — in place of the caption.
    expect(inFlowText(btn)).toContain(strings.error);
    if (caption) expect(inFlowText(btn)).not.toContain(caption);
    expect(btn.getAttribute('aria-label')).toContain(strings.error);
    expect(btn.getAttribute('title')).toBe(strings.error);
  });
});

describe('SoundTile — retry sentence and Nastaliq fit', () => {
  it('an error tile carries the full retry sentence in aria-label and title (its visible line may be ellipsised)', () => {
    for (const lang of ['en', 'ur'] as const) {
      const f = fakePlayer();
      render(<FlnPlayerProvider player={f.player}><SoundTile clipId="x001" label="b" lang={lang} /></FlnPlayerProvider>);
      const btn = screen.getByRole('button');
      f.emit('x001', 'error');
      expect(btn.getAttribute('aria-label')).toContain(AUDIO_STRINGS[lang].error);
      expect(btn.getAttribute('title')).toBe(AUDIO_STRINGS[lang].error);
      f.emit('x001', 'idle');
      expect(btn.hasAttribute('title')).toBe(false);
      cleanup();
    }
  });

  it('Urdu state line: font-size × line-height ≤ the fixed height', () => {
    const f = fakePlayer();
    render(<FlnPlayerProvider player={f.player}><SoundTile clipId="x001" label="ب" lang="ur" dir="rtl" /></FlnPlayerProvider>);
    const cs = getComputedStyle(screen.getByRole('button').querySelector('.fln-snd__sub') as HTMLElement);
    const fs = parseFloat(cs.fontSize);
    const lh = cs.lineHeight.endsWith('px') ? parseFloat(cs.lineHeight) : parseFloat(cs.lineHeight) * fs;
    const h = cs.height.endsWith('em') ? parseFloat(cs.height) * fs : parseFloat(cs.height);
    expect(fs).toBe(13);
    expect(lh).toBeLessThanOrEqual(h);
    // eslint-disable-next-line no-console
    console.log(`URDU_FIT font-size=${cs.fontSize} line-height=${cs.lineHeight} (=${lh}px) height=${cs.height} (=${h}px)`);
  });
});
