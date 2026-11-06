/**
 * variant-resolver (G6-12 board patterns, DESIGN R11, SPEC §4): which variant of a subject's pattern a paper
 * is set in, from the exam session. The FBISE notification-242 phasing is data (FBISE_50PCT); the rules a
 * subject carries are data (`applies_to`); the resolver only matches them.
 */
const R = require('../../../bot/shared/services/assessment/patterns/board/variant-resolver');

const v = (variant_id, applies_to) => ({ variant_id, applies_to });
/** A FBISE-shaped subject with the two variants b-patterns-fbise registers for a notified subject. */
function notified(grade, key) {
  return { key, variants: [v('50pct', R.fbiseAppliesTo(grade, key, '50pct')), v('nonpct', R.fbiseAppliesTo(grade, key, 'nonpct'))] };
}

describe('sessionFor: the next annual session for the academic year', () => {
  test.each([
    ['2026-11-04', '1A2027'], ['2027-01-15', '1A2027'], ['2027-06-30', '1A2027'],
    ['2027-07-01', '1A2028'], ['2026-07-01', '1A2027'], ['2026-06-30', '1A2026'], ['2027-12-31', '1A2028'],
  ])('%s → %s', (iso, want) => {
    expect(R.sessionFor(new Date(`${iso}T12:00:00Z`))).toBe(want);
  });

  test('rolls over in July (data, 1-based)', () => {
    expect(R.ROLLOVER_MONTH).toBe(7);
  });
});

describe('parseSession / compareSessions', () => {
  test('parses annual and supplementary sessions', () => {
    expect(R.parseSession('1A2027')).toEqual({ n: 1, year: 2027 });
    expect(R.parseSession('2A2028')).toEqual({ n: 2, year: 2028 });
    expect(R.parseSession(' 1a2027 ')).toEqual({ n: 1, year: 2027 });
  });

  test.each([[''], [null], [undefined], ['1B2027'], ['3A2027'], ['1A27'], ['A2027'], ['1A20271'], [2027]])('rejects %p', (s) => {
    expect(R.parseSession(s)).toBeNull();
  });

  test('orders by year, then annual before supplementary', () => {
    expect(R.compareSessions('1A2027', '2A2027')).toBeLessThan(0);
    expect(R.compareSessions('2A2027', '1A2028')).toBeLessThan(0);
    expect(R.compareSessions('1A2028', '2A2027')).toBeGreaterThan(0);
    expect(R.compareSessions('2A2027', '1A2027')).toBeGreaterThan(0);
    expect(R.compareSessions('1A2027', '1a2027')).toBe(0);
  });

  test('throws on a session it cannot read', () => {
    expect(() => R.compareSessions('x', '1A2027')).toThrow(/session/);
    expect(() => R.compareSessions('1A2027', 'x')).toThrow(/session/);
  });
});

describe('FBISE notification-242 phasing (data)', () => {
  test('the five notified subjects and the first 50% session per grade', () => {
    expect(R.FBISE_50PCT.subjects).toEqual(['maths', 'physics', 'chemistry', 'biology', 'computer_science']);
    expect(R.FBISE_50PCT.first_session).toEqual({ 9: '1A2027', 10: '1A2028', 11: '1A2027', 12: '1A2028' });
  });

  test('fbiseAppliesTo builds the rule a subject carries', () => {
    expect(R.fbiseAppliesTo(10, 'physics', '50pct')).toEqual({ from: '1A2028' });
    expect(R.fbiseAppliesTo(10, 'physics', 'nonpct')).toEqual({ before: '1A2028' });
    expect(R.fbiseAppliesTo('11', 'maths', '50pct')).toEqual({ from: '1A2027' });
    expect(R.fbiseAppliesTo(9, 'english', 'single')).toEqual({ sessions: ['*'] });
    expect(R.fbiseAppliesTo(9, 'islamiat', '50pct')).toEqual({ sessions: [] });
    expect(R.fbiseAppliesTo(9, 'islamiat', 'nonpct')).toEqual({ sessions: ['*'] });
  });

  test('fbiseAppliesTo refuses a grade or kind it does not know', () => {
    expect(() => R.fbiseAppliesTo(8, 'maths', '50pct')).toThrow(/grade/);
    expect(() => R.fbiseAppliesTo(13, 'maths', '50pct')).toThrow(/grade/);
    expect(() => R.fbiseAppliesTo(9, 'maths', 'half')).toThrow(/kind/);
  });
});

