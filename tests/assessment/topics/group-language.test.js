'use strict';
/** Task 3 — English and Urdu: day rows -> topics under skill headings (spec §4.1). Real fixture rows. */
const { parseMatrixTab } = require('../../../bot/shared/services/assessment/topics/matrix-rows');
const { groupChapter } = require('../../../bot/shared/services/assessment/topics/group');
const { groupLanguage } = require('../../../bot/shared/services/assessment/topics/group-language');
const sample = require('./fixtures/matrix-sample.json');

const english = parseMatrixTab(sample.english, 'english');
const urdu = parseMatrixTab(sample.urdu, 'urdu');
const chapter = (rows, n) => rows.filter((r) => r.chapter === n);
const brief = (t) => ({ name: t.name, heading: t.heading, days: t.days });

describe('English G1 Ch1 (spec §4.1 example)', () => {
  const topics = groupChapter('english', chapter(english, 1));

  test('five topics under four headings, day 6 folded into Introducing Myself', () => {
    expect(topics.map(brief)).toEqual([
      { name: 'All About Me: Key Words', heading: 'Vocabulary & grammar', days: [1] },
      { name: 'Meet Pinky: Reading a Self-Introduction', heading: 'Reading', days: [2] },
      { name: 'Introducing Myself', heading: 'Writing', days: [3, 6] },
      { name: 'Speaking Up & Showing Feelings', heading: 'Oral communication', days: [4] },
      { name: 'Rhyming Words & Days of the Week', heading: 'Vocabulary & grammar', days: [5] },
    ]);
  });

  test('the assessment (995, day 7) and revision (990, day 8) rows are not topics', () => {
    expect(topics.flatMap((t) => t.days)).not.toContain(7);
    expect(topics.flatMap((t) => t.days)).not.toContain(8);
  });

  test('heading order, sort order, pages and SLOs of the folded Writing topic', () => {
    const writing = topics[2];
    expect(writing).toMatchObject({
      heading: 'Writing', headingOrder: 5, sortOrder: 3, pages: [4, 5, 6, 10, 11],
      sloCodes: ['E-01-WR-01', 'E-01-PH-02', 'E-01-VO-02', 'E-01-WR-02'],
    });
    expect(writing.sloDescriptions).toHaveLength(4);
    expect(topics.map((t) => t.headingOrder)).toEqual([3, 2, 5, 4, 3]);
  });

  test('topic ids are grade-subject-chapter-skill-slug of the first day', () => {
    expect(topics[0].topicId).toBe('1-english-1-vocabulary_grammar-all-about-me-key-words-memory-lane');
    expect(topics[2].topicId).toBe('1-english-1-writing-introducing-myself-diving-deeper');
  });
});

describe('English Ch2: pre-reading folds into the next topic', () => {
  const topics = groupChapter('english', chapter(english, 2));

  test('day 9 pre_reading p13 joins day 10 Reading, pages [13,14,15]', () => {
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({
      name: "Reading 'Helping Hands at Dani's Hut!'", heading: 'Reading', headingOrder: 2,
      days: [9, 10], pages: [13, 14, 15],
      sloCodes: ['E-01-VO-03', 'E-01-RD-02', 'E-01-RD-03', 'E-01-RD-04', 'E-01-VO-04'],
    });
  });

  test('the id uses the reading skill and the first day (the pre-reading row) text', () => {
    expect(topics[0].topicId).toMatch(/^1-english-2-reading_comprehension-five-senses-key-words/);
  });

  test('a pre-reading row with nothing after it stands alone under Reading', () => {
    const [only] = groupLanguage('english', chapter(english, 2).filter((r) => r.day === 9));
    expect(only).toMatchObject({ heading: 'Reading', headingOrder: 2, days: [9], pages: [13] });
    expect(only.slug).toMatch(/^pre_reading-five-senses/);
  });

  test('two pre-reading rows in a row both fold forward', () => {
    const [pre] = chapter(english, 2);
    const rows = [pre, { ...pre, day: 99, pages: [12] }, chapter(english, 2)[1]];
    const out = groupLanguage('english', rows);
    expect(out).toHaveLength(1);
    expect(out[0].days).toEqual([9, 10, 99]);
  });
});

