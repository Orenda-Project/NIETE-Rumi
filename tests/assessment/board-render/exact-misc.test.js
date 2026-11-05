'use strict';
// Exact-output pins for text.js, header.js, layout.js and the two renderer shells.
const T = require('../../../bot/shared/services/assessment/board-render/text');
const H = require('../../../bot/shared/services/assessment/board-render/header');
const L = require('../../../bot/shared/services/assessment/board-render/layout');
const { renderBoardPaper } = require('../../../bot/shared/services/assessment/assessment-paper-board.renderer');
const { renderBoardScheme } = require('../../../bot/shared/services/assessment/assessment-scheme-board.renderer');

describe('text exact', () => {
  test('esc of null/undefined is empty, of 0 is "0"', () => {
    expect(T.esc(null)).toBe('');
    expect(T.esc(undefined)).toBe('');
    expect(T.esc(0)).toBe('0');
  });
  test('rtl decimals of any length are one span', () => {
    expect(T.textOf('3.55', true)).toBe('<span class="num">۳.۵۵</span>');
    expect(T.textOf('a 12', true)).toBe('a <span class="num">۱۲</span>');
  });
  test('fmtMarks', () => {
    expect(T.fmtMarks(0)).toBe('0');
    expect(T.fmtMarks(2.1)).toBe('2.1');
    expect(T.fmtMarks(0.1)).toBe('.1');
    expect(T.fmtMarks(12.75)).toBe('12¾');
  });
  test('marksText typesets bare decimals at the start, after digits and with long fractions', () => {
    expect(T.marksText('2.5', false)).toBe('2½');
    expect(T.marksText('12.5', false)).toBe('12½');
    expect(T.marksText('1.25 marks', false)).toBe('1¼ marks');
    expect(T.marksText('a 2.5', false)).toBe('a 2½');
    expect(T.marksText('3.55', false)).toBe('3.55');
    expect(T.marksText(null, false)).toBe('');
    expect(T.marksText('{n:2.5} x', false)).toBe('2½ x');
  });
});

describe('header exact', () => {
  const lay = (h, sections) => ({ header: h, sections: sections || [] });
  test('header lines', () => {
    expect(H.headerBlock(lay({ lines_en: ['Line {t:30}', 'Half 0.5'] }), 'en')).toBe('<div class="hdr"><div>Line 30</div><div>Half ½</div></div>');
    expect(H.headerBlock(lay({ lines_ur: ['۱ {t:5}'] }), 'ur')).toBe('<div class="hdr"><div>۱ <span class="num">۵</span></div></div>');
    expect(H.headerBlock(lay({ lines_en: [] }), 'en')).toBe('');
    expect(H.headerBlock(lay({ lines_en: 'x' }), 'en')).toBe('');
    expect(H.headerBlock(lay({ lines_en: ['a'] }), 'ur')).toBe('');
    expect(H.headerBlock(lay(undefined), 'en')).toBe('');
  });
  const roll = (num) => Array.from({ length: 6 }, () => `<div class="bubcol">${Array.from({ length: 10 }, (_, d) => `<div>${num(d)} <span class="bub"></span></div>`).join('')}</div>`).join('');
  const ver = ['A', 'B', 'C', 'D'].map((v) => `<div>${v} <span class="bub"></span></div>`).join('');
  test('bubble block english and urdu, exact', () => {
    const sections = [{ answer_on: 'omr' }, { answer_on: 'question_paper' }];
    expect(H.bubbleBlock(lay(null, sections), 'en')).toBe(`<div class="bubbles"><div><b>Roll No</b><div style="display:flex;gap:6px">${roll((d) => d)}</div></div><div><b>Version</b>${ver}</div></div>`);
    const urd = '۰۱۲۳۴۵۶۷۸۹';
    expect(H.bubbleBlock(lay(null, sections), 'ur')).toBe(`<div class="bubbles"><div><b>رول نمبر</b><div style="display:flex;gap:6px">${roll((d) => `<span class="num">${urd[d]}</span>`)}</div></div><div><b>ورژن</b>${ver}</div></div>`);
  });
  test('answer notes, exact in both languages', () => {
    expect(H.noteFor({ answer_on: 'omr' }, 'en')).toBe('Answer on the OMR sheet.');
    expect(H.noteFor({ answer_on: 'e_sheet' }, 'en')).toBe('Write the answers on the separate answer sheet.');
    expect(H.noteFor({ answer_on: 'omr' }, 'ur')).toBe('جواب OMR شیٹ پر دیں۔');
    expect(H.noteFor({ answer_on: 'e_sheet' }, 'ur')).toBe('جوابات الگ جوابی کاپی پر لکھیں۔');
    expect(H.noteFor({ answer_on: 'omr', note_ur: 'نوٹ' }, 'ur')).toBe('نوٹ');
    expect(H.noteFor({ answer_on: 'omr', note_ur: 'نوٹ' }, 'en')).toBe('Answer on the OMR sheet.');
  });
});

