'use strict';
/**
 * The standing class link's pick reaches the run row and the hub event; nothing else changes.
 *
 * Faked boundaries only (Supabase in memory with filters applied, Redis as a Map, R2, TTS, the LLM, the loggers);
 * the challenge service, the hub, the tokens and the class-link module run for real.
 *
 * Goldens: a hub token WITHOUT the class link's claim (every token minted today) gives the same run row and the same
 * hub_open event as the original code. The snapshot in __golden__/class-link-run-off.json was written by running
 * this file on the ORIGINAL origin/sandbox code with GOLDEN_CAPTURE=1.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  getPresignedUploadUrl: jest.fn(async (key) => `https://r2.test/put/${key}`),
  headObject: jest.fn(async () => ({ exists: true, sizeBytes: 400000, contentType: 'audio/webm' })),
  downloadFromR2: jest.fn(),
  getPresignedUrl: jest.fn(async (u) => u),
  buildR2PublicUrl: jest.fn((k) => `https://r2.test/${k}`),
  uploadBuffer: jest.fn(async () => 'ok'),
  presignKey: jest.fn(async (key) => `https://signed.test/${key}`),
  deleteAudio: jest.fn(async () => true),
  deleteKey: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));
jest.mock('../../../shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    set: async (k, v) => { store.set(k, v); return true; },
    setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; },
    delete: async (k) => store.delete(k),
  };
});
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const fs = require('fs');
const path = require('path');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');
const redis = require('../../../shared/services/cache/railway-redis.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Bank = require('../../../shared/services/child-test/item-bank');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');

const GOLDEN = path.join(__dirname, '__golden__', 'class-link-run-off.json');
const KID = '44444444-4444-4444-8444-444444444444';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const CLASS = 'c1a55000-0000-4000-8000-000000000001';
const DEV = 'FamilyPhoneDeviceRef_1';

let db;
beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; });
beforeEach(() => {
  db = {
    app_settings: [{ key: 'web_quiz_challenge', value: true }, { key: 'web_quiz_hub', value: 'true' }],
    student_lists: [{ id: LIST, class_name: '3', section: 'B', user_id: 't1', is_active: true }],
    students: [{ id: KID, list_id: LIST, student_name: 'Zara Khan', is_active: true }],
    quiz_share_codes: [],
    quiz_sessions: [],
    web_quiz_challenge_runs: [],
  };
  Object.assign(supabase, makeFake(db));
  Ch.__reset();
  Hub._resetCache();
  redis._store.clear();
  jest.clearAllMocks();
});

const exp = () => Math.floor(Date.now() / 1000) + 3600;
const plainHub = () => T.sign({ k: 'h', ids: [KID], exp: exp() });
const bank = () => Bank.getTaskSpec({ grade: 3, set: 'A', task: 'ma.discrimination' }).items;
const taps = (picks) => picks.map((pick, i) => ({ i, pick, ms: 1200 }));

async function playBigger(token) {
  const { ct } = await Ch.exercise(token, 'bigger', { device: DEV });
  await Ch.submit({ ct, taps: taps(bank().map((i) => i.answer)), ms: 30000 });
  expect(db.web_quiz_challenge_runs).toHaveLength(1);
  return db.web_quiz_challenge_runs[0];
}
// The volatile fields (ids, clocks, timings) are masked so the snapshot compares what the row SAYS.
const VOLATILE = new Set(['id', 'created_at', 'scored_at']);
function shape(row) {
  const out = {};
  Object.keys(row).sort().forEach((k) => {
    if (VOLATILE.has(k)) out[k] = '<volatile>';
    else if (k === 'meta') out[k] = Object.keys(row.meta || {}).sort();
    else out[k] = row[k];
  });
  return out;
}
async function hubOpenArgs(token) {
  await Hub.hub(token, { device: DEV });
  return logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.hub_open').map((c) => c[1]);
}

describe('golden: a hub token without the class link claim (every token today)', () => {
  test('the run row and the hub_open event are byte-identical to the original code', async () => {
    const row = shape(await playBigger(plainHub()));
    const events = await hubOpenArgs(plainHub());
    if (process.env.GOLDEN_CAPTURE === '1') {
      fs.writeFileSync(GOLDEN, `${JSON.stringify({ row, events }, null, 2)}\n`);
    }
    const want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    expect(row).toEqual(want.row);
    expect(events).toEqual(want.events);
  });
});

describe('(f)(h) the class link pick on the run row and the hub event', () => {
  const clHub = (cl) => T.sign({ k: 'h', ids: [KID], exp: exp(), src: 'cl', cl });

  test('(f) a roster pick writes class_id = the link\'s class and via = class_link on the run row', async () => {
    const row = await playBigger(clHub({ c: CLASS, s: 'roster_pick', q: 'high', h: false }));
    expect(row).toMatchObject({ via: 'class_link', class_id: CLASS, id_src: 'roster_pick', id_confidence: 'high', homonym_in_list: false, canonical_id: KID });
    expect(row.mode).toBeUndefined();
  });

  test('(g) a pick among identical chips is written low with homonym_in_list = true', async () => {
    const row = await playBigger(clHub({ c: CLASS, s: 'roster_pick', q: 'low', h: true }));
    expect(row).toMatchObject({ id_confidence: 'low', homonym_in_list: true });
  });

  test('(h) a teacher previewing plays mode = practice: never a counted run', async () => {
    const row = await playBigger(clHub({ c: CLASS, s: 'roster_pick', q: 'high', h: false, m: 'practice' }));
    expect(row.mode).toBe('practice');
  });

  test('golden: a class-link token opens the hub with hub_open args unchanged (the hub is its one writer)', async () => {
    const events = await hubOpenArgs(clHub({ c: CLASS, s: 'remembered', q: 'high', h: false }));
    const want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    expect(events).toEqual(want.events);
  });
});
