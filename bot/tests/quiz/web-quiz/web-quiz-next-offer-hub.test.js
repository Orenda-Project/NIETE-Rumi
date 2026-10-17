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
// a switch row as the settings table holds it: JSON true (a string 'true' is OFF for this slot's keys)
const ON = (k) => ({ key: k, value: true });
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
    quiz_sessions: [{ id: 's1', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: KID, status: 'completed', correct_answers: 8, total_questions_answered: 10, mastery_percentage: 80, completed_at: ago(20), created_at: ago(20), student_class: '3', device_ref: A.device }],
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
  require('../../../shared/services/quiz/web-quiz-hub-home')._resetCache();
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
    for (const value of ['true', '"true"', 'TRUE', 'false', false, null, 'yes', '1', 1, 'on', { enabled: true }, '{}', '[true]', '']) {
      seed([...BASE_ON, { key: 'web_quiz_next_offer', value }, ON('web_quiz_events_v3')], pending());
      redis._store.clear();
      const off = await Hub.hub(T.signHub([KID]), A);
      expect(off).toEqual(base);
    }
    // the slot's settings read throws (an outage): off, the payload today's
    seed([...NEXT_ON, ON('web_quiz_events_v3')], pending());
    redis._store.clear();
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t !== 'app_settings') return b;
      const inn = b.in.bind(b);
      b.in = (c, vs) => { if (c === 'key' && (vs || []).includes('web_quiz_next_offer')) throw new Error('settings read failed'); return inn(c, vs); };
      return b;
    };
    expect(await Hub.hub(T.signHub([KID]), A)).toEqual(base);
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
    Object.assign(over.quizzes[1], { quiz_source: 'story', status: 'sent', meta: { sent_at: SENT_2D } });
    seed(NEXT_ON, over);
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.next).toMatchObject({ kind: 'storybook', rank_src: 'pinned' });
    expect(out.next.id).toMatch(/^sb\.[0-9a-f]{10}$/);   // keyed: the share code never rides an event id
    expect(out.next.href).toMatch(/^\/q\/SCI002\?k=/);
  });

  test('a story the teacher only OPENED (its code minted at render, status ready, no sent_at) is never pinned', async () => {
    const over = pending();
    Object.assign(over.quizzes[1], { quiz_source: 'story', status: 'ready', meta: {} });
    seed(NEXT_ON, over);
    const out = await Hub.hub(T.signHub([KID]), A);
    const all = out.next ? [out.next, ...out.next.alts] : [];
    expect(all.filter((x) => /SCI002/.test(x.href))).toEqual([]);
    if (out.next) expect(out.next.rank_src).not.toBe('pinned');
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

describe('the ctrl arm\'s lantern is the one the child is shown (a same-titled twin never takes it)', () => {
  test('through the Jugnu corner\'s own reads: a newer listen story titled like this week\'s read story -> ctrl offers this week\'s', async () => {
    withArm('ctrl');
    const period = (() => { const d = new Date(Date.now() + 5 * 3600000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
    const run = (exercise) => ({ student_id: KID, exercise, mode: 'check', record: true, status: 'scored', period_id: period, passage_id: null });
    const passage = (id, kind, releasedH, title) => ({ passage_id: id, lang: 'en', band: 1, kind, pool: 'practice', status: 'reviewed', released_at: ago(releasedH), title_en: title, title_ur: null });
    seed([...NEXT_ON, ...STORY_ON], {
      web_quiz_challenge_runs: [run('read'), run('bigger')],
      // this week's story is the newest READ one (p-week); its twin by title is a newer LISTEN one, ranked first among unseen
      challenge_passages: [passage('p-week', 'read', 5, 'The Kite'), passage('p-twin', 'listen', 1, 'The Kite')],
    });
    Challenge.__reset();
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.lantern).toMatchObject({ kind: 'story', pid: 'p-week' });
    expect(out.next).toMatchObject({ id: 'p-week', rank_src: 'ctrl', source: 'fallback' });
  });
});

describe('Stories, the v3 home and the Next side by side on one payload', () => {
  test('all three switches on: stories, doors and next each on the hub payload (none replaces another)', async () => {
    seed([...NEXT_ON, ON('web_quiz_home_v3'), ON('web_quiz_stories')], { ...pending(), story_events: [] });
    const S = require('../../../shared/services/quiz/web-quiz-stories');
    S._reset();
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out).toMatchObject({ stories: { on: 1 }, home_v3: 1, doors: expect.any(Object), next: expect.objectContaining({ ctx: 'home', rank_src: 'pinned' }) });
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
    expect(f.elig.split('|')).toEqual(NO.KINDS.filter((k) => f.elig.split('|').includes(k)));   // the kit's kind order
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
    // a game tile names its one game: the numbers warm-up opens at once (#numbers), never Jugnu's list first
    expect(out.next.href).toMatch(/^\/c\/[^?#]+\?kid=[^#]+#numbers$/);
  });
});

// ── the result cards (web-quiz-next-offer-sources.js finishField / challengeField; the routes wrap them) ──────────
const Sources = require('../../../shared/services/quiz/web-quiz-next-offer-result');
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

describe('B1: a result card never mints or binds a hub token for a phone that is not the child\'s', () => {
  const ct = (ex) => T.signChallenge({ studentId: KID, ex, runId: `run-${ex}-${Math.random()}` });
  const B = { device: 'BBBBBBBBBBBBBBBBBBBBBB' };
  const C = { device: 'CCCCCCCCCCCCCCCCCCCCCC' };
  const hubKeys = () => [...redis._store.keys()].filter((k) => /^wq:hub:(dev|kid|devkids):/.test(k));
  const tokensIn = (n) => [n, ...(n.alts || [])].map((x) => (/\/(?:h|c|lib)\/([^/?#]+)/.exec(x.href) || [])[1]).filter(Boolean);

  test('phone B holding the child\'s challenge token (never played as them, no hub of theirs opened there) -> {} and nothing written', async () => {
    seed([...NEXT_ON, ON('web_quiz_events_v3'), ON('web_quiz_library')], pending());
    redis._store.clear();
    expect(await Sources.challengeField({ score: {} }, ct('bigger'), { device: B.device })).toEqual({});
    expect(hubKeys()).toEqual([]);
    expect(logEvent.mock.calls.filter(([nm]) => nm === 'web_quiz.next_set')).toHaveLength(0);
  });

  test('the child\'s own phone (it played as them) -> the offer, and every hub token in it is bound to THAT phone', async () => {
    seed([...NEXT_ON, ON('web_quiz_library')], pending());
    redis._store.clear();
    const { next_offer: n } = await Sources.challengeField({ score: {} }, ct('bigger'), { device: A.device });
    expect(n).toBeTruthy();
    const Dev = require('../../../shared/services/quiz/web-quiz-hub-device');
    for (const tok of tokensIn(n)) {
      expect((await Dev.deviceTrusted(decodeURIComponent(tok), B.device)).ok).toBe(false);
      expect((await Dev.deviceTrusted(decodeURIComponent(tok), A.device)).ok).toBe(true);
    }
  });

  test('a phone the child\'s hub was opened on (no play there) is the child\'s too -> the offer', async () => {
    seed([...NEXT_ON], pending());
    redis._store.clear();
    const Dev = require('../../../shared/services/quiz/web-quiz-hub-device');
    expect((await Dev.deviceTrusted(T.signHub([KID]), C.device)).ok).toBe(true);
    const { next_offer: n } = await Sources.challengeField({ score: {} }, ct('bigger'), { device: C.device });
    expect(n).toBeTruthy();
  });

  test('past the deadline before the mint (live off): no token, no bind, no state written', async () => {
    seed([...NEXT_ON], pending());
    redis._store.clear();
    expect(await Sources._snapshot({ studentId: KID, device: A.device, live: { on: false } })).toBeNull();
    expect(hubKeys()).toEqual([]);
  });
});

describe('warm before the result: the child\'s candidates are read when the quiz or the run starts, so the card only ranks', () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nxsKeys = () => [...redis._store.keys()].filter((k) => /^wq:nxs:[0-9a-f]{24}$/.test(k));
  const slowReads = () => { const real = Hub._parts.kidContext; return jest.spyOn(Hub._parts, 'kidContext').mockImplementation(async (...a) => { await sleep(2500); return real(...a); }); };
  const ct = (ex, extra = {}) => T.signChallenge({ studentId: KID, ex, runId: `run-${ex}-${Math.random()}`, ...extra });

  test('a warmed child: the quiz card\'s next_offer comes inside the deadline even when the child\'s reads are slow', async () => {
    seed(NEXT_ON, pending());
    redis._store.clear();
    expect(await Sources.warmFromSession({ st: st() }, { device: A.device })).toBe(true);
    expect(nxsKeys()).toHaveLength(1);
    slowReads();
    const t0 = Date.now();
    const { next_offer: n } = await Sources.finishField({ st: st() }, finished(), { device: A.device });
    expect(Date.now() - t0).toBeLessThan(Sources.DEADLINE_MS);
    expect(n).toMatchObject({ ctx: 'after_quiz', rank_src: 'pinned' });
    // the quiz just finished is still never "your teacher's new quiz"
    expect([n, ...n.alts].filter((x) => x.variant === 'new' && /MATH01/.test(x.href))).toEqual([]);
  }, 15000);

  test('not warmed and slow: today\'s answer ({} at the deadline)', async () => {
    seed(NEXT_ON, pending());
    redis._store.clear();
    slowReads();
    expect(await Sources.finishField({ st: st() }, finished(), { device: A.device })).toEqual({});
  }, 15000);

  test('a Jugnu run\'s start warms too; its result ranks from it; a class round\'s turn warms nothing', async () => {
    seed(NEXT_ON, pending());
    redis._store.clear();
    expect(await Sources.warmFromChallenge({ ct: ct('bigger', { round: 'cr-1', mode: 'check' }) }, { device: A.device })).toBe(false);
    expect(nxsKeys()).toHaveLength(0);
    const t = ct('bigger');
    expect(await Sources.warmFromChallenge({ ct: t }, { device: A.device })).toBe(true);
    slowReads();
    const { next_offer: n } = await Sources.challengeField({ score: {} }, t, { device: A.device });
    expect(n.ctx).toBe('after_game');
    expect([n, ...n.alts].map((x) => x.id)).not.toContain('stop.bigger');
  }, 15000);

  test('the switch off, a forged token, a teacher\'s run, a friend\'s run or a phone that is not the child\'s: nothing read into the cache', async () => {
    seed(BASE_ON, pending());
    redis._store.clear();
    expect(await Sources.warmFromSession({ st: st() }, { device: A.device })).toBe(false);
    seed(NEXT_ON, pending());
    expect(await Sources.warmFromSession({ st: 'nope' }, { device: A.device })).toBe(false);
    expect(await Sources.warmFromSession({}, { device: A.device })).toBe(false);
    db.quiz_sessions[0].user_id = TEACHER;
    expect(await Sources.warmFromSession({ st: st() }, { device: A.device })).toBe(false);
    seed(NEXT_ON, pending());
    db.quiz_sessions[0].invited_by_student_id = '44444444-4444-4444-8444-000000000077';
    expect(await Sources.warmFromSession({ st: st() }, { device: A.device })).toBe(false);
    seed(NEXT_ON, pending());
    expect(await Sources.warmFromChallenge({ ct: ct('bigger') }, { device: 'BBBBBBBBBBBBBBBBBBBBBB' })).toBe(false);
    expect(nxsKeys()).toHaveLength(0);
  });

  test('the warm list is per phone and carries no name, phone or raw id; another phone never reads it', async () => {
    seed(NEXT_ON, pending());
    redis._store.clear();
    await Sources.warmFromSession({ st: st() }, { device: A.device });
    const [k] = nxsKeys();
    const text = JSON.stringify(redis._store.get(k));
    ['Zara', 'FIXTURE', '+92'].forEach((x) => expect(text).not.toContain(x));
    // phone B holding the child's run token: its own key misses, and B1 refuses it (nothing minted, nothing written)
    expect(await Sources.challengeField({ score: {} }, ct('bigger'), { device: 'BBBBBBBBBBBBBBBBBBBBBB' })).toEqual({});
    expect(nxsKeys()).toHaveLength(1);
  });

  test('a card that comes while its warm-up is still reading waits for it (inside the deadline), never reads twice', async () => {
    seed(NEXT_ON, pending());
    redis._store.clear();
    const real = Hub._parts.kidContext;
    const spy = jest.spyOn(Hub._parts, 'kidContext').mockImplementation(async (...a) => { await sleep(600); return real(...a); });
    const w = Sources.warmFromSession({ st: st() }, { device: A.device });
    await sleep(50);
    const { next_offer: n } = await Sources.finishField({ st: st() }, finished(), { device: A.device });
    expect(n).toBeTruthy();
    await w;
    expect(spy).toHaveBeenCalledTimes(1);
  }, 15000);
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

describe('a child with no class quiz and the v3 home\'s watch-only player', () => {
  const VID = '77777777-7777-4777-8777-000000000001';
  const classless = () => ({
    quiz_sessions: [], quiz_share_codes: [],
    student_videos: [{ id: VID, grade: '3', subject: 'Science', clean_chapter: 'Water', clean_title: 'Where water goes', r2_url: null, migration_status: 'done', superseded_by: null }],
    quizzes: [{ id: '88888888-8888-4888-8888-000000000001', video_id: VID, quiz_source: 'video', status: 'ready' }],
  });

  test('home v3 on -> a video it can watch at once (#watch/<vid>), never a library tile it cannot start', async () => {
    withArm('rank');
    seed([...NEXT_ON, ON('web_quiz_home_v3')], classless());
    const out = await Hub.hub(T.signHub([KID]), A);
    const all = [out.next, ...out.next.alts];
    const v = all.find((x) => x.kind === 'video');
    expect(v).toMatchObject({ variant: 'recommended', id: VID, sub: 'Where water goes' });
    expect(v.href).toMatch(new RegExp(`^/h/[^?]+\\?kid=[^&]+&lang=en#watch/${VID}$`));
    expect(all.filter((x) => x.id === 'library')).toEqual([]);
    // both switches on: the v3 home's doors and the ranked Next ride the same payload (neither replaces the other)
    expect(out).toMatchObject({ home_v3: 1, doors: expect.objectContaining({ games: expect.any(Array) }), next: expect.objectContaining({ ctx: 'home' }) });
  });

  test('home v3 off -> no video at all for a class-less child (409 no_class)', async () => {
    seed([...NEXT_ON, ON('web_quiz_library')], classless());
    const out = await Hub.hub(T.signHub([KID]), A);
    if (out.next) expect([out.next, ...out.next.alts].map((x) => x.kind)).not.toContain('video');
  });
});

describe('the "on its way" check reads the draw as the serve does', () => {
  test('the grade reaches the draw as a number (the hub\'s grade is a string)', async () => {
    const D = require('../../../shared/services/quiz/web-quiz-challenge-draw');
    seed([...NEXT_ON, ...STORY_ON, ON('web_quiz_challenge_pool')], { web_quiz_challenge_runs: [] });
    Challenge.__reset();
    const spy = jest.spyOn(D, 'fixedGradeOf');
    await Sources_onItsWay(KID, ['read'], '3');
    expect(spy).toHaveBeenCalledWith(KID, 3);
  });
});
async function Sources_onItsWay(id, stops, grade) {
  return require('../../../shared/services/quiz/web-quiz-next-offer-sources').onItsWayOf(id, id, stops, 'en', grade);
}

describe('offerFor: any other activity (a watched video)', () => {
  test('after_video: the caller\'s own candidates join the child\'s, ranked for that ctx; off -> {}', async () => {
    const own = { kind: 'video', variant: 'next', id: 'vid-next', href: '/h/t?kid=c#watch/vid-next', title: 'Watch a video', minutes: 3 };
    seed(BASE_ON, pending());
    expect(await Sources.offerFor({ studentId: KID, device: A.device, ctx: 'after_video', extra: [own] })).toEqual({});
    seed(NEXT_ON, pending());
    const { next_offer: n } = await Sources.offerFor({ studentId: KID, device: A.device, ctx: 'after_video', extra: [own] });
    expect(n.ctx).toBe('after_video');
    expect(n.rank_src).toBe('pinned');   // the teacher's pending quiz still comes first
    expect([n, ...n.alts].length).toBeGreaterThan(1);
  });

  test('after_video joins: exactly one next_set {ctx:after_video} whose offer is the answer\'s; source in the allowed set', async () => {
    const more = { kind: 'video', variant: 'more', id: 'videos', href: '#videos', title: 'More videos', minutes: 3 };
    seed([...NEXT_ON, ON('web_quiz_events_v3')], pending());
    const { next_offer: n } = await Sources.offerFor({ studentId: KID, device: A.device, ctx: 'after_video', extra: [more] });
    const sets = logEvent.mock.calls.filter(([nm]) => nm === 'web_quiz.next_set');
    expect(sets).toHaveLength(1);
    expect(sets[0][1]).toMatchObject({ ctx: 'after_video', offer: n.offer, ev_v: 3 });
    expect(n.offer).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(['pinned', 'ranked', 'fallback']).toContain(n.source);
  });

  test('the caller\'s own candidates may be a read of their own (a function): it runs inside the deadline, beside the child\'s reads', async () => {
    const more = { kind: 'video', variant: 'more', id: 'videos', href: '#videos', title: 'More videos', minutes: 3 };
    seed(NEXT_ON, pending());
    // a fast read: its candidates are ranked with the child's
    const { next_offer: n } = await Sources.offerFor({ studentId: KID, device: A.device, ctx: 'after_video', extra: async () => [more] });
    expect([n, ...n.alts].map((x) => x.id).concat(n.id)).toBeDefined();
    let seen = null;
    jest.spyOn(NO, 'nextFor').mockImplementation(async (a) => { seen = a.candidates.map((c) => c.id); return null; });
    await Sources.offerFor({ studentId: KID, device: A.device, ctx: 'after_video', extra: async () => [more] });
    expect(seen).toContain('videos');
    jest.restoreAllMocks();
    // a read that never answers: the answer still comes within the deadline (with no slot), never held by it
    const t0 = Date.now();
    expect(await Sources.offerFor({ studentId: KID, device: A.device, ctx: 'after_video', extra: () => new Promise(() => {}) })).toEqual({});
    expect(Date.now() - t0).toBeLessThan(Sources.DEADLINE_MS + 600);
  });
});

describe('nextFor with another surface\'s key', () => {
  test('a keyed id (e.g. a teacher home\'s) drives the arm and the state; no child id needed', async () => {
    seed(NEXT_ON, pending());
    const spy = jest.spyOn(NO, 'armOf');
    const c = [{ kind: 'storybook', id: 'b1', href: '/x', title: 'A story' }, { kind: 'quiz', id: 'q1', href: '/y', title: 'A quiz' }];
    const n = await NO.nextFor({ ctx: 'teacher_home', studentId: null, candidates: c, key: 'abcdef0123456789' });
    expect(n).toBeTruthy();
    expect(spy.mock.calls[0][0]).toBe('abcdef0123456789');
    expect(redis._store.has('wq:next:o:abcdef0123456789')).toBe(true);   // its own prefix: never a child's state key
    for (const bad of ['not a key!', '000000000000', 'abcdef01', 'abcdef0123456789ab', 'ABCDEF0123456789']) {
      expect(await NO.nextFor({ ctx: 'teacher_home', studentId: null, candidates: c, key: bad })).toBeNull();
    }
  });
});

// ── the second review's fixes ─────────────────────────────────────────────────────────────────────────────────
const S = require('../../../shared/services/quiz/web-quiz-next-offer-sources');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextKeys = () => [...redis._store.keys()].filter((k) => String(k).startsWith('wq:next:'));
const nextSets = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.next_set');
// the per-child state read answers after `ms` (a slow Redis): everything else as it was. Swapped by hand (a spy on
// the fake's own jest.fn would lose its implementation on restore); put back after each test.
const fastGet = redis.get;
function slowState(ms) {
  redis.get = async function slowGet(k) {
    if (String(k).startsWith('wq:next:')) await sleep(ms);
    return fastGet.call(redis, k);
  };
}
afterEach(() => { redis.get = fastGet; });

describe('the deadline stops the work: a slot nobody was shown is never counted', () => {
  test('the hub: a state read past 1.2 s -> no `next`, and after it lands no wq:next: write and no next_set', async () => {
    process.env.WEB_QUIZ_KID_KEY = KEY32;
    seed([...NEXT_ON, ON('web_quiz_events_v3')], pending());
    slowState(1500);
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out).not.toHaveProperty('next');
    await sleep(800);   // the late read has resolved by now
    expect(nextKeys()).toEqual([]);
    expect(nextSets()).toEqual([]);
  });

  test('the quiz finish: past the deadline -> {} and nothing written or logged later', async () => {
    process.env.WEB_QUIZ_KID_KEY = KEY32;
    seed([...NEXT_ON, ON('web_quiz_events_v3')], pending());
    slowState(1500);
    expect(await Sources.finishField({ st: st() }, finished(), { device: A.device })).toEqual({});
    await sleep(800);
    expect(nextKeys()).toEqual([]);
    expect(nextSets()).toEqual([]);
  });

  test('a Jugnu stop: past the deadline -> {}, no run memo, no state, no line; the next poll draws it afresh', async () => {
    process.env.WEB_QUIZ_KID_KEY = KEY32;
    seed([...NEXT_ON, ON('web_quiz_events_v3')], pending());
    slowState(1500);
    const t = T.signChallenge({ studentId: KID, ex: 'bigger', runId: 'run-late' });
    expect(await Sources.challengeField({ score: {} }, t, { device: A.device })).toEqual({});
    await sleep(800);
    expect([...redis._store.keys()].filter((k) => String(k).startsWith('wq:nxr:'))).toEqual([]);
    expect(nextKeys()).toEqual([]);
    expect(nextSets()).toEqual([]);
    redis.get = fastGet;
    const again = await Sources.challengeField({ score: {} }, t, { device: A.device });
    expect(again.next_offer.ctx).toBe('after_game');
    expect(nextSets()).toHaveLength(1);
  });

  test('the hub\'s deadline is 1.2 s and the settings read is inside it', async () => {
    expect(S.HUB_DEADLINE_MS).toBe(1200);
    seed(NEXT_ON, pending());
    await Hub.hub(T.signHub([KID]), A);   // the hub's own caches warm
    const real = NO.switches;
    jest.spyOn(NO, 'switches').mockImplementation(async () => { await sleep(2500); return real(); });
    const t0 = Date.now();
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(Date.now() - t0).toBeLessThan(2200);
    expect(out).not.toHaveProperty('next');
    await sleep(1500);
  });
});

describe('the teacher card fails closed', () => {
  // the quizzes read the slot makes (id, quiz_source, status, meta) answers an error, or nothing
  function quizRead(answer) {
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t !== 'quizzes') return b;
      const sel = b.select.bind(b);
      b.select = (cols, ...rest) => {
        if (!/quiz_source, status, meta/.test(String(cols))) return sel(cols, ...rest);
        const chain = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => res(answer) : () => chain) });
        return chain;
      };
      return b;
    };
  }
  test('a quizzes read error or no rows -> the teacher card is never offered (it may be a previewed book)', async () => {
    for (const answer of [{ data: null, error: { message: 'timeout' } }, { data: null, error: null }]) {
      withArm('rank');
      seed(NEXT_ON, pending());
      quizRead(answer);
      const out = await Hub.hub(T.signHub([KID]), A);
      const all = out.next ? [out.next, ...out.next.alts] : [];
      expect(all.filter((x) => /SCI002/.test(x.href))).toEqual([]);
      if (out.next) expect(out.next.rank_src).not.toBe('pinned');
      const { next_offer: n } = await Sources.finishField({ st: st() }, finished(), { device: A.device });
      if (n) expect([n, ...n.alts].filter((x) => /SCI002/.test(x.href) && x.variant !== 'again')).toEqual([]);
      jest.restoreAllMocks();
    }
  });

  test('a storybook whose report went out (status report_sent) is still the teacher\'s send: pinned, its cover, «نئی»', async () => {
    const BOOK = '99999999-9999-4999-8999-000000000001';
    const over = { ...pending(), story_books: [{ id: BOOK, cover_file: 'cover-ab12cd34.webp' }] };
    Object.assign(over.quizzes[1], { quiz_source: 'story', status: 'report_sent', meta: { story: { book_id: BOOK, lang: 'en' } } });
    seed(NEXT_ON, over);
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.next).toMatchObject({ kind: 'storybook', rank_src: 'pinned', source: 'pinned', art: `/s/${BOOK}/cover-ab12cd34.webp`, tag: 'New', tag_ur: 'نئی' });
  });

  test('a lesson\'s video code (a parent code) open ≤ 7 days is never "your teacher\'s quiz"', async () => {
    const over = pending();
    over.quiz_share_codes[1].parent_share_code_id = 'sc-1';
    seed(NEXT_ON, over);
    const out = await Hub.hub(T.signHub([KID]), A);
    if (out.next) expect([out.next, ...out.next.alts].filter((x) => x.rank_src === 'pinned')).toEqual([]);
  });
});

describe('the tile: words, picture, tag, source', () => {
  test('the counted read stop reads "Read to Jugnu" / «جگنو کو پڑھ کر سناؤ»', () => {
    const list = S.candidatesOf({ out: { kid: 'c1' }, token: 'tok', collect: { trail: ['read', 'bigger'] } });
    expect(list.find((c) => c.id === 'stop.read')).toMatchObject({ title: 'Read to Jugnu', title_ur: 'جگنو کو پڑھ کر سناؤ' });
  });

  test('every kind carries a picture: the subject\'s, the grade\'s, the poster, else Jugnu\'s own', () => {
    const out = {
      kid: 'c1', book_on: true,
      teacher: { code: 'TQ0001', k: 'k1', topic: 'Plants', subject: 'Science', sent_at: ago(5) },
      last: { code: 'LQ0001', k: 'k2', state: 'open', subject: 'Maths' },
      again: [{ code: 'AQ0001', k: 'k3', subject: 'English', art: '/wq/art/subject-english-1.webp' }],
      lib: { href: '/lib/tok?kid=c1&l=en', art: '/wq/art/grade-3-1.webp' },
      recs: [{ vid: 'v-1', title: 'Water', poster: '/p.webp' }],
    };
    const subjectArt = (s) => `/wq/art/subject-${String(s).toLowerCase()}-1.webp`;
    const list = S.candidatesOf({
      out, token: 'tok', watch: true, subjectArt, known: new Set(['TQ0001']),
      collect: { trail: ['read', 'listen', 'bigger'], unseen: [{ pid: 'en.read.1.k01', title: 'A' }, { pid: 'en.listen.1.k02', title: 'B' }], live: [{ passage_id: 'en.listen.1.k02', kind: 'listen' }], story: true },
      extra: [{ kind: 'invite', id: 'invite', href: 'https://wa.me/?text=x', title: 'Invite a friend' }, { kind: 'storybook', id: 'sb-1', href: '/s/x', title: 'A book', rule: 'resume' }],
    });
    const kinds = new Set(list.map((c) => c.kind));
    ['quiz', 'video', 'story', 'game', 'sticker', 'invite', 'storybook'].forEach((k) => expect(kinds).toContain(k));
    list.forEach((c) => expect(typeof c.art === 'string' && c.art.startsWith('/')).toBe(true));
    // the library tile only when no lesson can be named: the hub's own grade picture
    const lib = S.candidatesOf({ out: { ...out, recs: [] }, token: 'tok', watch: true, subjectArt, known: new Set(['TQ0001']) });
    expect(lib.find((c) => c.id === 'library').art).toBe('/wq/art/grade-3-1.webp');
    expect(list.find((c) => c.rule === 'teacher_quiz' && c.variant === 'new').art).toBe('/wq/art/subject-science-1.webp');
    expect(list.find((c) => c.variant === 'again').art).toBe('/wq/art/subject-english-1.webp');
    expect(list.find((c) => c.id === 'v-1').art).toBe('/p.webp');
    expect(list.find((c) => c.rule === 'teacher_quiz')).toMatchObject({ tag: 'New', tag_ur: 'نیا' });
    // the shipped files only: every Jugnu picture exists in the app's public folder
    const pub = require('path').join(__dirname, '../../../../dashboard/public');
    Object.values(S.JUGNU_ART).forEach((a) => expect(require('fs').existsSync(require('path').join(pub, a))).toBe(true));
  });

  test('on the hub: `source` on next, arm + score_v + source on every alt, art everywhere', async () => {
    withArm('rank');
    seed([...NEXT_ON, ON('web_quiz_library')], pending());
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.next).toMatchObject({ source: 'pinned', arm: 'rank', score_v: NO.FILE_WEIGHTS.v });
    expect(out.next.alts.length).toBeGreaterThan(0);
    out.next.alts.forEach((a) => expect(a).toMatchObject({ arm: 'rank', score_v: NO.FILE_WEIGHTS.v, source: 'ranked' }));
    [out.next, ...out.next.alts].forEach((x) => expect(x.art).toMatch(/^\//));
  });

  test('the chapter video\'s id is the video\'s, never its share code; no video id -> no chapter tile', async () => {
    seed(NEXT_ON, pending());
    const a = await Sources.finishField({ st: st() }, finished({ next: { code: 'VIDQ01', title: 'Water' } }), { device: A.device });
    expect(JSON.stringify(a)).not.toContain('chapter.VIDQ01');
    seed(NEXT_ON, pending());
    const b = await Sources.finishField({ st: st() }, finished({ next: { code: 'VIDQ01', title: 'Water', vid: 'vid-9' } }), { device: A.device });
    const ch = [b.next_offer, ...b.next_offer.alts].find((x) => x.variant === 'chapter');
    if (ch) expect(ch.id).toBe('chapter.vid-9');
  });
});

describe('a read\'s context: weak below 40 % of the passage; tried when almost nothing was read', () => {
  const R = require('../../../shared/services/quiz/web-quiz-next-offer-result');
  test('challengeCtx (pure)', () => {
    expect(R.challengeCtx('read', { score: { attempted: 11 } }, { words: 30 })).toBe('after_read_weak');
    expect(R.challengeCtx('read', { score: { attempted: 12 } }, { words: 30 })).toBe('after_read');
    expect(R.challengeCtx('read', { score: { attempted: 5 } }, { words: null })).toBe('after_read');   // unknown length: not judged
    expect(R.challengeCtx('read', { failed: true, reason: 'unheard' })).toBe('after_read_tried');
    expect(R.challengeCtx('read', { failed: true, reason: 'abandoned' })).toBe('after_read_tried');
    expect(R.challengeCtx('read', { failed: true, reason: 'incomplete' })).toBe('after_read_weak');
    expect(R.challengeCtx('read', { score: { attempted: 30 }, ended: 'timer' }, { words: 30 })).toBe('after_read_weak');
  });

  test('through the result: the run\'s own passage length decides (a third of it read -> after_read_weak)', async () => {
    withArm('rank');
    const Bank = require('../../../shared/services/child-test/item-bank');
    const PID = 'en.read.1.ref01';
    const n = Challenge.passageFor(PID, Bank).tokens.length;
    expect(n).toBeGreaterThan(5);
    seed([...NEXT_ON, ...STORY_ON], { web_quiz_challenge_runs: [{ id: 'run-weak', student_id: KID, exercise: 'read', status: 'scored', passage_id: PID }] });
    Challenge.__reset();
    const t = T.signChallenge({ studentId: KID, ex: 'read', runId: 'run-weak' });
    const weak = await Sources.challengeField({ score: { correct: 3, attempted: Math.floor(n / 3) }, wcpm: 20 }, t, { device: A.device });
    expect(weak.next_offer.ctx).toBe('after_read_weak');
    redis._store.clear();
    const t2 = T.signChallenge({ studentId: KID, ex: 'read', runId: 'run-weak' });
    db.web_quiz_challenge_runs[0].id = 'run-weak';
    const ok = await Sources.challengeField({ score: { correct: n - 1, attempted: n }, wcpm: 60 }, t2, { device: A.device });
    expect(ok.next_offer.ctx).toBe('after_read');
  });

  test('a read with nothing heard -> after_read_tried: never another read-aloud', async () => {
    withArm('rank');
    seed([...NEXT_ON, ...STORY_ON], { web_quiz_challenge_runs: [] });
    Challenge.__reset();
    const t = T.signChallenge({ studentId: KID, ex: 'read', runId: 'run-tried' });
    const { next_offer: o } = await Sources.challengeField({ failed: true, reason: 'unheard' }, t, { device: A.device });
    expect(o.ctx).toBe('after_read_tried');
    expect([o, ...o.alts].filter((x) => x.title === 'Read to Jugnu')).toEqual([]);
  });
});

describe('GET /ch/result/:ct with a FINAL result: off -> byte for byte; on -> plus next_offer', () => {
  let server; let base;
  beforeAll(async () => {
    process.env.INTERNAL_API_KEY = 'route-key';
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    await new Promise((r) => { server = app.listen(0, r); });
    server.keepAliveTimeout = 120000;   // the client reuses its socket across these tests: never one closed under it
    base = `http://127.0.0.1:${server.address().port}/wq`;
  });
  afterAll(() => new Promise((r) => { server.closeAllConnections(); server.close(r); }));
  test('a scored poll', async () => {
    const H = { 'x-api-key': 'route-key', 'x-wq-device': A.device };
    jest.spyOn(Challenge, 'poll').mockResolvedValue({ score: { correct: 4, n: 5 } });
    const t = T.signChallenge({ studentId: KID, ex: 'bigger', runId: 'run-get' });
    seed(BASE_ON, pending());
    expect(await (await fetch(`${base}/ch/result/${encodeURIComponent(t)}`, { headers: H })).text()).toBe(JSON.stringify({ score: { correct: 4, n: 5 } }));
    seed(NEXT_ON, pending());
    const on = await (await fetch(`${base}/ch/result/${encodeURIComponent(t)}`, { headers: H })).json();
    const { next_offer: n, ...rest } = on;
    expect(rest).toEqual({ score: { correct: 4, n: 5 } });
    expect(n.ctx).toBe('after_game');
  });

  test('/finish keeps both the finish card\'s field and the next thing; both off -> the service\'s JSON byte for byte', async () => {
    const H = { 'x-api-key': 'route-key', 'content-type': 'application/json', 'x-wq-device': A.device };
    const WebQuiz = require('../../../shared/services/quiz/web-quiz.service');
    jest.spyOn(WebQuiz, 'finishSession').mockImplementation(async () => finished());
    jest.spyOn(require('../../../shared/services/quiz/web-quiz-share-warm'), 'afterFinish').mockImplementation(() => {});
    const Card = require('../../../shared/services/quiz/web-quiz-card-image');
    seed(BASE_ON, pending());
    Card._reset();
    expect(await (await fetch(`${base}/finish`, { method: 'POST', headers: H, body: JSON.stringify({ st: st() }) })).text()).toBe(JSON.stringify(finished()));
    seed([...NEXT_ON, ON('web_quiz_card_v3')], pending());
    Card._reset();
    const on = await (await fetch(`${base}/finish`, { method: 'POST', headers: H, body: JSON.stringify({ st: st() }) })).json();
    expect(on.card_v3).toBe(true);
    expect(on.next_offer).toMatchObject({ kind: 'quiz', ctx: 'after_quiz', rank_src: 'pinned' });
    const { card_v3: c, next_offer: n, ...rest } = on;
    expect(rest).toEqual(finished());
  });
});

describe('a child WITH a class: a "Watch a video" tile plays the lesson it names; the library tile says "Pick a video"', () => {
  const VID = '77777777-7777-4777-8777-000000000002';
  const VQ = '88888888-8888-4888-8888-000000000002';
  // the class child of the fixture (a teacher-sent code played) with one grade-3 lesson the bank can name
  const lessons = () => ({
    student_videos: [{ id: VID, grade: '3', subject: 'Science', clean_chapter: 'Water', clean_title: 'Where water goes', r2_url: null, migration_status: 'done', superseded_by: null }],
    quizzes: [...db.quizzes, { id: VQ, video_id: VID, quiz_source: 'video', status: 'ready', topic: 'Where water goes', language: 'en' }],
  });
  const videosOf = (out) => [out.next, ...out.next.alts].filter((x) => x && x.kind === 'video');
  const ALL_ON = () => [...NEXT_ON, ON('web_quiz_home_v3'), ON('web_quiz_library')];

  test('a lesson named (out.recs[].vid) -> {kind video, variant recommended, href the home\'s own player}, never the library picker', async () => {
    withArm('rank');
    seed(ALL_ON(), lessons());
    const tok = T.signHub([KID]);
    const out = await Hub.hub(tok, A);
    expect(out.recs.map((r) => r.vid)).toContain(VID);
    const v = videosOf(out);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ kind: 'video', variant: 'recommended', id: VID, title: 'Watch a video', title_ur: 'ویڈیو دیکھیں', sub: 'Where water goes' });
    // the hub's OWN token and chip (nothing minted for the tile), the home's player hash
    expect(v[0].href).toBe(`/h/${encodeURIComponent(tok)}?kid=${encodeURIComponent(out.kid)}&lang=en#watch/${VID}`);
    expect(v[0].href).not.toMatch(/^\/lib\//);
  });

  test('building the tile mints nothing, binds nothing and never reads the watch root', async () => {
    withArm('rank');
    seed(ALL_ON(), lessons());
    const codes0 = db.quiz_share_codes.length;
    const reads = [];
    const from = supabase.from;
    supabase.from = (t) => { const b = from(t); if (t === 'app_settings') { const eq = b.eq.bind(b); b.eq = (k, v) => { reads.push(v); return eq(k, v); }; } return b; };
    try {
      const out = await Hub.hub(T.signHub([KID]), A);
      expect(videosOf(out)[0].variant).toBe('recommended');
    } finally { supabase.from = from; }
    expect(db.quiz_share_codes).toHaveLength(codes0);
    expect(db.child_phone_bindings || []).toEqual([]);
    expect(reads).not.toContain('web_quiz_watch_root');
  });

  test('the tap: the class child\'s lesson starts on the class\'s own lesson code (the Videos door\'s rule), no watch root, no binding', async () => {
    const Videos = require('../../../shared/services/quiz/web-quiz-videos');
    seed(ALL_ON(), lessons());
    // a classmate already opened this lesson from the Videos door: its class code is live
    db.quiz_share_codes.push({ id: 'sc-v', code: 'VID001', quiz_id: VQ, video_id: VID, active: true, expires_at: ahead(240), topic: 'Where water goes', language: 'en', teacher_user_id: TEACHER, parent_share_code_id: 'sc-1', invited_by_student_id: null, created_at: ago(5) });
    const codes0 = db.quiz_share_codes.length;
    const tok = T.signHub([KID]);
    const out = await Hub.hub(tok, A);
    const a = await Videos.start({ hub: tok, kid: out.kid, vid: VID, device: A.device });
    const b = await Videos.start({ hub: tok, kid: out.kid, vid: VID, device: A.device });
    expect(a.code).toBe('VID001');
    expect(b).toEqual(a);
    expect(db.quiz_share_codes).toHaveLength(codes0);   // nothing new minted
    expect(db.child_phone_bindings || []).toEqual([]);  // nothing bound
  });

  test('no lesson can be named -> the library tile stays, its words are "Pick a video" / «ویڈیو چنیں», on the child\'s grade', async () => {
    withArm('rank');
    seed(ALL_ON(), { student_videos: [] });
    const tok = T.signHub([KID]);
    const out = await Hub.hub(tok, A);
    expect(out.recs).toEqual([]);
    const v = videosOf(out);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ kind: 'video', variant: 'library', id: 'library', title: 'Pick a video', title_ur: 'ویڈیو چنیں' });
    // the library on this hub's token: it opens on the child's own grade (the hub's grade picture rides the tile)
    expect(v[0].href).toMatch(/^\/lib\/[^?]+\?kid=[^&]+&l=en$/);
  });

  test('the result surface (after a quiz, a video): a class child\'s snapshot names the lesson too, so its tile plays it', async () => {
    seed(ALL_ON(), lessons());
    const R = require('../../../shared/services/quiz/web-quiz-next-offer-result');
    const snap = await R._snapshot({ studentId: KID, device: A.device, watch: true });
    expect(snap.out.recs.map((r) => r.vid)).toContain(VID);
  });

  // The result snapshot's reads. OFF (no lesson asked, `watch` off) = the recorded 16 tables on a cold start:
  // 12 data reads, exactly, + up to 4 switch reads (app_settings; a warm switch cache skips some, so they are a
  // ceiling). ON (a class child, the lesson named) <= OFF + its own named rows: the sessions, the quizzes and the
  // lessons behind the class's quiz (the recs a class-less child already gets), one each; never another table.
  const SNAP_OFF_DATA = { students: 2, student_lists: 2, class_enrollments: 2, quiz_share_codes: 3, quiz_sessions: 2, quizzes: 1 };
  const SNAP_SWITCH_MAX = 4;
  const SNAP_ON_ROWS = { quiz_sessions: 1, quizzes: 1, student_videos: 1 };
  test('the result snapshot reads 16 tables with the lesson off (12 data + up to 4 switches); on, at most those + quiz_sessions, quizzes, student_videos (one each)', async () => {
    const readsOf = async (watch) => {
      seed(ALL_ON(), lessons());
      const R = require('../../../shared/services/quiz/web-quiz-next-offer-result');
      const per = {};
      const from = supabase.from;
      supabase.from = (t) => { per[t] = (per[t] || 0) + 1; return from(t); };
      try { await R._snapshot({ studentId: KID, device: A.device, watch }); } finally { supabase.from = from; }
      const { app_settings: sw = 0, ...data } = per;
      return { sw, data };
    };
    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    const off = await readsOf(false);
    const on = await readsOf(true);
    expect(off.data).toEqual(SNAP_OFF_DATA);
    expect(off.sw).toBeLessThanOrEqual(SNAP_SWITCH_MAX);
    expect(sum(SNAP_OFF_DATA) + SNAP_SWITCH_MAX).toBe(16);
    // per table: never a table OFF does not read, except the named ones, and never more than OFF + its named row
    const over = Object.keys(on.data).filter((t) => on.data[t] > (SNAP_OFF_DATA[t] || 0) + (SNAP_ON_ROWS[t] || 0));
    expect(over).toEqual([]);
    expect(on.sw).toBeLessThanOrEqual(SNAP_SWITCH_MAX);
    expect(sum(on.data) + on.sw).toBeLessThanOrEqual(16 + sum(SNAP_ON_ROWS));
  });

  // GOLDEN: a class-less child's whole `next` (offer ids aside: random per render) equals the base's, written once on
  // the base commit (fixtures/next-video-classless.golden.json) and compared here. To re-record on a base commit, put
  // `require('fs').writeFileSync(file, `${got}\n`);` above the expect for one run, then remove it.
  test('GOLDEN: a class-less child\'s `next` is today\'s byte for byte (the recommended lesson in the home\'s player)', async () => {
    withArm('rank');
    seed(ALL_ON(), { ...lessons(), quiz_sessions: [], quiz_share_codes: [] });
    const out = await Hub.hub(T.signHub([KID]), A);
    const strip = (n) => JSON.parse(JSON.stringify(n, (k, v) => (k === 'offer' ? undefined : v)).replace(/\/h\/[^?"]+\?kid=[^&"]+/g, '/h/<t>?kid=<c>').replace(/\/lib\/[^?"]+\?kid=[^&"]+/g, '/lib/<t>?kid=<c>'));
    const got = JSON.stringify(strip(out.next));
    const file = require('path').join(__dirname, 'fixtures', 'next-video-classless.golden.json');
    expect(got).toBe(require('fs').readFileSync(file, 'utf8').trimEnd());
    expect(videosOf(out)[0]).toMatchObject({ variant: 'recommended', id: VID, title: 'Watch a video' });
  });
});
