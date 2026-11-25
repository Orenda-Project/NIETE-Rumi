'use strict';
/**
 * bd-5j1zaf — the teacher home's "Quiz reports" section, through the real router over the in-memory Supabase.
 *
 * Switch quiz_teacher_home_reports ON (JSON true): /api/th/home carries `reports` — every sent quiz of the teacher's
 * (own quizzes from the class report's rows, stories left out; library sends by their code), newest first, each with
 * the report's own count, the children who finished after its 12 h report, whether that report has gone, and the live
 * report's link opened from here (?from=home); the shell carries the section. OFF (absent, false, the string "true"):
 * no `reports` key and no section (the switch-off goldens in bot/tests/first-touch pin the rest byte for byte).
 * The section's taps log teacher_home.step { step: 'report', late }.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
process.env.PORTAL_URL = 'https://portal.example';
process.env.WHATSAPP_BOT_NUMBER = '15550001111';
process.env.WEB_QUIZ_KID_KEY = 'unit-kid-key-not-a-secret-0123456789';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('../first-touch/_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('../first-touch/_ingress-mocks').whatsappMock(jest));
jest.mock('../../shared/services/first-touch/walk-persona', () => ({ forHome: jest.fn(async (phone, lists) => lists) }));
jest.mock('../../shared/services/first-touch/one-door.service', () => ({ mintLanding: undefined }));
jest.mock('../../shared/services/first-touch/optional-modules', () => ({ load: undefined }));
jest.mock('../../shared/routes/story-teacher-internal.routes', () => ({ servePage: undefined }));
jest.mock('../../shared/services/quiz/story-teacher.service', () => ({ flagOn: undefined }));

const express = require('express');
const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Gate = require('../../shared/services/quiz/teacher-report-gate');
const List = require('../../shared/services/quiz/transcript-quiz-list.service');
const Bank = require('../../shared/services/first-touch/maker.bank');
const Flags = require('../../shared/services/first-touch/teacher-home.flags');
const CountsFlag = require('../../shared/services/first-touch/teacher-home-counts.flag');
const MoreFlags = require('../../shared/services/first-touch/teacher-home.more-flags');
const ReportsFlag = require('../../shared/services/quiz/report-late-flag');
const HomeToken = require('../../shared/services/first-touch/teacher-home.token');
const { createRouter } = require('../../shared/services/first-touch/teacher-home.routes');
const { seedMaker, TEACHER } = require('../first-touch/maker-fixture');

const PLANTS = 'c0000000-0000-4000-8000-0000000000a1';
const SHAPES = 'c0000000-0000-4000-8000-0000000000a2';
const STORY = 'c0000000-0000-4000-8000-0000000000a3';
const CODE_P = 'f0000000-0000-4000-8000-0000000000a1';
const CODE_S = 'f0000000-0000-4000-8000-0000000000a2';
const CODE_T = 'f0000000-0000-4000-8000-0000000000a3';
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const soon = new Date(Date.now() + 86400000).toISOString();
const tokenFor = (o = {}) => HomeToken.signTeacherHome({ uid: TEACHER.id, lang: 'en', via: 'go', ...o });

let srv;
let fake;
async function boot(d) {
  const app = express();
  app.use('/api/internal/th', createRouter(d));
  await new Promise((r) => { srv = app.listen(0, '127.0.0.1', r); });
}
const url = (p) => `http://127.0.0.1:${srv.address().port}/api/internal/th${p}`;
const H = () => ({ 'x-api-key': process.env.INTERNAL_API_KEY });
const get = (p) => fetch(url(p), { headers: H(), redirect: 'manual' });
const post = (p, body) => fetch(url(p), { method: 'POST', headers: { ...H(), 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual' });

const sess = (id, code, quiz, kid, h, extra = {}) => ({
  id, quiz_id: quiz, share_code_id: code, student_id: kid, student_name: `Child ${id}`, user_id: null, status: 'completed',
  correct_answers: 3, total_questions_answered: 4, completed_at: ago(h), created_at: ago(h + 0.1), invited_by_student_id: null, device_ref: `dv-${id}`, ...extra,
});
const kid = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

/** Two sent quizzes and a story send of the teacher's; Plants reported 18 h ago with one child after it. */
function seed({ reports = true, settings = [] } = {}) {
  fake = seedMaker(supabase, { on: true, extra: { coaching_sessions: [] } });
  fake.db.app_settings = [...fake.db.app_settings, { key: 'quiz_teacher_home', value: true }, { key: 'teacher_report_teachers', value: 'all' },
    ...(reports === undefined ? [] : reports === true ? [{ key: 'quiz_teacher_home_reports', value: true }] : reports === null ? [] : [{ key: 'quiz_teacher_home_reports', value: reports }]),
    ...settings];
  const quiz = (id, topic, h, code, extra = {}) => ({
    id, teacher_id: TEACHER.id, quiz_source: 'transcript', status: 'sent', topic, subject: 'Science', grade: '3', language: 'en', list_id: null,
    created_at: ago(h), meta: { student_message: `Play: https://portal.example/q/${code.slice(-6)}`, share_code_id: code }, ...extra,
  });
  fake.db.quizzes.push(quiz(PLANTS, 'Plants', 30, CODE_P), quiz(SHAPES, 'Shapes', 6, CODE_S), quiz(STORY, 'The Crow', 3, CODE_T, { quiz_source: 'story' }));
  const code = (id, quizId, h, stamp) => ({ id, code: id.slice(-6).toUpperCase(), quiz_id: quizId, teacher_user_id: TEACHER.id, active: true, expires_at: soon, created_at: ago(h), invited_by_student_id: null, parent_share_code_id: null, report_sent_at: stamp });
  fake.db.quiz_share_codes.push(code(CODE_P, PLANTS, 30, ago(18)), code(CODE_S, SHAPES, 6, null), code(CODE_T, STORY, 3, null));
  fake.db.quiz_sessions = [
    sess('p1', CODE_P, PLANTS, kid(1), 20), // before the report
    sess('p2', CODE_P, PLANTS, kid(2), 2), // after it: late
    sess('s1', CODE_S, SHAPES, kid(1), 1), // no report yet: not late
    sess('t1', CODE_T, STORY, kid(3), 1, { status: 'in_progress', completed_at: null }),
  ];
  fake.db.quiz_answers = [];
  Flags.reset(); IdFlags._resetCache(); HubFlags._resetCache(); Gate._resetCache(); Bank._resetCache(); CountsFlag._resetCache(); MoreFlags._resetCache(); ReportsFlag._resetCache();
}
const listDeps = (extra = {}) => ({ List: { ...List, loadLessonPage: jest.fn(async () => ({ sessions: [], quizzes: [], counts: {}, lessons: [] })) }, ...extra });

