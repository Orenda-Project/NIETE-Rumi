'use strict';
const T = require('../../../bot/shared/services/assessment/board-render/text');

describe('board-render/text', () => {
  test('esc escapes markup', () => {
    expect(T.esc('<b>"a"&</b>')).toBe('&lt;b&gt;&quot;a&quot;&amp;&lt;/b&gt;');
  });
  test('Urdu digits for rtl text, each number its own span', () => {
    const out = T.textOf('Q 12 and 3.5', true);
    expect(out).toContain('<span class="num">۱۲</span>');
    expect(out).toContain('<span class="num">۳.۵</span>');
    expect(out).not.toMatch(/[0-9]/);
  });
  test('ltr text keeps Western digits', () => {
    expect(T.textOf('12', false)).toBe('12');
  });
  test('fmtMarks prints quarter marks as fractions', () => {
    expect(T.fmtMarks(30)).toBe('30');
    expect(T.fmtMarks(0.5)).toBe('½');
    expect(T.fmtMarks(1.5)).toBe('1½');
    expect(T.fmtMarks(2.25)).toBe('2¼');
    expect(T.fmtMarks(0.75)).toBe('¾');
  });
  test('marksText fills the {n:}/{t:} atoms and typesets fractional marks', () => {
    expect(T.marksText('({n:60} × 0.5 = {t:30})', false)).toBe('(60 × ½ = 30)');
    expect(T.marksText('({t:3})', false)).toBe('(3)');
    expect(T.marksText('{n:60} × 0.5 = {t:30}', true)).toContain('۶۰');
  });
  test('textOf does not turn a decimal in a question into a fraction', () => {
    expect(T.textOf('a 3.5 kg block', false)).toBe('a 3.5 kg block');
  });
});
