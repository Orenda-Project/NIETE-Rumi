'use strict';
/**
 * bd-8hhqhf (VIDREC round 7, scale-run 081240): 26 shown clips on the 3,000-lesson run quoted the SCORER's own
 * commentary as "the moment from your lesson"; 4 came from lessons whose transcript is empty ("No transcript recorded.").
 * #3587 already requires a scorer-path quote to be a transcript line; this closes the rest:
 *  - an empty transcript → none 'no_moments' before any LLM call (nothing can be a moment);
 *  - a transcript with no [mm:ss] lines is still checked, line by line (it was treated as "nothing to check").
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');

let E;
const SID = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';

beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase in these tests'); }) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
});

function args(session, quote) {
  return {
    session: { id: SID, user_id: UID, transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: 'ur' }, ...session },
    analysis: {
      framework: 'fico',
      domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: `Teacher-led. Quote: "${quote}"`, evidence_summary: 'x', timestamp: '[00:00]' }] } },
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
const pick = (quote) => ({
  seg_id: '10-s1', moment: { at: '00:00', quote },
  reason_en: 'The class answered only yes or no. This clip shows a teacher asking why and how instead.',
  reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔', confidence: 0.6,
});

test('an empty transcript and a scorer "Quote:" of meta-text → none no_moments, no LLM call (today: the call runs and the meta quote is shown)', async () => {
  const META = 'No transcript recorded for this lesson at all';
  const d = deps([pick(META), pick(META)]);
  const row = await E.recommendForReport({ ...args({ transcript_text: '', diarization_data: { segments: [] } }, META), deps: d });
  expect(row).toMatchObject({ status: 'none', none_reason: 'no_moments' });
  expect(d.completeJson).not.toHaveBeenCalled();
});

test('a transcript with no [mm:ss] lines: a scorer meta quote is refused (validation:quote)', async () => {
  const META = 'entire transcript shows no instruction for independent student tasks';
  const text = 'آج ہم کہانی پڑھیں گے۔\nسب کتاب کھولیں اور پہلا صفحہ دیکھیں۔';
  const d = deps([pick(META), pick(META)]);
  const row = await E.recommendForReport({ ...args({ transcript_text: text }, META), deps: d });
  expect(row.moment_source).not.toBe('scorer');
  expect(row.first_none_reason).toBe('validation:quote');
});

test('a transcript with no [mm:ss] lines: a scorer quote that IS a line still passes as scorer (guard)', async () => {
  const LINE = 'بتائیں کہ کہانی میں لومڑی نے کیا کیا'; // R7c: a book call is no moment
  const text = `آج ہم کہانی پڑھیں گے۔\n${LINE}۔`;
  const d = deps([pick(LINE)]);
  const row = await E.recommendForReport({ ...args({ transcript_text: text }, LINE), deps: d });
  expect(row).toMatchObject({ status: 'shown', moment_source: 'scorer' });
});
