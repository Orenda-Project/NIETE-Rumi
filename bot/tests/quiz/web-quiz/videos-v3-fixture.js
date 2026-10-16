'use strict';
/**
 * The video library's seed for the web_quiz_videos_v3 tests (the OFF golden and the ON tests):
 * web-quiz-library.test.js's seed, with a `language` on each video (NULL, 'en' or 'ur') and
 * chapters whose numbers sort differently as text and as numbers (Latin, Urdu and Arabic-Indic digits).
 * Not a test file: both test files require it after their jest.mock block.
 */
const { makeFake } = require('./fake-supabase');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const KID_A = '44444444-4444-4444-8444-444444444444';
const V = (n) => `aaaaaa${String(n).padStart(2, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const VQ = (n) => `bbbbbb${String(n).padStart(2, '0')}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

function seed(supabase, settings = [{ key: 'web_quiz_library', value: true }]) {
  const vrow = (n, grade, subject, chapter, title, language, extra = {}) => ({
    id: V(n), grade, subject, clean_chapter: chapter, clean_title: title, language, migration_status: 'done', superseded_by: null,
    r2_url: `https://acct.r2.example.com/test-bucket/student-videos/v${n}.mp4`, ...extra,
  });
  const vquiz = (n) => ({ id: VQ(n), video_id: V(n), quiz_source: 'video', status: 'ready', topic: `Video quiz ${n}`, grade: '3', subject: 'Science' });
  const videos = [
    vrow(1, '3', 'Science', 'Plants', 'Parts of a Flower', null),
    vrow(2, '3', 'Science', 'Plants', 'Leaves', 'en'),
    vrow(3, '3', 'Science', 'Animals', 'Life Cycle of a Hen', 'ur'),
    vrow(4, '3', 'Maths', 'Chapter 2', 'Adding', 'en'),
    vrow(5, '3', 'Maths', 'Chapter 10', 'Big numbers', 'en'),
    vrow(6, '3', 'English', 'Nouns', 'Naming Words', null),
    vrow(7, '3', 'Science', 'Plants', 'No quiz yet', null),                              // no ready quiz: never listed
    vrow(8, '3', 'Science', 'Plants', 'A duplicate', null, { superseded_by: V(1) }),      // superseded: never listed
    vrow(9, '4', 'Science', 'Energy', 'Grade four video', 'en'),
    vrow(10, 'KG', 'English', 'Letters', 'ABC', null),
    vrow(11, '3', 'Urdu', 'Haroof', 'Not migrated', 'ur', { migration_status: 'pending' }),
    vrow(12, '3', 'Urdu', 'باب ۱۰', 'دس', 'ur'),
    vrow(13, '3', 'Urdu', 'باب ۲', 'دو', 'ur'),
    vrow(14, '3', 'Urdu', 'باب ٣', 'تین', 'ur'),                                          // Arabic-Indic three
    vrow(15, '3', 'Maths', 'Unit 3 Part 12', 'Shapes', null),
    vrow(16, '3', 'Maths', 'Unit 3 Part 2', 'Lines', null),
    vrow(17, '3', 'Maths', 'Chapter 2', 'Taking away', 'ur'),
  ];
  const fake = makeFake({
    app_settings: settings,
    quiz_share_codes: [
      { id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Testwala',
        topic: 'Parts of a plant', language: 'en', active: true, expires_at: future, invited_by_student_id: null,
        parent_share_code_id: null, uses_count: 0, created_at: ago(30) },
      { id: 'sc-v1', code: 'VID001', quiz_id: VQ(1), video_id: V(1), teacher_user_id: TEACHER, language: 'en', active: true,
        expires_at: future, invited_by_student_id: null, parent_share_code_id: SC, created_at: ago(5) },
      { id: 'sc-v2', code: 'VID002', quiz_id: VQ(2), video_id: V(2), teacher_user_id: TEACHER, language: 'en', active: true,
        expires_at: past, invited_by_student_id: null, parent_share_code_id: SC, created_at: ago(500) },
      { id: 'sc-v3', code: 'VID003', quiz_id: VQ(3), video_id: V(3), teacher_user_id: TEACHER, language: 'en', active: true,
        expires_at: future, invited_by_student_id: null, parent_share_code_id: SC, created_at: ago(5) },
      // An Urdu class's quiz code.
      { id: 'sc-ur', code: 'UR12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Testwala',
        topic: 'Parts of a plant', language: 'ur', active: true, expires_at: future, invited_by_student_id: null,
        parent_share_code_id: null, uses_count: 0, created_at: ago(30) },
    ],
    quizzes: [
      { id: QUIZ, topic: 'Parts of a plant', grade: '3', subject: 'science', language: 'en', quiz_source: 'transcript', video_id: null },
      ...[1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 15, 16, 17].map(vquiz),
      { id: VQ(7), video_id: V(7), quiz_source: 'video', status: 'generating' },
    ],
    student_videos: videos,
    quiz_sessions: [
      { id: 's-a1', quiz_id: QUIZ, share_code_id: SC, student_id: KID_A, status: 'completed', completed_at: ago(1), created_at: ago(1) },
      { id: 's-a0', quiz_id: VQ(2), share_code_id: SC, student_id: KID_A, status: 'completed', completed_at: ago(20), created_at: ago(20) },
    ],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  return fake;
}

// A signed poster carries the signing time: the trace keeps the object key only.
const normPosters = (x) => JSON.parse(JSON.stringify(x).replace(/(https:[^"?]*_poster\.jpg)\?[^"]*/g, '$1?<signed>'));

module.exports = { seed, normPosters, TEACHER, QUIZ, SC, KID_A, V, VQ };
