/**
 * RELIGIOUS FACTS — bd-nnd27p (P1).
 *
 * Amena ruled three errors on the G11 Islamiat ch2 pp10-12 plan (2026-10-07), each one a CLASS
 * that any Islamiat plan can repeat:
 *   1. «سورۃ طٰسٓمٓ» — طٰسٓمٓ is the disjoint-letter opening of Ash-Shu'ara/Al-Qasas, not a surah name.
 *   2. Al-Ma'idah credited with the inheritance rulings — those are An-Nisa 4:11-12, 4:176.
 *   3. سورۃ الانعام given as a MADANI example in the H4 answer key — Al-An'am is Makki.
 *
 * Each is checked mechanically and BLOCKS delivery under the RELIGIOUS_MARKS code, so the ladder
 * re-authors instead of shipping it. The false-positive cases matter as much: a blocking false
 * positive costs a teacher the whole lesson.
 */
const { religiousFactDefects } = require('../../bot/vendor/lp-v9/lib/religious_facts');
const { religious, withProse, cleanDoc } = require('./helpers/religious-marks');

const one = (s, at = '/sections/1/blocks/0/text') => religiousFactDefects([{ at, s }]);

describe('muqattaʿat letters used as a surah name', () => {
  test('«سورۃ طٰسٓمٓ» fails and names the surahs it opens', () => {
    const d = one('مکی سورتوں کی مثال: سورۃ طٰسٓمٓ');
    expect(d).toHaveLength(1);
    expect(d[0].msg).toMatch(/الشعراء|Shu'ara/);
  });

  test('«سورہ الٓمّٓ» and an English «Surah Ta-Sin-Mim» fail too', () => {
    expect(one('سورہ الٓمّٓ میں ایمان کا ذکر ہے')).toHaveLength(1);
    expect(one('Surah Ta-Sin-Mim is Makki.')).toHaveLength(1);
  });

  test('the real letter-named surahs pass: طٰہٰ، یٰسٓ، صٓ، قٓ', () => {
    expect(one('سورۃ طٰہٰ، سورۃ یٰسٓ، سورۃ صٓ اور سورۃ قٓ مکی ہیں۔')).toEqual([]);
  });

  test('the Urdu names «حٰمٓ السجدہ» and «الٓمٓ السجدہ» pass', () => {
    expect(one('سورۃ حٰمٓ السجدہ اور سورۃ الٓمٓ السجدہ مکی سورتیں ہیں۔')).toEqual([]);
  });

  test('the letters quoted as a verse, not a name, pass', () => {
    expect(one('سورۃ الشعراء کی پہلی آیت طٰسٓمٓ ہے۔')).toEqual([]);
  });
});

describe('a Makki surah given as a Madani example, or the reverse', () => {
  test('سورۃ الانعام as a Madani example fails and says it is Makki', () => {
    const d = one('مدنی سورتوں کی آیات طویل ہوتی ہیں، مثلاً سورۃ الانعام (ص ۱۱)۔');
    expect(d).toHaveLength(1);
    expect(d[0].msg).toMatch(/مکی|Makki/);
  });

  test('the H4 answer key is read against the H4 question it answers', () => {
    const d = religiousFactDefects([
      { at: '/sections/4/homework/items/3/ref', s: 'H4' },
      { at: '/sections/4/homework/items/3/text', s: 'مدنی سورتوں کی چار خصوصیات لکھیں۔' },
      { at: '/page2/homework_key/3/ref', s: 'H4' },
      { at: '/page2/homework_key/3/answer', s: '(۳) بڑی اور طویل آیات — مثلاً سورۃ الانعام (ص ۱۱)' },
    ]);
    expect(d).toHaveLength(1);
    expect(d[0].at).toBe('/page2/homework_key/3/answer');
  });

  test('a Madani surah given as a Makki example fails', () => {
    expect(one('مکی سورتوں کی مثال سورۃ البقرہ ہے۔')).toHaveLength(1);
    expect(one('Example of a Makki surah: Surah Al-Baqarah.')).toHaveLength(1);
  });

  test('correct examples pass', () => {
    expect(one('مدنی سورتیں: سورۃ البقرہ، سورۃ النساء، سورۃ الانفال۔')).toEqual([]);
    expect(one('مکی سورتیں: سورۃ الاخلاص، سورۃ اللہب، سورۃ الانعام۔')).toEqual([]);
  });

  test('a passage that contrasts Makki and Madani surahs is not judged', () => {
    expect(one('سورۃ الانعام مکی ہے جبکہ سورۃ البقرہ مدنی ہے۔')).toEqual([]);
  });

  test('a negation is not judged — «الانعام مدنی نہیں»', () => {
    expect(one('سورۃ الانعام مدنی سورت نہیں ہے۔')).toEqual([]);
  });

  test('a surah whose classification is disputed is never judged', () => {
    expect(one('مدنی سورتوں کی مثال: سورۃ الرحمٰن۔')).toEqual([]);
  });

  test('a surah named with no Makki/Madani context is not judged', () => {
    expect(one('سورۃ الانعام میں توحید کا بیان ہے۔')).toEqual([]);
  });

  // The two false positives a sweep of the 954 Islamiat page truths turned up.
  test('an exception is not an example — G11 p.11 «البقرہ اور آلِ عمران کے علاوہ … مکی ہیں»', () => {
    expect(one('سورۃ البقرہ اور سورۃ آلِ عمران کے علاوہ تمام سورتیں جن کا آغاز حروفِ مقطعات سے ہوتا ہے، وہ سب مکی ہیں۔')).toEqual([]);
  });

  test('«مدنی معاشرہ» is Madinan society, not a surah classification — G8 p.69', () => {
    expect(one('مدنی معاشرے میں آپ ﷺ سورۃ نور، سورۃ فرقان اور سورۃ احزاب کے احکام سکھاتے تھے۔')).toEqual([]);
  });

  test('the textbook\'s own error still fails — G11 p.11 «مدنی سورتیں … جیسے سورۃ الانعام، سورۃ الاعراف»', () => {
    const d = one('مدنی سورتیں بڑی سورتیں ہیں اور ان کی آیات بھی طویل ہیں، جیسے سورۃ الانعام، سورۃ الاعراف وغیرہ۔');
    expect(d).toHaveLength(2);
    expect(d[0].msg).toMatch(/textbook/);
  });
});

describe('inheritance credited to Al-Maʾidah', () => {
  test('«سورۃ المائدہ میں وراثت کے احکام» fails and points to An-Nisa', () => {
    const d = one('سورۃ المائدہ میں وراثت اور زکوٰۃ کے احکام بیان ہوئے۔');
    expect(d).toHaveLength(1);
    expect(d[0].msg).toMatch(/النساء|An-Nisa/);
  });

  test('Ma\'idah for wudu and An-Nisa for inheritance pass', () => {
    expect(one('سورۃ المائدہ میں وضو کا حکم (۵:۶) ہے۔')).toEqual([]);
    expect(one('سورۃ النساء میں وراثت کے احکام ہیں، سورۃ المائدہ میں وضو کے۔')).toEqual([]);
  });
});

describe('through the lint: these defects block delivery', () => {
  test('the Al-An\'am answer blocks under RELIGIOUS_MARKS', () => {
    const d = withProse('مدنی سورتوں کی آیات طویل ہوتی ہیں، مثلاً سورۃ الانعام۔');
    expect(religious(d).some((e) => /الانعام/.test(e))).toBe(true);
  });

  test('a surah citation is checked even with no other religious marker in the plan', () => {
    const d = cleanDoc();
    d.sections[1].blocks.find((b) => b.type === 'paragraph').text = 'سورۃ طٰسٓمٓ';
    expect(religious(d).some((e) => /طٰسٓمٓ|طسم/.test(e))).toBe(true);
  });

  test('a correct Islamiat paragraph does not block', () => {
    const d = withProse('مکی سورتوں کی مثال سورۃ الاخلاص ہے، اور مدنی سورتوں کی مثال سورۃ البقرہ۔ قرآن');
    expect(religious(d)).toEqual([]);
  });
});
