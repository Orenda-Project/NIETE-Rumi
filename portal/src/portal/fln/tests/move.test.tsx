import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, act } from '@testing-library/react';

/**
 * bd-t7zk3t.11 — a numbered move: the markdown subset ONLY (bold, italic, line breaks, `1. ` lines), everything else
 * as escaped TEXT (never innerHTML); every audio occurrence its own pill; the label chain from the player's clips.ts;
 * images in reserved boxes with one silent retry from `orig`; videos never preloaded; pdf as a ≥48 px link.
 */
vi.mock('../player', async (orig) => (await import('./fixtures/playerMock')).withStandIns(await orig()));

import { resetPlayerMock } from './fixtures/playerMock';
import { Move } from '../plan/Move';
import { MediaImage } from '../plan/MediaImage';
import { MediaVideo } from '../plan/MediaVideo';
import type { FlnItem, FlnMedia } from '../types';

const A = 'https://media.example.org/fln/audio';
const au = (sha8: string, extra: Partial<FlnMedia> = {}): FlnMedia => ({ kind: 'audio', src: `${A}/${sha8}/f_${sha8}.mp3`, orig: `${A}/o/${sha8}.mp3`, sha8, role: 'sound', ...extra });

function mv(item: FlnItem, lang: 'en' | 'ur' = 'en', n = 1) {
  return render(<Move item={item} n={n} planLang={lang} planDir={lang === 'ur' ? 'rtl' : 'ltr'} uiLang="en" />);
}

beforeEach(() => resetPlayerMock());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Move — markdown subset', () => {
  it('renders **bold**, *italic* and line breaks as elements', () => {
    const { container } = mv({ kind: 'instruction', text: 'Say **pen** and *pan*\nthen stop', media: [] });
    expect(container.querySelector('b')!.textContent).toBe('pen');
    expect(container.querySelector('i')!.textContent).toBe('pan');
    expect(container.querySelectorAll('br').length).toBe(1);
    expect(container.textContent).toContain('then stop');
  });

  it('keeps `1. ` lines as their own lines', () => {
    const { container } = mv({ kind: 'instruction', text: 'Steps:\n1. First\n2. Second', media: [] });
    const lines = container.querySelectorAll('.fln-line-num');
    expect(lines.length).toBe(2);
    expect(lines[0].textContent).toBe('1. First');
  });

  it('renders <script> and <img onerror> as TEXT, never as elements', () => {
    const evil = 'Hi <script>window.__x=1</script> and <img src=x onerror="window.__y=1"> **<b>bold</b>**';
    const { container } = mv({ kind: 'instruction', text: evil, media: [] });
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<script>window.__x=1</script>');
    expect(container.textContent).toContain('<img src=x onerror="window.__y=1">');
    expect(container.querySelector('b')!.textContent).toBe('<b>bold</b>');
    expect((window as unknown as { __x?: number }).__x).toBeUndefined();
  });

  it('labels say/ask/answer items and leaves instructions unlabelled', () => {
    const say = mv({ kind: 'say', text: 'Hello', media: [] });
    expect(say.container.querySelector('.fln-kind')!.textContent).toBe('Say:');
    cleanup();
    const ins = mv({ kind: 'instruction', text: 'Q: 2 + 2? A: 4', media: [] });
    expect(ins.container.querySelector('.fln-kind')).toBeNull();
  });

  it('isolates Latin and ASCII-digit runs in RTL text', () => {
    const { container } = mv({ kind: 'instruction', text: 'استاد سبق 3 میں SLO پڑھیں', media: [] }, 'ur');
    const bdis = [...container.querySelectorAll('bdi')].map((b) => b.textContent);
    expect(bdis).toContain('3');
    expect(bdis).toContain('SLO');
  });
});

