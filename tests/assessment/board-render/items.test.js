'use strict';
const I = require('../../../bot/shared/services/assessment/board-render/items');
const { itemsBySlot } = require('../../../bot/shared/services/assessment/board-render/layout');
const fx = require('./_fixtures');

const count = (html, s) => html.split(s).length - 1;
const ctx = (rtl) => ({ rtl, lang: rtl ? 'ur' : 'en' });
const block = (exam, i, rtl = false) => I.sectionBlock(exam._layout, exam._layout.sections[i], itemsBySlot(exam), ctx(rtl));

describe('board-render/items', () => {
  test('MCQ section on the paper: one 4-bubble row per question', () => {
    const html = block(fx.fbise50(), 0);
    expect(count(html, 'class="bub"')).toBe(60 * 4);
    expect(html).toContain('(40 × ½ = 20)');
    expect(html).toContain('(20 × ½ = 10)');
  });
  test('stimulus prints once above its MCQs', () => {
    const html = block(fx.fbise50(), 0);
    expect(count(html, 'Fictional passage 0.')).toBe(1);
    expect(count(html, 'class="stim"')).toBe(5);
    expect(html.indexOf('Fictional passage 0.')).toBeLessThan(html.indexOf('A.Q41-60 #1?'));
  });
  test('an OR slot prints OR between its branches; Urdu says یا', () => {
    const html = block(fx.fbiseNon(), 3);
    expect(count(html, 'class="or"')).toBe(1);
    expect(html).toContain('>OR<');
    expect(I.orWord(true)).toBe('یا');
  });
  test('"Attempt any N" line is computed from attempt < printed', () => {
    const html = block(fx.fbiseNon(), 3);
    expect(html).toContain('Attempt any 3 questions.');
    expect(html).toContain('(3 × 2 = 6)');
  });
  test('teacher-marked slot prints instruction and marks only, no items', () => {
    const html = block(fx.fbiseNon(), 3);
    expect(html).toContain('Teacher-marked project work.');
    expect(html).toContain('class="teacher-slot"');
    expect(html).toContain('(4)');
  });
  test('timed parts print their head lines and the handover line', () => {
    const html = block(fx.fbiseNon(), 3);
    expect(html).toContain('D1');
    expect(html).toContain('20 min');
    expect(html).toContain('Hand in Part D1 now.');
    expect(count(html, 'class="handover"')).toBe(1);
  });
  test('no tag, key or answer strings in the child html', () => {
    const html = block(fx.fbise50(), 0);
    expect(html).not.toMatch(/SECRET|official_slo|S-09-|LO-\d|difficulty|blooms/);
  });
  test('rtl section converts digits to Urdu digits', () => {
    expect(block(fx.urdu(), 0, true)).toContain('<span class="num">۱</span>');
  });
  test('a label the model wrote on an option is not printed twice (bd-5jmnfj.38.30)', () => {
    const exam = fx.fbise50();
    const first = exam._layout.slots[0].slot;
    const by = itemsBySlot(exam);
    const item = by.get(first)[0];
    item.options = ['A) J.J. Thomson', 'B. Rutherford', '(c) Bohr', 'C. elegans'];
    const html = I.sectionBlock(exam._layout, exam._layout.sections[0], by, ctx(false));
    expect(html).toContain('A. J.J. Thomson');
    expect(html).toContain('B. Rutherford');
    expect(html).toContain('C. Bohr');
    expect(html).not.toMatch(/A\. A\)|B\. B\.|C\. \(c\)/);
    expect(html).toContain('D. C. elegans'); // a letter that is not its own label is text, kept
  });
});

