'use strict';
/**
 * A synthetic school for the identity v2 tests: one teacher with two sections
 * of grade 4 (4-A, 4-B), a grade-4 quiz and its class code. 4-A holds the
 * collisions the matcher must ask about, never show: two Alis (different full
 * names), two Sanas (same full name, different fathers), two Hinas (same full
 * name, no father), and Bilal pasted twice (one child, two rows). Every name
 * is synthetic ("<Name> Testwala").
 */
const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const INVITE_SC = '33333333-3333-4333-8333-3333333333ff';
const CLS_A = 'c0000000-0000-4000-8000-00000000000a';
const CLS_B = 'c0000000-0000-4000-8000-00000000000b';
const LIST_A = 'a0000000-0000-4000-8000-00000000000a';
const LIST_B = 'a0000000-0000-4000-8000-00000000000b';
const TYPED = '44444444-4444-4444-8444-444444444444';
const kid = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

const A_KIDS = [
  [1, 'Ayesha Testwala', null],
  [2, 'Ali Raza Testwala', null],
  [3, 'Ali Hamza Testwala', null],
  [4, 'Sana Testwala', 'Dawood Testwala'],
  [5, 'Sana Testwala', 'Ehsan Testwala'],
  [6, 'Hina Testwala', null],
  [7, 'Hina Testwala', null],
  [8, 'Bilal Testwala', 'Khalid Testwala'],
  [9, 'Bilal Testwala', 'Khalid Testwala'], // the same child imported again, a day later
];

function db({ codeClass = CLS_A, flag = 'v2', grade = '4', classes = 'two', sessions = [] } = {}) {
  const students = A_KIDS.map(([n, name, father]) => ({
    id: kid(n), student_name: name, father_name: father, roll_number: n, list_id: LIST_A,
    is_active: true, status: 'active', created_at: `2026-09-0${n === 9 ? 3 : 1}T00:00:00Z`,
  }));
  students.push({ id: kid(10), student_name: 'Zara Testwala', father_name: null, roll_number: 1, list_id: LIST_B, is_active: true, status: 'active', created_at: '2026-09-01T00:00:00Z' });
  students.push({ id: kid(11), student_name: 'Nadia Testwala', father_name: null, roll_number: 10, list_id: LIST_A, is_active: true, status: 'merged', created_at: '2026-09-01T00:00:00Z' });
  students.push({ id: TYPED, student_name: 'Dansh', self_reported_class: '4-A', list_id: null, is_active: true, status: 'active', created_at: '2026-10-01T00:00:00Z' });
  const enrol = A_KIDS.map(([n]) => ({ id: `e-${n}`, class_id: CLS_A, student_id: kid(n), roll_number: n, is_active: true }));
  enrol.push({ id: 'e-10', class_id: CLS_B, student_id: kid(10), roll_number: 1, is_active: true });
  enrol.push({ id: 'e-11', class_id: CLS_A, student_id: kid(11), roll_number: 10, is_active: true });
  const cls = [{ id: CLS_A, school_id: 's1', grade_code: 'grade_4', section: 'A', shift_code: 'morning', is_active: true, merged_into_class_id: null }];
  const ct = [{ id: 'ct-a', class_id: CLS_A, teacher_user_id: TEACHER, is_active: true, is_class_teacher: true }];
  if (classes === 'two') {
    cls.push({ id: CLS_B, school_id: 's1', grade_code: 'grade_4', section: 'B', shift_code: 'morning', is_active: true, merged_into_class_id: null });
    ct.push({ id: 'ct-b', class_id: CLS_B, teacher_user_id: TEACHER, is_active: true, is_class_teacher: false });
  }
  return {
    app_settings: flag ? [{ key: 'web_quiz_identity', value: flag }] : [],
    quiz_share_codes: [
      { id: SC, code: 'AB12CD', quiz_id: QUIZ, teacher_user_id: TEACHER, teacher_name: 'Example Teacher', language: 'en',
        active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null, created_at: ago(30), class_id: codeClass },
      { id: INVITE_SC, code: 'FR13ND', quiz_id: QUIZ, teacher_user_id: TEACHER, teacher_name: 'Example Teacher', language: 'en',
        active: true, expires_at: future, invited_by_student_id: kid(1), parent_share_code_id: SC, created_at: ago(2), class_id: null },
    ],
    quizzes: [{ id: QUIZ, topic: 'Plants', grade, language: 'en', meta: {}, quiz_source: 'transcript', list_id: null }],
    quiz_questions: [1, 2].map((n) => ({
      id: `9999999${n}-9999-4999-8999-999999999999`, quiz_id: QUIZ, external_id: `tq:${n}`, sort_order: n,
      question_text: `Question ${n}`, option_a: 'Root', option_b: 'Leaf', option_c: 'Stem', option_d: null, correct_option: 'B', media: {},
    })),
    student_lists: [
      { id: LIST_A, user_id: TEACHER, class_name: 'Grade 4 - A', section: 'A', class_id: CLS_A, is_active: true },
      { id: LIST_B, user_id: TEACHER, class_name: 'Grade 4 - B', section: 'B', class_id: CLS_B, is_active: true },
    ],
    classes: cls,
    class_teachers: classes === 'none' ? [] : ct,
    class_enrollments: enrol,
    students,
    quiz_sessions: sessions,
    quiz_answers: [],
  };
}

const done = (id, studentId, name, correct, h, extra = {}) => ({
  id, quiz_id: QUIZ, share_code_id: SC, student_id: studentId, student_name: name, user_id: null, status: 'completed',
  correct_answers: correct, total_questions_answered: 5, mastery_percentage: correct * 20, completed_at: ago(h), created_at: ago(h + 0.1),
  invited_by_student_id: null, device_ref: extra.user_id ? null : `dev-${id}`, ...extra,
});

module.exports = { TEACHER, QUIZ, SC, INVITE_SC, CLS_A, CLS_B, LIST_A, LIST_B, TYPED, kid, ago, db, done };