beforeEach(() => { jest.clearAllMocks(); });
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

describe('switch ON', () => {
  test('/api/th/home carries the section: newest first, late and reported from the report\'s own count, the live link from here', async () => {
    seed();
    await boot(listDeps());
    const home = await (await get(`/api/th/home?t=${tokenFor()}`)).json();
    expect(home.reports).toBeDefined();
    const rows = home.reports.rows;
    expect(rows.map((r) => r.title)).toEqual(['Shapes', 'Plants']); // the story send is not a quiz report row
    expect(rows[1]).toMatchObject({ key: `q_${PLANTS}`, played: 2, late: 1, reported: true });
    expect(rows[0]).toMatchObject({ key: `q_${SHAPES}`, played: 1, late: 0, reported: false });
    // the report opens in the home's language (an en teacher reading the Urdu home gets the Urdu report)
    rows.forEach((r) => expect(r.report).toMatch(/^https:\/\/portal\.example\/r\/[^?]+\?from=home&lang=en$/));
    expect(home.reports.rounds).toBeNull();
  });

  test('a home read in Urdu links the Urdu report (the token\'s lang or the page\'s ?lang)', async () => {
    seed();
    await boot(listDeps());
    const ur = await (await get(`/api/th/home?t=${tokenFor({ lang: 'ur' })}`)).json();
    ur.reports.rows.forEach((r) => expect(r.report).toMatch(/\?from=home&lang=ur$/));
    const bi = await (await get(`/api/th/home?t=${tokenFor({ lang: 'bi' })}&lang=en`)).json();
    bi.reports.rows.forEach((r) => expect(r.report).toMatch(/\?from=home&lang=en$/));
  });

  test('the quick answer (quiz_teacher_home_paged) carries the same rows', async () => {
    seed({ settings: [{ key: 'quiz_teacher_home_paged', value: true }] });
    await boot(listDeps());
    const home = await (await get(`/api/th/home?t=${tokenFor()}`)).json();
    expect(home.reports.rows.map((r) => [r.title, r.late, r.reported])).toEqual([['Shapes', 0, false], ['Plants', 1, true]]);
  });

  test('a report page that is not on for this teacher: no links, so no rows', async () => {
    seed();
    fake.db.app_settings = fake.db.app_settings.filter((r) => r.key !== 'teacher_report_teachers');
    Gate._resetCache();
    await boot(listDeps());
    const home = await (await get(`/api/th/home?t=${tokenFor()}`)).json();
    expect(home.reports).toEqual({ rows: [], rounds: null });
  });

  test('the evening rounds line: only when the class tab\'s reader has a round to show', async () => {
    seed();
    const rounds = jest.fn(async () => [{ round_day: '2026-11-23', finishers: [] }]);
    await boot(listDeps({ EveningRound: { forTeacherReport: rounds } }));
    const home = await (await get(`/api/th/home?t=${tokenFor()}`)).json();
    expect(rounds).toHaveBeenCalledWith(TEACHER.id);
    expect(home.reports.rounds).toMatch(/^https:\/\/portal\.example\/r\/[^?]+\?tab=class&from=home&lang=en$/);
  });

  test('the shell carries the section, its heading and its More', async () => {
    seed();
    await boot(listDeps());
    const html = await (await get(`/quiz/teacher/${tokenFor()}`)).text();
    expect(html).toContain('id="th-rp"');
    expect(html).toContain('>Quiz reports</h2>');
    expect(html).toContain('id="th-rp-more"');
    // between the top card and My lessons
    expect(html.indexOf('id="th-top"')).toBeLessThan(html.indexOf('id="th-rp"'));
    expect(html.indexOf('id="th-rp"')).toBeLessThan(html.indexOf('id="th-tl"'));
  });

  test('a row\'s tap logs teacher_home.step { step: report, late }', async () => {
    seed();
    await boot(listDeps());
    const t = tokenFor();
    // the home sends the string (the edge keeps strings only); a boolean from elsewhere still reads as true
    expect((await post('/api/th/step', { t, step: 'report', late: 'true' })).status).toBe(204);
    expect((await post('/api/th/step', { t, step: 'report', late: 'false' })).status).toBe(204);
    expect((await post('/api/th/step', { t, step: 'reports_more' })).status).toBe(204);
    const steps = logEvent.mock.calls.filter(([n]) => n === 'teacher_home.step').map(([, f]) => f);
    expect(steps[0]).toMatchObject({ step: 'report', late: true });
    expect(steps[1]).toMatchObject({ step: 'report', late: false });
    expect(steps[2]).toMatchObject({ step: 'reports_more' });
    expect(steps[2]).not.toHaveProperty('late');
  });
});

