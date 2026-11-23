/**
 * ICT sheet, Assessment Generator row 12 (Saba Kokab, Coach; Amena's decision 21 Nov 2026): "Multiple MCQs/sub-questions
 * under one main question are counted separately, causing the limit to reach quickly." Decision (a): a group of MCQs
 * (or blanks, true/false, matching…) printed under ONE heading counts as ONE question toward the 50-question limit.
 * Written questions still count one each. A group still holds at most 50, and the whole paper at most 100 printed
 * items: the request row's own CHECK (question_count 1..100, V1.7.5).
 */
jest.mock('../../bot/shared/config/supabase', () => ({}));
jest.mock('../../bot/shared/storage/r2', () => ({}));
const QT = require('../../bot/shared/services/assessment/question-types');

describe('a group under one heading counts as one question (AG row 12)', () => {
  test('limitCount: each grouped type is 1, each written question is 1', () => {
    expect(QT.limitCount([
      { id: 'MCQs', count: 20 }, { id: 'Fill in the Blanks', count: 10 }, { id: 'True/False', count: 10 },
      { id: 'Short Questions', count: 12 },
    ])).toBe(15);
    expect(QT.limitCount([{ id: 'Brief Answers', count: 5 }])).toBe(5);
    expect(QT.limitCount([])).toBe(0);
  });

  test('a 20 MCQ + 10 blanks + 10 T/F + 25 short paper (65 items) is accepted: it counts 28', () => {
    const r = QT.parsePerTypeCounts(['MCQs', 'Fill in the Blanks', 'True/False', 'Short Questions'],
      { count_1: '20', count_2: '10', count_3: '10', count_4: '25' }, 'science', 5);
    expect(r.ok).toBe(true);
    expect(r.total).toBe(65);
    expect(r.counted).toBe(28);
  });

  test('51 written questions are still refused', () => {
    const r = QT.parsePerTypeCounts(['Short Questions', 'Brief Answers'],
      { count_1: '30', count_2: '21' }, 'science', 5);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/50/);
  });

  test('a group still holds at most 50', () => {
    const r = QT.parsePerTypeCounts(['MCQs'], { count_1: '51' }, 'science', 5);
    expect(r.ok).toBe(false);
  });

  test('more than 100 printed items is refused, naming the 100', () => {
    const r = QT.parsePerTypeCounts(['MCQs', 'Fill in the Blanks', 'True/False'],
      { count_1: '40', count_2: '40', count_3: '30' }, 'science', 5);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/100/);
  });

  test('Seen questions on Both count one each, beside the grouped Unseen', () => {
    expect(QT.parsePerTypeCounts(['MCQs'], { count_1: '30' }, 'science', 5, 49).ok).toBe(true);
    expect(QT.parsePerTypeCounts(['Short Questions'], { count_1: '2' }, 'science', 5, 49).ok).toBe(false);
    expect(QT.parsePerTypeCounts(['MCQs'], { count_1: '30' }, 'science', 5, { counted: 2, items: 40 }).ok).toBe(true);
    expect(QT.parsePerTypeCounts(['MCQs'], { count_1: '30' }, 'science', 5, { counted: 2, items: 80 }).ok).toBe(false);
  });

  test('the options say which types group and the item ceiling, so the app counts the same way', () => {
    expect(QT.GROUPED_TYPES).toEqual(expect.arrayContaining(['MCQs', 'Fill in the Blanks', 'True/False', 'Match the Column']));
    expect(QT.MAX_ITEMS).toBe(100);
    const Browse = require('../../bot/shared/services/assessment/assessment-browse.service');
    const o = Browse.questionOptions('science', 5);
    expect(o.groupedTypes).toEqual(QT.GROUPED_TYPES);
    expect(o.maxItems).toBe(100);
    expect(o.maxQuestions).toBe(50);
  });
});
