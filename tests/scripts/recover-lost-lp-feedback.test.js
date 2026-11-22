/**
 * bd-dp9ipc — put back the grades 1-5 survey answers lost on lp_feedback_lp612_segment_id_fkey (live 16-21 Nov 2026).
 * Each lost tap is in the logs (teacher id, catalogue lesson id, thumbs, time). The recovery stores it the way a
 * grades 1-5 answer is stored: a lesson_plans row for her and that lesson, and lp_feedback by lesson_plan_id.
 */
const { planRecovery, recover } = require('../../bot/scripts/recover-lost-lp-feedback');

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const hit = { lesson: { segment_index: 4, topic: 'Topic' }, chapter: { number: 12 }, book: { grade: 3, subject_key: 'urdu' } };
const lessonById = (id) => (id.startsWith('grade_') ? hit : null);

describe('planRecovery', () => {
  test('one answer per teacher and lesson: her LAST tap wins', () => {
    const out = planRecovery([
      { at: '2026-11-19T11:59:25Z', userId: T1, lessonId: 'grade_1_urdu_ch11_seg3', useful: false },
      { at: '2026-11-21T13:10:05Z', userId: T1, lessonId: 'grade_1_urdu_ch11_seg3', useful: true },
      { at: '2026-11-17T08:00:00Z', userId: T2, lessonId: 'grade_1_urdu_ch11_seg3', useful: true },
    ], lessonById);
    expect(out.answers).toHaveLength(2);
    expect(out.answers.find((a) => a.userId === T1)).toMatchObject({ useful: true, at: '2026-11-21T13:10:05Z' });
  });

  test('a lesson the catalogue does not know, a bad id or a missing thumbs is set aside, not guessed', () => {
    const out = planRecovery([
      { at: 'x', userId: T1, lessonId: 'g9p_newton', useful: true },
      { at: 'x', userId: 'nope', lessonId: 'grade_1_a', useful: true },
      { at: 'x', userId: T1, lessonId: 'grade_1_a', useful: null },
    ], lessonById);
    expect(out.answers).toHaveLength(0);
    expect(out.skipped.map((s) => s.why).sort()).toEqual(['bad_user', 'no_answer', 'unknown_lesson']);
  });
});

function fakeDb({ existingFeedback = false } = {}) {
  const inserts = [];
  const from = (table) => {
    const q = {
      _table: table,
      select: () => q, eq: () => q, in: () => q, limit: () => q,
      insert: (row) => { inserts.push({ table, row }); return { select: () => ({ single: async () => ({ data: { id: 'fb-1' }, error: null }) }) }; },
      then: (resolve) => resolve(table === 'lesson_plans'
        ? { data: existingFeedback ? [{ id: 'lp-old' }] : [], error: null }
        : { data: existingFeedback ? [{ id: 'fb-old' }] : [], error: null }),
    };
    return q;
  };
  return { from, inserts };
}

describe('recover', () => {
  const answers = [{ at: '2026-11-18T10:00:00Z', userId: T1, lessonId: 'grade_3_urdu_ch12_seg4', useful: true }];

  test('dry run writes nothing and says what it would do', async () => {
    const db = fakeDb();
    const record = jest.fn();
    const out = await recover({ answers, supabase: db, recordLessonPlanRow: record, lessonById, apply: false });
    expect(out).toMatchObject({ would: 1, written: 0, already: 0 });
    expect(record).not.toHaveBeenCalled();
    expect(db.inserts).toHaveLength(0);
  });

  test('apply: a lesson_plans row for her, then lp_feedback by lesson_plan_id at the original tap time, never the 6-12 column', async () => {
    const db = fakeDb();
    const record = jest.fn(async () => 'lp-new');
    const out = await recover({ answers, supabase: db, recordLessonPlanRow: record, lessonById, apply: true });
    expect(out).toMatchObject({ written: 1, failed: 0 });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ userId: T1, lessonId: 'grade_3_urdu_ch12_seg4', surface: 'app' }));
    const fb = db.inserts.find((i) => i.table === 'lp_feedback').row;
    expect(fb).toMatchObject({
      user_id: T1, lesson_plan_id: 'lp-new', useful: true, grade: 3, subject: 'urdu', chapter_number: 12,
      segment_number: 4, trigger_mode: 'after_pdf_only', created_at: '2026-11-18T10:00:00Z',
    });
    expect(fb).not.toHaveProperty('lp612_segment_id');
  });

  test('a teacher who already has an answer for that lesson is left alone (safe to run twice)', async () => {
    const db = fakeDb({ existingFeedback: true });
    const record = jest.fn();
    const out = await recover({ answers, supabase: db, recordLessonPlanRow: record, lessonById, apply: true });
    expect(out).toMatchObject({ written: 0, already: 1 });
    expect(record).not.toHaveBeenCalled();
  });
});
