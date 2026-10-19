import { describe, it, expect } from 'vitest';
import { WHATSAPP_URL_PICKER } from '@/lib/whatsapp';
import { shareMessage, waUrl, withSrc, MAX_CODE_POINTS } from './message';

/**
 * The WhatsApp text a leader shares (contracts/deep-link.md v2): line 1 the subject and the LEVEL (never
 * a grade) in the leader's language, line 2 the title in the PLAN's language, line 3 the URL alone with ?src=wa.
 * Urdu chrome: «—» separators, Urdu digits. ≤300 code points; the title is cut, never the URL.
 */
const URL_ = 'https://portal.example.test/portal/fln/p/11156';
const cp = (s: string) => Array.from(s).length;

describe('shareMessage — English chrome', () => {
  it('three lines: kicker with the level, the title, the URL with ?src=wa alone on its line', () => {
    const m = shareMessage({ uiLang: 'en', subject: 'rh-en', level: 1, title: "Sounds of 'c/k, e, h, r, m, d' (Fluency)", url: URL_ });
    expect(m.split('\n')).toEqual([
      '📘 Reading Hour · English · Level 1',
      "Sounds of 'c/k, e, h, r, m, d' (Fluency)",
      `${URL_}?src=wa`,
    ]);
  });
  it('never names a grade', () => {
    const m = shareMessage({ uiLang: 'en', subject: 'num', level: 3, title: 'Long division', url: URL_ });
    expect(m).not.toMatch(/grade/i);
    expect(m.split('\n')[0]).toBe('📘 Numeracy · Level 3');
  });
});

describe('shareMessage — Urdu chrome', () => {
  it('«—» separators and Urdu digits on line 1; the plan title stays in its own language', () => {
    const m = shareMessage({ uiLang: 'ur', subject: 'rh-ur', level: 1, title: 'حروف کی آوازیں', url: URL_ });
    const [l1, l2, l3] = m.split('\n');
    expect(l1).toBe('📘 ریڈنگ آور — اردو — سطح ۱');
    expect(l1).not.toContain('·');
    expect(l1).not.toMatch(/[0-9]/);
    expect(l2).toBe('حروف کی آوازیں');
    expect(l3).toBe(`${URL_}?src=wa`);
  });
  it('an English plan shared from Urdu chrome keeps its English title; the URL keeps ASCII digits', () => {
    const m = shareMessage({ uiLang: 'ur', subject: 'rh-en', level: 2, title: 'Blends and digraphs', url: URL_ });
    expect(m.split('\n')).toEqual(['📘 ریڈنگ آور — انگریزی — سطح ۲', 'Blends and digraphs', `${URL_}?src=wa`]);
  });
});

describe('shareMessage — limits', () => {
  it('a long title is cut with an ellipsis to fit 300 code points; the URL line is whole', () => {
    const title = 'ب'.repeat(500);
    const m = shareMessage({ uiLang: 'ur', subject: 'rh-ur', level: 3, title, url: URL_ });
    expect(cp(m)).toBeLessThanOrEqual(MAX_CODE_POINTS);
    expect(cp(m)).toBe(MAX_CODE_POINTS);
    const lines = m.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1].endsWith('…')).toBe(true);
    expect(lines[2]).toBe(`${URL_}?src=wa`);
  });
  it('counts code points, not UTF-16 units (an emoji is one)', () => {
    const title = '😀'.repeat(400);
    const m = shareMessage({ uiLang: 'en', subject: 'rh-en', level: 1, title, url: URL_ });
    expect(cp(m)).toBeLessThanOrEqual(MAX_CODE_POINTS);
    expect(m.length).toBeGreaterThan(MAX_CODE_POINTS);
  });
  it('newlines inside a title cannot push the URL off its own line', () => {
    const m = shareMessage({ uiLang: 'en', subject: 'rh-en', level: 1, title: 'A\nB\r\nC', url: URL_ });
    expect(m.split('\n')).toEqual(['📘 Reading Hour · English · Level 1', 'A B C', `${URL_}?src=wa`]);
  });
});

describe('withSrc / waUrl', () => {
  it('appends src=wa once, with & when a query exists', () => {
    expect(withSrc(URL_)).toBe(`${URL_}?src=wa`);
    expect(withSrc(`${URL_}?src=wa`)).toBe(`${URL_}?src=wa`);
    expect(withSrc(`${URL_}?x=1`)).toBe(`${URL_}?x=1&src=wa`);
  });
  it('wa.me with the whole message encoded', () => {
    const m = shareMessage({ uiLang: 'en', subject: 'rh-en', level: 1, title: 'A & B', url: URL_ });
    const u = waUrl(m);
    const pre = `${WHATSAPP_URL_PICKER}?text=`;
    expect(pre).toBe('https:' + '//wa.me/?text=');
    expect(u.startsWith(pre)).toBe(true);
    expect(decodeURIComponent(u.slice(pre.length))).toBe(m);
    expect(u).not.toContain(' ');
  });
});
