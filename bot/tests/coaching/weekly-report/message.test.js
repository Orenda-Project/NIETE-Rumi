'use strict';
/**
 * bd-v0toag.32 — the message builder: a week's summary + the teacher → the template name, Meta language
 * code and body parameters for whatsapp.service.sendTemplate. Pure.
 */

const { buildMessage, weekLabel } = require('../../../shared/services/coaching/weekly-report/message');
const { summarise } = require('../../../shared/services/coaching/weekly-report/summarise');

const WEEK = { weekStart: '2026-10-12', lastDay: '2026-10-16' };
const params = (m) => m.components[0].parameters.map((p) => p.text);

const busy = {
  lessonPlans: 4, daysUsed: 3, recordings: 2,
  move: { did: 1, partly: 1, notDone: 0, checked: 2 },
  thumbs: { up: 2, down: 1 },
};

describe('weekLabel', () => {
  test('en and ur, same month and across a month end', () => {
    expect(weekLabel(WEEK, 'en')).toBe('12–16 Oct');
    expect(weekLabel(WEEK, 'ur')).toBe('12 تا 16 اکتوبر');
    expect(weekLabel({ weekStart: '2026-10-26', lastDay: '2026-10-30' }, 'en')).toBe('26–30 Oct');
    expect(weekLabel({ weekStart: '2026-11-30', lastDay: '2026-12-04' }, 'en')).toBe('30 Nov – 4 Dec');
    expect(weekLabel({ weekStart: '2026-11-30', lastDay: '2026-12-04' }, 'ur')).toBe('30 نومبر تا 4 دسمبر');
  });
});

describe('buildMessage — a week with activity uses weekly_usage_v1', () => {
  test('English: the seven parameters, in order', () => {
    const m = buildMessage({ summary: busy, week: WEEK, teacher: { name: 'Ayesha Khan', preferred_language: 'en' } });
    expect(m.template).toBe('weekly_usage_v1');
    expect(m.languageCode).toBe('en_US');
    expect(m.quiet).toBe(false);
    expect(m.components).toHaveLength(1);
    expect(m.components[0].type).toBe('body');
    expect(params(m)).toEqual([
      'Ayesha', '12–16 Oct', '4', '3', '2',
      'done in 1 of 2 recordings, partly in 1', '2 of 3',
    ]);
  });

  test('Urdu reads preferred_language and fills Urdu phrases', () => {
    const m = buildMessage({ summary: busy, week: WEEK, teacher: { name: 'عائشہ', preferred_language: 'ur' } });
    expect(m.languageCode).toBe('ur');
    expect(params(m)).toEqual([
      'عائشہ', '12 تا 16 اکتوبر', '4', '3', '2',
      '2 میں سے 1 ریکارڈنگ میں کیا، 1 میں کچھ حد تک', '3 میں سے 2',
    ]);
  });

  test('nothing to check or rate yet is said plainly, not as a zero', () => {
    const s = { ...busy, move: { did: 0, partly: 0, notDone: 0, checked: 0 }, thumbs: { up: 0, down: 0 } };
    const en = params(buildMessage({ summary: s, week: WEEK, teacher: { name: 'A', preferred_language: 'en' } }));
    expect(en.slice(5)).toEqual(['not checked yet', 'no answers yet']);
    const ur = params(buildMessage({ summary: s, week: WEEK, teacher: { name: 'A', preferred_language: 'ur' } }));
    expect(ur.slice(5)).toEqual(['ابھی جانچا نہیں گیا', 'ابھی کوئی جواب نہیں']);
  });

  test('checked but not done says so without blame', () => {
    const s = { ...busy, move: { did: 0, partly: 0, notDone: 2, checked: 2 } };
    expect(params(buildMessage({ summary: s, week: WEEK, teacher: { name: 'A', preferred_language: 'en' } }))[5])
      .toBe('not seen yet in 2 recordings');
  });
});

describe('buildMessage — a quiet week uses weekly_usage_quiet_v1, no numbers', () => {
  test('two parameters: name and the week', () => {
    const m = buildMessage({ summary: summarise({}), week: WEEK, teacher: { name: 'Ayesha Khan', preferred_language: 'en' } });
    expect(m.template).toBe('weekly_usage_quiet_v1');
    expect(m.quiet).toBe(true);
    expect(params(m)).toEqual(['Ayesha', '12–16 Oct']);
  });
});

describe('buildMessage — the teacher', () => {
  test('an unknown or missing language falls back to English (the NIETE floor)', () => {
    expect(buildMessage({ summary: busy, week: WEEK, teacher: { name: 'A', preferred_language: 'sw' } }).languageCode).toBe('en_US');
    expect(buildMessage({ summary: busy, week: WEEK, teacher: { name: 'A' } }).languageCode).toBe('en_US');
  });

  test('no name: a respectful word, never an empty parameter (Meta rejects empty text)', () => {
    expect(params(buildMessage({ summary: busy, week: WEEK, teacher: { name: '  ', preferred_language: 'en' } }))[0]).toBe('Teacher');
    expect(params(buildMessage({ summary: busy, week: WEEK, teacher: { preferred_language: 'ur' } }))[0]).toBe('استاد');
  });
});
