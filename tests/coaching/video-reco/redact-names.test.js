'use strict';
/**
 * VIDREC H8 — no person's name survives into a quote. Cases are the shapes measured on 120 held-out NIETE
 * transcripts (r-corpus REPORT, Session 2); every name below is invented or a common given name.
 */
const { redactNames } = require('../../../bot/shared/services/coaching/video-reco/redact-names');

const CASES = [
  // [what, input, expected]
  ['H8 failing case: Roman name + tum batao', '[12:40] Teacher: Ahmed, tum batao', '[12:40] Teacher: [CHILD], tum batao'],
  ['Urdu name glued to ۔', '[00:09] Student (UR): علی۔', '[00:09] Student (UR): [CHILD]۔'],
  ['Urdu name glued to ؟', 'Teacher (UR): فاطمہ؟ آپ بتائیں', 'Teacher (UR): [CHILD]؟ آپ بتائیں'],
  ['name not in the lexicon, addressed at turn start', '[03:10] Teacher (UR): تیمور، آپ بتائیں۔', '[03:10] Teacher (UR): [CHILD]، آپ بتائیں۔'],
  ['name not in the lexicon, praised', 'Teacher (UR): شاباش زنیرہ۔', 'Teacher (UR): شاباش [CHILD]۔'],
  ['name before بیٹا', 'Teacher (UR): عفان بیٹا، ادھر آئیں', 'Teacher (UR): [CHILD] بیٹا، ادھر آئیں'],
  ['beta + Roman name', 'Teacher: beta Zunaira, read it', 'Teacher: beta [CHILD], read it'],
  ['diacritics and Arabic letter forms', 'Teacher (UR): موسیٰ اور عيسى', 'Teacher (UR): [CHILD] اور [CHILD]'],
  ['ambiguous name when addressed', 'Teacher (UR): نور، آپ بتائیں', 'Teacher (UR): [CHILD]، آپ بتائیں'],
];

const KEPT = [
  ['the Prophet', 'حضرت محمد صلی اللہ علیہ وسلم نے فرمایا'],
  ['Fatima Jinnah', 'محترمہ فاطمہ جناح ایک بہادر خاتون تھیں'],
  ['Allama Iqbal', 'Allama Iqbal was a poet'],
  ['عمر = age', 'آپ کی عمر کیا ہے؟'],
  ['نور = light', 'نور یعنی روشنی'],
  ['اذان = call to prayer', 'اذان کی آواز آ رہی ہے'],
  ['سارا = whole', 'سارا کام ختم کریں'],
  ['a common word addressed at turn start', 'Teacher (UR): اچھا، آپ بتائیں'],
  ['English turn start', 'Student (EN): Yes, teacher'],
];

describe('redactNames — names out', () => {
  test.each(CASES)('%s', (_what, input, expected) => {
    expect(redactNames(input)).toBe(expected);
  });
});

describe('redactNames — words in', () => {
  test.each(KEPT)('%s is unchanged', (_what, input) => {
    expect(redactNames(input)).toBe(input);
  });
});

describe('redactNames — this session\'s people', () => {
  const ctx = { teacher: 'Samina Kausar', coach: 'شبنم ناز', school: 'IMSG Shah Allah Ditta', roster: ['Mirha Batool'] };

  test('teacher, coach and school names become their role', () => {
    expect(redactNames('Kausar madam, Samina ji. شبنم صاحبہ. Ditta school', ctx))
      .toBe('[TEACHER] madam, [TEACHER] ji. [COACH] صاحبہ. [SCHOOL] school');
  });

  test('a roster name is a child even unaddressed and lower-case', () => {
    expect(redactNames('then mirha said seven', ctx)).toBe('then [CHILD] said seven');
  });

  test('placeholders can be the prompt\'s own words', () => {
    expect(redactNames('Teacher: Ahmed, tum batao', { placeholders: { child: '[a student]' } }))
      .toBe('Teacher: [a student], tum batao');
  });
});

describe('redactNames — contacts and purity', () => {
  test('phones, URLs and emails', () => {
    expect(redactNames('call 0300 1234567 or +92-321-7654321, see https://x.io/a, mail a.b@c.pk'))
      .toBe('call [NUMBER] or [NUMBER], see [URL] mail [EMAIL]');
  });

  test('non-strings pass through; ctx is not changed; same input, same output', () => {
    expect(redactNames(null)).toBeNull();
    expect(redactNames('')).toBe('');
    const ctx = Object.freeze({ teacher: 'Samina', roster: Object.freeze(['Ali']) });
    const once = redactNames('Teacher (UR): علی، آپ', ctx);
    expect(redactNames('Teacher (UR): علی، آپ', ctx)).toBe(once);
    expect(once).toBe('Teacher (UR): [CHILD]، آپ');
  });
});

describe('redactNames — names that are also words (v3)', () => {
  test.each([
    ['a word-name that does something', 'Teacher (UR): نور نے بتایا ہے', 'Teacher (UR): [CHILD] نے بتایا ہے'],
    ['a word-name that ends the turn', 'Teacher (UR): شاباش، حسن\n', 'Teacher (UR): شاباش، [CHILD]\n'],
    ['split compound name', 'Teacher (UR): عبد اللہ بتائیں', 'Teacher (UR): [CHILD] [CHILD] بتائیں'],
  ])('%s', (_what, input, expected) => {
    expect(redactNames(input)).toBe(expected);
  });

  test('Allah on its own is kept', () => {
    expect(redactNames('اللہ تعالی نے ہمیں پیدا کیا')).toBe('اللہ تعالی نے ہمیں پیدا کیا');
  });
});

describe('redactNames — strict vocabulary', () => {
  test('a name in no list and in no address slot is masked as out-of-vocabulary', () => {
    expect(redactNames('پھر زرغونہ نے جواب دیا')).toBe('پھر [CHILD] نے جواب دیا');
  });

  test('strict: false keeps out-of-vocabulary words', () => {
    expect(redactNames('پھر زرغونہ نے جواب دیا', { strict: false })).toBe('پھر زرغونہ نے جواب دیا');
  });

  test('placeholders already in the text are left alone', () => {
    expect(redactNames('see [URL] and [CHILD]')).toBe('see [URL] and [CHILD]');
  });
});