describe('Move — media', () => {
  it('gives EVERY audio occurrence its own pill (repeats included, same clip id)', () => {
    const { container } = mv({ kind: 'instruction', text: 'Repeat **p** **p**', media: [au('aa000001'), au('aa000001'), au('aa000002')] });
    const pills = [...container.querySelectorAll('[data-fln-clip]')].map((p) => p.getAttribute('data-fln-clip'));
    expect(pills).toEqual(['aa000001', 'aa000001', 'aa000002']);
  });

  it('label chain: label_ur ?? label_en → first **bold** run → filename stem', () => {
    const urdu = mv({ kind: 'instruction', text: 'حرف **ب** سنیں', media: [au('u1', { label_ur: 'ب', label_en: 'Bay' }), au('u2'), au('u3', { label_en: 'Pay' })] }, 'ur');
    const labels = [...urdu.container.querySelectorAll('[data-fln-clip]')].map((p) => p.textContent);
    expect(labels).toEqual(['ب', 'ب', 'Pay']);
    cleanup();
    const stem = mv({ kind: 'instruction', text: 'no bold here', media: [au('e1')] });
    expect(stem.container.querySelector('[data-fln-clip]')!.textContent).toBe('f_e1');
  });

  it('renders a pdf as a ≥48 px link opening in a new tab', () => {
    const { container } = mv({ kind: 'instruction', text: 'Open it', media: [{ kind: 'pdf', src: 'https://media.example.org/x.pdf' }] });
    const a = container.querySelector('a.fln-pdf') as HTMLAnchorElement;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(a.textContent).toBe('Open the worksheet');
  });

  it('image: reserved aspect-ratio box, lazy, alt = step text; one silent retry from orig, then the failed caption', () => {
    vi.useFakeTimers();
    const m: FlnMedia = { kind: 'image', src: 'https://m.example.org/a.webp', orig: 'https://o.example.org/a.png', w: 800, h: 600 };
    const { container, getByText } = render(<MediaImage media={m} alt="  Show the picture.  " uiLang="en" />);
    const box = container.querySelector('.fln-pic') as HTMLElement;
    expect(box.style.aspectRatio).toBe('800 / 600');
    let im = container.querySelector('img')!;
    expect(im.getAttribute('loading')).toBe('lazy');
    expect(im.getAttribute('decoding')).toBe('async');
    expect(im.getAttribute('alt')).toBe('Show the picture.');
    fireEvent.error(im);
    im = container.querySelector('img')!;
    expect(im.getAttribute('src')).toBe('https://o.example.org/a.png');
    fireEvent.error(im);
    expect(getByText("Picture couldn't load")).toBeTruthy();
    expect((container.querySelector('.fln-pic') as HTMLElement).style.aspectRatio).toBe('800 / 600');
  });

  it('image: 6 s without load switches to orig once', () => {
    vi.useFakeTimers();
    const m: FlnMedia = { kind: 'image', src: 'https://m.example.org/b.webp', orig: 'https://o.example.org/b.png' };
    const { container } = render(<MediaImage media={m} alt="x" uiLang="en" />);
    expect((container.querySelector('.fln-pic') as HTMLElement).style.aspectRatio).toBe('4 / 3');
    act(() => { vi.advanceTimersByTime(6100); });
    expect(container.querySelector('img')!.getAttribute('src')).toBe('https://o.example.org/b.png');
  });

  it('image: tap opens a full-screen overlay with `full` and a close button', () => {
    const m: FlnMedia = { kind: 'image', src: 'https://m.example.org/c.webp', full: 'https://o.example.org/c-full.png', w: 4, h: 3 };
    const { container, getByRole } = render(<MediaImage media={m} alt="x" uiLang="en" />);
    fireEvent.click(container.querySelector('button.fln-pic-open')!);
    const dlg = getByRole('dialog');
    expect(dlg.querySelector('img')!.getAttribute('src')).toBe('https://o.example.org/c-full.png');
    fireEvent.click(getByRole('button', { name: 'Close' }));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('video: poster + Watch button, no src until tapped, preload none', () => {
    const m: FlnMedia = { kind: 'video', src: 'https://m.example.org/v.mp4', poster: 'https://m.example.org/v.jpg', duration_s: 660, bytes: 26_000_000, src_low: 'https://m.example.org/v360.mp4' };
    const { container, getByRole } = render(<MediaVideo media={m} uiLang="en" />);
    expect(container.querySelector('video')).toBeNull();
    const btn = getByRole('button', { name: 'Watch · 11 min · 26 MB' });
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
    fireEvent.click(btn);
    const v = container.querySelector('video')!;
    expect(v.getAttribute('preload')).toBe('none');
    expect(v.getAttribute('src')).toBe('https://m.example.org/v.mp4');
  });

  it('video: 5 s in waiting offers the smaller video', () => {
    vi.useFakeTimers();
    const m: FlnMedia = { kind: 'video', src: 'https://m.example.org/v.mp4', duration_s: 60, bytes: 5_000_000, src_low: 'https://m.example.org/v360.mp4' };
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
    const { container, getByRole, queryByRole } = render(<MediaVideo media={m} uiLang="en" />);
    fireEvent.click(getByRole('button', { name: /Watch/ }));
    fireEvent(container.querySelector('video')!, new Event('waiting'));
    expect(queryByRole('button', { name: 'Smaller video' })).toBeNull();
    act(() => { vi.advanceTimersByTime(5100); });
    fireEvent.click(getByRole('button', { name: 'Smaller video' }));
    expect(container.querySelector('video')!.getAttribute('src')).toBe('https://m.example.org/v360.mp4');
  });
});