describe('resolve', () => {
  test.each([
    [9, 'maths', '1A2027', '50pct'], [11, 'physics', '1A2027', '50pct'],
    [10, 'maths', '1A2027', 'nonpct'], [12, 'chemistry', '1A2027', 'nonpct'],
    [10, 'biology', '2A2027', 'nonpct'], [12, 'computer_science', '2A2027', 'nonpct'],
    [9, 'maths', '1A2028', '50pct'], [10, 'maths', '1A2028', '50pct'],
    [11, 'biology', '1A2028', '50pct'], [12, 'physics', '1A2028', '50pct'],
    [9, 'chemistry', '2A2026', 'nonpct'], [11, 'maths', '1A2026', 'nonpct'],
  ])('G%i %s in %s → %s', (grade, key, session, want) => {
    expect(R.resolve(notified(grade, key), { grade, examSession: session }).variant_id).toBe(want);
  });

  test('a non-core subject is always the Inclusive variant', () => {
    const S = notified(9, 'islamiat');
    ['1A2026', '1A2027', '1A2028', '2A2030'].forEach((s) => {
      expect(R.resolve(S, { grade: 9, examSession: s }).variant_id).toBe('nonpct');
    });
  });

  test('a subject with one variant gets it, whatever the session', () => {
    const S = { key: 'english', variants: [v('single', { sessions: ['*'] })] };
    expect(R.resolve(S, { grade: 9, examSession: '1A2027' })).toBe(S.variants[0]);
    expect(R.resolve(S, { grade: 9 })).toBe(S.variants[0]);
  });

  test('a variant with no applies_to applies everywhere', () => {
    const S = { key: 'history', variants: [{ variant_id: 'default' }] };
    expect(R.resolve(S, { grade: 6 }).variant_id).toBe('default');
  });

  test('the default session is the next annual one from `now`', () => {
    const S = notified(10, 'maths');
    expect(R.resolve(S, { grade: 10, now: new Date('2026-11-04T00:00:00Z') }).variant_id).toBe('nonpct');
    expect(R.resolve(S, { grade: 10, now: new Date('2027-08-01T00:00:00Z') }).variant_id).toBe('50pct');
  });

  test('explicit session lists and grade filters are honoured', () => {
    const S = {
      key: 'x',
      variants: [
        v('g10only', { sessions: ['1A2027'], grades: [10] }),
        v('listed', { sessions: ['1A2027', '2A2027'] }),
        v('rest', { sessions: ['*'] }),
      ],
    };
    expect(R.resolve(S, { grade: 10, examSession: '1A2027' }).variant_id).toBe('g10only');
    expect(R.resolve(S, { grade: '10', examSession: '1A2027' }).variant_id).toBe('g10only');
    expect(R.resolve(S, { grade: 9, examSession: '1A2027' }).variant_id).toBe('listed');
    expect(R.resolve(S, { examSession: '1A2027' }).variant_id).toBe('listed');
    expect(R.resolve(S, { grade: 9, examSession: '2a2027' }).variant_id).toBe('listed');
    expect(R.resolve(S, { grade: 9, examSession: '1A2028' }).variant_id).toBe('rest');
  });

  test('from is inclusive and before is exclusive', () => {
    const S = { key: 'x', variants: [v('window', { from: '1A2027', before: '1A2028' }), v('rest', { sessions: ['*'] })] };
    expect(R.resolve(S, { examSession: '1A2027' }).variant_id).toBe('window');
    expect(R.resolve(S, { examSession: '2A2027' }).variant_id).toBe('window');
    expect(R.resolve(S, { examSession: '1A2028' }).variant_id).toBe('rest');
    expect(R.resolve(S, { examSession: '2A2026' }).variant_id).toBe('rest');
  });

  test('returns null when no variant applies', () => {
    const S = { key: 'x', variants: [v('a', { from: '1A2028' }), v('b', { sessions: [] })] };
    expect(R.resolve(S, { grade: 10, examSession: '1A2027' })).toBeNull();
  });

  test('refuses a subject without variants or an unreadable session', () => {
    expect(() => R.resolve({ key: 'x', variants: [] }, {})).toThrow(/variants/);
    expect(() => R.resolve({ key: 'x' }, {})).toThrow(/variants/);
    expect(() => R.resolve(null, {})).toThrow(/variants/);
    expect(() => R.resolve(notified(9, 'maths'), { examSession: 'soon' })).toThrow(/session/);
  });

  test('works with no options at all', () => {
    const S = { key: 'english', variants: [v('single', { sessions: ['*'] })] };
    expect(R.resolve(S).variant_id).toBe('single');
  });
});
