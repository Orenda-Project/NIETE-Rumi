'use strict';
const L = require('../../../bot/shared/services/assessment/board-render/layout');
const css = require('../../../bot/shared/services/assessment/board-render/css');
const fx = require('./_fixtures');

describe('board-render/layout', () => {
  test('layoutOf refuses a paper with no board layout', () => {
    expect(() => L.layoutOf({})).toThrow(/NO_LAYOUT/);
    expect(() => L.layoutOf({ _layout: { sections: [] } })).toThrow(/NO_LAYOUT/);
    expect(() => L.layoutOf({ _layout: { sections: [{}], slots: 'x' } })).toThrow(/NO_LAYOUT/);
  });
  test('layoutOf returns the layout of a board paper', () => {
    const exam = fx.fbise50();
    expect(L.layoutOf(exam)).toBe(exam._layout);
  });
  test('itemsBySlot groups items by slot id and never reads _layout', () => {
    const exam = fx.fbiseNon();
    const by = L.itemsBySlot(exam);
    expect(by.get('A.Q1')).toHaveLength(12);
    expect(by.get('D.Q9')).toHaveLength(2);
    expect(by.get('D.Q11')).toBeUndefined();
  });
  test('slotsOf lists the flat slots of one section in order', () => {
    const exam = fx.fbiseNon();
    expect(L.slotsOf(exam._layout, 'D').map((s) => s.slot)).toEqual(['D.Q9', 'D.Q10', 'D.Q11']);
  });
  test('isRtl reads _layout.rtl', () => {
    expect(L.isRtl(fx.urdu()._layout)).toBe(true);
    expect(L.isRtl(fx.fbise50()._layout)).toBe(false);
  });
  test('css carries direction and font faces for an rtl paper', () => {
    expect(css.css(true)).toContain('direction:rtl');
    expect(css.css(false)).not.toContain('direction:rtl');
    expect(css.css(false)).toContain('@page');
  });
});