describe('switch OFF', () => {
  test.each([['absent', null], ['false', false], ['the string "true"', 'true']])('%s → no reports key, no section', async (_, v) => {
    seed({ reports: v });
    await boot(listDeps());
    const home = await (await get(`/api/th/home?t=${tokenFor()}`)).json();
    expect(home).not.toHaveProperty('reports');
    const html = await (await get(`/quiz/teacher/${tokenFor()}`)).text();
    expect(html).not.toContain('th-rp');
  });
});

/**
 * QF-R4c: the "Evening rounds" line and the class tab's section read ONE source. A live standing link alone (the evening
 * after a link is minted, before the first round is drawn; a class with no children) shows no line, because the tab it
 * opens would have no section; a round in the last week shows the line and the tab carries #evening-rounds. Real
 * class-link and evening-round readers over the same in-memory Supabase (no reader injected).
 */
describe('the rounds line and the class tab\'s section agree', () => {
  const CLASS = 'c1a55000-0000-4000-8000-0000000000f1';
  const ROUND_QUIZ = 'c0000000-0000-4000-8000-0000000000f1';
  const ROUND_CODE = 'f0000000-0000-4000-8000-0000000000f1';
  const ER = () => require('../../shared/services/quiz/web-quiz-evening-round');
  function seedRounds({ round }) {
    seed({ settings: ['web_quiz_challenge', 'web_quiz_challenge_v2', 'web_quiz_class_link', 'web_quiz_evening_round'].map((key) => ({ key, value: true })) });
    fake.db.class_teachers = [{ id: 'ctf1', class_id: CLASS, teacher_user_id: TEACHER.id, is_active: true }];
    fake.db.class_links = [{ code: 'QFXTESTAB1', class_id: CLASS, teacher_id: TEACHER.id, term_code: '2026-27b', expires_at: soon, revoked_at: null, created_at: ago(2) }];
    fake.db.classes = [{ id: CLASS, grade_code: '3', section: 'A' }];
    fake.db.students = [{ id: kid(9), student_name: 'Sana Testwala' }];
    if (round) {
      fake.db.quizzes.push({ id: ROUND_QUIZ, teacher_id: TEACHER.id, quiz_source: 'transcript', status: 'sent', topic: 'Fractions', subject: 'Maths', grade: '3', language: 'en', list_id: null, created_at: ago(20), meta: { source: 'evening_round' } });
      fake.db.quiz_share_codes.push({ id: ROUND_CODE, code: 'RNDF01', quiz_id: ROUND_QUIZ, class_id: CLASS, teacher_user_id: TEACHER.id, active: true, expires_at: soon, created_at: ago(20), invited_by_student_id: null, parent_share_code_id: null, report_sent_at: null });
      fake.db.quiz_sessions.push(sess('r1', ROUND_CODE, ROUND_QUIZ, kid(9), 18));
    }
    require('../../shared/services/quiz/web-quiz-class-link-flags')._resetCache();
    require('../../shared/services/quiz/web-quiz-evening-round-flags')._resetCache();
  }

  test('a live link and no round yet: no line (the tab would have no section to land on)', async () => {
    seedRounds({ round: false });
    await boot(listDeps());
    const home = await (await get(`/api/th/home?t=${tokenFor()}`)).json();
    await expect(ER().reportSection(TEACHER.id)).resolves.toBe('');
    expect(home.reports.rounds).toBeNull();
  });

  test('a round this week: the line, and the tab it opens carries #evening-rounds', async () => {
    seedRounds({ round: true });
    await boot(listDeps());
    const home = await (await get(`/api/th/home?t=${tokenFor({ lang: 'ur' })}`)).json();
    expect(home.reports.rounds).toMatch(/^https:\/\/portal\.example\/r\/[^?]+\?tab=class&from=home&lang=ur$/);
    expect(await ER().reportSection(TEACHER.id, { lang: 'ur' })).toContain('id="evening-rounds"');
  });
});
