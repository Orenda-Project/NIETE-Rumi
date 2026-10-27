'use strict';
/**
 * bd-8hhqhf (VIDREC round 7, red7 074501 / 074627, COS 074519): two quote-validation gaps found on scale-run's real rows.
 *  1. A bare speaker label ("Student (UR):", "teacher:", optionally followed by an opening quote mark) counted as words:
 *     28403c82 stored the one-word moment «Student (UR): بلی». The label is stripped before the word count, and a quote
 *     with fewer than 3 real words is validation:placeholder whether or not it was found.
 *  2. A scorer-path quote must appear in the full transcript: 5e0b2032 stored the scorer's summary sentence and
 *     7a2cc41e a quote plus the model's own commentary, both accepted because they matched the scorer's "Quote:" text.
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');

let E;
let S;
const SID = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';

beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase in these tests'); }) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
  S = require('../../../bot/shared/services/coaching/video-reco/select');
});

const list = { candidates: [{ seg_id: '10-s1', indicator: 'C1' }] };
const pick = (quote, at = '00:29') => ({
  seg_id: '10-s1', moment: { at, quote },
  reason_en: 'At 00:29 the class gave one-word answers only. This clip shows a teacher asking why and how instead.',
  reason_ur: 'کلاس نے صرف ایک لفظ میں جواب دیا؛ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔', confidence: 0.6,
});

describe('1 · a bare speaker label is not words', () => {
  test('28403c82: «Student (UR): بلی» against its own line → validation:placeholder (today: ok)', () => {
    expect(S.validate(pick('Student (UR): بلی'), list, ['[00:29] Student (UR): بلی'], {}).none).toBe('validation:placeholder');
  });

  test.each([
    ['Teacher:', 'Teacher: یہ کہانی ہمیں کیا سکھاتی ہے'],
    ['teacher: "…" (lower case, opening quote mark)', 'teacher: "یہ کہانی ہمیں کیا سکھاتی ہے"'],
    ['Teacher (EN):', 'Teacher (EN): what does the story teach us'],
  ])('%s is stripped and a real line still passes', (_, quote) => {
    // R7c: «آج ہم کہانی پڑھیں گے» announces the lesson (not_moment), so the line is a question
    const line = `[00:29] Teacher (UR): یہ کہانی ہمیں کیا سکھاتی ہے، what does the story teach us`;
    expect(S.validate(pick(quote), list, [line, '[00:31] Student (UR): جی۔'], {}).ok).toBe(true);
  });

  test('a two-word quote that is not in the transcript is placeholder (too short to be a moment), not quote', () => {
    expect(S.validate(pick('بالکل ٹھیک'), list, ['[00:29] Teacher (UR): آج ہم کہانی پڑھیں گے'], {}).none).toBe('validation:placeholder');
  });
});

describe('2 · a scorer-path quote must appear in the full transcript (engine)', () => {
  function args(evidence, lines) {
    return {
      session: { id: SID, user_id: UID, transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: 'ur' }, diarization_data: { segments: lines } },
      analysis: {
        framework: 'fico',
        domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence, evidence_summary: 'x', timestamp: '[04:24]' }] } },
        subject_resolution: { code: 'urdu', grade: '3', confidence: 'high' },
      },
      nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'Few open questions', try: 'Ask two why questions' } },
      loop: { state: { angle: 'show' } },
      card: { indicator: 'C1', action: 'Ask two why questions about the story' },
      coachingSessionId: SID,
    };
  }
  function deps(answers) {
    const completeJson = jest.fn();
    answers.forEach((a) => completeJson.mockResolvedValueOnce({ result: a, usage: { prompt_tokens: 900, completion_tokens: 100 }, finishReason: 'stop' }));
    return {
      env: { VIDEO_RECO_ENABLED: 'true' },
      catalog: require('../../../bot/shared/services/coaching/video-reco/catalog').fromData(FIXTURE),
      store: {
        readForSession: jest.fn().mockResolvedValue(null),
        recentHistory: jest.fn().mockResolvedValue({ segments: [], modules: [] }),
        ladderProgress: jest.fn().mockResolvedValue({ level: 2, completedModules: [] }),
        trainingBands: jest.fn().mockResolvedValue([]),
        write: jest.fn(async (row) => ({ id: 'rec-1', ...row })),
      },
      v10GroupFor: jest.fn().mockResolvedValue({ group: 'C' }),
      completeJson,
    };
  }
  const LINES = [
    { start_ms: 264000, label: 'Teacher', text: 'Who can tell me the answer? You, at the back.' },
    { start_ms: 270000, label: 'Teacher', text: 'All kids mark it. Now open page four.' },
    { start_ms: 276000, label: 'Teacher', text: 'Read the first line with me, slowly.' }, // R7l §1a: three teacher turns, a lesson
  ];
  // 5e0b2032: the scorer's "Quote:" is a summary sentence, not a transcript line.
  const SUMMARY = 'entire transcript shows teacher-directed questioning with no pair-share or student discussion prompts';

  test('5e0b2032: a summary quote matched only against the scorer text → validation:quote on both tries (today: shown, moment_source scorer)', async () => {
    const d = deps([pick(SUMMARY, '04:24'), pick(SUMMARY, '04:24')]);
    const row = await E.recommendForReport({ ...args(`Teacher-led. Quote: "${SUMMARY}"`, LINES), deps: d });
    expect(row.moment_source).not.toBe('scorer');
    expect(row.first_none_reason).toBe('validation:quote');
  });

  test('7a2cc41e: a real line plus the model\'s commentary → validation:quote', async () => {
    const q = 'teacher: "All kids mark it." No partner talk is prompted. (00:00-15:00)';
    const d = deps([pick(q, '04:30'), pick(q, '04:30')]);
    const row = await E.recommendForReport({ ...args(`${q} Quote: "${q}"`, LINES), deps: d });
    expect(row.moment_source).not.toBe('scorer');
    expect(row.first_none_reason).toBe('validation:quote');
  });

  test('a scorer quote that IS a transcript line outside the 12-line window still passes as scorer', async () => {
    // the quoted line at 00:01; the window sits around the scorer's [04:24], lines 3–14, so the line is outside it
    const far = Array.from({ length: 30 }, (_, i) => ({ start_ms: 200000 + i * 10000, label: 'Teacher', text: `Line number ${i} about the story and its people` }));
    const lines = [{ start_ms: 1000, label: 'Teacher', text: 'Please read the first paragraph aloud together now' }, { start_ms: 2000, label: 'Student', text: 'جی۔' }, ...far];
    const quote = 'Please read the first paragraph aloud together now';
    const d = deps([pick(quote, '00:01')]);
    const row = await E.recommendForReport({ ...args(`Choral reading. Quote: "${quote}"`, lines), deps: d });
    expect(row).toMatchObject({ status: 'shown', moment_source: 'scorer' });
  });
});
