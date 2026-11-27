'use strict';
/**
 * Practice door database layer: the reads that feed a round (pool, held items, rounds today, blocked texts) and the
 * ab_assignment ledger. Faked boundary: Supabase (fake-supabase applies the filters). Invented content and ids only.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));

const { makeFake } = require('../web-quiz/fake-supabase');
const { strictColumns } = require('../web-quiz/schema-columns');
const supabase = require('../../../shared/config/supabase');
const { logToFile } = require('../../../shared/utils/logger');
const Pool = require('../../../shared/services/quiz/test-practice/pool.repo');
const Ledger = require('../../../shared/services/quiz/test-practice/ledger');

const KID = '11111111-1111-4111-8111-111111111111';
const STRICT = ['quizzes', 'quiz_answers', 'exam_question_bank', 'textbooks', 'textbook_pages', 'ab_assignment'];

// strictColumns reads a jsonb path filter (meta->>student_id) as a column name, so that one read runs unstrict.
function use(db, opts, strict = STRICT) {
  const fake = strictColumns(makeFake(db, opts), strict);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Pool._resetCache();
  return fake;
}
const lp = (id, o = {}) => ({ id, teacher_id: 't1', grade: '3', subject: 'English', topic: `T-${id}`, quiz_source: 'lp_v8', status: 'sent', meta: {}, created_at: `2026-11-0${o.day || 1}T00:00:00Z`, ...o });
const qq = (id, quizId) => ({ id, quiz_id: quizId, question_text: `Q ${id}?`, option_a: 'x', option_b: 'y', option_c: 'z', correct_option: 'A', external_id: `tq:${quizId}:S1:1` });

beforeEach(() => logToFile.mockClear());

describe('poolQuizzes', () => {
  test('same grade, English, lesson-plan, live, not the source quiz, newest first', async () => {
    use({ quizzes: [lp('a', { day: 1 }), lp('b', { day: 3 }), lp('src'), lp('m', { subject: 'Maths' }), lp('g', { grade: '4' }),
      lp('t', { quiz_source: 'transcript' }), lp('f', { status: 'failed' }), lp('p', { quiz_source: 'practice', status: 'skipped' })] });
    expect((await Pool.poolQuizzes('3', 'src')).map((z) => z.id)).toEqual(['b', 'a']);
  });
  test('a read error gives an empty pool', async () => {
    use({});
    supabase.from = () => { throw new Error('down'); };
    expect(await Pool.poolQuizzes('3', 'src')).toEqual([]);
  });
});

describe('questionsOf', () => {
  test('a question a reviewer held is never in the pool', async () => {
    use({ quiz_questions: [qq('q1', 'a'), qq('q2', 'a'), qq('q3', 'zz')], quiz_item_reviews: [{ question_id: 'q2', status: 'key_wrong' }] });
    expect((await Pool.questionsOf(['a'])).map((q) => q.id)).toEqual(['q1']);
  });
  test('no ids, no read', async () => {
    const fake = use({});
    expect(await Pool.questionsOf([])).toEqual([]);
    expect(fake.calls).toHaveLength(0);
  });
});

describe('practice rounds of a child', () => {
  test('rounds since a time are counted, and their served questions are seen', async () => {
    use({ quizzes: [
      { id: 'r1', teacher_id: 't1', topic: 'x', quiz_source: 'practice', status: 'skipped', created_at: '2026-11-27T05:00:00Z', meta: { kind: 'practice', student_id: KID, round: { items: [{ qid: 'q1' }, { qid: 'q2' }] } } },
      { id: 'r0', teacher_id: 't1', topic: 'x', quiz_source: 'practice', status: 'skipped', created_at: '2026-11-25T05:00:00Z', meta: { kind: 'practice', student_id: KID, round: { items: [{ qid: 'q9' }] } } },
      { id: 'o', teacher_id: 't1', topic: 'x', quiz_source: 'practice', status: 'skipped', created_at: '2026-11-27T05:00:00Z', meta: { kind: 'practice', student_id: 'other', round: { items: [{ qid: 'q5' }] } } },
      { id: 'l', teacher_id: 't1', topic: 'x', quiz_source: 'lp_v8', status: 'sent', created_at: '2026-11-27T05:00:00Z', meta: { student_id: KID } },
    ] }, undefined, STRICT.filter((t) => t !== 'quizzes'));
    const rows = await Pool.practiceRows(KID);
    expect(rows.map((r) => r.id).sort()).toEqual(['r0', 'r1']);
    expect(Pool.roundsSince(rows, '2026-11-26T19:00:00.000Z')).toBe(1);
    expect([...Pool.seenOfRounds(rows)].sort()).toEqual(['q1', 'q2', 'q9']);
  });
});

describe('blockedTexts', () => {
  test('English exam-bank questions and same-grade English textbook exercises', async () => {
    use({
      exam_question_bank: [{ subject: 'English', question_statement: 'Exam one?' }, { subject: 'Mathematics', question_statement: 'Sum?' }],
      textbooks: [{ id: 'tb3', grade: 3, subject: 'English' }, { id: 'tb4', grade: 4, subject: 'English' }, { id: 'tbm', grade: 3, subject: 'Maths' }],
      textbook_pages: [{ textbook_id: 'tb3', exercises: [{ q: 'Book three ex' }] }, { textbook_id: 'tb4', exercises: ['Book four ex'] }, { textbook_id: 'tbm', exercises: ['Maths ex'] }],
    });
    expect((await Pool.blockedTexts(3)).sort()).toEqual(['Book three ex', 'Exam one?']);
  });
  test('a failed read is null (the caller fails closed)', async () => {
    use({ textbooks: [{ id: 'tb3', grade: 3, subject: 'English' }] });
    const from = supabase.from;
    supabase.from = (t) => { if (t === 'textbook_pages') throw new Error('down'); return from(t); };
    expect(await Pool.blockedTexts(3)).toBeNull();
  });
  test('the exam bank is read in pages past the server row cap', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: `e${String(i).padStart(5, '0')}`, subject: 'English', question_statement: `E${i}` }));
    use({ exam_question_bank: rows }, { maxRows: { exam_question_bank: 1000 } });
    expect((await Pool.blockedTexts(3)).length).toBe(2500);
  });
});

describe('rounds', () => {
  test('insert gives the id; update writes meta', async () => {
    const fake = use({ quizzes: [] });
    const id = await Pool.insertRound({ teacher_id: 't1', topic: 'x', grade: '3', subject: 'English', quiz_source: 'practice', status: 'skipped', meta: { kind: 'practice' } });
    expect(id).toBeTruthy();
    expect(await Pool.updateRound(id, { meta: { kind: 'practice', result: { score: 1 } } })).toBe(true);
    expect(fake.db.quizzes[0].meta.result).toEqual({ score: 1 });
  });
  test('a failed insert is null', async () => {
    use({});
    supabase.from = () => ({ insert: () => { throw new Error('down'); } });
    expect(await Pool.insertRound({})).toBeNull();
  });
});

describe('ledger', () => {
  test('nothing recorded reads null; a write is read back', async () => {
    use({ ab_assignment: [] }, { uniques: { ab_assignment: ['test_id', 'unit_id'] } });
    expect(await Ledger.readArm(KID)).toBeNull();
    expect(await Ledger.writeArm(KID, 'b', 'pg:abc')).toBe(true);
    expect(await Ledger.readArm(KID)).toBe('b');
  });
  test('the row carries the test, the child, the arm and the phone group as block', async () => {
    const fake = use({ ab_assignment: [] });
    await Ledger.writeArm(KID, 'a', 'st:x');
    expect(fake.db.ab_assignment[0]).toMatchObject({ test_id: 'ict-quiz-practice-door', unit_id: KID, arm: 'a', block: 'st:x' });
  });
  test('a write the database refuses (no card lock yet, or a duplicate) is logged, not thrown', async () => {
    use({ ab_assignment: [{ test_id: 'ict-quiz-practice-door', unit_id: KID, arm: 'a' }] }, { uniques: { ab_assignment: ['test_id', 'unit_id'] } });
    expect(await Ledger.writeArm(KID, 'b', 'pg:x')).toBe(false);
    expect(await Ledger.readArm(KID)).toBe('a');
    expect(logToFile).toHaveBeenCalled();
    expect(String(logToFile.mock.calls[0][0])).not.toContain(KID);
  });
  test('a read error is null', async () => {
    use({});
    supabase.from = () => { throw new Error('down'); };
    expect(await Ledger.readArm(KID)).toBeNull();
  });
});
