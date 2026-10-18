'use strict';
/**
 * A story the teacher sent this month, with the quick answer (switch quiz_teacher_home_paged) ON and OFF: the home's
 * library dates the sent book and the pick is the next book, both ways. The quick answer's class report rows (ownOnly)
 * carry the story's book from the quizzes read they already make (its `meta`), so ON needs no "which are mine" read.
 * The routes run end to end over the in-memory Supabase, as the routes test does.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
process.env.PORTAL_URL = 'https://portal.example';
process.env.WHATSAPP_BOT_NUMBER = '15550001111';
process.env.WEB_QUIZ_KID_KEY = 'unit-kid-key-not-a-secret-0123456789';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));
const mockWalk = { forHome: undefined };
jest.mock('../../shared/services/first-touch/walk-persona', () => mockWalk);
jest.mock('../../shared/services/first-touch/one-door.service', () => ({ mintLanding: undefined }));
jest.mock('../../shared/services/first-touch/optional-modules', () => ({ load: undefined }));
jest.mock('../../shared/routes/story-teacher-internal.routes', () => ({ servePage: undefined }));
jest.mock('../../shared/services/quiz/story-teacher.service', () => ({ flagOn: undefined }));

const http = require('http');
const express = require('express');
const supabase = require('../../shared/config/supabase');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Gate = require('../../shared/services/quiz/teacher-report-gate');
const List = require('../../shared/services/quiz/transcript-quiz-list.service');
const Bank = require('../../shared/services/first-touch/maker.bank');
const Flags = require('../../shared/services/first-touch/teacher-home.flags');
const HomeToken = require('../../shared/services/first-touch/teacher-home.token');
const Report = require('../../shared/services/quiz/teacher-report.data');
const { createRouter } = require('../../shared/services/first-touch/teacher-home.routes');
const { seedMaker, TEACHER } = require('./maker-fixture');
const { jsonPathSelect } = require('./_json-path-select');

const OWN_QUIZ = 'c0000000-0000-4000-8000-0000000000a1';
const OWN_CODE = 'f0000000-0000-4000-8000-0000000000a1';
const tokenFor = () => HomeToken.signTeacherHome({ uid: TEACHER.id, lang: 'en', via: 'go' });

let srv;
let fake;
async function boot(d) {
  const app = express();
  app.use('/api/internal/th', createRouter(d));
  await new Promise((r) => { srv = app.listen(0, '127.0.0.1', r); });
}
// one socket per request (no pooled keep-alive to a server an earlier test closed)
const get = (p) => new Promise((resolve, reject) => {
  const req = http.get({ host: '127.0.0.1', port: srv.address().port, path: `/api/internal/th${p}`, agent: false, headers: { 'x-api-key': process.env.INTERNAL_API_KEY } }, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve(JSON.parse(body)));
  });
  req.on('error', reject);
});

function seed(paged) {
  fake = seedMaker(supabase, { on: true });
  fake.db.app_settings = [...fake.db.app_settings, { key: 'quiz_teacher_home', value: true }, ...(paged ? [{ key: 'quiz_teacher_home_paged', value: true }] : [])];
  Flags.reset(); IdFlags._resetCache(); HubFlags._resetCache(); Gate._resetCache(); Bank._resetCache();
}

beforeEach(() => { jest.clearAllMocks(); });
afterEach(() => new Promise((r) => { if (!srv) return r(); srv.closeAllConnections(); srv.close(r); srv = null; }));

test.each([['OFF', false], ['ON', true]])('switch %s: a book the teacher sent this month — the home dates it and picks the next book, as another grade\'s library does', async (_, paged) => {
  seed(paged);
  const at = new Date(Date.now() - 5 * 86400000).toISOString();
  fake.db.quizzes.push({ id: OWN_QUIZ, teacher_id: TEACHER.id, quiz_source: 'story', status: 'sent', topic: 'The Thirsty Crow', created_at: at,
    meta: { story: { book_id: 'b1', lang: 'en' }, student_message: 'Read with Jugnu: https://portal.example/q/STORY1', share_code_id: OWN_CODE } });
  fake.db.quiz_sessions = [];
  const deps = {
    List: { ...List, loadLessonPage: jest.fn(async () => ({ sessions: [], quizzes: [], counts: {}, lessons: [] })) },
    supabase: jsonPathSelect(supabase),
    Stories: { flagOn: async () => true, shelf: jest.fn(async () => ({ books: [{ id: 'b1', title: 'The Thirsty Crow' }, { id: 'b2', title: 'Rain' }] })) },
  };
  await boot(deps);
  const t = tokenFor();
  const base = `/quiz/teacher/${encodeURIComponent(t)}/stories?lang=en`;
  const home = await get(`/api/th/home?t=${t}&g=3`);
  expect(home.primary).toMatchObject({ kind: 'story', id: 'b2' });
  expect(home.library.stories).toEqual([{ id: 'b1', title: 'The Thirsty Crow', href: `${base}&book=b1`, sent: at }, { id: 'b2', title: 'Rain', href: `${base}&book=b2` }]);
  const lib = await get(`/api/th/library?t=${t}&g=4`);
  expect(lib.pick).toMatchObject({ kind: 'story', id: 'b2', href: `${base}&book=b2` });
  expect(lib.stories).toEqual(home.library.stories);
  // ON: the home's book comes from the class report's own quizzes read — no "which are mine" read for the home
  const mineReads = deps.supabase.selects.filter((x) => x.table === 'quizzes' && /story_book/.test(x.cols)).length;
  expect(mineReads).toBe(paged ? 1 : 2); // ON: the library's own read only; OFF: one per request, as today
});

describe('the class report\'s own-quiz rows (the quick answer)', () => {
  const row = (id, source, meta) => ({ id, teacher_id: TEACHER.id, quiz_source: source, status: 'sent', topic: id, created_at: new Date(Date.now() - 86400000).toISOString(), meta });
  test('ownOnly: a story row carries its book (or null); every other row and the full report are as before', async () => {
    seed(false);
    fake.db.quizzes.push(row('s1', 'story', { story: { book_id: 'b1' } }), row('s2', 'story', {}), row('v1', 'video', { story: { book_id: 'b7' } }));
    const own = await Report.classReport(TEACHER.id, { days: 60, ownOnly: true });
    const by = new Map(own.quizzes.map((q) => [q.id, q]));
    expect(by.get('s1').book).toBe('b1');
    expect(by.get('s2')).toHaveProperty('book', null);
    expect(by.get('v1')).not.toHaveProperty('book');
    const full = await Report.classReport(TEACHER.id, { days: 60 });
    expect(full.quizzes.every((q) => !('book' in q))).toBe(true); // switch OFF's report: byte-identical
  });

  test('playedOwn light: the story entries carry `book` as the full read does, from the same report rows', async () => {
    const { playedOwn } = require('../../shared/services/first-touch/teacher-home.data');
    const q = (id, source, extra = {}) => ({ id, played: 2, of: 9, date: '2026-10-10', topic: id, source, ...extra });
    const R = { classReport: jest.fn(async () => ({ quizzes: [q('s1', 'story', { book: 'b1' }), q('s2', 'story', { book: null }), q('v1', 'video'), q('L', 'video', { sent: true })] })) };
    const out = await playedOwn(TEACHER.id, { Report: R }, { light: true });
    expect([...out.keys()]).toEqual(['s1', 's2', 'v1']);
    expect(out.get('s1')).toEqual({ played: 2, of: 9, date: '2026-10-10', topic: 's1', source: 'story', book: 'b1' });
    expect(out.get('s2')).toEqual({ played: 2, of: 9, date: '2026-10-10', topic: 's2', source: 'story', book: null });
    expect(out.get('v1')).toEqual({ played: 2, of: 9, date: '2026-10-10', topic: 'v1', source: 'video' });
  });
});
