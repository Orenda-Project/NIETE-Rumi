'use strict';
/**
 * bd-snkn32.56 (queue #134 E) — the goal start's two reads for the Make my own form, both dark unless the teacher app,
 * Make my own AND the list-only portal_lp_own_goal_start are on for her (404 otherwise; the user is the session's):
 *
 *   GET /api/portal/lp612/own/goals?grade&subject          → { success, outcomes: [{ segmentId, text }] (no chapter names, bd-snkn32.61) }
 *   GET /api/portal/lp612/own/goals/match?grade&subject&q  → { success, match: { segmentId, title } | null }
 */
const http = require('http');
const express = require('express');

const ROWS = [
  { segment_id: 'grade_7_general_science.c03.p020', chapter_number: 3, order_index: 1, chapter_title: 'Water', menu_title: 'The water cycle', subtopic_title: 'Evaporation and condensation', slo_descriptions: ['Describe the water cycle'] },
  { segment_id: 'grade_7_general_science.c01.p001', chapter_number: 1, order_index: 1, chapter_title: 'Cells', menu_title: 'Cells', subtopic_title: 'Plant cells', slo_descriptions: ['Compare plant and animal cells'] },
];

let flags;
let goalOn;
let rowsAsked;
beforeEach(() => {
  jest.resetModules();
  flags = { portal_teacher_v2: true, portal_lp_make_own: true };
  goalOn = true;
  rowsAsked = [];
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
  jest.doMock('../../bot/shared/services/lp612-own-goal.store', () => ({
    goalStartOn: async (_s, userId) => goalOn && userId === 'u1',
    goalRows: async (_s, q) => { rowsAsked.push(q); return ROWS; },
  }));
});

let srv;
afterEach(async () => { if (srv) await new Promise((r) => srv.close(r)); srv = null; });

async function start(user = 'u1') {
  const a = express();
  a.use((req, _res, next) => { req.session = { portalUserId: user }; next(); });
  a.use('/api/portal', require('../../dashboard/routes/portal-lp612-own-goal.routes'));
  srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
}

const get = (path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.address().port, path, agent: false }, (res) => {
    let s = '';
    res.on('data', (c) => { s += c; });
    res.on('end', () => resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
  }).on('error', reject);
});

test('her grade and subject\'s outcomes, in book order, each naming its lesson', async () => {
  await start();
  const r = await get('/api/portal/lp612/own/goals?grade=7&subject=General%20Science');
  expect(r.status).toBe(200);
  expect(rowsAsked).toEqual([{ grade: 7, subject: 'General Science' }]);
  expect(r.body).toEqual({
    success: true,
    outcomes: [
      { segmentId: 'grade_7_general_science.c01.p001', text: 'Compare plant and animal cells' },
      { segmentId: 'grade_7_general_science.c03.p020', text: 'Describe the water cycle' },
    ],
  });
});

test('a typed topic: the closest lesson, or null', async () => {
  await start();
  // bd-snkn32.58.2 — the answer now also carries the guard's status and suggestions (below)
  expect((await get('/api/portal/lp612/own/goals/match?grade=7&subject=General%20Science&q=rain%20and%20water')).body)
    .toEqual(expect.objectContaining({ success: true, match: { segmentId: 'grade_7_general_science.c03.p020', title: 'Describe the water cycle' } }));
  expect((await get('/api/portal/lp612/own/goals/match?grade=7&subject=General%20Science&q=volcanoes')).body)
    .toEqual(expect.objectContaining({ success: true, match: null }));
});

test('bad grade, a grade off 1-12 or no subject: 400', async () => {
  await start();
  expect((await get('/api/portal/lp612/own/goals?grade=0&subject=Maths')).status).toBe(400);
  expect((await get('/api/portal/lp612/own/goals?grade=13&subject=Maths')).status).toBe(400);
  expect((await get('/api/portal/lp612/own/goals?grade=x&subject=Maths')).status).toBe(400);
  expect((await get('/api/portal/lp612/own/goals?grade=7')).status).toBe(400);
  expect((await get('/api/portal/lp612/own/goals/match?grade=7&subject=Maths')).status).toBe(400);
});

