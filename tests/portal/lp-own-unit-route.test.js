'use strict';
/**
 * bd-snkn32.59 (queue #165) — "A whole unit" routes: dark (404) unless the teacher app, Make my own AND the list-only
 * portal_lp_own_unit are on for her; the user is always the session's; a day is made once, review/test days never.
 */
const http = require('http');
const express = require('express');

let flags;
let unitList;
let rows;
let plans;
let posted;
let logged;
beforeEach(() => {
  jest.resetModules();
  flags = { portal_teacher_v2: true, portal_lp_make_own: true };
  unitList = ['11111111-1111-4111-8111-111111111111'];
  rows = [];
  plans = [];
  posted = [];
  logged = [];
  process.env.MAIN_BOT_URL = 'http://bot';
  process.env.INTERNAL_API_KEY = 'k';
  jest.doMock('../../dashboard/config/supabase', () => ({}));
  jest.doMock('../../bot/shared/services/lp-own-gb', () => ({ isGbTeacher: async () => false }));
  jest.doMock('../../dashboard/lib/portal-auth', () => ({
    requirePortalAuth: (req, res, next) => (req.session && req.session.portalUserId ? next() : res.status(401).json({})),
  }));
  jest.doMock('../../dashboard/lib/teacher-app', () => ({ teacherAppOnFor: async (_s, key) => flags[key] === true }));
  jest.doMock('../../dashboard/lib/feature-flags', () => ({
    PORTAL_TEACHER_V2_KEY: 'portal_teacher_v2',
    PORTAL_LP_MAKE_OWN_KEY: 'portal_lp_make_own',
    isFlagEnabledForUser: async (_s, key) => flags[key] === true,
  }));
  jest.doMock('../../dashboard/routes/app-funnel.routes', () => ({ logAppAction: (_req, action, _k, detail) => logged.push({ action, detail }) }));
  jest.doMock('axios', () => ({
    post: async (url, body) => { posted.push({ url, body }); return { status: 202, data: { success: true, renderId: 'own-1' } }; },
  }));
  jest.doMock('../../bot/shared/services/lp-own-unit.store', () => ({
    unitOn: async (_s, userId) => unitList.includes(userId),
    createUnitStore: () => ({
      insert: async (r) => { const row = { ...r, id: '22222222-2222-4222-8222-22222222222' + rows.length, status: 'active' }; rows.push(row); return row; },
      list: async (u) => rows.filter((r) => r.user_id === u),
      get: async (u, id) => rows.find((r) => r.user_id === u && r.id === id) || null,
      update: async (u, id, p) => Object.assign(rows.find((r) => r.id === id), p),
      dayPlans: async (u, id) => plans.filter((p) => p.unit_id === id),
      latestPeriod: async () => null,
    }),
  }));
});

let srv;
afterEach(async () => { if (srv) await new Promise((r) => srv.close(r)); srv = null; });

async function start(user = '11111111-1111-4111-8111-111111111111') {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.session = { portalUserId: user }; next(); });
  a.use('/api/portal', require('../../dashboard/routes/portal-lp-own-unit.routes'));
  srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
}

const call = (method, path, body) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({
    host: '127.0.0.1', port: srv.address().port, path, method, agent: false,
    headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
  }, (res) => {
    let s = '';
    res.on('data', (c) => { s += c; });
    res.on('end', () => resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
  });
  req.on('error', reject);
  if (data) req.write(data);
  req.end();
});

const UNIT = { grade: 3, subject: 'math', from: 2, to: 3, period: 35, pace: 'recommended' };
const ANSWERS = { size: '31_50', level: 'on_track', way: 'cpa', resources: ['textbook'] };

test('switch off (not on her list, or Make my own off): every unit route is 404 and nothing is written', async () => {
  unitList = [];
  await start();
  expect((await call('GET', '/api/portal/lp/own/unit/chapters?grade=3&subject=math')).status).toBe(404);
  expect((await call('POST', '/api/portal/lp/own/units', UNIT)).status).toBe(404);
  expect(rows).toHaveLength(0);
  unitList = ['11111111-1111-4111-8111-111111111111'];
  flags.portal_lp_make_own = false;
  expect((await call('GET', '/api/portal/lp/own/units')).status).toBe(404);
});

test('chapters and pace counts for G3 Maths ch 2-3 at 35 min', async () => {
  await start();
  const ch = await call('GET', '/api/portal/lp/own/unit/chapters?grade=3&subject=math');
  expect(ch.status).toBe(200);
  expect(ch.body.chapters.find((c) => c.number === 2).days).toBe(11);
  const p = await call('GET', '/api/portal/lp/own/unit/paces?grade=3&subject=math&from=2&to=3&period=35');
  expect(p.body).toEqual({ success: true, counts: { recommended: 21, slower: 25, faster: 17 } });
});

