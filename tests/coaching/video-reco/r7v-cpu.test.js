'use strict';
/**
 * bd-8hhqhf R7v (COS 20261027T050735 + 055344; eng-fix r7v/MEASURE.md), parts (b)–(d), engine-only: the card-mode pick rebuilt
 * static work on every call (the redactor's vocab sets once per transcript line, the BM25 catalogue index once per call,
 * ~90% of its CPU); both are now built once. (d) one '[video-reco] timing' line per pick, the prod proof.
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');

describe('the static work is built once (R7v CPU)', () => {
  test('BM25: the catalogue index is built on the first call only; the scores are the same', () => {
    jest.resetModules();
    const shortlist = require('../../../bot/shared/services/coaching/video-reco/shortlist');
    const catalog = require('../../../bot/shared/services/coaching/video-reco/catalog').fromData(FIXTURE);
    let reads = 0;
    for (const m of catalog.modules) {
      const segs = m.segments;
      Object.defineProperty(m, 'segments', { get() { reads += 1; return segs; }, configurable: true, enumerable: true });
    }
    const q = 'ask two why questions about shapes';
    const s1 = [...shortlist.bm25(catalog, q)];
    const after1 = reads;
    const s2 = [...shortlist.bm25(catalog, q)];
    expect(s2).toEqual(s1);
    expect(reads - after1).toBe(0); // head: every call walks every module's segments again
  });

  test('redactor: the vocab lists are read once per list, not once per transcript line; the masks are the same', () => {
    jest.resetModules();
    const R = require('../../../bot/shared/services/coaching/video-reco/redact-names');
    const lines = Array.from({ length: 40 }, (_, i) => `Teacher: Ahmed, read line ${i}. Sana and Bilal, sit down.`);
    let lengthReads = 0;
    const counted = (arr) => new Proxy(arr, { get(t, k) { if (k === 'length') lengthReads += 1; return t[k]; } });
    const vocab = counted(['triangle', 'shape', 'line']);
    const oovVocab = counted(['shapes']);
    const ctx = { vocab, oovVocab, roster: new Set(['zarmeena']), teacher: 'Saima Khan' };
    const masked = R.maskedKeys(lines, ctx);
    expect(lengthReads).toBeLessThanOrEqual(4); // head: ≥ 2 per line (80+)
    const fresh = R.maskedKeys(lines, { vocab: ['triangle', 'shape', 'line'], oovVocab: ['shapes'], roster: new Set(['zarmeena']), teacher: 'Saima Khan' });
    expect([...masked].sort()).toEqual([...fresh].sort());
    expect(R.redactNames(lines[0], ctx)).toBe(R.redactNames(lines[0], { vocab: ['triangle', 'shape', 'line'], oovVocab: ['shapes'], roster: new Set(['zarmeena']), teacher: 'Saima Khan' }));
  });
});

test('(d) one [video-reco] timing line per pick, with the read wait, and the row is unchanged', async () => {
  jest.resetModules();
  const log = jest.fn();
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: log, logWarn: jest.fn() }));
  const E = require('../../../bot/shared/services/coaching/video-reco/engine');
  const catalog = require('../../../bot/shared/services/coaching/video-reco/catalog').fromData(FIXTURE);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const later = (v) => jest.fn(async () => { await sleep(40); return v; });
  const store = {
    readForSession: later(null), recentHistory: later({ segments: [], modules: [] }), ladderProgress: later({ level: 2, completedModules: [] }),
    rosterNames: later([]), trainingBands: later([]), write: jest.fn(async (r) => ({ id: 'rec-1', ...r })),
  };
  const SID = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
  const row = await E.recommendForReport({
    session: { id: SID, user_id: 'u-1', transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: 'ur' },
      diarization_data: { segments: [{ start_ms: 30000, label: 'Teacher', text: 'Is this a triangle? Yes or no, quickly!' }] } },
    analysis: { framework: 'fico', domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Quote: "Is this a triangle? Yes or no"', evidence_summary: 'yes/no', timestamp: '[00:30]' }] } }, subject_resolution: { code: 'urdu', confidence: 'high', grade: '3' } },
    nextStep: { target: { indicator: 'C1', rung: 1 } }, card: { indicator: 'C1', action: 'Ask two why questions about shapes' }, coachingSessionId: SID,
    deps: { env: { VIDEO_RECO_ENABLED: 'true', VIDEO_RECO_MODE: 'shadow', VIDEO_RECO_REASON: 'card' }, catalog, store, v10GroupFor: later(null) },
  });
  const lines = log.mock.calls.filter((c) => c[0] === '[video-reco] timing');
  expect(lines).toHaveLength(1);
  const x = lines[0][1];
  expect(x).toMatchObject({ coachingSessionId: SID, engine_ms: row.engine_ms, prefetched: false, prefetch_age_ms: null, status: row.status });
  expect(x.reads_wait_ms).toBeGreaterThanOrEqual(35);
  expect(x.reads_wait_ms).toBeLessThanOrEqual(row.engine_ms);
  expect(JSON.stringify(x)).not.toMatch(/Saima|Khan/); // no names on the line
});
