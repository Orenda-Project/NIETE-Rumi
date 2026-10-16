'use strict';
/**
 * The maker router (/api/internal/ft): switch OFF → every route answers 404 {off:true} before reading anything else;
 * switch ON → the page with the grade chips, no free-text field, "Change my choice" only on the door's token; a thrown
 * bank read → the mk.error page with 200 (JSON routes: 503 {error:'mk.error'}), never a 500; onboard.maker{open}
 * carries no phone. And the mount wrapper: a maker module that throws at load does not stop the bot.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));

const express = require('express');
const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const MakerToken = require('../../shared/services/first-touch/maker.token');
const Bank = require('../../shared/services/first-touch/maker.bank');
const { mountMaker } = require('../../shared/services/first-touch/maker.mount');
const { str, subjectLabel } = require('../../shared/services/first-touch/maker.strings');
const { seedMaker, tableReads, TEACHER, PHONE, qid } = require('./maker-fixture');

const UK = '0123456789abcdef';
const tokenFor = (o = {}) => MakerToken.signMaker({ uid: TEACHER.id, lang: 'en', tour: 0, via: 'door', uk: UK, ...o });

let srv;
let fake;
async function boot() {
  const app = express();
  app.use(express.json());
  app.use('/api/internal/ft', require('../../shared/services/first-touch/maker.routes'));
  await new Promise((r) => { srv = app.listen(0, r); });
}
const url = (p) => `http://127.0.0.1:${srv.address().port}/api/internal/ft${p}`;
const H = () => ({ 'x-api-key': process.env.INTERNAL_API_KEY });
const get = (p) => fetch(url(p), { headers: H(), redirect: 'manual' });
const post = (p, body) => fetch(url(p), { method: 'POST', headers: { ...H(), 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual' });

function seed(opts) {
  fake = seedMaker(supabase, opts);
  IdFlags._resetCache(); HubFlags._resetCache(); Bank._resetCache();
}

beforeEach(async () => { jest.clearAllMocks(); await boot(); });
afterEach(() => new Promise((r) => srv.close(r)));

describe('switch OFF (quiz_maker_page absent)', () => {
  test('every route of the router → 404 {off:true}, and nothing but the switch is read', async () => {
    seed({ on: false });
    const t = tokenFor();
    const answers = await Promise.all([
      get(`/m/${t}`), get(`/m/${t}/send?c=x`), get('/m/garbage'),
      post('/api/ft/make', { t, grade: '4', subject: 'maths', quizId: qid(2) }),
      post('/api/ft/step', { t, step: 'grade', grade: '4' }),
      get(`/f/${t}`), post('/api/ft/door', { t }), post('/api/ft/code', { t, code: 'QUIZ-ABCDEF' }), post('/api/ft/tour', { t }),
    ]);
    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ off: true });
    }
    expect(tableReads(fake, 'quizzes', 'student_videos', 'quiz_questions', 'quiz_share_codes', 'users')).toBe(0);
    expect(fake.calls.filter((c) => c.op !== 'select')).toEqual([]);
    expect(logEvent.mock.calls.filter(([e]) => e === 'onboard.maker')).toEqual([]);
  });

  test('without the internal key → 401 (the key is checked first, as every internal router)', async () => {
    seed({ on: false });
    const res = await fetch(url(`/m/${tokenFor()}`));
    expect(res.status).toBe(401);
  });
});

describe('switch ON — the page', () => {
  test('200 with the grade chips present in the bank, subject labels from the catalog, the English topic verbatim', async () => {
    seed();
    const res = await get(`/m/${tokenFor()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    expect(res.headers.get('content-security-policy')).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
    const html = await res.text();
    expect(html).toContain(str('mk.h', 'en'));
    for (const g of ['1', '3', '4', '5']) expect(html).toContain(`data-grade="${g}"`);
    expect(html).not.toContain('data-grade="2"');     // grade 2 has no ready video quiz in a mapped subject
    expect(html).not.toContain('data-grade="6"');
    expect(html).toContain(subjectLabel('maths', 'en'));
    expect(html).toContain(subjectLabel('islamic_studies', 'en'));
    expect(html).toContain('Fractions');
    expect(html).toContain('<div id="ft-banner-slot"><div class="mk-tour" id="mk-tour"');   // the hook, now carrying the tour banner
    expect(html).toContain('window.ftOnFirstChip');
  });

  test('the Urdu page: rtl, Urdu-Indic grade digits, topics in <bdi>, the «موضوع» heading', async () => {
    seed();
    const html = await (await get(`/m/${tokenFor({ lang: 'ur' })}`)).text();
    expect(html).toMatch(/<html lang="ur" dir="rtl">/);
    expect(html).toContain('>۴<');
    expect(html).toContain('<bdi>Fractions</bdi>');
    expect(html).toContain(str('mk.topic', 'ur'));
    expect(html).toContain(subjectLabel('maths', 'ur'));
  });

  test('no free-text field: no <input type=text>, no <textarea>, no <select>', async () => {
    seed();
    for (const via of ['door', 'menu', 'empty']) {
      const html = await (await get(`/m/${tokenFor({ via })}`)).text();
      expect(html).not.toMatch(/<textarea|<select/i);
      const inputs = html.match(/<input[^>]*>/gi) || [];
      for (const i of inputs) expect(i).toMatch(/type="hidden"/);
    }
  });

  test('"Change my choice" only for via door, once, as a POST to /api/ft/door carrying t', async () => {
    seed();
    const t = tokenFor({ via: 'door' });
    const door = await (await get(`/m/${t}`)).text();
    expect(door.split(str('mk.change', 'en')).length - 1).toBe(1);
    expect(door).toMatch(/<form[^>]+method="post"[^>]+action="\/api\/ft\/door"/);
    expect(door).toContain(`<input type="hidden" name="t" value="${t}">`);
    for (const via of ['menu', 'empty']) {
      const html = await (await get(`/m/${tokenFor({ via })}`)).text();
      expect(html).not.toContain(str('mk.change', 'en'));
      expect(html).not.toContain('/api/ft/door');
    }
  });

  test('nothing on the page speaks of "your lesson"', async () => {
    seed();
    const html = await (await get(`/m/${tokenFor()}`)).text();
    expect(html).not.toMatch(/your lesson/i);
    expect(html).not.toContain('آپ کا سبق');
  });

  test('onboard.maker{step:open} with the contract fields and no phone, name or share code', async () => {
    seed();
    await get(`/m/${tokenFor({ via: 'menu' })}`);
    const opens = logEvent.mock.calls.filter(([e, f]) => e === 'onboard.maker' && f.step === 'open');
    expect(opens).toHaveLength(1);
    expect(opens[0][1]).toEqual({ step: 'open', grade: null, subject: null, qlang: null, lang: 'en', via: 'menu', quiz_id: null, ukey: UK, w: 's' });
    const flat = JSON.stringify(opens);
    expect(flat).not.toContain(PHONE);
    expect(flat).not.toContain(TEACHER.name);
  });

  test('a thrown bank read → the mk.error page with 200, never a 500', async () => {
    seed({ throwOn: 'student_videos' });
    const res = await get(`/m/${tokenFor()}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(str('mk.error', 'en').replace(/'/g, '&#39;'));   // HTML-escaped
  });

  test('a thrown read on a JSON route → 503 {error:"mk.error"}, never a 500', async () => {
    seed({ throwOn: 'quizzes' });
    const res = await post('/api/ft/make', { t: tokenFor(), grade: '4', subject: 'maths', quizId: qid(2) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'mk.error' });
  });
});

describe('switch ON — a token of another kind', () => {
  test('a family-kind token with maker fields → the 404 page and 404 {error:mk.stale}, and no bank read', async () => {
    seed();
    const WebQuizToken = require('../../shared/services/quiz/web-quiz-token');
    const ft = WebQuizToken.sign({ k: 'f', uid: TEACHER.id, lang: 'en', tour: 0, via: 'door', uk: UK, exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(typeof ft).toBe('string');
    const page = await get(`/m/${ft}`);
    expect(page.status).toBe(404);
    expect(await page.text()).toContain(str('mk.stale', 'en').replace(/'/g, '&#39;'));
    const made = await post('/api/ft/make', { t: ft, grade: '4', subject: 'maths', quizId: qid(2) });
    expect(made.status).toBe(404);
    expect(await made.json()).toEqual({ error: 'mk.stale' });
    expect(tableReads(fake, 'student_videos', 'quizzes', 'quiz_questions', 'video_quiz_share_codes', 'quiz_share_codes')).toBe(0);
    expect(logEvent.mock.calls.filter(([e]) => e === 'onboard.maker')).toEqual([]);
  });
});

describe('switch ON — /api/ft/step', () => {
  test('grade / subject / topic → 204 and one onboard.maker each, with codes; topic carries quiz_id and qlang', async () => {
    seed();
    const t = tokenFor();
    expect((await post('/api/ft/step', { t, step: 'grade', grade: '3' })).status).toBe(204);
    expect((await post('/api/ft/step', { t, step: 'subject', grade: '3', subject: 'general_knowledge' })).status).toBe(204);
    expect((await post('/api/ft/step', { t, step: 'topic', grade: '3', subject: 'general_knowledge', quizId: qid(5) })).status).toBe(204);
    const steps = logEvent.mock.calls.filter(([e]) => e === 'onboard.maker').map(([, f]) => f);
    expect(steps).toEqual([
      { step: 'grade', grade: 'grade_3', subject: null, qlang: null, lang: 'en', via: 'door', quiz_id: null, ukey: UK, w: 's' },
      { step: 'subject', grade: 'grade_3', subject: 'general_knowledge', qlang: null, lang: 'en', via: 'door', quiz_id: null, ukey: UK, w: 's' },
      { step: 'topic', grade: 'grade_3', subject: 'general_knowledge', qlang: 'en', lang: 'en', via: 'door', quiz_id: qid(5), ukey: UK, w: 's' },
    ]);
  });

  test('an unknown step or a bad token → no event', async () => {
    seed();
    expect((await post('/api/ft/step', { t: tokenFor(), step: 'made' })).status).toBe(400);
    expect((await post('/api/ft/step', { t: 'nope', step: 'grade', grade: '3' })).status).toBe(404);
    expect(logEvent.mock.calls.filter(([e]) => e === 'onboard.maker')).toEqual([]);
  });
});

describe('the mount wrapper (broken at load)', () => {
  test('a maker module that throws at require → the app still serves its other routes; the real one mounts', async () => {
    const app = express();
    app.get('/health', (req, res) => res.send('ok'));
    expect(mountMaker(app, () => { throw new Error('broken at load'); })).toBe(false);
    expect(mountMaker(app)).toBe(true);
    const s = await new Promise((r) => { const x = app.listen(0, () => r(x)); });
    try {
      const res = await fetch(`http://127.0.0.1:${s.address().port}/health`);
      expect(await res.text()).toBe('ok');
    } finally { await new Promise((r) => s.close(r)); }
  });
});
