'use strict';
/**
 * The re-score of the kept readings scored before the noise floor (scripts/quiz/rescore-kept-reads.js): a guarded
 * one-off over a fake store. It refuses a foreign tier, sends no events, defaults to a dry run with counts and a cost
 * ceiling, never scores a reading outside the kept prefix (the scorer deletes a plain upload after scoring), and
 * on --write compare-and-sets only the score's meta fields — never score, wcpm, status, record, mode or meta.counted.
 */

// the service is loaded only for its exports (the last test): no store, no logs, no bucket
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/storage/r2', () => ({ downloadFromR2: jest.fn(), listKeys: jest.fn(async () => []), deleteKey: jest.fn(async () => true) }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({ isAvailable: () => false, get: async () => null, setNX: async () => true }));
jest.mock('openchemlib', () => require('../../../tests/__mocks__/openchemlib.js'));

const R = require('../../scripts/quiz/rescore-kept-reads');

const REF = 'abcdefghijklmnopqrst';
const ENV = { RAILWAY_ENVIRONMENT_NAME: 'sandbox', SUPABASE_URL: `https://${REF}.supabase.co`, CHILD_TEST_R2_ENV: 'sandbox' };
const KEPT = (run) => `child-voice/sandbox/kept/2026-10-10/${run}/read-take1.webm`;
const id = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const row = (n, over = {}) => ({
  id: id(n), exercise: 'read', status: 'scored', lang: 'en', grade: 3, form: 3, passage_id: null, score: { correct: 40, attempted: 42 }, wcpm: 40,
  meta: { audio_key: KEPT(id(n)), counted: true, ended: 'timer', read_s: 60, ms: 60000 }, ...over,
});

