'use strict';
const S = require('../../../bot/shared/services/assessment/board-render/scheme-items');
const { itemsBySlot } = require('../../../bot/shared/services/assessment/board-render/layout');
const fx = require('./_fixtures');

const ctx = (rtl) => ({ rtl, lang: rtl ? 'ur' : 'en' });
const sum = (html, attr) => [...html.matchAll(new RegExp(`${attr}="([0-9.]+)"`, 'g'))].reduce((n, m) => n + Number(m[1]), 0);
const sec = (exam, i, by = itemsBySlot(exam), rtl = false) => S.schemeSection(exam._layout, exam._layout.sections[i], by, ctx(rtl));

describe('board-render/scheme-items', () => {
  test('analytic points: each item lists its points; per-slot total is attempt × marks_each', () => {
    const html = sec(fx.fbiseNon(), 1);
    expect(html).toContain('point one');
    expect(sum(html, 'data-slot-total')).toBe(30);
    expect(sum(html, 'data-section-total')).toBe(30);
  });
  test('holistic bands render a band table', () => {
    const html = sec(fx.urdu(), 1, undefined, true);
    expect(html).toContain('class="bands"');
    expect(html).toContain('Complete answer');
  });
  test('MCQ rows show the key letter with the option text', () => {
    const html = sec(fx.fbise50(), 0);
    expect(html).toContain('B');
    expect(html).toContain('beta');
  });
  test('blooms and official SLO print per item when present, and not when absent', () => {
    const exam = fx.fbiseNon();
    const by = itemsBySlot(exam);
    expect(sec(exam, 1, by)).toMatch(/Bloom.*U/);
    expect(sec(exam, 1, by)).toContain('S-09-0');
    by.get('B.Q2 (i)-(x)').forEach((q) => { delete q.tag; });
    const html = sec(exam, 1, by);
    expect(html).not.toContain('S-09-0');
    expect(html).not.toMatch(/Bloom/);
  });
  test('teacher-marked slot prints criteria and its marks', () => {
    const exam = fx.fbiseNon();
    exam._layout.slots.find((s) => s.slot === 'D.Q11').project.criteria_en = ['Neat', 'On topic'];
    const html = sec(exam, 3);
    expect(html).toContain('Teacher-marked project work.');
    expect(html).toContain('On topic');
    expect(html).toContain('data-slot-total="4"');
  });
  test('class record has a column per section, a total and blank rows', () => {
    const L = fx.fbise50()._layout;
    const html = S.classRecord(L, ctx(false), 5);
    expect(html).toContain('Class record');
    expect((html.match(/<tr class="rec-row">/g) || [])).toHaveLength(5);
    expect(html).toContain('Section A');
    expect(html).toContain('60');
  });
});