describe('Connect and Create folds only into an earlier topic of the same skill', () => {
  const ch1 = chapter(english, 1).filter((r) => r.lpType === 'content');

  test('a Connect and Create day with no earlier same-skill topic stands alone', () => {
    const out = groupLanguage('english', ch1.filter((r) => r.day !== 3));
    expect(out.map((t) => t.days)).toEqual([[1], [2], [4], [5], [6]]);
  });

  test('it folds into the nearest earlier same-skill topic, not a later one', () => {
    const day6 = ch1.find((r) => r.day === 6);
    const extra = { ...ch1.find((r) => r.day === 3), day: 7, topic: 'Second Writing Day' };
    const out = groupLanguage('english', [...ch1.filter((r) => r.day !== 6), extra, { ...day6, day: 8 }]);
    expect(out.find((t) => t.days.includes(8)).days).toEqual([7, 8]);
  });

  test('a day outside Connect and Create never folds, even with the same skill', () => {
    const day6 = { ...ch1.find((r) => r.day === 6), section: 'Imagination Canvas' };
    const out = groupLanguage('english', [...ch1.filter((r) => r.day !== 6), day6]);
    expect(out).toHaveLength(6);
  });
});

describe('Urdu G1 Ch1', () => {
  const topics = groupChapter('urdu', urdu);

  test('eight content days give eight topics; 995 and duhrai are not topics', () => {
    expect(topics.map((t) => t.days)).toEqual([[1], [2], [3], [4], [5], [6], [7], [8]]);
    expect(topics.flatMap((t) => t.days)).not.toContain(9);
    expect(topics.flatMap((t) => t.days)).not.toContain(10);
  });

  test('headings are the Urdu teacher words', () => {
    expect(topics.map((t) => t.heading)).toEqual([
      'بلند خوانی', 'الفاظ و معانی', 'ارکان سازی', 'ارکان سازی', 'بلند خوانی', 'تفہیم', 'قواعد', 'تخلیقی لکھائی',
    ]);
  });

  test('a leading skill label ("قواعد — …") is dropped from the name; names stay ≤ 40 code points', () => {
    expect(topics[6].name).toBe('مِلتی جُلتی آوازیں / ہم آواز الفاظ');
    expect(topics[1].name).toBe('نظم کے الفاظ اور ان کے معانی');
    for (const t of topics) expect(Array.from(t.name).length).toBeLessThanOrEqual(40);
  });

  test('a label that is not a skill stays in the name', () => {
    expect(topics[0].name.startsWith('میرا تعارف')).toBe(true);
  });

  test('a longer label that only mentions the skill ("حمد کی بلند خوانی — …") stays in the name', () => {
    expect(topics[4].name.startsWith('حمد کی بلند خوانی')).toBe(true);
    expect(topics[4].heading).toBe('بلند خوانی');
  });

  test('row 8 ⟢ with the same skill type on both sides stays one topic', () => {
    expect(topics[7]).toMatchObject({ heading: 'تخلیقی لکھائی', days: [8], pages: [8, 9], name: 'اپنا تعارف لکھنا (اور اسم کا تعارف)' });
    expect(topics[7].topicId).toMatch(/^1-urdu-1-takhleeqi_likhai-تخلیقی-لکھائی-اپنا-تعارف/);
  });

  test('row 8 ⟢ with two skill types makes two topics, in part order', () => {
    const row8 = urdu.find((r) => r.day === 8);
    const mixed = { ...row8, topic: row8.topic.replace('تخلیقی لکھائی —', 'قواعد —') };
    const out = groupChapter('urdu', [mixed]);
    expect(out.map((t) => [t.heading, t.days, t.pages])).toEqual([
      ['قواعد', [8], [8, 9]],
      ['تخلیقی لکھائی', [8], [8, 9]],
    ]);
    expect(out[0].name).toBe('اپنا تعارف لکھنا (اور اسم کا تعارف)');
    expect(out[1].name).toBe('"میں خاص ہوں" کتاب بنانا');
    expect(out[1].sloCodes).toEqual(row8.sloCodes);
    expect(out[0].topicId).not.toBe(out[1].topicId);
  });

  test('a ⟢ part without a skill label takes the row skill type', () => {
    const row8 = urdu.find((r) => r.day === 8);
    const out = groupLanguage('urdu', [{ ...row8, topic: 'قواعد — الف  ⟢  کچھ اور — ب', skillType: 'qawaid' }]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('الف');
  });
});
