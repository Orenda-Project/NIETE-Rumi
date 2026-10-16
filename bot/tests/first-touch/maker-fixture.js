'use strict';
/**
 * The quiz-maker tests' fixture: a synthetic video bank (student_videos × quizzes × quiz_questions), one registered
 * teacher ("Amina Testwala"), seeded into the sister's in-memory Supabase through the door fixture. Only the network
 * boundary is faked; every module under test runs for real.
 */
const { seedDb, settings, fixturePhone } = require('./door-fixture');

const TEACHER = Object.freeze({
  id: 'a0000000-0000-4000-8000-0000000000f1', name: 'Amina Testwala', preferred_language: 'en',
  registration_completed: true, role: 'teacher',
});
const PHONE = fixturePhone(931);

const vid = (n) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const qid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const iso = (d) => new Date(d).toISOString();

/** id → [grade, subject, topic, { superseded, createdAt, language, status, source }] */
function bank() {
  const rows = [
    // n, grade, subject, topic, opts
    [1, '4', 'Maths', 'Fractions', { createdAt: '2026-01-01' }],
    [2, '4', 'Mathematics', 'Fractions', { createdAt: '2026-03-01' }],     // newer live video, same topic → wins
    [3, '4', 'Maths', 'Decimals', { superseded: true }],                  // superseded video → absent
    [4, '1', 'Islamic Studies', 'Kalima', {}],
    [5, '3', 'General Knowledge', 'Our Body', { language: 'en' }],
    [6, '6', 'Maths', 'Algebra', {}],                                     // grade 6 → absent
    [7, 'KG', 'English', 'Alphabet', {}],                                 // KG → absent
    [8, 'NURSERY', 'Urdu', 'Haroof', {}],                                 // NURSERY → absent
    [9, '2', 'Social Studies', 'My Town', {}],                            // unmapped subject → absent
    [10, '5', 'Science', 'Plants', { status: 'generating' }],             // not ready → absent
    [11, '5', 'General Science', 'Magnets', { language: 'ur' }],
    [12, '2', 'English', 'Nouns', { source: 'lesson_plan' }],             // not a video quiz → absent
  ];
  const student_videos = [];
  const quizzes = [];
  const quiz_questions = [];
  for (const [n, grade, subject, topic, o] of rows) {
    student_videos.push({
      id: vid(n), grade: `Grade ${grade}`, subject, topic, migration_status: 'done', r2_url: `https://media.example/${n}.mp4`,
      superseded_by: o.superseded ? vid(99) : null, created_at: iso(o.createdAt || '2026-02-01'),
    });
    quizzes.push({
      id: qid(n), teacher_id: null, video_id: vid(n), quiz_source: o.source || 'video', status: o.status || 'ready',
      grade, subject, topic, language: o.language === undefined ? null : o.language, meta: {}, created_at: iso('2026-02-02'),
    });
    quiz_questions.push(
      { id: `d0000000-0000-4000-8000-${String(n * 10 + 2).padStart(12, '0')}`, quiz_id: qid(n), question_text: `Second question of ${topic}`, sort_order: 2 },
      { id: `d0000000-0000-4000-8000-${String(n * 10 + 1).padStart(12, '0')}`, quiz_id: qid(n), question_text: `First question of ${topic}`, sort_order: 1 },
    );
  }
  return { student_videos, quizzes, quiz_questions };
}

/** Seeds the fake: switches (`on` → quiz_maker_page true), the bank, the teacher. → the fake. */
function seedMaker(supabase, { on = true, throwOn = null, extra = {} } = {}) {
  const fake = seedDb(supabase, { settings: on ? { quiz_maker_page: true } : {}, throwOn });
  const b = bank();
  fake.db.student_videos = b.student_videos;
  fake.db.quizzes = b.quizzes;
  fake.db.quiz_questions = b.quiz_questions;
  fake.db.quiz_share_codes = [];
  fake.db.users = [{ ...TEACHER }];
  Object.assign(fake.db, extra);
  return fake;
}

const tableReads = (fake, ...tables) => fake.calls.filter((c) => tables.includes(c.table)).length;

module.exports = { TEACHER, PHONE, vid, qid, bank, seedMaker, tableReads, settings, fixturePhone };
