'use strict';
/**
 * The /j/<code> link preview names the CLASS only: og:title (and the page title) is
 * "Jugnu · Class 3 B" / «جگنو · کلاس ۳ B» — the class's grade and section through classLabels, the same function the
 * reminder's title uses — and never a school, teacher or child name; og:url stays the origin. Only for a live code
 * with web_quiz_class_link on; a class with no numeric grade keeps today's generic head; an unknown or closed code
 * keeps today's closed page.
 *
 * The real chain: the portal's /j/<code> (dashboard createWebQuizRouter) and the bot's real /api/internal/wq/cl/*
 * routes over HTTP. Faked boundaries only: Supabase (in memory), Redis (a Map), the loggers, the event key module.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return { _store: store, isAvailable: () => true, get: async (k) => (store.has(k) ? store.get(k) : null), set: async (k, v) => { store.set(k, v); return true; }, setNX: async () => true, delete: async (k) => store.delete(k) };
});
jest.mock('../../shared/services/quiz/web-quiz-kid', () => ({
  kid: (id) => `kid:${String(id).slice(-4)}`, dk: () => 'dk', cls: () => 'clshash00000', qk: () => 'qk00000000', envelope: (f) => ({ ev_v: 2, ...f }),
}));

const http = require('http');
const express = require('express');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');

const CODE = 'K7Q2MXTRAB';
const CLASS = 'c1a55000-0000-4000-8000-0000000000e1';
const SCHOOL = '5c400000-0000-4000-8000-0000000000e1';
const TEACHER = '7e000000-0000-4000-8000-0000000000e1';
const ZARA = 'c0000001-0000-4000-8000-0000000000e1';
const ON = (k) => ({ key: k, value: true });
const SWITCHES = [ON('web_quiz_challenge'), ON('web_quiz_challenge_v2'), ON('web_quiz_class_link')];

function seed({ lang = 'en', grade = 'grade_3', section = 'B', settings = SWITCHES } = {}) {
  Object.assign(supabase, makeFake({
    app_settings: settings,
    schools: [{ id: SCHOOL, name: 'Testwala Model School', emis_code: '12345' }],
    users: [{ id: TEACHER, name: 'Rifat Testwala', school_id: SCHOOL, preferred_language: lang }],
    classes: [{ id: CLASS, school_id: SCHOOL, grade_code: grade, section, is_active: true }],
    class_links: [{ code: CODE, class_id: CLASS, teacher_id: TEACHER, term_code: '2026-27b', expires_at: '2099-03-31T18:59:59Z', revoked_at: null }],
    class_teachers: [{ class_id: CLASS, teacher_user_id: TEACHER, is_active: true }],
    class_enrollments: [{ class_id: CLASS, student_id: ZARA, is_active: true }],
    students: [{ id: ZARA, student_name: 'Zara Testwali', list_id: null, is_active: true }],
    quiz_sessions: [],
  }));
  require('../../shared/services/quiz/web-quiz-class-link-flags')._resetCache();
}

let botSrv;
let edgeSrv;
beforeAll(async () => {
  process.env.WEB_QUIZ_TOKEN_SECRET = 'class-link-preview-test-secret';
  const bot = express();
  bot.use(express.json());
  bot.use('/api/internal/wq/cl', require('../../shared/routes/web-quiz-class-link.routes'));
  botSrv = await new Promise((r) => { const s = bot.listen(0, '127.0.0.1', () => r(s)); });
  const { createWebQuizRouter } = require('../../../dashboard/routes/web-quiz.routes');
  const edge = express();
  edge.set('trust proxy', 1);
  edge.use(createWebQuizRouter({ botUrl: `http://127.0.0.1:${botSrv.address().port}`, apiKey: 'test-internal-key', fetchImpl: fetch, canonicalBase: '', logEvent: () => {} }));
  edgeSrv = await new Promise((r) => { const s = edge.listen(0, '127.0.0.1', () => r(s)); });
});
afterAll(async () => {
  await new Promise((r) => edgeSrv.close(r));
  await new Promise((r) => botSrv.close(r));
});

function get(p, ua = null) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: edgeSrv.address().port, method: 'GET', path: p, headers: { host: 'quiz.example.org', ...(ua ? { 'user-agent': ua } : {}) } }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    r.on('error', reject);
    r.end();
  });
}
const headOf = (html) => (/<head>([\s\S]*?)<\/head>/.exec(html) || [])[1] || '';
const meta = (html, p) => (new RegExp(`<meta property="og:${p}" content="([^"]*)">`).exec(html) || [])[1];
const titleOf = (html) => (/<title>([^<]*)<\/title>/.exec(html) || [])[1];
const WA = 'WhatsApp/2.23.20.0 A';

describe('the preview names the class: grade and section, nothing else', () => {
  test.each([
    ['en', 'grade_3', 'B', 'Jugnu · Class 3 B'],
    ['ur', 'grade_3', 'B', 'جگنو · کلاس ۳ B'],
    ['en', 'grade_5', null, 'Jugnu · Class 5'],
    ['ur', 'grade_10', 'A', 'جگنو · کلاس ۱۰ A'],
  ])('%s class %s %p: og:title "%s", for WhatsApp\'s crawler and for the page alike', async (lang, grade, section, want) => {
    seed({ lang, grade, section });
    for (const ua of [WA, null]) {
      // eslint-disable-next-line no-await-in-loop
      const r = await get(`/j/${CODE}?f=1`, ua);
      expect(r.status).toBe(200);
      expect(meta(r.body, 'title')).toBe(want);
      expect(titleOf(r.body)).toBe(want);
      expect(meta(r.body, 'image:alt')).toBe(want);
      expect(meta(r.body, 'url')).toBe('http://quiz.example.org');
    }
  });

  test('no school, teacher or child name (or id) reaches the head', async () => {
    for (const lang of ['en', 'ur']) {
      seed({ lang });
      // eslint-disable-next-line no-await-in-loop
      const r = await get(`/j/${CODE}`, WA);
      const head = headOf(r.body);
      expect(head).toContain('og:title');
      expect(head).not.toMatch(/Testwala|Testwali|Rifat|Zara|Model School|12345|7e000000|c1a55000|5c400000/);
    }
  });
});

describe('otherwise today\'s head and pages', () => {
  test('a class with no numeric grade (early years): the generic og.link title', async () => {
    seed({ grade: 'early_years', section: 'A' });
    const r = await get(`/j/${CODE}`, WA);
    expect(r.status).toBe(200);
    expect(meta(r.body, 'title')).toBe('Jugnu&#39;s Challenge');
    expect(meta(r.body, 'description')).toBe('Stories and number games. Tap to play.');
  });

  test('the switch off, or an unknown code: the closed page (404), no class named', async () => {
    seed({ settings: SWITCHES.filter((s) => s.key !== 'web_quiz_class_link') });
    const off = await get(`/j/${CODE}`, WA);
    expect(off.status).toBe(404);
    expect(off.body).not.toMatch(/Class 3|کلاس/);
    seed();
    const unknown = await get('/j/ZZZZZZZZZZ', WA);
    expect(unknown.status).toBe(404);
    expect(unknown.body).not.toMatch(/Class 3|کلاس/);
  });

  test('the edge names only a class label: anything else the bot might answer keeps the generic title', () => {
    const Edge = require('../../../dashboard/routes/web-quiz-class-link');
    const render = (lang, classLabel) => Edge.renderClassLinkPage({
      lang, classLabel, code: CODE, jt: null, origin: 'https://x', assetV: '1', jsV: '1', brand: null, ui: null,
      head: ({ title }) => `<!doctype html><html><head><title>${title}</title>`, esc: (s) => s, bootJson: (o) => JSON.stringify(o),
    });
    expect(render('en', 'Class 3 B')).toContain('<title>Jugnu · Class 3 B</title>');
    expect(render('ur', 'کلاس ۳ B')).toContain('<title>جگنو · کلاس ۳ B</title>');
    for (const bad of ['Rifat Testwala', 'Class 3 B Rifat Testwala Sahib', 'Grade 3', '', null, 42]) {
      expect(render('en', bad)).toContain("<title>Jugnu's Challenge</title>");
    }
    expect(render('ur', 'Class 3 B')).toContain('<title>جگنو کا چیلنج</title>');
  });
});