function fakeDeps(rows, scores = {}) {
  const store = new Map(rows.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
  const calls = { score: [], write: [] };
  return {
    store, calls,
    deps: {
      list: async () => [...store.values()].map((r) => JSON.parse(JSON.stringify(r))),
      isKeptKey: (k) => typeof k === 'string' && k.startsWith('child-voice/sandbox/kept/'),
      score: async (r) => { calls.score.push(r.id); return scores[r.id] || { score: { correct: 40 }, wcpm: 40, meta: { cost_usd: 0.014, flags: [], stt_words: 41, align_correct: 39 } }; },
      // the service's compare-and-set: build(cur) → patch, written over the stored row
      write: async (rid, build) => {
        const cur = store.get(rid);
        if (!cur) return null;
        const patch = build(JSON.parse(JSON.stringify(cur)));
        calls.write.push(rid);
        store.set(rid, { ...cur, ...patch });
        return { ...cur, ...patch };
      },
      now: () => '2026-10-17T09:00:00.000Z',
    },
  };
}
const args = (more = []) => R.parseArgs(['--env', 'sandbox', '--ref', REF, ...more]);

describe('rescore-kept-reads: the tier guard', () => {
  it('refuses without --env and --ref', async () => {
    const { deps } = fakeDeps([row(1)]);
    await expect(R.rescoreKept({ args: R.parseArgs([]), env: ENV, deps })).rejects.toThrow(/--env/);
    await expect(R.rescoreKept({ args: R.parseArgs(['--env', 'sandbox']), env: ENV, deps })).rejects.toThrow(/--ref/);
  });
  it('refuses a ref that is not the one inside SUPABASE_URL, and an env that is not the deployment\'s', async () => {
    const { deps, calls } = fakeDeps([row(1)]);
    await expect(R.rescoreKept({ args: R.parseArgs(['--env', 'sandbox', '--ref', 'zzzzzzzzzzzzzzzzzzzz']), env: ENV, deps })).rejects.toThrow(/ref/);
    await expect(R.rescoreKept({ args: R.parseArgs(['--env', 'production', '--ref', REF]), env: ENV, deps })).rejects.toThrow(/env/);
    await expect(R.rescoreKept({ args: args(), env: { ...ENV, RAILWAY_ENVIRONMENT_NAME: '' }, deps })).rejects.toThrow(/env/);
    expect(calls.score).toEqual([]);
  });
  it('strips every AXIOM_ variable before anything loads, and says how many', () => {
    const env = { ...ENV, AXIOM_TOKEN: 'x', AXIOM_DATASET: 'y', OTHER: 'z' };
    expect(R.stripAxiom(env)).toBe(2);
    expect(Object.keys(env).filter((k) => k.startsWith('AXIOM_'))).toEqual([]);
    expect(env.OTHER).toBe('z');
  });
  it('rejects an unknown argument', () => {
    expect(() => R.parseArgs(['--apply'])).toThrow(/unknown/);
  });
});

describe('rescore-kept-reads: the selection and the dry run', () => {
  it('selects scored reads with a kept key and no stt_words; a plain key is counted, never scored', async () => {
    const rows = [
      row(1), row(2, { lang: 'ur' }),
      row(3, { meta: { audio_key: KEPT(id(3)), stt_words: 30 } }),            // already scored under the floor
      row(4, { status: 'failed' }), row(5, { exercise: 'listen' }),
      row(6, { meta: { audio_key: `child-voice/sandbox/${id(6)}/read-take1.webm` } }),   // a plain upload
      row(7, { meta: { counted: true } }),                                     // no audio kept
    ];
    const { deps, calls } = fakeDeps(rows);
    const out = await R.rescoreKept({ args: args(), env: ENV, deps });
    expect(out.dry_run).toBe(true);
    expect(out.mode).toBe('dry_run');
    expect(out.selected).toEqual({ en: 1, ur: 1 });
    expect(out.not_kept).toBe(1);
    expect(out.cost_ceiling_usd).toBeCloseTo(2 * R.USD_PER_READ, 6);
    expect(calls.score).toEqual([]);
    expect(calls.write).toEqual([]);
  });
  it('refuses when the ceiling is above --max-usd, before any scoring', async () => {
    const { deps, calls } = fakeDeps([row(1), row(2)]);
    await expect(R.rescoreKept({ args: args(['--write', '--max-usd', '0.01']), env: ENV, deps })).rejects.toThrow(/ceiling/);
    expect(calls.score).toEqual([]);
  });
  it('prints counts and at most the first 8 characters of a row id', async () => {
    const { deps } = fakeDeps([row(1)]);
    const out = await R.rescoreKept({ args: args(['--write']), env: ENV, deps });
    const text = JSON.stringify(out);
    expect(text).not.toContain(id(1));
    expect(text).not.toContain('child-voice/');
    expect(out.rows.map((x) => x.id)).toEqual([id(1).slice(0, 8)]);
  });
});

describe('rescore-kept-reads: --write', () => {
  it('an implausible re-score writes quality, flags, raw, stt_words, align_correct, rescored_at — nothing else moves', async () => {
    const implausible = { score: { correct: 0 }, wcpm: null, implausible: 'no_speech',
      meta: { cost_usd: 0.014, flags: ['no_speech'], quality: 'implausible', raw: { correct: 40, attempted: 42, wcpm: 40 }, stt_words: 0, ended: 'timer', clock: 'x' } };
    const { deps, store } = fakeDeps([row(1)], { [id(1)]: implausible });
    const before = JSON.parse(JSON.stringify(store.get(id(1))));
    const out = await R.rescoreKept({ args: args(['--write']), env: ENV, deps });
    const after = store.get(id(1));
    for (const col of ['score', 'wcpm', 'status', 'lang', 'grade', 'form']) expect(after[col]).toEqual(before[col]);
    expect(after.meta).toEqual({ ...before.meta, quality: 'implausible', flags: ['no_speech'], raw: { correct: 40, attempted: 42, wcpm: 40 }, stt_words: 0, rescored_at: '2026-10-17T09:00:00.000Z' });
    expect(out.implausible).toEqual({ no_speech: 1 });
    expect(out.cost_usd).toBeCloseTo(0.014, 6);
  });
  it('an ok re-score writes the heard words and the time, and no quality mark', async () => {
    const { deps, store } = fakeDeps([row(1)]);
    const out = await R.rescoreKept({ args: args(['--write']), env: ENV, deps });
    const m = store.get(id(1)).meta;
    expect(m.quality).toBeUndefined();
    expect(m).toMatchObject({ stt_words: 41, align_correct: 39, flags: [], rescored_at: '2026-10-17T09:00:00.000Z', counted: true });
    expect(out.ok).toBe(1);
  });
  it('a re-score the live path would not keep (unheard, abandoned) is written as an implausible mark with its reason; an error is not written', async () => {
    const { deps, calls, store } = fakeDeps([row(1), row(2), row(3)], {
      [id(1)]: { failed: true, reason: 'unheard', meta: { cost_usd: 0.014, stt_words: 3, align_correct: 0 } },
      [id(2)]: { failed: true, reason: 'internal_error', meta: {} },
      [id(3)]: { failed: true, reason: 'abandoned', words: 2, meta: { cost_usd: 0.014, flags: ['short'], stt_words: 4, align_correct: 2, words: 2 } },
    });
    const before = JSON.parse(JSON.stringify(store.get(id(1))));
    const out = await R.rescoreKept({ args: args(['--write']), env: ENV, deps });
    expect(calls.write).toEqual([id(1), id(3)]);
    const a = store.get(id(1));
    for (const col of ['score', 'wcpm', 'status']) expect(a[col]).toEqual(before[col]);
    expect(a.meta).toEqual({ ...before.meta, quality: 'implausible', flags: ['unheard'], stt_words: 3, align_correct: 0, rescored_at: '2026-10-17T09:00:00.000Z' });
    expect(store.get(id(3)).meta).toMatchObject({ quality: 'implausible', flags: ['short', 'abandoned'], stt_words: 4, align_correct: 2 });
    expect(store.get(id(3)).meta.words).toBeUndefined();
    expect(out.would_fail).toEqual({ unheard: 1, abandoned: 1 });
    expect(out.implausible).toEqual({});
    expect(out.errors).toBe(1);
  });
  it('--score scores and names every outcome by reason, and writes nothing', async () => {
    const { deps, calls } = fakeDeps([row(1), row(2)], {
      [id(1)]: { failed: true, reason: 'unheard', meta: { cost_usd: 0.014 } },
      [id(2)]: { score: { correct: 0 }, wcpm: null, implausible: 'low_stt_support', meta: { cost_usd: 0.014, quality: 'implausible', flags: ['low_stt_support'] } },
    });
    const out = await R.rescoreKept({ args: args(['--score']), env: ENV, deps });
    expect(calls.score).toEqual([id(1), id(2)]);
    expect(calls.write).toEqual([]);
    expect(out.mode).toBe('score');
    expect(out.would_fail).toEqual({ unheard: 1 });
    expect(out.implausible).toEqual({ low_stt_support: 1 });
    expect(out.rows).toEqual([{ id: id(1).slice(0, 8), outcome: 'unheard' }, { id: id(2).slice(0, 8), outcome: 'implausible:low_stt_support' }]);
  });
  it('--score and --write together are refused', () => {
    expect(() => R.parseArgs(['--score', '--write'])).toThrow(/either/);
  });
  it('a row that changed between the read and the write is left as it is', async () => {
    const { deps, store } = fakeDeps([row(1)]);
    const score = deps.score;
    deps.score = async (r) => { const res = await score(r); store.get(r.id).meta.stt_words = 12; return res; };
    const out = await R.rescoreKept({ args: args(['--write']), env: ENV, deps });
    expect(store.get(id(1)).meta.stt_words).toBe(12);
    expect(store.get(id(1)).meta.rescored_at).toBeUndefined();
    expect(out.changed).toBe(1);
  });
  it('stops scoring once the scorer\'s own cost reaches --max-usd', async () => {
    const rows = [row(1), row(2), row(3)];
    const { deps, calls } = fakeDeps(rows);
    deps.score = async (r) => { calls.score.push(r.id); return { score: { correct: 1 }, wcpm: 1, meta: { cost_usd: 0.03, flags: [], stt_words: 5, align_correct: 1 } }; };
    const out = await R.rescoreKept({ args: args(['--write', '--max-usd', '0.05']), env: ENV, deps });
    expect(calls.score.length).toBe(2);
    expect(out.stopped_at_cost).toBe(true);
  });
});

describe('the service hands the script its scorer', () => {
  const Ch = require('../../shared/services/quiz/web-quiz-challenge');
  const r2 = require('../../shared/storage/r2');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const env0 = process.env.CHILD_TEST_R2_ENV;
  beforeAll(() => { process.env.CHILD_TEST_R2_ENV = 'sandbox'; });
  afterAll(() => { if (env0 === undefined) delete process.env.CHILD_TEST_R2_ENV; else process.env.CHILD_TEST_R2_ENV = env0; });

  it('exports scoreRead, passageFor and childTest', () => {
    expect(typeof Ch.scoreRead).toBe('function');
    expect(typeof Ch.passageFor).toBe('function');
    expect(typeof Ch.childTest).toBe('function');
  });

  it('scoring a kept reading never deletes it; a plain upload is deleted (the reason the script refuses one)', async () => {
    const tmp = path.join(os.tmpdir(), `rescore-test-${process.pid}`);
    const CT = {
      Bank: Ch.childTest().Bank,
      media: { tmpFile: (ext) => `${tmp}.${ext}`, probeDuration: async () => 60, decodedDuration: async () => null, cleanup: (f) => { try { fs.unlinkSync(f); } catch (_) { /* gone */ } } },
      scoreTask: async () => ({ ok: true, timed: { correct: 40, attempted: 42, time_remaining: 0 }, stt_words: 41, align_correct: 39, flags: [], meta: { cost_usd: 0.014 } }),
    };
    r2.downloadFromR2.mockResolvedValue(Buffer.from('OggS'));
    r2.deleteKey.mockClear();
    const run = { form: 3, lang: 'en', task: 'en.story', passage: null };
    const kept = KEPT(id(1));
    const res = await Ch.scoreRead(run, kept, 'webm', 60000, CT, { record: true }, { ended: 'timer', runId: id(1) });
    expect(res.failed).toBeUndefined();
    expect(res.meta).toMatchObject({ stt_words: 41, align_correct: 39 });
    expect(r2.deleteKey).not.toHaveBeenCalled();
    await Ch.scoreRead(run, `child-voice/sandbox/${id(2)}/read-take1.webm`, 'webm', 60000, CT, { record: true }, { ended: 'timer', runId: id(2) });
    expect(r2.deleteKey).toHaveBeenCalled();
  });

  it('the service deps build the run from the row (form, task, passage) and score with the record rule on', async () => {
    const seen = [];
    const ct = jest.spyOn(Ch, 'childTest').mockReturnValue({ Bank: { getPassage: () => null, getTaskSpec: () => ({}) } });
    const sr = jest.spyOn(Ch, 'scoreRead').mockImplementation(async (...a) => { seen.push(a); return { score: {}, meta: {} }; });
    try {
      const d = R.serviceDeps();
      await d.score({ id: id(1), lang: 'ur', grade: 5, form: null, passage_id: null, meta: { audio_key: KEPT(id(1)), ms: 58000, ended: 'stuck', mic_check: 'pass', read_s: 58 } });
      const [run, key, ext, ms, , rules, ctx] = seen[0];
      expect(run).toEqual({ form: await Ch.formForChild(5), lang: 'ur', task: 'ur.story', passage: null });
      expect([key, ext, ms]).toEqual([KEPT(id(1)), 'webm', 58000]);
      expect(rules).toEqual({ record: true });
      expect(ctx).toEqual({ ended: 'stuck', micCheck: 'pass', readS: 58, runId: id(1) });
      expect(d.isKeptKey(KEPT(id(1)))).toBe(true);
      expect(d.isKeptKey(`child-voice/sandbox/${id(1)}/read-1.webm`)).toBe(false);
    } finally { ct.mockRestore(); sr.mockRestore(); }
  });
});
