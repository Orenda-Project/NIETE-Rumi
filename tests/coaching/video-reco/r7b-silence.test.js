'use strict';
/**
 * bd-8hhqhf R7b (COS ruling 20261023T144730 2a; panel ped/REVIEW_r7_scale.md §2, §6.1): the engine stays silent when
 * there is no move to find. Each test is a panel row's shape (anonymised; the words are the row's, the names are not):
 * - P066 / P072 / P076: an F5 "Subject-Specific Pedagogy: MATH" card on an Urdu / Islamiyat / English lesson → no move;
 * - P099 / P096: the B6 template card on a lesson with no mixed-level moment → no move; P011 (a real one) still picks;
 * - P183 / P076: the cited line has no child's turn on it or beside it → not a moment (retry, then the card fallback);
 * - P123 / P161: the card sentence is a diagnosis fragment («Made one thing together») → no card fallback.
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

// The fixture plus one leader-facing B6 chapter (the shape of 156-s2 / 157-s3: the only B6 chapters the ladder has).
function catalog() {
  const data = JSON.parse(JSON.stringify(FIXTURE));
  data.modules.push({
    ...data.modules[0], module_id: 56, title: 'Module 56', video_url: 'https://r2.example/training/56.mp4',
    segments: [{
      seg_id: '56-s2', start_s: 60, end_s: 150, title_en: 'Two versions of one task', title_ur: 'عنوان',
      summary_en: 'A simpler task and a challenge task on the same theme.', moves: ['differentiate_tasks'],
      fico: [{ indicator: 'B6', strength: 2 }], fico_main37: ['B6'], keywords: ['versions', 'simpler', 'challenge', 'levels'], symptoms: [],
    }],
  });
  return require('../../../bot/shared/services/coaching/video-reco/catalog').fromData(data);
}

function deps(answers) {
  const completeJson = jest.fn();
  answers.forEach((a) => completeJson.mockResolvedValueOnce({ result: a, usage: { prompt_tokens: 900, completion_tokens: 100 }, finishReason: 'stop' }));
  return {
    env: { VIDEO_RECO_ENABLED: 'true' },
    catalog: catalog(),
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

const T = (ms, text) => ({ start_ms: ms, label: 'Teacher (UR)', text });
const K = (ms, text) => ({ start_ms: ms, label: 'Student (UR)', text });

function args({ lines, indicator, action, subject = 'urdu', scheme = 'fico_main_37', score = 1 }) {
  return {
    session: { id: SID, user_id: UID, transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: 'ur' }, diarization_data: { segments: lines } },
    analysis: {
      framework: 'fico',
      indicator_scheme: scheme,
      domains: { X: { domain_max: 4, indicators: [{ id: indicator, name: indicator, score, applicable: true, evidence: 'x', evidence_summary: 'x', timestamp: '[00:40]' }] } },
      ...(subject ? { subject_resolution: { code: subject, grade: '3', confidence: 'high' } } : {}),
    },
    nextStep: { target: null, fallback: null },
    loop: { state: { angle: 'show' } },
    card: { indicator, action },
    coachingSessionId: SID,
  };
}

const reason = {
  reason_en: 'The class answered in one word. The clip shows a teacher asking why and how instead.',
  reason_ur: 'کلاس نے ایک لفظ میں جواب دیا؛ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔',
  confidence: 0.6,
};
const pick = (seg, quote, at = '00:40') => ({ seg_id: seg, moment: { at, quote }, ...reason });

// ── F-row label off its subject (P066 ⛔4, P072, P076) ───────────────────────────────────────────────────────────────
const F5_CARD = 'اگلی کلاس میں Subject-Specific Pedagogy: MATH کو بہتر بنانے کے لیے پانچ منٹ دیں: why اور how کے سوال پوچھیں۔';
const CLASS = [T(40000, 'یہ لفظ کون پڑھے گا؟ آپ سب بتائیں۔'), K(45000, 'استاد جی، ہم بتائیں گے۔')];

test.each([['urdu'], ['islamiyat'], ['english'], [null]])('P066/P072/P076: an F5 MATH label on a %s lesson → silence:label_subject, no LLM call', async (subject) => {
  const d = deps([pick('10-s1', 'یہ لفظ کون پڑھے گا؟ آپ سب بتائیں۔')]);
  const row = await E.recommendForReport({ ...args({ lines: CLASS, indicator: 'F5', action: F5_CARD, subject }), deps: d });
  expect(row).toMatchObject({ status: 'none', none_reason: 'silence:label_subject', seg_id: null, candidates: [] });
  expect(d.completeJson).not.toHaveBeenCalled();
});

test('an F5 MATH label on a maths lesson still picks', async () => {
  const d = deps([pick('10-s1', 'یہ لفظ کون پڑھے گا؟ آپ سب بتائیں۔')]);
  const row = await E.recommendForReport({ ...args({ lines: CLASS, indicator: 'F5', action: F5_CARD, subject: 'maths' }), deps: d });
  expect(d.completeJson).toHaveBeenCalled();
  expect(row.none_reason).not.toBe('silence:label_subject');
});

// ── B6 with no mixed-level moment (P099, P096) ─────────────────────────────────────────────────────────────────────────
const B6_CARD = 'اگلی activity کے لیے دو versions تیار کریں: ایک آسان version اور ایک challenge version۔ طلبہ کو انتخاب کرنے دیں۔';

test('P099: the B6 template card on a greeting-and-Q&A lesson → silence:no_levels_moment, no LLM call', async () => {
  const lines = [T(0, 'السلام علیکم کلاس، آج ہم نیا سبق شروع کریں گے، کتابیں کھولیں۔'), K(4000, 'وعلیکم السلام۔'),
    T(40000, 'کون بتائے گا کہ ہم تہوار کیوں مناتے ہیں؟ ہاتھ اٹھائیں۔'), K(45000, 'ہمیں خوشی ہوتی ہے۔')];
  const d = deps([pick('56-s2', 'کون بتائے گا کہ ہم تہوار کیوں مناتے ہیں؟')]);
  const row = await E.recommendForReport({ ...args({ lines, indicator: 'B6', action: B6_CARD }), deps: d });
  expect(row).toMatchObject({ status: 'none', none_reason: 'silence:no_levels_moment', seg_id: null, candidates: [] });
  expect(d.completeJson).not.toHaveBeenCalled();
});

test('P011: B6 on a lesson where children are visibly not following still picks', async () => {
  const lines = [T(40000, 'اچھا، اب ان جملوں کو کمانڈ بنائیں۔ سمجھ نہیں آ رہا؟ دوبارہ دیکھیں۔'), K(45000, 'مس، یہ والا مشکل ہے۔')];
  const d = deps([{ ...pick('56-s2', 'اچھا، اب ان جملوں کو کمانڈ بنائیں۔'), reason_en: 'Some children were not following the task. The clip shows a simpler task and a challenge task on one theme.' }]);
  const row = await E.recommendForReport({ ...args({ lines, indicator: 'B6', action: B6_CARD }), deps: d });
  expect(d.completeJson).toHaveBeenCalled();
  expect(row).toMatchObject({ status: 'shown', seg_id: '56-s2' });
});

// ── a moment with no child in it (P183, P076) ──────────────────────────────────────────────────────────────────────────
test('P183: a one-line monologue about tomorrow\'s test is no moment → retry, then the card\'s own sentence', async () => {
  const lines = [T(53000, 'بچو، آپ نے گھر سے بھی یہی کام کرنا ہے، اور کل جمع کا پیپر ہے، یاد کر کے آنا ہے، ٹھیک ہے؟')];
  const q = 'اور کل جمع کا پیپر ہے، یاد کر کے آنا ہے، ٹھیک ہے؟';
  const d = deps([pick('10-s1', q, '00:53'), pick('10-s1', q, '00:53')]);
  const row = await E.recommendForReport({
    ...args({ lines, indicator: 'C1', action: 'اگلی کلاس میں ہر جواب کے بعد ایک کیوں والا سوال پوچھیں۔', scheme: 'fico_v4' }), deps: d,
  });
  expect(d.completeJson).toHaveBeenCalledTimes(2);
  expect(d.completeJson.mock.calls[1][0]).toContain('validation:no_child_turn');
  expect(row).toMatchObject({ status: 'shown', first_none_reason: 'validation:no_child_turn', moment_source: 'card', moment_quote: null });
});

test('a moment with a child\'s turn beside it stays a transcript moment', async () => {
  const lines = [T(40000, 'یہ لفظ کون پڑھے گا؟ آپ سب بتائیں۔'), K(45000, 'استاد جی، ہم بتائیں گے۔')];
  const d = deps([pick('10-s1', 'یہ لفظ کون پڑھے گا؟ آپ سب بتائیں۔')]);
  const row = await E.recommendForReport({ ...args({ lines, indicator: 'C1', action: 'ہر جواب کے بعد کیوں پوچھیں۔', scheme: 'fico_v4' }), deps: d });
  expect(d.completeJson).toHaveBeenCalledTimes(1);
  expect(row).toMatchObject({ status: 'shown', moment_source: 'transcript' });
});

// ── a card fragment is not a move (P123, P161) ─────────────────────────────────────────────────────────────────────────
test.each([['Made one thing together'], ['ایک ساتھ بیٹھے، اکیلے کام کیا']])('P123/P161: the card «%s» is no fallback → the none stands', async (action) => {
  const bad = pick('10-s1', 'a line that is nowhere in the lesson at all');
  const d = deps([bad, bad]);
  const row = await E.recommendForReport({ ...args({ lines: CLASS, indicator: 'C1', action, scheme: 'fico_v4' }), deps: d });
  expect(row).toMatchObject({ status: 'none', none_reason: 'validation:quote', seg_id: null });
});

test('an imperative card sentence still makes the fallback (en and ur)', async () => {
  const bad = pick('10-s1', 'a line that is nowhere in the lesson at all');
  for (const action of ['Ask two why questions after each answer.', 'ہر جواب کے بعد دو کیوں والے سوال پوچھیں۔']) {
    const d = deps([bad, bad]);
    const row = await E.recommendForReport({ ...args({ lines: CLASS, indicator: 'C1', action, scheme: 'fico_v4' }), deps: d });
    expect(row).toMatchObject({ status: 'shown', moment_source: 'card' });
  }
});
