'use strict';
/**
 * The ranked next thing on the hub boot (web-quiz-next-offer-sources.js hubField through the real hub payload): the
 * golden (web_quiz_next_offer off -> no `next`, the payload deep-equal to today's), the teacher quiz pinned, the
 * month's stop in the first two home opens and never one the draw would answer "on its way", the `next_set` line
 * (events v3 only, no name or phone). Supabase and Redis are the boundaries and are faked; every first-party module
 * on the path runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store, _up: true,
    isAvailable() { return this._up; },
    get: jest.fn(async function get(k) { return this._up && store.has(k) ? store.get(k) : null; }),
    set: jest.fn(async function set(k, v) { if (!this._up) return false; store.set(k, typeof v === 'string' ? v : JSON.parse(JSON.stringify(v))); return true; }),
    delete: jest.fn().mockResolvedValue(true),
    setNX: jest.fn(async function setNX(k, v) { if (!this._up) return true; if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const Play = require('../../../shared/services/quiz/web-quiz-hub-play');
const redis = require('../../../shared/services/cache/railway-redis.service');
const NO = require('../../../shared/services/quiz/web-quiz-next-offer');
const { logEvent } = require('../../../shared/utils/structured-logger');

const KID = '44444444-4444-4444-8444-000000000001';
const TEACHER = '11111111-1111-4111-8111-000000000001';
const LIST = '55555555-5555-4555-8555-000000000001';
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const ahead = (h) => new Date(Date.now() + h * 3600000).toISOString();
const A = { device: 'AAAAAAAAAAAAAAAAAAAAAA' };
const ON = (k) => ({ key: k, value: 'true' });
const BASE_ON = [ON('web_quiz_hub'), ON('web_quiz_challenge'), ON('web_quiz_child_quiz_home')];

// The registry's columns, read from the migration that creates challenge_passages (never a hand-kept list).
const REGISTRY_COLS = (() => {
  const sql = require('fs').readFileSync(require('path').join(__dirname, '../../../database/migrations/web_quiz_challenge_registry.sql'), 'utf8');
  const body = sql.split('CREATE TABLE IF NOT EXISTS public.challenge_passages (')[1].split('\n);')[0];
  return new Set(body.split('\n').map((l) => (/^\s{2}([a-z_0-9]+)\s/.exec(l) || [])[1]).filter((c) => c && c !== 'constraint'));
})();

// One title home: the lantern names a story by its passage FILE's title. A fixture registry row whose id
// has no shipped file gets a file here carrying that row's titles; the shipped files are loaded as they are.
const Bank = require('../../../shared/services/child-test/item-bank');
const SHIPPED = require('path').join(__dirname, '../../../shared/data/child-test/passages');
const PDIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'wqplay-'));
function filesFor(rows) {
  const fs = require('fs');
  const at = (id) => require('path').join(PDIR, `${id}.json`);
  fs.readdirSync(PDIR).forEach((f) => fs.rmSync(require('path').join(PDIR, f)));
  fs.readdirSync(SHIPPED).filter((f) => f.endsWith('.json')).forEach((f) => fs.copyFileSync(require('path').join(SHIPPED, f), require('path').join(PDIR, f)));
  rows.filter((r) => !fs.existsSync(at(r.passage_id))).forEach((r) => fs.writeFileSync(at(r.passage_id), JSON.stringify({
    passage_id: r.passage_id, lang: r.lang, kind: r.kind, band: r.band, pool: r.pool, title_en: r.title_en == null ? null : r.title_en, title_ur: r.title_ur == null ? null : r.title_ur,
  })));
  Bank._loadPassagesFrom(PDIR);
}
afterAll(() => { Bank._loadPassagesFrom(); require('fs').rmSync(PDIR, { recursive: true, force: true }); });

let db;
function seed(settings, over = {}) {
  db = {
    app_settings: settings,
    students: [{ id: KID, student_name: 'Zara Testwala', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, phone: '+92300FIXTURE1', created_at: ago(500) }],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    quizzes: [{ id: 'q-1', topic: 'Fractions quiz', subject: 'Maths', language: 'en', grade: '3', video_id: null }],
    quiz_share_codes: [{ id: 'sc-1', code: 'MATH01', quiz_id: 'q-1', active: true, expires_at: ahead(240), topic: 'Fractions quiz', language: 'en', teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(30) }],
    quiz_sessions: [{ id: 's1', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: KID, status: 'completed', correct_answers: 8, total_questions_answered: 10, mastery_percentage: 80, completed_at: ago(20), created_at: ago(20), student_class: '3' }],
    ...over,
  };
  filesFor(db.challenge_passages || []);
  const fake = makeFake(db);
  // challenge_passages answers like PostgREST: a select naming a column the registry migration does not create is 42703.
  const from = (t) => {
    const b = fake.from(t);
    if (t !== 'challenge_passages') return b;
    const sel = b.select.bind(b);
    b.select = (cols, ...rest) => {
      const bad = String(cols || '').split(',').map((c) => c.trim()).filter((c) => c && c !== '*' && !REGISTRY_COLS.has(c));
      if (!bad.length) return sel(cols, ...rest);
      const err = { data: null, error: { code: '42703', message: `column challenge_passages.${bad[0]} does not exist` } };
      const chain = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => res(err) : () => chain) });
      return chain;
    };
    return b;
  };
  Object.assign(supabase, { from, rpc: fake.rpc });
  Hub._resetCache();
  Play._resetCache();
  NO._resetCache();
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-test-secret';
  process.env.PORTAL_URL = 'https://portal.example.test';
  redis._store.clear();
  seed(BASE_ON);
});


const Challenge = require('../../../shared/services/quiz/web-quiz-challenge');
const NEXT_ON = [...BASE_ON, ON('web_quiz_next_offer')];
const STORY_ON = [ON('web_quiz_challenge_v2'), ON('web_quiz_challenge_story')];
const KEY32 = 'k'.repeat(40);
// A second code from the child's teacher, sent 2 days ago and never opened: the hub's teacher card (b).
const SENT_2D = ago(48);
const pending = () => ({
  quizzes: [...db.quizzes, { id: '22222222-2222-4222-8222-000000000002', topic: 'Plants quiz', subject: 'Science', language: 'en', grade: '3', video_id: null }],
  quiz_share_codes: [...db.quiz_share_codes, { id: 'sc-2', code: 'SCI002', quiz_id: '22222222-2222-4222-8222-000000000002', active: true, expires_at: ahead(240), topic: 'Plants quiz', language: 'en', teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: SENT_2D }],
});
const withArm = (arm) => jest.spyOn(NO, 'armOf').mockReturnValue(arm);
const v3Lines = () => logEvent.mock.calls.filter(([, f]) => f && f.ev_v === 3);

afterEach(() => { jest.restoreAllMocks(); Challenge.__reset(); delete process.env.WEB_QUIZ_KID_KEY; });

describe('GOLDEN: web_quiz_next_offer off -> the hub boot is today\'s', () => {
  test('absent or false: no `next`, the payload deep-equal to the base, no v3 line', async () => {
    seed(BASE_ON, pending());
    const base = await Hub.hub(T.signHub([KID]), A);
    expect(base).not.toHaveProperty('next');
    for (const value of ['false', false, null]) {
      seed([...BASE_ON, { key: 'web_quiz_next_offer', value }, ON('web_quiz_events_v3')], pending());
      redis._store.clear();
      const off = await Hub.hub(T.signHub([KID]), A);
      expect(off).toEqual(base);
    }
    expect(v3Lines()).toEqual([]);
    expect([...redis._store.keys()].some((k) => String(k).startsWith('wq:next:'))).toBe(false);
  });

  test('with the Jugnu corner on too, off is still the corner\'s own payload (the collect read changes nothing)', async () => {
    seed([...BASE_ON, ...STORY_ON], { web_quiz_challenge_runs: [] });
    Challenge.__reset();
    const base = await Hub.hub(T.signHub([KID]), A);
    seed([...BASE_ON, ...STORY_ON, { key: 'web_quiz_next_offer', value: 'false' }], { web_quiz_challenge_runs: [] });
    Challenge.__reset();
    redis._store.clear();
    expect(await Hub.hub(T.signHub([KID]), A)).toEqual(base);
  });
});

describe('switch on: rule 1 — the teacher\'s quiz from the last 7 days', () => {
  test('a pending teacher quiz -> next.kind quiz, pinned, an href that opens it, in every arm', async () => {
    for (const arm of ['rank', 'rand', 'ctrl']) {
      withArm(arm);
      seed(NEXT_ON, pending());
      redis._store.clear();
      const out = await Hub.hub(T.signHub([KID]), A);
      expect(out.next).toMatchObject({ kind: 'quiz', ctx: 'home', rank_src: 'pinned', arm, title: 'From your teacher', sub: 'Plants quiz' });
      expect(out.next.href).toMatch(/^\/q\/SCI002\?k=/);
      expect(out.next.offer).toMatch(/^[A-Za-z0-9_-]{10}$/);
      expect(out.next.score_v).toBe(NO.FILE_WEIGHTS.v);
      expect(out.next.alts.length).toBeLessThanOrEqual(2);
      out.next.alts.forEach((a) => { expect(a.href).toBeTruthy(); expect(a.offer).toMatch(/^[A-Za-z0-9_-]{10}$/); });
      jest.restoreAllMocks();
    }
  });

  test('a storybook the teacher sent (a story send: quiz_source story) -> the pin, kind storybook', async () => {
    const over = pending();
    over.quizzes[1].quiz_source = 'story';
    seed(NEXT_ON, over);
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.next).toMatchObject({ kind: 'storybook', rank_src: 'pinned', id: 'sb.SCI002' });
    expect(out.next.href).toMatch(/^\/q\/SCI002\?k=/);
  });

  test('the quiz id is never in `next` (a keyed id only), nor the child\'s name or phone', async () => {
    process.env.WEB_QUIZ_KID_KEY = KEY32;
    seed(NEXT_ON, pending());
    const out = await Hub.hub(T.signHub([KID]), A);
    const text = JSON.stringify(out.next);
    expect(text).not.toContain('22222222-2222-4222-8222-000000000002');
    expect(text).not.toContain('Zara');
    expect(text).not.toContain('FIXTURE');
    expect(out.next.id).toMatch(/^[0-9a-f]{10}$/);
  });
});

describe('switch on: rule 2 — the month\'s stop in the first two home opens', () => {
  const fresh = (over = {}) => { seed([...NEXT_ON, ...STORY_ON], { web_quiz_challenge_runs: [], ...over }); Challenge.__reset(); };

  test('opens 1 and 2 -> the stop (rank_src rule, an href to that stop); open 3 -> it competes', async () => {
    withArm('rank');
    fresh();
    const one = await Hub.hub(T.signHub([KID]), A);
    expect(one.next).toMatchObject({ rank_src: 'rule' });
    expect(one.next.id).toMatch(/^stop\./);
    expect(one.next.href).toMatch(/^\/c\/[^?]+\?kid=[^&]+&lang=en#(read|bigger)$/);
    fresh();
    const two = await Hub.hub(T.signHub([KID]), A);
    expect(two.next.rank_src).toBe('rule');
    fresh();
    const three = await Hub.hub(T.signHub([KID]), A);
    expect(three.next.rank_src).not.toBe('rule');
  });

  test('a read stop the draw would answer "on its way" (no counted passage) is never offered; the game stop is', async () => {
    withArm('rank');
    seed([...NEXT_ON, ...STORY_ON, ON('web_quiz_challenge_pool')], { web_quiz_challenge_runs: [], challenge_passages: [] });
    Challenge.__reset();
    const out = await Hub.hub(T.signHub([KID]), A);
    const ids = [out.next, ...out.next.alts].map((x) => x.id);
    expect(ids).not.toContain('stop.read');
    expect(out.next.id).toBe('stop.bigger');
  });
});

describe('the next_set line (events v3)', () => {
  test('events v3 on -> one next_set with the same offer, keyed, no name, phone, token or quiz id', async () => {
    process.env.WEB_QUIZ_KID_KEY = KEY32;
    seed([...NEXT_ON, ON('web_quiz_events_v3')], pending());
    const out = await Hub.hub(T.signHub([KID]), A);
    const sets = logEvent.mock.calls.filter(([n]) => n === 'web_quiz.next_set');
    expect(sets).toHaveLength(1);
    const f = sets[0][1];
    expect(f).toMatchObject({ ev_v: 3, v3: 1, w: 's', ctx: 'home', offer: out.next.offer, rank_src: 'pinned', rule: 'teacher_quiz', pinned_k: 1 });
    expect(f.kid).toMatch(/^[0-9a-f]{16}$/);
    expect(f.sit).toMatch(/^[a-z0-9]{10}$/);
    expect(f.kinds.split('|')[0]).toBe('quiz');
    expect(f.elig.split('|')).toEqual([...f.elig.split('|')].sort());
    const text = JSON.stringify(f);
    ['Zara', 'FIXTURE', KID, 'SCI002', '22222222-2222-4222-8222-000000000002'].forEach((s) => expect(text).not.toContain(s));
  });

  test('events v3 off -> no next_set (the slot still fills)', async () => {
    seed(NEXT_ON, pending());
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.next).toBeTruthy();
    expect(logEvent.mock.calls.filter(([n]) => n === 'web_quiz.next_set')).toHaveLength(0);
  });
});

describe('the VALUE override (web_quiz_next_offer_weights)', () => {
  test('a table that ranks the game first wins on the home (no rule applies)', async () => {
    withArm('rank');
    const W = { v: 'ovr-1', contexts: { home: [{ kind: 'game', score: 40, ci: [30, 50], n: 9, evidence: 'significant' }, { kind: 'quiz', score: 1, ci: null, n: 1, evidence: 'prior' }] } };
    // the stops played this month: rule 2 has nothing to serve
    const period = (() => { const d = new Date(Date.now() + 5 * 3600000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
    const run = (exercise) => ({ student_id: KID, exercise, mode: 'check', record: true, status: 'scored', period_id: period, passage_id: null });
    seed([...NEXT_ON, ...STORY_ON, { key: 'web_quiz_next_offer_weights', value: JSON.stringify(W) }], { web_quiz_challenge_runs: [run('read'), run('bigger')] });
    Challenge.__reset();
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.next).toMatchObject({ kind: 'game', id: 'numbers', rank_src: 'significant', score: 40, score_v: 'ovr-1' });
  });
});

// ── the result cards (web-quiz-next-offer-sources.js finishField / challengeField; the routes wrap them) ──────────
const Sources = require('../../../shared/services/quiz/web-quiz-next-offer-sources');
const st = () => T.signSession({ sessionId: 's1', deviceRef: A.device, shareCodeId: 'sc-1' });
const finished = (over = {}) => ({ score: { correct: 8, total: 10, pct: 80, level: 'high' }, challenge_code: 'FRND01', card: { first: 'Zara' }, ...over });

describe('the quiz finish: next_offer', () => {
  test('switch off -> {} (the card is today\'s)', async () => {
    seed(BASE_ON, pending());
    expect(await Sources.finishField({ st: st() }, finished(), { device: A.device })).toEqual({});
  });

  test('after a quiz with another teacher quiz pending -> that quiz, pinned; the quiz just played only as "play again"', async () => {
    seed(NEXT_ON, pending());
    const { next_offer: n } = await Sources.finishField({ st: st() }, finished(), { device: A.device });
    expect(n).toMatchObject({ kind: 'quiz', ctx: 'after_quiz', rank_src: 'pinned' });
    expect(n.href).toMatch(/^\/q\/SCI002\?k=/);
    const all = [n, ...n.alts];
    all.filter((x) => /MATH01/.test(x.href)).forEach((x) => expect(x.href).toMatch(/again=1/));
  });

  test('a < 50 % quiz -> ctx after_quiz_low', async () => {
    seed(NEXT_ON, pending());
    const { next_offer: n } = await Sources.finishField({ st: st() }, finished({ score: { correct: 2, total: 10, pct: 20 } }), { device: A.device });
    expect(n.ctx).toBe('after_quiz_low');
  });

  test('finishing a teacher quiz before any home open this month -> the month\'s stop (the 1st-of-month finish)', async () => {
    withArm('rank');
    seed([...NEXT_ON, ...STORY_ON], { web_quiz_challenge_runs: [] });
    Challenge.__reset();
    const { next_offer: n } = await Sources.finishField({ st: st() }, finished(), { device: A.device });
    expect(n.rank_src).toBe('rule');
    expect(n.id).toMatch(/^stop\./);
  });

  test('then (the stops played) -> the top of the after_quiz table, rank_src from the scores file', async () => {
    withArm('rank');
    const period = (() => { const d = new Date(Date.now() + 5 * 3600000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
    const run = (exercise) => ({ student_id: KID, exercise, mode: 'check', record: true, status: 'scored', period_id: period, passage_id: null });
    seed([...NEXT_ON, ...STORY_ON, ON('web_quiz_library')], { web_quiz_challenge_runs: [run('read'), run('bigger')] });
    Challenge.__reset();
    const { next_offer: n } = await Sources.finishField({ st: st() }, finished(), { device: A.device });
    const rows = NO.FILE_WEIGHTS.contexts.after_quiz;
    const top = rows.filter((r) => r.evidence === 'significant').map((r) => r.kind);
    expect(top).toContain(n.kind);
    expect(n.rank_src).toBe('significant');
  });

  test('a teacher\'s own run or an invited friend\'s -> {}', async () => {
    seed(NEXT_ON, pending());
    db.quiz_sessions[0].user_id = TEACHER;
    expect(await Sources.finishField({ st: st() }, finished(), { device: A.device })).toEqual({});
    seed(NEXT_ON, pending());
    db.quiz_sessions[0].invited_by_student_id = '44444444-4444-4444-8444-000000000077';
    expect(await Sources.finishField({ st: st() }, finished(), { device: A.device })).toEqual({});
  });

  test('a forged or missing session token -> {}', async () => {
    seed(NEXT_ON, pending());
    expect(await Sources.finishField({ st: 'nope' }, finished(), { device: A.device })).toEqual({});
    expect(await Sources.finishField({}, finished(), { device: A.device })).toEqual({});
  });
});

describe('a Jugnu stop\'s result: next_offer', () => {
  const ct = (ex) => T.signChallenge({ studentId: KID, ex, runId: `run-${ex}-${Math.random()}` });

  test('pending -> nothing; switch off -> nothing', async () => {
    seed(NEXT_ON, pending());
    expect(await Sources.challengeField({ pending: true }, ct('read'), { device: A.device })).toEqual({});
    seed(BASE_ON, pending());
    expect(await Sources.challengeField({ score: {} }, ct('read'), { device: A.device })).toEqual({});
  });

  test('a read that ended by the timer -> after_read_weak; never another read-aloud; the stop just played never', async () => {
    withArm('rank');
    seed([...NEXT_ON, ...STORY_ON], { web_quiz_challenge_runs: [] });
    Challenge.__reset();
    const { next_offer: n } = await Sources.challengeField({ score: { correct: 3 }, ended: 'timer' }, ct('read'), { device: A.device });
    expect(n.ctx).toBe('after_read_weak');
    const ids = [n, ...n.alts].map((x) => x.id);
    expect(ids).not.toContain('stop.read');
  });

  test('one offer per run: every poll after the first gets the same object and no second next_set', async () => {
    seed([...NEXT_ON, ON('web_quiz_events_v3')], pending());
    const t = ct('bigger');
    const a = await Sources.challengeField({ score: {} }, t, { device: A.device });
    const b = await Sources.challengeField({ score: {} }, t, { device: A.device });
    expect(a.next_offer.ctx).toBe('after_game');
    expect(b.next_offer).toEqual(a.next_offer);
    expect(logEvent.mock.calls.filter(([nm]) => nm === 'web_quiz.next_set')).toHaveLength(1);
  });

  test('no device (the phone cannot be bound) or a class round\'s turn -> {}', async () => {
    seed(NEXT_ON, pending());
    expect(await Sources.challengeField({ score: {} }, ct('bigger'), {})).toEqual({});
    const round = T.signChallenge({ studentId: KID, ex: 'bigger', runId: 'r-round', round: 'cr-1', mode: 'check' });
    expect(await Sources.challengeField({ score: {} }, round, { device: A.device })).toEqual({});
  });
});

describe('the routes wrap the results: switch off -> the body is today\'s, byte for byte', () => {
  let server; let base;
  const WebQuiz = require('../../../shared/services/quiz/web-quiz.service');
  beforeAll(async () => {
    process.env.INTERNAL_API_KEY = 'route-key';
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}/wq`;
  });
  afterAll(() => new Promise((r) => server.close(r)));
  const H = { 'x-api-key': 'route-key', 'content-type': 'application/json', 'x-wq-device': A.device };

  test('/finish and /ch/result: off -> exactly the service\'s JSON; on -> the same plus next_offer', async () => {
    const body = finished({ next: { vid: 'v1', title: 'Water', code: 'VIDQ01' } });
    jest.spyOn(WebQuiz, 'finishSession').mockResolvedValue(body);
    jest.spyOn(require('../../../shared/services/quiz/web-quiz-share-warm'), 'afterFinish').mockImplementation(() => {});
    jest.spyOn(Challenge, 'submit').mockResolvedValue({ score: { correct: 4, n: 5 } });
    jest.spyOn(Challenge, 'poll').mockResolvedValue({ pending: true });
    seed(BASE_ON, pending());
    const fin = await (await fetch(`${base}/finish`, { method: 'POST', headers: H, body: JSON.stringify({ st: st() }) })).text();
    expect(fin).toBe(JSON.stringify(body));
    const t = T.signChallenge({ studentId: KID, ex: 'bigger', runId: 'run-route' });
    const res = await (await fetch(`${base}/ch/result`, { method: 'POST', headers: H, body: JSON.stringify({ ct: t }) })).text();
    expect(res).toBe(JSON.stringify({ score: { correct: 4, n: 5 } }));
    expect(await (await fetch(`${base}/ch/result/${encodeURIComponent(t)}`, { headers: H })).text()).toBe(JSON.stringify({ pending: true }));

    seed(NEXT_ON, pending());
    const on = await (await fetch(`${base}/finish`, { method: 'POST', headers: H, body: JSON.stringify({ st: st() }) })).json();
    const { next_offer: nOffer, ...rest } = on;
    expect(rest).toEqual(body);
    expect(on.next).toEqual(body.next);   // the chapter video keeps its own key
    expect(nOffer.kind).toBe('quiz');
    const ch = await (await fetch(`${base}/ch/result`, { method: 'POST', headers: H, body: JSON.stringify({ ct: t }) })).json();
    expect(ch.score).toEqual({ correct: 4, n: 5 });
    expect(ch.next_offer.ctx).toBe('after_game');
    expect(await (await fetch(`${base}/ch/result/${encodeURIComponent(t)}`, { headers: H })).json()).toEqual({ pending: true });
  });
});
