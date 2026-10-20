'use strict';
/**
 * The teacher app's home card asks the bot for the quiz job (GET /api/internal/thportal/portal-home?uid&lang): the
 * key first, then the quiz_teacher_home switch (off → 404 {off:true}), then the teacher (gone → 404, a coach or a
 * principal → off, reason role), then the quiz home's own top card from the quiz home's own reads, with a signed home
 * path (via 'portal'). Only the data sources are faked; Data, Model and the token run for real.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/first-touch/teacher-home.flags', () => ({ on: jest.fn() }));
// no walk-through persona here (its module is looked up by name)
jest.mock('../../shared/services/first-touch/optional-modules', () => ({ load: () => null }));

const express = require('express');
const Flags = require('../../shared/services/first-touch/teacher-home.flags');
const HomeToken = require('../../shared/services/first-touch/teacher-home.token');
const { logEvent } = require('../../shared/utils/structured-logger');
const { createRouter } = require('../../shared/services/first-touch/teacher-home.portal.routes');

const UID = 'a0000000-0000-4000-8000-0000000000c1';
const HOUR = 3600000;

/** A chainable stand-in for the client: each table's rows by the filters asked (`pick(ops)`), or an error. */
function fakeDb(tables) {
  return {
    from(table) {
      const ops = [];
      const answer = () => {
        const t = tables[table];
        if (t && t.error) return { data: null, error: { message: t.error } };
        return { data: t ? t.pick(ops) : [], error: null };
      };
      const chain = {
        maybeSingle: async () => { const a = answer(); return { data: a.error ? null : (a.data && a.data[0]) || null, error: a.error }; },
        then: (ok, ko) => Promise.resolve(answer()).then(ok, ko),
      };
      ['select', 'eq', 'is', 'gte', 'in', 'order', 'limit'].forEach((m) => { chain[m] = (...a) => { ops.push([m, ...a]); return chain; }; });
      return chain;
    },
  };
}
const asked = (ops, m, col) => ops.some((o) => o[0] === m && o[1] === col);

/** The deps a teacher's reads come from: the users row, their plan lessons, their sends and the report's counts. */
function depsFor({ role = 'teacher', user = true, userError = null, lessons = [], played = [], sent = [] } = {}) {
  const codes = sent.map((q) => ({ id: `c_${q.id}`, quiz_id: q.id, teacher_user_id: UID, active: true, expires_at: null, created_at: q.date }));
  return {
    supabase: fakeDb({
      users: userError ? { error: userError } : { pick: () => (user ? [{ id: UID, name: 'Ms Test Teacher', phone_number: null, preferred_language: 'en', role }] : []) },
      quizzes: { pick: () => sent.map((q) => ({ id: q.id, teacher_id: UID, status: 'sent', quiz_source: 'lp_v8', topic: q.topic, meta: { student_message: 'Play this', share_code_id: `c_${q.id}` } })) },
      // the teacher's own library sends (asked by teacher_user_id): none; the codes by id: the stored codes above
      quiz_share_codes: { pick: (ops) => (asked(ops, 'eq', 'teacher_user_id') ? [] : codes) },
    }),
    List: {
      loadLessonPage: async () => ({ sessions: [], quizzes: [], counts: new Map(), lessons }),
      lessonItems: (s, q, ls) => ls.map((l, i) => ({ kind: 'lesson', key: `lpl_${i + 1}`, date: l.date, quiz: null, lesson: l })),
      quizState: (q) => (q ? q.status : 'none'),
    },
    Report: {
      classReport: async () => ({ quizzes: played }),
      sessionsFor: async () => [],
      countedSessions: () => [],
    },
  };
}

