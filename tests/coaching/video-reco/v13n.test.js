'use strict';
/**
 * bd-8hhqhf (VIDREC round 7, red7 091238): #3587 validates a label-bearing quote as a line but STORED it with the label,
 * and /v shows moment_quote verbatim: «Teacher (UR): سب سیٹ کسے کہتے ہیں؟» (70f7c682), «"چلو مل کر... گائیڈ نوٹ تیار
 * کرتے ہیں." (15:29)» (0a69a5c4). The stored quote drops a leading stamp / speaker label, a trailing "(mm:ss)", one
 * wrapping pair of quote marks; it stays a verbatim stretch of the line (placeholders kept as the redactor wrote them).
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

function args(lines, evidence = 'x') {
  return {
    session: { id: SID, user_id: UID, transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: 'ur' }, diarization_data: { segments: lines } },
    analysis: {
      framework: 'fico',
      domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence, evidence_summary: 'x', timestamp: '[00:40]' }] } },
      subject_resolution: { code: 'urdu', grade: '3', confidence: 'high' },
    },
    nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'Few open questions', try: 'Ask two why questions' } },
    loop: { state: { angle: 'show' } },
    card: { indicator: 'C1', action: 'Ask two why questions about sets' },
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
const pick = (quote, at = '00:40') => ({
  seg_id: '10-s1', moment: { at, quote },
  reason_en: 'The class could not say what a set is. The clip shows a teacher asking why and how instead.',
  reason_ur: 'کلاس سیٹ کی تعریف نہ بتا سکی؛ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔', confidence: 0.6,
});

test('70f7c682: the label leaves the stored moment_quote (today: «Teacher (UR): سب سیٹ کسے کہتے ہیں؟»)', async () => {
  const lines = [{ start_ms: 40000, label: 'Teacher (UR)', text: 'سب سیٹ کسے کہتے ہیں؟' }];
  const row = await E.recommendForReport({ ...args(lines), deps: deps([pick('Teacher (UR): سب سیٹ کسے کہتے ہیں؟')]) });
  expect(row).toMatchObject({ status: 'shown', moment_source: 'transcript', moment_quote: 'سب سیٹ کسے کہتے ہیں؟' });
});

test('0a69a5c4: a trailing "(15:29)" and the wrapping quote marks leave the stored scorer quote', async () => {
  const LINE = 'چلو مل کر... گائیڈ نوٹ تیار کرتے ہیں.';
  const lines = [{ start_ms: 929000, label: 'Teacher', text: LINE }, { start_ms: 40000, label: 'Teacher', text: 'سب بیٹھ جائیں' }];
  const q = `"${LINE}" (15:29)`;
  const row = await E.recommendForReport({ ...args(lines, `Planning together. Quote: ${q}`), deps: deps([pick(q, '15:29')]) });
  expect(row.status).toBe('shown');
  expect(row.moment_quote).toBe(LINE);
});

test.each([
  ['[06:56] Teacher: [a student] ناؤن کو لکھنا ہے۔', '[a student] ناؤن کو لکھنا ہے۔'],
  ['[12:10] Student (UR): [a student]، آپ بتائیں۔', '[a student]، آپ بتائیں۔'],
  ['[00:05] ... آپ نے میرے ساتھ دہرانا ہے.', '... آپ نے میرے ساتھ دہرانا ہے.'],
  ['teacher: "All kids mark it."', 'All kids mark it.'],
  ['Students, today is Monday, and today is reading day.', 'Students, today is Monday, and today is reading day.'],
])('storedQuote: %s', (q, want) => {
  expect(S.storedQuote(q)).toBe(want);
});

describe('red7 093352: the storage strip only takes a real speaker label, never text before a colon', () => {
  test.each([
    ['[00:05] اب سوال یہ ہے: کیا کریں گے؟', 'اب سوال یہ ہے: کیا کریں گے؟'],
    ['[00:05] Rule one: open your books, page 77.', 'Rule one: open your books, page 77.'],
    ['ٹیچر: آج ہم کہانی پڑھیں گے', 'آج ہم کہانی پڑھیں گے'],
    ['[03:10] استاد (UR): سب کتاب کھولیں', 'سب کتاب کھولیں'],
    ['[1:02:03] Teacher: open the book', 'open the book'],
  ])('storedQuote: %s', (q, want) => {
    expect(S.storedQuote(q)).toBe(want);
  });
});

