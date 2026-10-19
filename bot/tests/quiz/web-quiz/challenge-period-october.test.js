'use strict';
/**
 * October 2026 is the first counted period: web_quiz_challenge_period_2026_10.sql adds its challenge_periods row, so a
 * serve from the go day to the end of the month carries period_id '2026-10' instead of NULL (and the period-missing
 * log). The migration file is the file under test: its one VALUES tuple is parsed and fed to the fake table beside the
 * registry seed's two rows. Its bounds are the PKT month (the 1st 00:00 PKT = the prior day 19:00Z) and abut the
 * November row exactly. Faked boundaries only (Supabase, R2, speech, the LLM client); the service and the draw are real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  getPresignedUploadUrl: jest.fn(async (key) => `https://r2.test/put/${key}?X-Amz-Signature=x`),
  headObject: jest.fn(async () => ({ exists: true, sizeBytes: 400000, contentType: 'audio/webm' })),
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
jest.mock('../../../shared/services/llm-client', () => {
  const create = jest.fn();
  return { __create: create, getClient: () => ({ chat: { completions: { create } } }) };
});
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return { _store: store, isAvailable: () => true, get: async (k) => (store.has(k) ? store.get(k) : null), setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; } };
});
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const fs = require('fs');
const path = require('path');
const { makeFake } = require('./fake-supabase');
const { guardColumns } = require('./registry-columns');
const supabase = require('../../../shared/config/supabase');
const { logError } = require('../../../shared/utils/logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');

const MIG = path.join(__dirname, '../../../database/migrations');
const FILE = path.join(MIG, 'web_quiz_challenge_period_2026_10.sql');
const ROLLBACK = path.join(MIG, 'web_quiz_challenge_period_2026_10_rollback.sql');
const SEED = path.join(MIG, 'web_quiz_challenge_registry_seed.sql');
const COLS = ['period_id', 'starts_at', 'ends_at', 'anchor_block_version', 'weights_v', 'bank_version', 'created_by'];

// one SQL tuple of quoted literals → a row keyed by the INSERT's column list
const tuple = (cols, body) => {
  const vals = body.split(',').map((v) => v.trim().replace(/^'(.*)'$/, '$1'));
  return Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
};
const colsOf = (s) => s.split(',').map((c) => c.trim());
const octoberRow = () => {
  const sql = fs.readFileSync(FILE, 'utf8');
  const m = sql.match(/INSERT INTO public\.challenge_periods \(([^)]*)\) VALUES \(([^)]*)\) ON CONFLICT \(period_id\) DO NOTHING;/);
  if (!m) throw new Error('no challenge_periods INSERT in the October migration');
  return tuple(colsOf(m[1]), m[2]);
};
const seedRows = () => {
  const sql = fs.readFileSync(SEED, 'utf8');
  const m = sql.match(/INSERT INTO public\.challenge_periods \(([^)]*)\) VALUES([\s\S]*?)ON CONFLICT \(period_id\) DO NOTHING;/);
  const cols = colsOf(m[1]);
  return [...m[2].matchAll(/\(([^)]*)\)/g)].map((t) => tuple(cols, t[1]));
};
const K5 = '55555555-5555-4555-8555-555555555555';
const L5 = 'a0000000-0000-4000-8000-000000000005';
const BASE_FLAGS = ['web_quiz_challenge', 'web_quiz_challenge_record', 'web_quiz_challenge_trail', 'web_quiz_challenge_missing', 'web_quiz_challenge_listen', 'web_quiz_challenge_questions'];
const ON = ['web_quiz_challenge_v2', 'web_quiz_challenge_period', 'web_quiz_hub', 'web_quiz_identity_canon'];
const D = { device: 'FamilyPhoneDeviceRef_1', lang: 'en' };
const hub = (id) => T.sign({ k: 'h', ids: [id], exp: Math.floor(Date.now() / 1000) + 3600 });
const rowOf = (ct) => db.web_quiz_challenge_runs.find((r) => r.id === T.verify(ct, 'c').r);
const periodMissing = () => logError.mock.calls.filter(([n]) => n === 'web_quiz.ch_period_missing');

let db;
const setup = (periods) => {
  db = {
    app_settings: [...BASE_FLAGS, ...ON].map((key) => ({ key, value: true })),
    student_lists: [{ id: L5, class_name: '5', is_active: true }],
    students: [{ id: K5, list_id: L5, student_name: 'Bilal Testwala' }],
    web_quiz_challenge_runs: [],
    challenge_periods: periods,
    challenge_passages: [],
    challenge_draws: [],
  };
  Object.assign(supabase, guardColumns(makeFake(db)));
};
const at = (isoTime) => jest.spyOn(Date, 'now').mockReturnValue(Date.parse(isoTime));

beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; });
beforeEach(() => {
  Ch.__reset();
  for (const m of ['web-quiz-hub-flags', 'web-quiz-identity-flags']) require(`../../../shared/services/quiz/${m}`)._resetCache();
  jest.clearAllMocks();
});
afterEach(() => { jest.restoreAllMocks(); });

describe('the October 2026 migration file', () => {
  test('one challenge_periods row: the seven fields, the PKT month bounds abutting November', () => {
    const r = octoberRow();
    expect(Object.keys(r)).toEqual(COLS);
    expect(r).toEqual({
      period_id: '2026-10', starts_at: '2026-09-30T19:00:00Z', ends_at: '2026-10-31T19:00:00Z',
      anchor_block_version: 'A1', weights_v: 'w1', bank_version: 'child-test-items-v4', created_by: 'seed',
    });
    const nov = seedRows().find((p) => p.period_id === '2026-11');
    expect(nov.starts_at).toBe(r.ends_at);
    expect(nov).toMatchObject({ anchor_block_version: r.anchor_block_version, weights_v: r.weights_v, bank_version: r.bank_version });
  });

  test('the house header: requires the registry, no top-level BEGIN; / COMMIT; (the apply tool owns the transaction)', () => {
    const sql = fs.readFileSync(FILE, 'utf8');
    expect(sql.split('\n')[0]).toMatch(/^-- requires: web_quiz_challenge_registry\.sql\b/);
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/mi);
    expect(sql).toMatch(/ON CONFLICT \(period_id\) DO NOTHING;/);
  });

  test('the rollback deletes only the October row, refusing while a run or a draw names it', () => {
    const sql = fs.readFileSync(ROLLBACK, 'utf8');
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/mi);
    expect(sql).toMatch(/DELETE FROM public\.challenge_periods WHERE period_id = '2026-10';/);
    expect(sql).toMatch(/FROM public\.web_quiz_challenge_runs WHERE period_id = '2026-10'/);
    expect(sql).toMatch(/FROM public\.challenge_draws WHERE period_id = '2026-10'/);
    expect(sql).toMatch(/RAISE EXCEPTION/);
  });
});

describe('the serve with the October row in challenge_periods', () => {
  test('20 Oct 2026: the run row carries period_id 2026-10, no period-missing log', async () => {
    setup([...seedRows(), octoberRow()]);
    at('2026-10-20T10:00:00Z');
    const ex = await Ch.exercise(hub(K5), 'missing', D);
    expect(rowOf(ex.ct).period_id).toBe('2026-10');
    expect(periodMissing()).toHaveLength(0);
  });

  test('31 Oct 2026 19:00Z exactly (1 Nov 00:00 PKT): 2026-11, no overlap', async () => {
    setup([...seedRows(), octoberRow()]);
    at('2026-10-31T19:00:00Z');
    const ex = await Ch.exercise(hub(K5), 'missing', D);
    expect(rowOf(ex.ct).period_id).toBe('2026-11');
  });

  test('20 Oct 2026 with only the seed\'s two rows: period_id null and the period-missing log once', async () => {
    setup(seedRows());
    at('2026-10-20T10:00:00Z');
    const ex = await Ch.exercise(hub(K5), 'missing', D);
    const row = rowOf(ex.ct);
    expect(row.period_id).toBeNull();
    expect(row.record).toBeNull();
    expect(periodMissing()).toHaveLength(1);
    expect(periodMissing()[0][1]).toEqual({ day: '2026-10-20' });
  });
});