let srv;
async function serve(deps) {
  const app = express();
  app.use('/api/internal/thportal', createRouter(deps));
  await new Promise((r) => { srv = app.listen(0, '127.0.0.1', r); });
}
async function get(q, { key = process.env.INTERNAL_API_KEY } = {}) {
  const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/internal/thportal/portal-home${q}`, { headers: key ? { 'x-api-key': key } : {} });
  let body = null;
  try { body = await res.json(); } catch (_) { /* not JSON */ }
  return { status: res.status, body, cache: res.headers.get('cache-control') };
}

beforeEach(() => { Flags.on.mockReset(); Flags.on.mockResolvedValue(true); logEvent.mockClear(); });
afterEach(async () => { if (srv) { srv.closeAllConnections(); await new Promise((r) => srv.close(r)); srv = null; } });

describe('portal home card', () => {
  test('no key → 401, before the switch is read', async () => {
    await serve(depsFor());
    expect((await get(`?uid=${UID}`, { key: null })).status).toBe(401);
    expect((await get(`?uid=${UID}`, { key: 'wrong' })).status).toBe(401);
    expect(Flags.on).not.toHaveBeenCalled();
  });

  test('switch off, or its read throws → 404 {off:true}', async () => {
    await serve(depsFor());
    Flags.on.mockResolvedValue(false);
    expect(await get(`?uid=${UID}`)).toMatchObject({ status: 404, body: { off: true } });
    Flags.on.mockRejectedValue(new Error('down'));
    expect(await get(`?uid=${UID}`)).toMatchObject({ status: 404, body: { off: true } });
  });

  test('a uid that is not a UUID → 400; a teacher who is gone → 404 reason user', async () => {
    await serve(depsFor({ user: false }));
    expect((await get('?uid=not-a-uuid')).status).toBe(400);
    expect((await get('')).status).toBe(400);
    expect(await get(`?uid=${UID}`)).toMatchObject({ status: 404, body: { off: true, reason: 'user' } });
  });

  test('a coach → 200 {off:true, reason:role}, no token', async () => {
    await serve(depsFor({ role: 'Coach' }));
    expect(await get(`?uid=${UID}`)).toMatchObject({ status: 200, body: { off: true, reason: 'role' } });
  });

  test('an un-quizzed lesson plan of yesterday → the lesson card and a signed home path (via portal, the language asked)', async () => {
    await serve(depsFor({ lessons: [{ date: new Date(Date.now() - 24 * HOUR).toISOString(), topic: 'Plants', subject: 'science', grade: 3 }] }));
    const r = await get(`?uid=${UID}&lang=en`);
    expect(r.status).toBe(200);
    expect(r.cache).toBe('private, no-store');
    expect(r.body.path).toMatch(/^\/quiz\/teacher\//);
    const t = r.body.path.slice('/quiz/teacher/'.length);
    expect(HomeToken.verifyTeacherHome(t)).toEqual({ ok: expect.objectContaining({ uid: UID, lang: 'en', via: 'portal' }) });
    expect(r.body.primary).toEqual({ kind: 'lesson', id: 'lpl_1', make: 'lesson', title: 'Plants', from: 'lp' });
    expect(r.body.facts).toMatchObject({ has_lp: true, primary_kind: 'lp_quiz' });
    // not a quiz-home open
    expect(logEvent.mock.calls.map((c) => c[0])).not.toContain('teacher_home_open');
  });

  test('a send of an hour ago that 3 children played → the class card; lang defaults to ur', async () => {
    const at = new Date(Date.now() - HOUR).toISOString();
    await serve(depsFor({
      sent: [{ id: 'q1', topic: 'Fractions', date: at }],
      played: [{ id: 'q1', played: 3, of: 20, date: at, topic: 'Fractions', source: 'lp_v8' }],
    }));
    const r = await get(`?uid=${UID}`);
    expect(r.status).toBe(200);
    expect(r.body.primary).toEqual({ kind: 'class', title: 'Fractions', played: 3 });
    expect(HomeToken.verifyTeacherHome(r.body.path.slice('/quiz/teacher/'.length)).ok.lang).toBe('ur');
  });

  test('nothing to quiz → primary none', async () => {
    await serve(depsFor());
    const r = await get(`?uid=${UID}&lang=en`);
    expect(r.status).toBe(200);
    expect(r.body.primary).toEqual({ kind: 'none' });
  });

  test('a thrown read → 503 {error:mk.error}, never a 500', async () => {
    await serve(depsFor({ userError: 'db down' }));
    const r = await get(`?uid=${UID}`);
    expect(r).toMatchObject({ status: 503, body: { error: 'mk.error' }, cache: 'private, no-store' });
  });
});
