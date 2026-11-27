'use strict';
/**
 * QF-K1: the rollback for teacher quiz edits is the switch-off (web_quiz_teacher_edit row deleted). A teacher who edited
 * before it must keep a Download: an edit or a revert drops the stored PDF, and the remake of the CURRENT version is a
 * read, not an edit, so ensurePdf runs with the switch off. view and save stay switch-gated (404 {off:true}).
 */
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/config/supabase', () => ({ from: () => { throw new Error('use deps.db'); }, rpc: jest.fn() }));
jest.mock('../../../shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../../shared/services/quiz/transcript-quiz-generate.service', () => ({ renderPdf: jest.fn(), withFigureSvgs: (r) => r }));
jest.mock('../../../shared/services/quiz/transcript-quiz-handoff.service', () => ({ load: jest.fn() }));
jest.mock('../../../shared/services/quiz/transcript-quiz-validator', () => ({ MIN_QUESTIONS: 6 }));

const Edit = require('../../../shared/services/quiz/quiz-teacher-edit');

const QUIZ = '00000000-0000-4000-8000-000000000001';
const TEACHER = '00000000-0000-4000-8000-00000000aaaa';
const OTHER = '00000000-0000-4000-8000-00000000bbbb';

// A minimal PostgREST-shaped fake: app_settings (the switch) and quizzes; every read is recorded.
function fakeDb({ switchOn, meta }) {
  const tables = {
    app_settings: switchOn ? [{ key: 'web_quiz_teacher_edit', value: true }] : [],
    quizzes: [{ id: QUIZ, teacher_id: TEACHER, language: 'en', meta }],
    quiz_questions: [],
  };
  return {
    from(t) {
      const filters = [];
      const q = {
        select() { return q; },
        eq(c, v) { filters.push((r) => r[c] === v); return q; },
        order() { return q; },
        maybeSingle() { return Promise.resolve({ data: (tables[t] || []).filter((r) => filters.every((f) => f(r)))[0] || null, error: null }); },
        then(ok, bad) { return Promise.resolve({ data: (tables[t] || []).filter((r) => filters.every((f) => f(r))), error: null }).then(ok, bad); },
      };
      return q;
    },
  };
}

describe('QF-K1: ensurePdf remakes the current PDF with the switch off', () => {
  test('switch off, owner, no stored PDF → 200 and the remake runs once for the current version', async () => {
    const remakePdf = jest.fn().mockResolvedValue('ready');
    const r = await Edit.ensurePdf({ quizId: QUIZ, teacherUserId: TEACHER }, { db: fakeDb({ switchOn: false, meta: { edit_v: 8 } }), remakePdf });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, pdf: 'ready' });
    expect(remakePdf).toHaveBeenCalledTimes(1);
    expect(remakePdf.mock.calls[0][0]).toBe(QUIZ);
    expect(remakePdf.mock.calls[0][1]).toBe(8);
  });

  test('switch off, owner, PDF already stored → 200 ready, no remake', async () => {
    const remakePdf = jest.fn();
    const r = await Edit.ensurePdf({ quizId: QUIZ, teacherUserId: TEACHER }, { db: fakeDb({ switchOn: false, meta: { edit_v: 2, pdf_key: 'k-e2.pdf' } }), remakePdf });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, pdf: 'ready', pdf_key: 'k-e2.pdf' });
    expect(remakePdf).not.toHaveBeenCalled();
  });

  test('switch off, not the owner → refused, no remake', async () => {
    const remakePdf = jest.fn();
    const r = await Edit.ensurePdf({ quizId: QUIZ, teacherUserId: OTHER }, { db: fakeDb({ switchOn: false, meta: { edit_v: 3 } }), remakePdf });
    expect(r.status).not.toBe(200);
    expect(r.body.reason).toBe('not_owner');
    expect(remakePdf).not.toHaveBeenCalled();
  });

  test('switch off, bad ids → refused before any read', async () => {
    const r = await Edit.ensurePdf({ quizId: 'nope', teacherUserId: TEACHER }, { db: fakeDb({ switchOn: false, meta: {} }), remakePdf: jest.fn() });
    expect(r.body.reason).toBe('bad_request');
  });

  test('view and save stay switch-gated: 404 {off:true} with the switch off', async () => {
    const db = fakeDb({ switchOn: false, meta: { edit_v: 1 } });
    const v = await Edit.view({ quizId: QUIZ, teacherUserId: TEACHER }, { db });
    expect(v.status).toBe(404);
    expect(v.body).toEqual({ off: true });
    const s = await Edit.save({ quizId: QUIZ, teacherUserId: TEACHER, expectV: 1, changes: [] }, { db });
    expect(s.status).toBe(404);
    expect(s.body).toEqual({ off: true });
  });
});
