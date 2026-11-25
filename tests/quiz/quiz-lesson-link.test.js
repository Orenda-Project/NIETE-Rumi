'use strict';
/**
 * bd-ptl6x9.13.1 — the lesson plan on every quiz. A quiz made from a plan (lp_v8, lp612, the
 * evening round) or from a recording where the teacher picked her plan carries
 * `meta.lesson_links`: one entry per lesson, with the plan's code, the plan document's id, and
 * the book / chapter / lesson read off the code. The book key is the one the exam-paper maker
 * already stores (`assessment_requests.grade_code + '_' + subject_code`), so plan → quiz → paper
 * join on (teacher, book, chapter) with no new column. Never guessed: no code, no link.
 */
const { makeDb } = require('./helpers/memory-db');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const Link = require('../../bot/shared/services/quiz/quiz-lesson-link');

describe('parse — the plan code read into book / chapter / lesson', () => {
  test('K-5 code: grade, subject, chapter, lesson; "math" and "maths" are one book', () => {
    expect(Link.parse('grade_5_math_ch5_seg7')).toEqual({
      lesson_id: 'grade_5_math_ch5_seg7', grade: 5, subject: 'maths', book: 'grade_5_maths', chapter: 5, lesson: 7, pages: null,
    });
    expect(Link.parse('grade_1_maths_ch1_seg1').book).toBe('grade_1_maths');
  });

  test('general_science is the paper maker\'s "science"', () => {
    expect(Link.parse('grade_4_general_science_ch2_seg3')).toMatchObject({ subject: 'science', book: 'grade_4_science', chapter: 2, lesson: 3 });
  });

  test('6-12 segment: book and chapter, pages kept, no lesson number', () => {
    expect(Link.parse('grade_9_physics.c05.p123-124')).toEqual({
      lesson_id: 'grade_9_physics.c05.p123-124', grade: 9, subject: 'physics', book: 'grade_9_physics', chapter: 5, lesson: null, pages: '123-124',
    });
  });

  test('6-12 segment with a sub-part name; mathematics is maths', () => {
    expect(Link.parse('grade_7_urdu.c06.p033-034.alfaaz_maani')).toMatchObject({ book: 'grade_7_urdu', chapter: 6, pages: '033-034', lesson: null });
    expect(Link.parse('grade_8_mathematics.c04.p047-050').book).toBe('grade_8_maths');
  });

  test('an unknown code keeps the code and invents nothing', () => {
    expect(Link.parse('something_else')).toEqual({
      lesson_id: 'something_else', grade: null, subject: null, book: null, chapter: null, lesson: null, pages: null,
    });
    expect(Link.parse('')).toBeNull();
    expect(Link.parse(null)).toBeNull();
  });

  test('bookKey matches the exam paper row', () => {
    expect(Link.bookKey('grade_4', 'science')).toBe('grade_4_science');
    expect(Link.bookKey(4, 'general_science')).toBe('grade_4_science');
    expect(Link.bookKey('5', 'math')).toBe('grade_5_maths');
    expect(Link.bookKey(null, 'maths')).toBeNull();
  });
});

describe('fromPlanLessons / fromRecording', () => {
  test('one link per plan lesson, with the plan document id', () => {
    const links = Link.fromPlanLessons([
      { lesson_id: 'grade_2_maths_ch3_seg1', asset_id: 'A1' },
      { segment_id: 'grade_9_physics.c05.p123-124', render_id: 'R1' },
      { asset_id: 'no-code' },
    ]);
    expect(links).toEqual([
      expect.objectContaining({ lesson_id: 'grade_2_maths_ch3_seg1', plan_asset_id: 'A1', book: 'grade_2_maths', chapter: 3, lesson: 1, via: 'plan' }),
      expect.objectContaining({ lesson_id: 'grade_9_physics.c05.p123-124', plan_asset_id: 'R1', book: 'grade_9_physics', chapter: 5, via: 'plan' }),
    ]);
    expect(Link.fromPlanLessons(null)).toEqual([]);
  });

  test('a recording links only when the teacher picked her plan', () => {
    const picked = { lesson_plan_link_method: 'selected_recent', ref: { lesson_id: 'grade_3_math_ch4_seg2' } };
    expect(Link.fromRecording(picked)).toEqual([expect.objectContaining({ lesson_id: 'grade_3_math_ch4_seg2', book: 'grade_3_maths', via: 'teacher_picked', plan_asset_id: null })]);
    expect(Link.fromRecording({ lesson_plan_link_method: 'none', ref: { lesson_id: 'grade_3_math_ch4_seg2' } })).toEqual([]);
    expect(Link.fromRecording({ lesson_plan_link_method: 'selected_recent', ref: null })).toEqual([]);
    expect(Link.fromRecording(null)).toEqual([]);
  });

  test('forRecording reads only the reference slice, and never throws', async () => {
    mockDb = makeDb({ coaching_sessions: [
      { id: 'S1', lesson_plan_link_method: 'selected_recent', lesson_plan_structured: { big: 'x', _fidelity_ref: { lesson_id: 'grade_1_english_ch10_seg1' } } },
      { id: 'S2', lesson_plan_link_method: null, lesson_plan_structured: null },
    ] });
    expect(await Link.forRecording('S1')).toEqual([expect.objectContaining({ lesson_id: 'grade_1_english_ch10_seg1', book: 'grade_1_english', chapter: 10, lesson: 1 })]);
    expect(await Link.forRecording('S2')).toEqual([]);
    expect(await Link.forRecording(null)).toEqual([]);
    mockDb = { from: () => { throw new Error('db down'); } };
    expect(await Link.forRecording('S1')).toEqual([]);
  });
});

