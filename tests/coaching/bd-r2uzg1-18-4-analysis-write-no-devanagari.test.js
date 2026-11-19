'use strict';
/**
 * bd-r2uzg1.18.4 — the analysis a coach reviews and a teacher's report is built from is stored with no Devanagari.
 *
 * The one write that matters most: analysis-processor's analysis_data write combines the FICO analysis, the v6 read,
 * the reflective corpus, the photo read and the LP-fidelity blob, for teacher DC sessions AND coach observations
 * (the coach's review form is pre-filled from a frozen copy of exactly this row). Every later step re-reads it.
 * One more writer puts model text there on its own: the LP-fidelity grade (computeLpFidelity, which the late-plan
 * recompute and /observe2 also call). (This branch has no late v6 write: the v6 read reaches the row only through
 * the analysis write.)
 *
 * Built on the seam subject-reaches-analyser.test.js uses: the model boundary and supabase are mocked, the
 * processor's own build-and-persist runs for real. Strings are made up, shaped like the prod samples.
 */

const persisted = [];

jest.mock('../../bot/shared/config/supabase', () => {
  const makeBuilder = () => {
    const builder = {
      select: jest.fn(() => builder),
      update: jest.fn((patch) => { persisted.push(patch); return builder; }),
      eq: jest.fn(() => builder), not: jest.fn(() => builder), is: jest.fn(() => builder),
      gte: jest.fn(() => builder), in: jest.fn(() => builder), order: jest.fn(() => builder), limit: jest.fn(() => builder),
      single: jest.fn(() => Promise.resolve({ data: global.__DEV_SESSION, error: null })),
      maybeSingle: jest.fn(() => Promise.resolve({ data: { users: { preferred_language: 'ur' } }, error: null })),
      then: (resolve) => resolve({ data: null, error: null }),
    };
    return builder;
  };
  return { from: jest.fn(() => makeBuilder()) };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logEvent: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({ PEDAGOGICAL_ANALYSIS_MEDIA_ID: null }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve()), sendSticker: jest.fn(() => Promise.resolve()),
}));

// Shaped like the prod samples: Urdu with one Hindi-script word; a code-switched quote.
const UR_WITH_HINDI_WORD = 'استاد نے گہرے سوچنے کے मौके محدود کیے';
const UR_PREFIX = 'استاد نے گہرے سوچنے کے ';
const MIXED_QUOTE = 'Teacher: "अच्छा, अब बताइए" — بچوں نے جواب دیا';
const CLEAN_UR = 'آپ نے بچوں کو سوچنے کا وقت دیا۔';

const mockAnalyze = jest.fn();
const mockCorpus = jest.fn();
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  analyzePedagogy: (...args) => mockAnalyze(...args),
  extractReflectiveCorpus: (...args) => mockCorpus(...args),
}));
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateStatus: jest.fn(() => Promise.resolve()), markAsFailed: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/report-generator.service', () => ({
  fetchAndCompressPriorFeedback: jest.fn(() => Promise.resolve({ exists: false })),
}));
jest.mock('../../bot/shared/services/coaching/frameworks/framework-selector', () => ({
  selectFrameworkWithReason: jest.fn(() => Promise.resolve({
    framework: { name: 'fico', applyLpFidelity: jest.fn() }, frameworkKey: 'fico', reason: 'default',
  })),
}));
jest.mock('../../bot/shared/config/coaching-messages', () => ({ getCoachingMessage: jest.fn(() => 'msg') }));
jest.mock('../../bot/shared/services/coaching/reflective-conversation.service', () => ({
  conductReflectiveConversation: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueReport: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/observe/observe-draft.service', () => ({
  onAnalysisReady: jest.fn(() => Promise.resolve()),
}));

const { hasDevanagari } = require('../../bot/shared/utils/devanagari-guard');
const AnalysisProcessor = require('../../bot/shared/services/coaching/analysis-processor.service');

const deepHasDevanagari = (v) => hasDevanagari(JSON.stringify(v));
const SID = 'sess-devanagari';
const lastAnalysisData = () => [...persisted].reverse().find((p) => p && p.analysis_data)?.analysis_data;

function session(extra = {}) {
  return {
    id: SID,
    user_id: 'u-1',
    transcript_text: 'transcript',
    transcript_language: 'ur',
    audio_duration_seconds: 960,
    classroom_photos: [],
    users: { name: 'T', phone_number: '92300' },
    ...extra,
  };
}

