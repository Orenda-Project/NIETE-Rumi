'use strict';

/**
 * CONTRACT §18 (operator, 3 Oct): a drawn child is named by the FULL name first, the roll only as a
 * hint when the roster has one. NIETE roster, 3 Oct: 3.4% of Grade 3/5 children have no roll, and a
 * roll-less child on the list made resolveUx throw ("missing param roll", bd-s1oo0.36).
 */

const { childName, rollOf, childLabel, childLabels, childRow } = require('../../../bot/shared/services/child-test/conversation/identity');

const cps = (s) => [...String(s)].length;
const LONG = 'Muhammad Abdul Rehman Khan Niazi';          // 32 code points
const URDU_NAME = 'عائشہ بی بی';

describe('child identity — full name first, roll as a hint (CONTRACT §18)', () => {
  test('the coach language picks the script: Urdu name for ur when the roster has one, roster spelling otherwise', () => {
    const c = { displayName: '  Ayesha   Bibi ', displayNameUrdu: URDU_NAME, rollNumber: 8 };
    expect(childName('ur', c)).toBe(URDU_NAME);
    expect(childName('en', c)).toBe('Ayesha Bibi');
    expect(childName('ur', { displayName: 'Ayesha Bibi' })).toBe('Ayesha Bibi');
    expect(childName('en', { displayNameUrdu: URDU_NAME })).toBe(URDU_NAME);
    expect(childName('ur', {})).toBe('');
    expect(childName('ur', null)).toBe('');
  });

  test('only a positive whole number is a roll', () => {
    for (const r of [null, undefined, '', '  ', 'abc', 0, -3, '4a', 2.5]) expect(rollOf({ rollNumber: r })).toBeNull();
    expect(rollOf({ rollNumber: 8 })).toBe(8);
    expect(rollOf({ rollNumber: ' 25 ' })).toBe(25);
  });

  test('name and roll: the name leads, the roll follows in the coach\'s digits', () => {
    const c = { displayName: 'Ayesha Bibi', rollNumber: 8 };
    const ur = childLabel('ur', c);
    expect(ur.indexOf('Ayesha Bibi')).toBeGreaterThanOrEqual(0);
    expect(ur.indexOf('رول')).toBeGreaterThan(ur.indexOf('Ayesha Bibi'));
    expect(ur).toContain('۸');
    expect(childLabel('en', c)).toBe('Ayesha Bibi · roll 8');
  });

  test('a child with no roll is named alone, in every shape the roster gives — never "null", never a throw', () => {
    for (const rollNumber of [null, undefined, '']) {
      for (const lang of ['ur', 'en']) {
        const s = childLabel(lang, { displayName: 'Ayesha Bibi', rollNumber });
        expect(s).toBe('Ayesha Bibi');
      }
    }
  });

  test('no name falls back to the roll, then to a plain "no name" label', () => {
    expect(childLabel('en', { rollNumber: 8 })).toBe('Roll 8');
    expect(childLabel('ur', { rollNumber: 8 })).toContain('۸');
    for (const lang of ['ur', 'en']) {
      const s = childLabel(lang, {});
      expect(s.length).toBeGreaterThan(0);
      expect(s).not.toMatch(/null|undefined|\{/);
    }
  });

  test('a one-line list of children uses the language\'s comma', () => {
    const kids = [{ displayName: 'Ayesha Bibi', rollNumber: 8 }, { displayName: 'Ali Raza', rollNumber: null }];
    expect(childLabels('en', kids)).toBe('Ayesha Bibi · roll 8, Ali Raza');
    expect(childLabels('ur', kids)).toContain('، ');
  });

  describe('list rows fit WhatsApp (title 24, description 72 code points) and always show the full name', () => {
    test('a short name is the title; the description carries the roll and the caller\'s status', () => {
      const r = childRow('en', { displayName: 'Ayesha Bibi', rollNumber: 8 }, 'New');
      expect(r.title).toBe('Ayesha Bibi');
      expect(r.description).toBe('Roll 8 · New');
    });

    test('a long name is clipped in the title and given in full in the description', () => {
      for (const lang of ['ur', 'en']) {
        const r = childRow(lang, { displayName: LONG, rollNumber: 12 }, lang === 'en' ? 'New' : 'نیا');
        expect(cps(r.title)).toBeLessThanOrEqual(24);
        expect(r.title.endsWith('…')).toBe(true);
        expect(r.description).toContain(LONG);
        expect(cps(r.description)).toBeLessThanOrEqual(72);
      }
    });

    test('no roll: the description is the status alone; nothing reads "null"', () => {
      const r = childRow('ur', { displayName: 'Ali Raza', rollNumber: null }, 'نیا');
      expect(r.title).toBe('Ali Raza');
      expect(r.description).toBe('نیا');
      expect(JSON.stringify(r)).not.toMatch(/null|undefined/);
    });

    test('a 72-code-point overflow is clipped, never sent over the cap', () => {
      const huge = 'A'.repeat(90);
      const r = childRow('en', { displayName: huge, rollNumber: 3 }, 'Returning (Form B)');
      expect(cps(r.title)).toBeLessThanOrEqual(24);
      expect(cps(r.description)).toBeLessThanOrEqual(72);
    });
  });
});