describe('layout exact', () => {
  test('NO_LAYOUT error carries its code and message', () => {
    let err;
    try { L.layoutOf({}); } catch (e) { err = e; }
    expect(err.code).toBe('NO_LAYOUT');
    expect(err.message).toBe('NO_LAYOUT: this renderer only prints board-pattern papers');
    for (const bad of [null, 'x', 5, { sections: [], slots: [] }, { sections: [{}] }, { sections: {}, slots: [] }]) {
      expect(() => L.layoutOf({ _layout: bad })).toThrow(/NO_LAYOUT/);
    }
    expect(() => L.layoutOf({ _layout: { sections: [{}], slots: [] } })).not.toThrow();
  });
  test('itemsBySlot skips every malformed branch, type bucket, list and item', () => {
    const live = { slot: 'X', question: 'live' };
    for (const junk of [null, 'str', 7]) {
      const by = L.itemsBySlot({ seen: junk, unseen: { t: junk, u: { k: junk, l: [live] } } });
      expect(by.get('X')).toEqual([live]);
    }
    const by = L.itemsBySlot({
      seen: { a: { l: [null, 'str', { slot: 'X', removed: true }, { question: 'noslot' }, live, { slot: 'Y', removed: false }] } },
      unseen: { a: { l: [{ slot: 'X', question: 'two' }] } },
    });
    expect(by.get('X').map((q) => q.question)).toEqual(['live', 'two']);
    expect(by.get('Y')).toHaveLength(1);
    expect([...by.keys()]).toEqual(['X', 'Y']);
  });
});

describe('renderer shells', () => {
  const base = (extra) => ({ _layout: { sections: [{ id: 'A', marks: 1, answer_on: 'omr' }], slots: [], ...extra } });
  test('paper footer and html root', () => {
    expect(renderBoardPaper(base({}))).toContain('<div class="footer">Page {n} of {N}</div></body></html>');
    expect(renderBoardPaper(base({ rtl: true }))).toContain('<div class="footer">صفحہ {n} از {N}</div>');
    expect(renderBoardPaper(base({}))).toMatch(/^<!DOCTYPE html><html lang="en" dir="ltr"><head><meta charset="utf-8"><style>/);
  });
  test('scheme title and legend, exact', () => {
    const lg = { title_en: 'Key <1>', lines_en: ['one', 'two'], title_ur: 'عنوان', lines_ur: ['ایک'] };
    expect(renderBoardScheme(base({ legend: lg }))).toContain('<h2 class="hdr">Marking Scheme</h2><div class="legend"><b>Key &lt;1&gt;</b><ul><li>one</li><li>two</li></ul></div>');
    expect(renderBoardScheme(base({ legend: lg, rtl: true }))).toContain('<h2 class="hdr">مارکنگ اسکیم</h2><div class="legend"><b>عنوان</b><ul><li>ایک</li></ul></div>');
    expect(renderBoardScheme(base({ legend: {} }))).toContain('<div class="legend"><b></b><ul></ul></div>');
    expect(renderBoardScheme(base({}))).not.toContain('class="legend"');
  });
});