// The FICO analysis as the model returns it: the paths prod showed Devanagari in.
function modelAnalysis() {
  return {
    framework: 'fico',
    executive_summary: CLEAN_UR,
    topic: 'جمع — जोड़',
    domains: {
      lesson_plan_fidelity: { indicators: [{ id: 'B1', score: 2, evidence: UR_WITH_HINDI_WORD, evidence_summary: MIXED_QUOTE }] },
      high_leverage_practices: { indicators: [{ id: 'C1', score: 3, evidence: CLEAN_UR }] },
    },
    focus_area: { rationale: UR_WITH_HINDI_WORD, try_this_tomorrow: MIXED_QUOTE },
    strengths: [{ title: CLEAN_UR, evidence: MIXED_QUOTE }],
    notable_moments: [{ at: '03:12', what_happened: UR_WITH_HINDI_WORD }],
    recommendations: [UR_WITH_HINDI_WORD],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  persisted.length = 0;
  mockAnalyze.mockImplementation(() => Promise.resolve({
    analysis: modelAnalysis(),
    usage: { input_tokens: 1, output_tokens: 1, cached_tokens: 0, cost: 0 },
  }));
  mockCorpus.mockImplementation(() => Promise.resolve({
    corpus: {
      lesson_throughline_en: 'The class counted objects.',
      significant_moments: [{ at: '05:40', what_happened: MIXED_QUOTE, significance_reason_en: UR_WITH_HINDI_WORD }],
      recurring_signals: [{ signal: UR_WITH_HINDI_WORD }],
    },
    model_used: 'm',
  }));
});

describe('analysis-processor: the stored analysis_data', () => {
  test.each([
    ['a teacher DC session', {}],
    ['a coach observation (its review form is pre-filled from this row)', { observation_type: 'leader_observation', observer_user_id: 'coach-1' }],
  ])('%s: no Devanagari anywhere in what is written', async (_label, extra) => {
    global.__DEV_SESSION = session(extra);
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    const stored = lastAnalysisData();
    expect(stored).toBeTruthy();
    expect(deepHasDevanagari(stored)).toBe(false);
  });

  test('the Urdu and English around the word are kept, and the clean fields are exactly what the model wrote', async () => {
    global.__DEV_SESSION = session();
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    const stored = lastAnalysisData();
    expect(stored.domains.lesson_plan_fidelity.indicators[0].evidence.startsWith(UR_PREFIX)).toBe(true);
    expect(stored.domains.lesson_plan_fidelity.indicators[0].score).toBe(2);
    expect(stored.domains.high_leverage_practices.indicators[0].evidence).toBe(CLEAN_UR);
    expect(stored.executive_summary).toBe(CLEAN_UR);
    expect(stored.strengths[0].title).toBe(CLEAN_UR);
    expect(stored.reflective_corpus.lesson_throughline_en).toBe('The class counted objects.');
    expect(stored.reflective_corpus.significant_moments[0].at).toBe('05:40');
    expect(stored.subject_resolution).toBeTruthy();
  });

  test('the reflective corpus (the reflective questions are built from it) is stored clean', async () => {
    global.__DEV_SESSION = session();
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    expect(deepHasDevanagari(lastAnalysisData().reflective_corpus)).toBe(false);
  });
});

describe('LP fidelity: computeLpFidelity returns its blob clean (main analysis, late-plan recompute, /observe2)', () => {
  test('a move list and grade with Devanagari come back with none', async () => {
    const { computeLpFidelity } = require('../../bot/shared/services/coaching/fidelity/fidelity-orchestrator');
    const out = await computeLpFidelity(
      { transcript: 'no stamps here', corpusKey: { lesson_id: 'lesson-1' }, runs: 1 },
      {
        resolveMoveList: async () => ({ lesson_id: 'lesson-1', template: 'T', moves: [{ move_id: 'm1', text: UR_WITH_HINDI_WORD }] }),
        scoreFidelity: (moves, verdicts) => ({
          fidelity_pct: null,
          moves: moves.map((m, i) => ({ ...m, verdict: verdicts[i].verdict, evidence: MIXED_QUOTE })),
        }),
      },
    );
    expect(out.status).toBe('ok');
    expect(deepHasDevanagari(out)).toBe(false);
    expect(out.moves[0].text.startsWith(UR_PREFIX)).toBe(true);
    expect(out.moves[0].move_id).toBe('m1');
  });

  test('a status-only blob is unchanged', async () => {
    const { computeLpFidelity } = require('../../bot/shared/services/coaching/fidelity/fidelity-orchestrator');
    expect(await computeLpFidelity({ transcript: 't' }, { resolveMoveList: async () => null })).toEqual({ status: 'lp_absent' });
  });
});
