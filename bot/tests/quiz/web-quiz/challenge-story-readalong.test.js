'use strict';
/**
 * The word-by-word read-along on a Story Time read (web_quiz_readalong, web-quiz-readalong.js): the story serve
 * carries `readalong` — the passage's timing file with its voice as a signed URL — only when the switch is on AND the
 * file exists AND it matches the words shown. Off: the serve is byte-identical to today's, and no file is even read.
 * The same harness as challenge-story-serve.test.js (faked Supabase, R2, speech; the route and services real).
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
// the record's parent switch (web_quiz_identity_canon, under web_quiz_hub): a check serve is a record only with it on
const CANON_ON = ['web_quiz_hub', 'web_quiz_identity_canon'];

const DAY = 24 * 3600 * 1000;
const iso = (t) => new Date(t).toISOString();
const periodsNow = () => [
  { period_id: '2026-10', starts_at: iso(Date.now() - 40 * DAY), ends_at: iso(Date.now() - DAY), anchor_block_version: 'A1', weights_v: 'w1', bank_version: 'child-test-items-v4' },
  { period_id: '2026-11', starts_at: iso(Date.now() - DAY), ends_at: iso(Date.now() + 29 * DAY), anchor_block_version: 'A1', weights_v: 'w1', bank_version: 'child-test-items-v4' },
];
const REL = '2026-10-01T00:00:00Z';
const reg = (id, extra = {}) => {
  const [lang, kind, band] = id.split('.');
  return { passage_id: id, lang, kind, band: Number(band), pool: 'practice', status: 'reviewed', is_reference: false, released_at: REL, withdrawn_at: null, twin_of: null, provenance: 'published_calibrated', ...extra };   // sourced: the counted draw admits it
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
  // the hub and identity switches are cached 30 s: each serve reads its own
  for (const m of ['web-quiz-hub-flags', 'web-quiz-identity-flags']) require(`../../../shared/services/quiz/${m}`)._resetCache();
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


const RA = require('../../../shared/services/quiz/web-quiz-readalong');
const r2 = require('../../../shared/storage/r2');
const { logError } = require('../../../shared/utils/logger');
const READALONG = 'web_quiz_readalong';
const KITE = 'en.read.1.kite';
const kiteText = () => Bank.getPassage(KITE).text;
const DIR = `readalong/sandbox/passage/en/${KITE}`;
const timingFile = (text = kiteText(), extra = {}) => {
  const ws = RA.printedWords(text);
  return { v: 1, id: KITE, lang: 'en', dir: 'ltr', audio: { url: 'sx-grace-ab12cd34.ogg', ms: 9000, mime: 'audio/ogg; codecs=opus' },
    words: ws.map((t, i) => ({ i, t, s_ms: 200 + i * 500, e_ms: 600 + i * 500 })), pace_wpm: 100,
    voice: { provider: 'soniox', voice: 'Grace' }, timing_src: 'stt_final', text_hash: RA.textHash(text), ...extra };
};
const stored = {};
const putFile = (key, obj) => { stored[key] = Buffer.from(JSON.stringify(obj)); };
beforeEach(() => {
  for (const k of Object.keys(stored)) delete stored[k];
  r2.downloadFromR2.mockImplementation(async (key) => {
    if (stored[key]) return stored[key];
    throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
  });
  process.env.RAILWAY_ENVIRONMENT_NAME = 'sandbox';
  RA.readAlong({ settingOn: Ch.settingOn })._reset();
});
const readalongReads = () => r2.downloadFromR2.mock.calls.filter(([k]) => String(k).startsWith('readalong/'));
const STORY_ON = [V2, ...CANON_ON, PERIOD, POOL, STORY];

describe('switch off: the serve is today\'s, byte for byte, and no timing file is read', () => {
  test('deep-equal to the same serve with the timing file present but the switch absent', async () => {
    on(...STORY_ON);
    const before = norm(await story('read', KITE));
    fresh(); on(...STORY_ON); jest.clearAllMocks(); RA.readAlong({ settingOn: Ch.settingOn })._reset();
    putFile(`${DIR}/current.json`, timingFile());
    const after = norm(await story('read', KITE));
    expect(after).toEqual(before);
    expect(after.body).not.toHaveProperty('readalong');
    expect(readalongReads()).toHaveLength(0);
  });
  test('the switch present but false is off too', async () => {
    on(...STORY_ON); db.app_settings.push({ key: READALONG, value: false });
    putFile(`${DIR}/current.json`, timingFile());
    const { body } = await story('read', KITE);
    expect(body).not.toHaveProperty('readalong');
    expect(readalongReads()).toHaveLength(0);
  });
});

describe('switch on', () => {
  beforeEach(() => on(...STORY_ON, READALONG));

  test('a story with its timing file: `readalong` is the file, its voice signed, and nothing else changes', async () => {
    fresh(); on(...STORY_ON);
    const plain = await story('read', KITE);
    fresh(); on(...STORY_ON, READALONG); RA.readAlong({ settingOn: Ch.settingOn })._reset();
    putFile(`${DIR}/current.json`, timingFile());
    const { status, body } = await story('read', KITE);
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual([...Object.keys(plain.body), 'readalong'].sort());
    const f = timingFile();
    expect(body.readalong).toEqual({
      v: 1, id: KITE, lang: 'en', dir: 'ltr',
      audio: { url: `https://signed.test/${DIR}/sx-grace-ab12cd34.ogg`, ms: 9000, mime: 'audio/ogg; codecs=opus' },
      words: f.words, pace_wpm: 100,
    });
    expect(r2.presignKey).toHaveBeenCalledWith(`${DIR}/sx-grace-ab12cd34.ogg`, 6 * 3600, expect.any(Object));
  });

  test('no timing file: no field, and the miss is remembered (one read for two serves)', async () => {
    const a = await story('read', KITE);
    const b = await story('read', KITE);
    expect(a.body).not.toHaveProperty('readalong');
    expect(b.body).not.toHaveProperty('readalong');
    expect(readalongReads()).toHaveLength(1);
    expect(logError).not.toHaveBeenCalledWith('web_quiz.readalong_read_failed', expect.anything());
  });

  test.each([
    ['made for other words (text hash)', () => timingFile(kiteText(), { text_hash: 'sha256:00000000' })],
    ['a word missing', () => { const f = timingFile(); f.words.pop(); return f; }],
    ['an audio key that is a URL', () => timingFile(kiteText(), { audio: { url: 'https://evil.test/a.ogg', ms: 1 } })],
    ['an audio key that climbs folders', () => timingFile(kiteText(), { audio: { url: '../x.ogg', ms: 1 } })],
    ['times going back', () => { const f = timingFile(); f.words[3].s_ms = 1; return f; }],
  ])('a file out of step (%s) is never served, and says why', async (_, make) => {
    putFile(`${DIR}/current.json`, make());
    const { status, body } = await story('read', KITE);
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('readalong');
    expect(logError).toHaveBeenCalledWith('web_quiz.readalong_out_of_step', expect.objectContaining({ passage_id: KITE }));
  });

  test('a check serve (not Story Time) never carries it and reads no file', async () => {
    putFile(`${DIR}/current.json`, timingFile());
    const { status, body } = await get('read');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('readalong');
    expect(readalongReads()).toHaveLength(0);
  });

  test('a listening story never carries it (the story is heard, never shown)', async () => {
    const { status, body } = await story('listen', 'en.listen.1.rain');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('readalong');
    expect(readalongReads()).toHaveLength(0);
  });
});

describe('the timing helpers', () => {
  test('printed words keep punctuation on the word; the hash is of the words joined by one space', () => {
    expect(RA.printedWords('  Asad  played\ncricket. ')).toEqual(['Asad', 'played', 'cricket.']);
    expect(RA.textHash('Asad played  cricket.')).toBe(RA.textHash('Asad played cricket.'));
    expect(RA.textHash('Asad played cricket.')).not.toBe(RA.textHash('Asad played cricket'));
    expect(RA.textHash('a')).toMatch(/^sha256:[0-9a-f]{8}$/);
  });
  test('the folder is per environment, kind, language and id, with unsafe characters made safe', () => {
    expect(RA.folder({ env: 'sandbox', lang: 'ur', id: 'ur.read.1.story01' })).toBe('readalong/sandbox/passage/ur/ur.read.1.story01');
    expect(RA.folder({ env: 'sandbox', kind: 'story', lang: 'en', id: 'b/../x' })).toBe('readalong/sandbox/story/en/b-..-x');
  });
});
