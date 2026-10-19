'use strict';
/**
 * The class round's teacher screens in Urdu write their numbers in Urdu digits (U+06F0–06F9): the teacher's count
 * (jg.round.t_count) and the paused card's line (jg.round.t_paused). A teacher's screen has no Western keypad or
 * cells, so the copy rule's Western exception does not apply. English is unchanged. The real page module runs.
 */
const Page = require('../../../shared/templates/class-round.page');

const TOKEN = 'eyJrIjoidHIifQ.AAAAAAAAAAAAAAAAAAAAAA';
const rows = (n, done, absent) => Array.from({ length: n }, (_, i) => ({
  pos: i, name: `Kid${i + 1} Testwala`, s: i < done ? 'done' : (i < done + absent ? 'absent' : 'todo'), now: i === done + absent,
}));
const URDU_DIGIT = /[۰-۹]/;

describe('the teacher\'s count', () => {
  test('Urdu: «۳۱ میں سے ۱۴ مکمل، ۲ غیر حاضر», no ASCII digit in the count line', () => {
    const html = Page.renderRound({ mode: 'teacher', rows: rows(31, 14, 2) }, { lang: 'ur', token: TOKEN });
    const line = html.match(/<p class="count">([^<]*)<\/p>/)[1];
    expect(line).toBe('۳۱ میں سے ۱۴ مکمل، ۲ غیر حاضر');
    expect(line).not.toMatch(/[0-9]/);
  });

  test('English: unchanged, ASCII digits', () => {
    const html = Page.renderRound({ mode: 'teacher', rows: rows(31, 14, 2) }, { lang: 'en', token: TOKEN });
    expect(html.match(/<p class="count">([^<]*)<\/p>/)[1]).toBe('14 of 31 done, 2 absent');
  });
});

describe('the paused card\'s line', () => {
  const d = require('../../../shared/config/copy.v2.json')['jg.round.t_paused'];

  test('Urdu: the deck\'s line with Urdu digits («۳۱ میں سے ۱۴ …»)', () => {
    const html = Page.renderCard({ lang: 'ur', token: TOKEN, started: true, paused: { done: 14, total: 31 } });
    const line = html.match(/<p class="cr-paused"[^>]*>([^<]*)<\/p>/)[1];
    expect(line).toBe(d.ur.replace('{done}', '۱۴').replace('{total}', '۳۱'));
    expect(line).toMatch(URDU_DIGIT);
    expect(line).not.toMatch(/[0-9]/);
  });

  test('English: unchanged, ASCII digits', () => {
    const html = Page.renderCard({ lang: 'en', token: TOKEN, started: true, paused: { done: 14, total: 31 } });
    expect(html).toContain('14 of 31 played. Continue another day.');
  });

  test('zero and a bad number stay a zero in either system', () => {
    expect(Page.renderCard({ lang: 'ur', token: TOKEN, started: true, paused: { done: 'x', total: 0 } })).toContain(d.ur.replace('{done}', '۰').replace('{total}', '۰'));
    expect(Page.renderCard({ lang: 'en', token: TOKEN, started: true, paused: { done: 'x', total: 0 } })).toContain('0 of 0 played.');
  });
});