describe('the quiz makers write it', () => {
  test('a recording quiz claimed from /quiz carries the teacher-picked plan', async () => {
    mockDb = makeDb({
      coaching_sessions: [{ id: 'S1', user_id: 'T1', lesson_plan_link_method: 'selected_recent', lesson_plan_structured: { _fidelity_ref: { lesson_id: 'grade_2_maths_ch3_seg1' } } }],
      quizzes: [],
    });
    const Provider = require('../../bot/shared/services/quiz/transcript-lesson-provider');
    const out = await Provider.claimForGeneration({ userId: 'T1', sessionId: 'S1', session: { analysis_data: { topic: 'Add', subject: 'maths' } }, quiz: null, quizLanguage: 'en' });
    expect(out.quizId).toBeTruthy();
    const row = mockDb.tables.quizzes.find((q) => q.id === out.quizId);
    expect(row.meta.lesson_links).toEqual([expect.objectContaining({ lesson_id: 'grade_2_maths_ch3_seg1', via: 'teacher_picked' })]);
  });

  test('the recording offer\'s claim and the closed-window held row carry the teacher-picked plan', async () => {
    const session = { id: 'S1', user_id: 'T1', analysis_data: { topic: 'Add', subject: 'maths' } };
    mockDb = makeDb({
      coaching_sessions: [{ ...session, lesson_plan_link_method: 'selected_recent', lesson_plan_structured: { _fidelity_ref: { lesson_id: 'grade_2_maths_ch3_seg1' } } }],
      quizzes: [],
    });
    const Offer = require('../../bot/shared/services/quiz/transcript-quiz-offer.service');
    const claim = await Offer.claimRow({ session, source: 'offer' });
    expect(claim.claimed).toBe(true);
    const ClosedWindow = require('../../bot/shared/services/quiz/closed-window-offer');
    mockDb.tables.quizzes.length = 0;
    expect(await ClosedWindow.recordHeld({ session, heldPath: null })).toBe(true);
    expect(mockDb.tables.quizzes).toHaveLength(1);
    expect(mockDb.tables.quizzes[0].meta.lesson_links).toEqual([expect.objectContaining({ lesson_id: 'grade_2_maths_ch3_seg1', via: 'teacher_picked' })]);
  });

  test('the recording offer\'s claim row has the link', async () => {
    const session = { id: 'S9', user_id: 'T1', analysis_data: {} };
    mockDb = makeDb({
      coaching_sessions: [{ ...session, lesson_plan_link_method: 'selected_recent', lesson_plan_structured: { _fidelity_ref: { lesson_id: 'grade_1_urdu_ch2_seg3' } } }],
      quizzes: [],
    });
    const Offer = require('../../bot/shared/services/quiz/transcript-quiz-offer.service');
    const claim = await Offer.claimRow({ session });
    const row = mockDb.tables.quizzes.find((q) => q.id === claim.quizId);
    expect(row.meta.lesson_links).toEqual([expect.objectContaining({ lesson_id: 'grade_1_urdu_ch2_seg3', book: 'grade_1_urdu' })]);
  });

  test('the day-3 retest keeps the original\'s plan', () => {
    const { retestMeta } = require('../../bot/shared/services/quiz/quiz-retest-sweep');
    const links = [{ lesson_id: 'grade_2_maths_ch3_seg1', book: 'grade_2_maths', chapter: 3 }];
    expect(retestMeta({ id: 'Q1', meta: { lesson_links: links } }, []).lesson_links).toEqual(links);
  });
});