test('save, read back the same outline, and her period; another teacher cannot read it', async () => {
  await start();
  const made = await call('POST', '/api/portal/lp/own/units', UNIT);
  expect(made.status).toBe(201);
  expect(made.body.unit.days).toHaveLength(21);
  expect(rows[0].user_id).toBe('11111111-1111-4111-8111-111111111111');
  expect(logged.map((l) => l.action)).toContain('own_unit.create');
  const back = await call('GET', `/api/portal/lp/own/units/${made.body.unit.id}`);
  expect(back.body.unit.days.map((d) => d.lesson_ids)).toEqual(made.body.unit.days.map((d) => d.lesson_ids));
  expect(back.body.unit.period_minutes).toBe(35);
  await new Promise((r) => srv.close(r));
  unitList.push('33333333-3333-4333-8333-333333333333');
  await start('33333333-3333-4333-8333-333333333333');
  expect((await call('GET', `/api/portal/lp/own/units/${made.body.unit.id}`)).status).toBe(404);
});

test('open Day 4: one make, with the unit; open Day 10 (review): the book\'s day, no make', async () => {
  await start();
  const { body } = await call('POST', '/api/portal/lp/own/units', UNIT);
  const id = body.unit.id;
  const d4 = await call('POST', `/api/portal/lp/own/units/${id}/days/4/open`, { answers: ANSWERS });
  expect(d4).toEqual({ status: 202, body: { success: true, state: 'authoring', renderId: 'own-1' } });
  expect(posted).toHaveLength(1);
  expect(posted[0].body).toMatchObject({ userId: '11111111-1111-4111-8111-111111111111', lessonId: 'grade_3_math_ch2_seg4' });
  expect(posted[0].body.answers.unit).toMatchObject({ unit_id: id, day_no: 4, period: 35 });
  const d10 = await call('POST', `/api/portal/lp/own/units/${id}/days/10/open`, { answers: ANSWERS });
  expect(d10.body).toEqual({ success: true, outcome: 'book', lessonId: 'grade_3_math_ch2_seg990' });
  expect(posted).toHaveLength(1);
  const logs = logged.filter((l) => l.action === 'own_unit.open_day');
  expect(JSON.stringify(logs)).not.toContain('31_50'); // ids only, never her answers
});

test('a bad unit id is 404; a bad outline is 400', async () => {
  await start();
  expect((await call('GET', '/api/portal/lp/own/units/nope')).status).toBe(404);
  expect((await call('POST', '/api/portal/lp/own/units', { ...UNIT, outline: [{ kind: 'party' }] })).status).toBe(400);
});

// bd-snkn32.59.4 (queue #165, phase 2) — Amena 20 Nov: "pls dont link the textbook for learning goals".
const GOALS = { start: 'goals', grade: 3, subject: 'math', period: 35, pace: 'recommended',
  goals: [{ kind: 'outcome', text: 'Add 2-digit numbers', code: 'M-03-AD-02' }, { kind: 'topic', text: 'Telling the time' }, { kind: 'topic', text: 'Sharing equally' }, { kind: 'topic', text: 'Coins and notes' }] };

test('goal unit: pace counts from the number of goals; saved with no book, no chapter', async () => {
  await start();
  const p = await call('GET', '/api/portal/lp/own/unit/paces?start=goals&count=4&period=35');
  expect(p.body).toEqual({ success: true, counts: { recommended: 7, slower: 11, faster: 6 } });
  const made = await call('POST', '/api/portal/lp/own/units', { ...GOALS, from: 2, to: 3 });
  expect(made.status).toBe(201);
  expect(rows[0]).toMatchObject({ start_kind: 'goals', book_stem: null, goals: ['Add 2-digit numbers', 'Telling the time', 'Sharing equally', 'Coins and notes'] });
  expect(rows[0].chapter_from).toBeUndefined();
  expect(JSON.stringify(rows[0].outline)).not.toMatch(/grade_\d|_seg|pages/);
  expect(logged.find((l) => l.action === 'own_unit.create').detail.start).toBe('goals');
});

test('goal unit: every day is made from her goals (the check day too), never a book day', async () => {
  await start();
  const { body } = await call('POST', '/api/portal/lp/own/units', GOALS);
  const id = body.unit.id;
  await call('POST', `/api/portal/lp/own/units/${id}/days/2/open`, { answers: ANSWERS });
  expect(posted[0].body.lessonId).toBeNull();
  expect(posted[0].body.answers.unit).toMatchObject({ start: 'goals', day_no: 2, kind: 'lesson', grade: 3, subject: 'math', lang: 'en', goals: ['Telling the time'], recap: 'Add 2-digit numbers' });
  const check = await call('POST', `/api/portal/lp/own/units/${id}/days/7/open`, { answers: ANSWERS });
  expect(check.status).toBe(202);
  expect(posted[1].body.answers.unit).toMatchObject({ kind: 'test', goals: GOALS.goals.map((g) => g.text) });
});

test('goal unit: a blocked word or one goal only is refused, nothing written', async () => {
  await start();
  expect((await call('POST', '/api/portal/lp/own/units', { ...GOALS, goals: [...GOALS.goals.slice(0, 1), { kind: 'topic', text: 'sex' }] })).status).toBe(400);
  expect((await call('POST', '/api/portal/lp/own/units', { ...GOALS, goals: GOALS.goals.slice(0, 1) })).status).toBe(400);
  expect(rows).toHaveLength(0);
});

test('goal unit: a GB teacher gets 404 (Make my own stays off for GB)', async () => {
  jest.doMock('../../bot/shared/services/lp-own-gb', () => ({ isGbTeacher: async () => true }));
  await start();
  expect((await call('POST', '/api/portal/lp/own/units', GOALS)).status).toBe(404);
  expect(rows).toHaveLength(0);
});
