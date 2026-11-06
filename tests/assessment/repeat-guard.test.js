/**
 * A teacher who asks again for pages she already has a paper on gets a different paper.
 *
 * Prod, 4-6 Nov 2026: separate requests for the same pages opened with the same items, and in
 * several cases it was the same teacher asking again minutes later (one G3 General Knowledge
 * chapter three times in five minutes). The writer is given the same page text and nothing else,
 * so it writes the same paper. The guard hands it her earlier questions to stay away from.
 * Grades 1-2 are left as they are (Amena, 6 Nov).
 */
const { pagesOverlap, questionTexts, avoidNote, previousQuestions } = require('../../bot/shared/services/assessment/repeat-guard');

describe('pagesOverlap', () => {
  test.each([
    ['71-84', '71-84', true],
    ['59-120', '60-112', true],
    ['1-84, 127-137', '130', true],
    ['1-10', '11-20', false],
    ['5', '6, 8-9', false],
  ])('%s vs %s', (a, b, want) => expect(pagesOverlap(a, b)).toBe(want));

  test('missing or unreadable pages never overlap', () => {
    expect(pagesOverlap(null, '1-5')).toBe(false);
    expect(pagesOverlap('1-5', '')).toBe(false);
    expect(pagesOverlap('abc', '1-5')).toBe(false);
  });
});

describe('questionTexts', () => {
  test('collects every question in both sections, passage subs included, once each', () => {
    const exam = {
      seen: { objective: { MCQs: [{ question: 'مسکن کی تعریف کریں۔' }, { question: ' 250 - 125 = ? ' }] } },
      unseen: {
        subjective: {
          Comprehension: [{ passage: 'Rockets go into space.', questions: [{ question: 'What is a rocket?' }] }],
          'Short Questions': [{ question: 'مسکن کی تعریف کریں۔' }],
        },
      },
      _layout: { question: 'not a question' },
    };
    expect(questionTexts(exam)).toEqual(['مسکن کی تعریف کریں۔', '250 - 125 = ?', 'What is a rocket?']);
  });

  test('survives an empty or odd tree', () => {
    expect(questionTexts(null)).toEqual([]);
    expect(questionTexts({ seen: 'x', unseen: { a: null } })).toEqual([]);
  });
});

describe('avoidNote', () => {
  test('empty list adds nothing', () => expect(avoidNote([])).toBe(''));

  test('lists her earlier questions and asks for different ones', () => {
    const note = avoidNote(['250 - 125 = ?', 'Estimate the sum of 38 and 44.']);
    expect(note).toMatch(/already has a paper on these pages/);
    expect(note).toContain('- 250 - 125 = ?');
    expect(note).toContain('- Estimate the sum of 38 and 44.');
  });

  test('caps the list so the prompt stays bounded', () => {
    const many = Array.from({ length: 100 }, (_, i) => `Question ${i}`);
    const lines = avoidNote(many).split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toHaveLength(40);
    expect(lines[0]).toBe('- Question 0');
  });
});

// A stand-in for the two reads the guard makes. Each read records its filters.
function fakeDb({ request, siblings = [], papers = [] }) {
  const calls = [];
  const from = (table) => {
    const q = { table, filters: [] };
    calls.push(q);
    const chain = {
      select: () => chain,
      eq: (k, v) => { q.filters.push(['eq', k, v]); return chain; },
      neq: (k, v) => { q.filters.push(['neq', k, v]); return chain; },
      gte: (k, v) => { q.filters.push(['gte', k, v]); return chain; },
      in: (k, v) => { q.filters.push(['in', k, v]); return chain; },
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: request, error: null }),
      then: (ok, bad) => Promise.resolve({ data: table === 'assessment_papers' ? papers : siblings, error: null }).then(ok, bad),
    };
    return chain;
  };
  return { from, calls };
}

describe('previousQuestions', () => {
  const now = new Date('2026-11-06T10:00:00Z');
  const req = { id: 'r-new', user_id: 'u1', grade_code: 'grade_3', textbook_id: 'b1', page_ranges: '71-84' };

  test('her earlier paper on overlapping pages comes back', async () => {
    const db = fakeDb({
      request: req,
      siblings: [{ id: 'r-old', page_ranges: '71-84' }, { id: 'r-far', page_ranges: '1-10' }],
      papers: [{ request_id: 'r-old', exam_json: { seen: { objective: { MCQs: [{ question: 'مسکن کی تعریف کریں۔' }] } } } }],
    });
    expect(await previousQuestions({ db, requestId: 'r-new', now })).toEqual(['مسکن کی تعریف کریں۔']);
    const sib = db.calls.find((c) => c.table === 'assessment_requests' && c.filters.some((f) => f[1] === 'user_id'));
    expect(sib.filters).toEqual(expect.arrayContaining([
      ['eq', 'user_id', 'u1'], ['eq', 'textbook_id', 'b1'], ['neq', 'id', 'r-new'],
    ]));
    const pap = db.calls.find((c) => c.table === 'assessment_papers');
    expect(pap.filters).toEqual(expect.arrayContaining([['in', 'request_id', ['r-old']], ['eq', 'status', 'ready']]));
  });

  test.each(['grade_1', 'grade_2'])('%s is left alone: no reads past the request', async (grade_code) => {
    const db = fakeDb({ request: { ...req, grade_code }, siblings: [{ id: 'r-old', page_ranges: '71-84' }] });
    expect(await previousQuestions({ db, requestId: 'r-new', now })).toEqual([]);
    expect(db.calls).toHaveLength(1);
  });

  test('no earlier request on these pages: nothing, and no paper read', async () => {
    const db = fakeDb({ request: req, siblings: [{ id: 'r-far', page_ranges: '1-10' }] });
    expect(await previousQuestions({ db, requestId: 'r-new', now })).toEqual([]);
    expect(db.calls.some((c) => c.table === 'assessment_papers')).toBe(false);
  });

  test('a failed read never stops the paper', async () => {
    const db = { from: () => { throw new Error('db down'); } };
    expect(await previousQuestions({ db, requestId: 'r-new', now })).toEqual([]);
  });
});
