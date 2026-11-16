'use strict';
/**
 * bd-4alcjx — on the WhatsApp /observe list, two of the teacher's own plans for the same lesson read the same
 * ("Made by the teacher · Grade 7 Science · Ch3 · today"). Her own rows now end with the Pakistan calendar day
 * and the time of day, so the coach can tell them apart. "today" is the Pakistan day, not a rolling 24 h.
 * Over the 72-code-point cap, the grade/subject part is shortened, never the time.
 */
const OWN = '../../bot/shared/services/coaching/lp-coaching/lp-own-plans';
const { formatOwnRow, ownWhen, toListLp } = require(OWN);

const cp = (s) => [...String(s)].length;
const NOW = new Date('2026-11-16T07:00:00Z'); // 12:00 pm in Pakistan
const TZ = 'Asia/Karachi';
const plan = (madeAt, over = {}) => toListLp({
  ownId: 'x', topic: 'Plants', grade: 7, subject: 'science', chapterNumber: '3', madeAt, ...over,
});

describe('ownWhen: Pakistan day + time of day', () => {
  test('same Pakistan day → "today h:mm am/pm"', () => {
    expect(ownWhen('2026-11-16T03:05:00Z', NOW, TZ)).toBe('today 8:05 am');
    expect(ownWhen('2026-11-16T06:20:00Z', NOW, TZ)).toBe('today 11:20 am');
  });

  test('9 pm last night is "yesterday", not a rolling-24h "today"', () => {
    expect(ownWhen('2026-11-15T16:00:00Z', NOW, TZ)).toBe('yesterday 9:00 pm');
  });

  test('older → "D Mon, h:mm am/pm"', () => {
    expect(ownWhen('2026-11-12T09:40:00Z', NOW, TZ)).toBe('12 Nov, 2:40 pm');
  });

  test('just after midnight Pakistan time is "today 12:05 am"', () => {
    expect(ownWhen('2026-11-15T19:05:00Z', NOW, TZ)).toBe('today 12:05 am');
  });

  test('missing or bad dates give nothing', () => {
    expect(ownWhen(null, NOW, TZ)).toBe('');
    expect(ownWhen('not a date', NOW, TZ)).toBe('');
  });

  test('defaults to REGION_TIME_ZONE, else Asia/Karachi', () => {
    const prev = process.env.REGION_TIME_ZONE;
    delete process.env.REGION_TIME_ZONE;
    expect(ownWhen('2026-11-16T03:05:00Z', NOW)).toBe('today 8:05 am');
    process.env.REGION_TIME_ZONE = 'UTC';
    expect(ownWhen('2026-11-16T03:05:00Z', NOW)).toBe('today 3:05 am');
    if (prev === undefined) delete process.env.REGION_TIME_ZONE; else process.env.REGION_TIME_ZONE = prev;
  });
});

describe('own rows carry the time', () => {
  test('two plans for the same lesson, same day, read differently', () => {
    const a = formatOwnRow(plan('2026-11-16T03:05:00Z'), 'en', { now: NOW, tz: TZ }).description;
    const b = formatOwnRow(plan('2026-11-16T06:20:00Z'), 'en', { now: NOW, tz: TZ }).description;
    expect(a).toBe('Made by the teacher · Grade 7 Science · Ch3 · today 8:05 am');
    expect(b).toBe('Made by the teacher · Grade 7 Science · Ch3 · today 11:20 am');
    expect(a).not.toBe(b);
  });

  test('a long Urdu row stays within 72 code points and still ends with the time', () => {
    const lp = plan('2026-11-15T06:05:00Z', { grade: 10, subject: 'computer science and information technology', chapterNumber: '12' });
    const d = formatOwnRow(lp, 'ur', { now: NOW, tz: TZ }).description;
    expect(cp(d)).toBeLessThanOrEqual(72);
    expect(d.endsWith(' · yesterday 11:05 am')).toBe(true);
    expect(d.startsWith('ٹیچر کا بنایا ہوا')).toBe(true);
  });
});
