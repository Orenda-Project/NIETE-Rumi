'use strict';
/**
 * bd-8hhqhf (VIDREC round 7, scale-run 084820): with the copied "[mm:ss] Teacher:" prefix dropped (#3593), a reason the
 * model opened with the quote «[a student]، پہلی پکچر میں …» now OPENS with a placeholder — the child's name masked as
 * a vocative, the [v1.3c-5] shape. At composition a leading vocative placeholder ("[a student]،" / "," / ":", inside an
 * opening quote mark or not) is dropped; the quote stays a verbatim stretch of the line. A placeholder that is the
 * sentence's subject ("[a student] reads …") is not an address and stays.
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');

let E;
let C;
const SID = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';
const FSI = '⁨';
const PDI = '⁩';

beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase in these tests'); }) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
  C = require('../../../bot/shared/services/coaching/video-reco/copy');
});

// 26435821 (scale-run r7, head 3efb5017cb, 156-s2): the model's own reason and moment.
const LINE = 'ثنا، پہلی پکچر میں کیا کر رہے ہیں؟';
const A = {
  seg_id: '10-s1', moment: { at: '03:12', quote: '[a student]، پہلی پکچر میں کیا کر رہے ہیں؟' },
  reason_en: '[a student]، پہلی پکچر میں کیا کر رہے ہیں؟ The clip shows the teacher preparing an easier spoken-sentence task and a challenge paragraph task so students can choose the version that matches their level.',
  reason_ur: '[a student]، پہلی پکچر میں کیا کر رہے ہیں؟ یہ کلپ دکھاتا ہے کہ استاد ایک آسان زبانی جملے کا کام اور ایک مشکل پیراگراف کا کام تیار کرتے ہیں تاکہ بچے اپنی سطح کے مطابق کام چن سکیں۔',
  confidence: 0.6,
};
function args() {
  return {
    session: { id: SID, user_id: UID, transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: 'ur' }, diarization_data: { segments: [{ start_ms: 192000, label: 'Teacher', text: LINE }] } },
    analysis: {
      framework: 'fico',
      domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'x', evidence_summary: 'x', timestamp: '[03:12]' }] } },
      subject_resolution: { code: 'urdu', grade: '3', confidence: 'high' },
    },
    nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'Few open questions', try: 'Ask two why questions' } },
    loop: { state: { angle: 'show' } },
    card: { indicator: 'C1', action: 'Ask two why questions about the picture' },
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

test('26435821: neither stored reason opens with "[a student]"; the rest of the line is kept (today: both open with it)', async () => {
  const row = await E.recommendForReport({ ...args(), deps: deps([A]) });
  expect(row.status).toBe('shown');
  expect(row.reason_en.startsWith(`${FSI}پہلی پکچر میں کیا کر رہے ہیں؟${PDI} The clip shows`)).toBe(true);
  expect(row.reason_ur.startsWith('پہلی پکچر میں کیا کر رہے ہیں؟ یہ کلپ')).toBe(true);
});

test.each([
  ['"[a student]، سب سنیں" The clip shows wait time.', `"${FSI}سب سنیں${PDI}" The clip shows wait time.`],
  ['[a student], read the next line. The clip shows pair reading.', 'read the next line. The clip shows pair reading.'],
  // red7 085645: two vocatives in a row, and a vocative before a copied stamp
  ['[a student]، [a student]، آپ دونوں پڑھیں۔ The clip shows turns.', `${FSI}آپ دونوں پڑھیں۔${PDI} The clip shows turns.`],
  ['[a student]، [00:12] آپ پڑھیں۔ The clip shows turns.', `${FSI}آپ پڑھیں۔${PDI} The clip shows turns.`],
])('a leading vocative placeholder goes: %s', (raw, want) => {
  expect(C.composeReason(raw, 'en')).toBe(want);
});

test('a placeholder that is the subject, or that sits mid-reason, stays', () => {
  expect(C.composeReason('[a student] reads the question aloud first. The clip shows wait time.', 'en')).toBe('[a student] reads the question aloud first. The clip shows wait time.');
  expect(C.composeReason('The class waited while [a student]، read it. The clip shows wait time.', 'en')).toContain('[a student]');
});

describe('red7 085115 finding 1: an unshowable placeholder in an LLM reason or quote is refused', () => {
  const S = () => require('../../../bot/shared/services/coaching/video-reco/select');
  const list = { candidates: [{ seg_id: '10-s1', indicator: 'C1' }] };
  const ex = ['[00:30] Teacher: [TEACHER], class, open your books and read the first line'];
  const pick = (over) => ({
    seg_id: '10-s1', moment: { at: '00:30', quote: 'class, open your books and read the first line' },
    reason_en: 'The class waited for one instruction. The clip shows a teacher giving a clear first step.',
    reason_ur: 'کلاس ایک ہدایت کا انتظار کرتی رہی؛ اس کلپ میں استاد ایک واضح پہلا قدم دیتے ہیں۔', confidence: 0.6, ...over,
  });

  test('fa7fa5c9 shape: «[TEACHER], class, open your books…» in reason_en → validation:placeholder (today: ok)', () => {
    const p = pick({ reason_en: "The teacher said '[TEACHER], class, open your books' and waited. The clip shows a teacher giving a clear first step." });
    expect(S().validate(p, list, ex, {}).none).toBe('validation:placeholder');
  });

  test('[TEACHER] in the quote → validation:placeholder', () => {
    expect(S().validate(pick({ moment: { at: '00:30', quote: '[TEACHER], class, open your books and read' } }), list, ex, {}).none).toBe('validation:placeholder');
  });

  test('a reason with only [a student] placeholders is not refused by this rule', () => {
    expect(S().validate(pick({ reason_en: 'The class waited while [a student] read. The clip shows a teacher giving a clear first step.' }), list, ex, {}).ok).toBe(true);
  });
});

