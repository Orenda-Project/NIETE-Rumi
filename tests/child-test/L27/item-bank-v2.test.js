'use strict';
/**
 * bd-s1oo0.46.3 (L27) — the v2 item bank through its accessor (CONTRACT §19): the oral maths items are
 * reachable by id, the script lines and the oral set have their own readers, and the two v2 switches
 * (CHILD_TEST_BATTERY, CHILD_TEST_MATHS_MODE) read v2 by default. Pure module; nothing to mock.
 */
const bank = require('../../../bot/shared/services/child-test/item-bank');

describe('item bank v2 accessor', () => {
  test('every oral maths item resolves through getItem, with its kind', () => {
    for (const g of [3, 5]) for (const f of ['A', 'B']) {
      const o = bank.getOral(g, f);
      expect(o.compare).toHaveLength(4);
      expect(o.sums).toHaveLength(4);
      expect(o.word_problems).toHaveLength(2);
      for (const [kind, list] of [['oral.compare', o.compare], ['oral.sums', o.sums], ['oral.word_problems', o.word_problems]]) {
        for (const it of list) {
          const hit = bank.getItem(it.id);
          expect(hit).toEqual({ grade: String(g), form: f, block: 'maths', kind, item: it });
        }
      }
    }
    expect(bank.getItem('m3A-oc4').item).toMatchObject({ a: 3826, b: 2863, answer: 3826, label: 'D' });
    expect(bank.getItem('m5A-os4').item).toMatchObject({ prompt: '72 ÷ 6', answer: 12 });
    expect(bank.getItem('m3A-owp2').item.answer).toBe(12);
  });

  test('getScript returns the words the coach says, per block; maths reads the oral script', () => {
    expect(bank.getScript(3, 'A', 'urdu').start.endsWith(bank.cue.urdu.start)).toBe(true);
    expect(bank.getScript(3, 'A', 'english').stop).toBe(bank.cue.english.stop);
    expect(bank.getScript(5, 'B', 'maths').wp_intro).toBe(bank.cue.maths.word_problems);
    expect(() => bank.getScript(3, 'A', 'science')).toThrow(/unknown block/);
  });

  test('the switches read v2 by default and v1 only when set to it', () => {
    expect(bank.batteryVersion({})).toBe('v2');
    expect(bank.batteryVersion({ CHILD_TEST_BATTERY: 'v1' })).toBe('v1');
    expect(bank.batteryVersion({ CHILD_TEST_BATTERY: ' V1 ' })).toBe('v1');
    expect(bank.batteryVersion({ CHILD_TEST_BATTERY: 'v3' })).toBe('v2');
    expect(bank.mathsMode({})).toBe('oral');
    expect(bank.mathsMode({ CHILD_TEST_MATHS_MODE: 'strip' })).toBe('strip');
    expect(bank.mathsMode({ CHILD_TEST_MATHS_MODE: 'nonsense' })).toBe('oral');
  });

  test('English has three questions in every form, asked in story order', () => {
    for (const g of [3, 5]) for (const f of ['A', 'B']) {
      const qs = bank.getBlock(g, f, 'english').questions;
      expect(qs.map((q) => q.id)).toEqual([1, 2, 3].map((n) => `e${g}${f}-q${n}`));
      expect([...qs.map((q) => q.needs_line)].sort((a, b) => a - b)).toEqual(qs.map((q) => q.needs_line));
    }
  });
});
