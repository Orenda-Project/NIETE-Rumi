'use strict';
/**
 * Story Time: GET /ch/:token/<read|listen>?room=story&pid=<passage_id> serves the practice story the shelf showed,
 * behind web_quiz_challenge_story (under web_quiz_challenge_v2) and web_quiz_challenge_pool. The id must be a practice
 * passage the shelf could have shown this child: reviewed or better, released, not withdrawn, not the reserve, in the
 * child's language, of this exercise's kind, in a band open to the child. Anything else: 400 story_pid and no run row.
 * The row is practice, never a record, on the story's own passage; the month's record is untouched.
 * Switch off: room and pid are ignored and the serve is today's, byte for byte.
 * Faked boundaries only (Supabase with the tables' real columns, R2, speech, the LLM client); the route, the service,
 * the draw module and the loader are real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  getPresignedUploadUrl: jest.fn(async (key) => `https://r2.test/put/${key}?X-Amz-Signature=x`),
  headObject: jest.fn(async () => ({ exists: true, sizeBytes: 400000, contentType: 'audio/ogg' })),
  downloadFromR2: jest.fn(),
  getPresignedUrl: jest.fn(async (u) => `${u}?X-Amz-Signature=x`),
  buildR2PublicUrl: jest.fn((k) => `https://r2.test/${k}`),
  uploadBuffer: jest.fn(async () => 'ok'),
  presignKey: jest.fn(async (key) => `https://signed.test/${key}`),
  deleteAudio: jest.fn(async () => true),
  deleteKey: jest.fn(async () => true),
  listKeys: jest.fn(async () => []),
}));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));
jest.mock('../../../shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return { isAvailable: () => true, get: async (k) => (store.has(k) ? store.get(k) : null), setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; } };
});
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { makeFake } = require('./fake-supabase');
const { guardColumns } = require('./registry-columns');
const supabase = require('../../../shared/config/supabase');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Bank = require('../../../shared/services/child-test/item-bank');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
const Draw = require('../../../shared/services/quiz/web-quiz-challenge-draw');

const K3 = '44444444-4444-4444-8444-444444444444';
const L3 = 'a0000000-0000-4000-8000-000000000003';
const BASE_FLAGS = ['web_quiz_challenge', 'web_quiz_challenge_record', 'web_quiz_challenge_trail', 'web_quiz_challenge_missing', 'web_quiz_challenge_listen', 'web_quiz_challenge_questions'];
const V2 = 'web_quiz_challenge_v2';
const PERIOD = 'web_quiz_challenge_period';
const POOL = 'web_quiz_challenge_pool';
const STORY = 'web_quiz_challenge_story';

const DAY = 24 * 3600 * 1000;
const iso = (t) => new Date(t).toISOString();
const periodsNow = () => [
  { period_id: '2026-10', starts_at: iso(Date.now() - 40 * DAY), ends_at: iso(Date.now() - DAY), anchor_block_version: 'A1', weights_v: 'w1', bank_version: 'child-test-items-v4' },
  { period_id: '2026-11', starts_at: iso(Date.now() - DAY), ends_at: iso(Date.now() + 29 * DAY), anchor_block_version: 'A1', weights_v: 'w1', bank_version: 'child-test-items-v4' },
];
const REL = '2026-10-01T00:00:00Z';
const reg = (id, extra = {}) => {
  const [lang, kind, band] = id.split('.');
  return { passage_id: id, lang, kind, band: Number(band), pool: 'practice', status: 'reviewed', is_reference: false, released_at: REL, withdrawn_at: null, twin_of: null, ...extra };
};
// One check passage per (read, band 1) so the check draw is deterministic; the rest are Story Time's practice pool.
const REGISTRY = () => [
  reg('en.read.2.setA', { pool: 'check', status: 'calibrated', is_reference: true }),
  reg('en.read.1.ref01', { pool: 'check', status: 'calibrated', is_reference: true }),
  reg('en.read.1.kite'),                                                     // the story: released practice, band 1
  reg('en.read.1.boat', { status: 'calibrated' }),                           // another story, a shelf status too
  reg('en.listen.1.rain'),                                                   // a listening story
  reg('en.read.1.later', { released_at: iso(Date.now() + 5 * DAY) }),        // not released yet
  reg('en.read.1.gone', { withdrawn_at: '2026-10-05T00:00:00Z' }),            // withdrawn
  reg('en.read.1.draft', { status: 'draft' }),                               // never reviewed
  reg('ur.read.1.chand'),                                                    // another language
  reg('en.read.2.river'),                                                    // a band not open to a grade-3 child
  reg('en.read.1.reserve01'),                                                // the draw's fall-through, never Story Time
];

const PDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wqstory-'));
const W = ['Hina', 'saw', 'a', 'red', 'kite', 'It', 'flew', 'over', 'the', 'school', 'She', 'smiled', 'and', 'ran', 'home'];
const passage = (id, words, questions, pool = 'practice') => {
  const [lang, kind, band] = id.split('.');
  fs.writeFileSync(path.join(PDIR, `${id}.json`), JSON.stringify({
    passage_id: id, lang, kind, band: Number(band), pool, status_at_authoring: 'reviewed', is_reference: false,
    text: words.join(' '), lines: [{ n: 1, from: 0, to: 4 }, { n: 2, from: 5, to: 9 }, { n: 3, from: 10, to: words.length - 1 }],
    tokens: words, questions, twin_of: null, bank_version: 'child-test-items-v4',
  }));
};
const Q = (id, needs, tap = true) => ({ id, prompt: `Who is ${id}?`, type: 'literal', needs_line: needs, tap_ok: tap, accept: ['the girl'], reject: ['the dog', 'the cat', 'the tree'], rubric: '' });
passage('en.read.1.ref01', W, [Q('en.read.1.ref01.q1', 1)], 'check');
passage('en.read.1.kite', ['A', 'kite', 'story', ...W.slice(3)], [Q('en.read.1.kite.q1', 1), Q('en.read.1.kite.q2', 2)]);
passage('en.read.1.boat', ['A', 'boat', 'story', ...W.slice(3)], [Q('en.read.1.boat.q1', 1)]);
passage('en.listen.1.rain', ['The', 'rain', 'story', ...W.slice(3)], [Q('en.listen.1.rain.q1', 1), Q('en.listen.1.rain.q2', 2, false), Q('en.listen.1.rain.q3', 3)]);
for (const id of ['en.read.1.later', 'en.read.1.gone', 'en.read.1.draft', 'ur.read.1.chand', 'en.read.2.river', 'en.read.1.reserve01']) passage(id, W, [Q(`${id}.q1`, 1)]);

let db; let server; let base;
beforeAll(async () => {
  process.env.INTERNAL_API_KEY = 'route-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.R2_BUCKET_NAME = 'r2-default';
  Bank._loadPassagesFrom(PDIR);
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
});
afterAll(async () => { Bank._loadPassagesFrom(); await new Promise((r) => (server ? server.close(r) : r())); });
const fresh = () => {
  db = {
    app_settings: BASE_FLAGS.map((key) => ({ key, value: true })),
    student_lists: [{ id: L3, class_name: '3', is_active: true }],
    students: [{ id: K3, list_id: L3, student_name: 'Sana Testwala' }],
    web_quiz_challenge_runs: [],
    challenge_periods: periodsNow(),
    challenge_passages: REGISTRY(),
    challenge_draws: [],
  };
  Object.assign(supabase, guardColumns(makeFake(db)));
  Ch.__reset();
};
beforeEach(() => { fresh(); jest.clearAllMocks(); });
const on = (...keys) => keys.forEach((key) => db.app_settings.push({ key, value: true }));

const hub = () => T.sign({ k: 'h', ids: [K3], exp: Math.floor(Date.now() / 1000) + 3600 });
const get = async (ex, query = '') => {
  const r = await fetch(`${base}/ch/${hub()}/${ex}?lang=en${query}`, { headers: { 'x-api-key': 'route-key', 'x-wq-device': 'FamilyPhoneDeviceRef_1' } });
  return { status: r.status, body: await r.json() };
};
const story = (ex, pid) => get(ex, `&room=story&pid=${encodeURIComponent(pid)}`);
const runOf = (ct) => T.verify(ct, 'c').r;
const rowOf = (ct) => db.web_quiz_challenge_runs.find((r) => r.id === runOf(ct));

// Everything a serve returns and writes, with ids, tokens, seeds and clocks taken out.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VOLATILE = new Set(['ct', 'created_at', 'started_at', 'drawn_at', 'seed', 'draw_seed', 'draw_id']);
const norm = (x) => JSON.parse(JSON.stringify(x, (k, v) => (VOLATILE.has(k) ? undefined : (typeof v === 'string' && UUID.test(v) ? 'U' : v))));
async function serveAll(query) {
  const out = {};
  for (const ex of ['read', 'listen']) out[ex] = await get(ex, query);
  out.rows = db.web_quiz_challenge_runs.map((r) => ({ ...r }));
  out.draws = db.challenge_draws.map((r) => ({ ...r }));
  return norm(out);
}

describe('(a) the switch off: room and pid are ignored, the serve is today\'s', () => {
  test.each([
    ['_v2, _period, _pool on, Story Time off', [V2, PERIOD, POOL]],
    ['Story Time on with its parent _v2 off', [PERIOD, POOL, STORY]],
  ])('%s: deep-equal to the same serve without room/pid', async (_, flags) => {
    on(...flags);
    const today = await serveAll('');
    fresh(); on(...flags);
    const withPid = await serveAll('&room=story&pid=en.read.1.kite');
    expect(withPid).toEqual(today);
    expect(today.read.status).toBe(200);
    expect(db.web_quiz_challenge_runs.some((r) => r.passage_id === 'en.read.1.kite')).toBe(false);
  });
});

describe('(b) on: a released practice story in the child\'s language and band is served', () => {
  beforeEach(() => on(V2, PERIOD, POOL, STORY));
  const FORBIDDEN = ['band', 'exposure_no', 'rung', 'passage_id', 'period_id', 'record_decision', 'served_id', 'band_reason'];

  test('read: 200, a practice row on the story, never a record; the payload is the check serve\'s plus practice_round and the read-along clip', async () => {
    const check = await get('read');
    expect(check.status).toBe(200);
    fresh(); on(V2, PERIOD, POOL, STORY);
    const { status, body } = await story('read', 'en.read.1.kite');
    expect(status).toBe(200);
    const row = rowOf(body.ct);
    expect(row).toMatchObject({ status: 'served', exercise: 'read', lang: 'en', mode: 'practice', record: false, passage_id: 'en.read.1.kite', band: 1, exposure_no: 1, period_id: '2026-11', canonical_id: K3 });
    expect(row.meta.draw).toMatchObject({ outcome: 'served', band_reason: 'story', served_id: 'en.read.1.kite' });
    expect(db.web_quiz_challenge_runs).toHaveLength(1);
    expect(db.challenge_draws).toHaveLength(0);   // a story is chosen, not drawn
    // the payload: exactly today's check serve keys + practice_round + the read-along clip (`story` is the passage itself)
    expect(check.body).not.toHaveProperty('story_clip');
    expect(Object.keys(body).sort()).toEqual([...Object.keys(check.body), 'practice_round', 'story_clip'].sort());
    expect(body.story_clip).toEqual({ url: `https://signed.test/${Ch.clipKey('read', 'story', 'en', Bank.getPassage('en.read.1.kite').text)}` });
    expect(body).toMatchObject({ mode: 'practice', practice_round: true, draw: { outcome: 'served' } });
    expect(Object.keys(body.draw)).toEqual(['outcome']);
    for (const k of FORBIDDEN) expect(body).not.toHaveProperty(k);
    expect(body.story.text).toBe(Bank.getPassage('en.read.1.kite').text);
    // the story joins the child's seen set: the shelf's NEW tag clears after one play
    expect(Draw.seenIdsOf(await Draw.childRows(K3, [K3])).has('en.read.1.kite')).toBe(true);
  });

  test('listen: 200, the story\'s own clip and its tap-ok questions; payload = check keys + practice_round', async () => {
    const { status, body } = await story('listen', 'en.listen.1.rain');
    expect(status).toBe(200);
    expect(rowOf(body.ct)).toMatchObject({ mode: 'practice', record: false, passage_id: 'en.listen.1.rain', band: 1 });
    expect(body.story_clip.url).toBe(`https://signed.test/${Ch.clipKey('listen', 'story', 'en', Bank.getPassage('en.listen.1.rain').text)}`);
    expect(Object.keys(body).sort()).toEqual(['ex', 'name', 'lang', 'ct', 'clips', 'record', 'v2', 'trail', 'trail_copy', 'practice_round', 'mode', 'draw', 'read_times', 'story_clip'].sort());
    expect(body).toMatchObject({ mode: 'practice', practice_round: true, draw: { outcome: 'served' } });
    expect(body).not.toHaveProperty('story');
    for (const k of FORBIDDEN) expect(body).not.toHaveProperty(k);
    const qs = (await Ch.questions({ ct: body.ct })).questions;
    expect(qs.map((q) => q.id)).toEqual(['en.listen.1.rain.q1', 'en.listen.1.rain.q3']);
  });

  test('a calibrated practice story (the shelf shows reviewed, provisional and calibrated) is served too', async () => {
    const { status, body } = await story('read', 'en.read.1.boat');
    expect(status).toBe(200);
    expect(rowOf(body.ct)).toMatchObject({ mode: 'practice', passage_id: 'en.read.1.boat' });
  });
});

describe('(c, d) an id the shelf could not have shown: 400 story_pid and no run row', () => {
  beforeEach(() => on(V2, PERIOD, POOL, STORY));
  test.each([
    ['a CHECK-pool id', 'read', 'en.read.1.ref01'],
    ['an unknown id', 'read', 'en.read.1.nosuch'],
    ['no pid at all', 'read', ''],
    ['not released yet', 'read', 'en.read.1.later'],
    ['withdrawn', 'read', 'en.read.1.gone'],
    ['a draft', 'read', 'en.read.1.draft'],
    ['another language', 'read', 'ur.read.1.chand'],
    ['a band above the open bands', 'read', 'en.read.2.river'],
    ['the reserve story', 'read', 'en.read.1.reserve01'],
    ['a listening story asked for as a read', 'read', 'en.listen.1.rain'],
    ['a reading story asked for as a listen', 'listen', 'en.read.1.kite'],
  ])('%s → 400 story_pid, nothing written', async (_, ex, pid) => {
    const r = await story(ex, pid);
    expect(r).toEqual({ status: 400, body: { error: 'story_pid' } });
    expect(db.web_quiz_challenge_runs).toHaveLength(0);
    expect(db.challenge_draws).toHaveLength(0);
  });

  test('Story Time on but _pool off: the story room never falls back to a check serve', async () => {
    db.app_settings = db.app_settings.filter((s) => s.key !== POOL); Ch.__reset();
    expect(await story('read', 'en.read.1.kite')).toEqual({ status: 400, body: { error: 'story_pid' } });
    expect(db.web_quiz_challenge_runs).toHaveLength(0);
  });
});

describe('(e, f) the month\'s record and the story\'s exposures', () => {
  beforeEach(() => on(V2, PERIOD, POOL, STORY));

  test('(e) a story played first leaves the record open: the following check serve is the record', async () => {
    const s = await story('read', 'en.read.1.kite');
    Object.assign(rowOf(s.body.ct), { status: 'scored', score: { correct: 12 } });
    const c = await get('read');
    expect(c.status).toBe(200);
    expect(rowOf(c.body.ct)).toMatchObject({ mode: 'check', record: true, passage_id: 'en.read.1.ref01', exposure_no: 1 });
    expect(c.body).toMatchObject({ mode: 'check' });
    expect(c.body).not.toHaveProperty('practice_round');
    expect(c.body).not.toHaveProperty('story_clip');
  });

  test('(f) exposure_no counts the story\'s own rows only', async () => {
    const old = (id, passageId, extra = {}) => ({ id, student_id: K3, canonical_id: K3, exercise: 'read', grade: 3, lang: 'en', status: 'scored', mode: 'practice', record: false, passage_id: passageId, period_id: '2026-10', created_at: '2026-10-10T00:00:00Z', ...extra });
    db.web_quiz_challenge_runs.push(
      old('b1111111-1111-4111-8111-111111111111', 'en.read.1.kite'),
      old('b2222222-2222-4222-8222-222222222222', 'en.read.1.kite', { status: 'abandoned' }),
      old('b3333333-3333-4333-8333-333333333333', 'en.read.1.boat'),
      old('b4444444-4444-4444-8444-444444444444', 'en.read.1.ref01', { mode: 'check', record: true }),
    );
    const s = await story('read', 'en.read.1.kite');
    expect(s.status).toBe(200);
    expect(rowOf(s.body.ct)).toMatchObject({ passage_id: 'en.read.1.kite', exposure_no: 3, record: false });
  });
});