test.each([
  ['the goal start is off', () => { goalOn = false; }],
  ['Make my own is off', () => { flags.portal_lp_make_own = false; }],
  ['the teacher app is off', () => { flags.portal_teacher_v2 = false; }],
])('404 when %s', async (_, off) => {
  off();
  await start();
  expect((await get('/api/portal/lp612/own/goals?grade=7&subject=English')).status).toBe(404);
  expect((await get('/api/portal/lp612/own/goals/match?grade=7&subject=English&q=nouns')).status).toBe(404);
});

test('bd-snkn32.57 — grades 1-5 too: the official outcomes, each naming its day', async () => {
  await start();
  const r = await get('/api/portal/lp612/own/goals?grade=3&subject=math');
  expect(r.status).toBe(200);
  expect(rowsAsked).toEqual([{ grade: 3, subject: 'math' }]);
  expect((await get('/api/portal/lp612/own/goals/match?grade=1&subject=urdu&q=water')).status).toBe(200);
});

test('someone not on the list: 404', async () => {
  await start('u2');
  expect((await get('/api/portal/lp612/own/goals?grade=7&subject=English')).status).toBe(404);
});

/**
 * bd-snkn32.58.2 (queue #155 B) — a typed topic goes through the guard (lp-own-goal-guard): up to 3 "Did you mean"
 * goals of her grade, a nearby grade's goal when it fits clearly better, or a refusal (blocked word / off the curriculum).
 */
describe('the typed-topic guard', () => {
  const G3 = [{ segment_id: 'd2', chapter_title: 'Times', slo_descriptions: ['Multiply 2 digit numbers by 1 digit number.'] }];
  const G4 = [{ segment_id: 'e1', chapter_title: 'Decimals', slo_descriptions: ['Read and write decimal numbers and their place value.'] }];
  beforeEach(() => {
    jest.doMock('../../bot/shared/services/lp612-own-goal.store', () => ({
      goalStartOn: async () => true,
      goalRows: async (_s, q) => { rowsAsked.push(q); return q.grade === 3 ? G3 : q.grade === 4 ? G4 : []; },
    }));
  });

  test('a misspelling: did you mean, from her grade', async () => {
    await start();
    const r = (await get('/api/portal/lp612/own/goals/match?grade=3&subject=math&q=multiplcation%20by%202')).body;
    expect(r.status).toBe('ok');
    expect(r.suggestions).toEqual([{ segmentId: 'd2', text: 'Multiply 2 digit numbers by 1 digit number.' }]);
    expect(r.match).toEqual({ segmentId: 'd2', title: 'Multiply 2 digit numbers by 1 digit number.' });
  });

  test('nearby grades are read (±2, inside grades 1–5) and a clearly better one is named', async () => {
    await start();
    const r = (await get('/api/portal/lp612/own/goals/match?grade=3&subject=math&q=decimal%20place%20value')).body;
    expect(rowsAsked.map((x) => x.grade).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(r.otherGrade).toEqual(expect.objectContaining({ grade: 4, segmentId: 'e1' }));
    expect(r.match).toBeNull();
  });

  test('a blocked word or a topic off the curriculum: refused, no match', async () => {
    await start();
    expect((await get('/api/portal/lp612/own/goals/match?grade=3&subject=math&q=guns')).body)
      .toEqual(expect.objectContaining({ status: 'blocked', suggestions: [], match: null }));
    expect((await get('/api/portal/lp612/own/goals/match?grade=3&subject=math&q=cricket%20world%20cup')).body)
      .toEqual(expect.objectContaining({ status: 'none', suggestions: [], match: null }));
  });
});
