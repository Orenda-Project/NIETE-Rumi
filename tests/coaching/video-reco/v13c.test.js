'use strict';
/**
 * bd-gzfdu9 — SPEC v1.3c §3.5 (lead-review 20:33Z): (a) ⛔9 post-redaction of reason_en / reason_ur / moment.quote
 * after validation; (b) the card-sentence fallback when the retry also fails on a validation rule
 * (moment_source 'card', no quote, no LLM call).
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

function args(extra = {}, card = { indicator: 'C1', action: 'Ask two why questions about shapes' }, lang = 'ur') {
  return {
    session: {
      id: SID, user_id: UID, transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: lang },
      diarization_data: { segments: [
        { start_ms: 30000, label: 'Teacher', text: 'Ahmed, tum batao: is this a triangle? Yes or no, quickly!' },
        { start_ms: 45000, label: 'Student', text: 'Yes' },
      ] },
    },
    analysis: {
      framework: 'fico',
      domains: { C: { indicators: [
        { id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed questions. Quote: "Is this a triangle? Yes or no"', evidence_summary: 'Only yes/no questions', timestamp: '[00:40]' },
        { id: 'C2', name: 'Re-explanation', score: 0, applicable: true, evidence: 'none', evidence_summary: '', timestamp: '[01:00]' },
      ] } },
      subject_resolution: { code: 'urdu', grade: '3', confidence: 'high' },
      topic: 'shapes',
    },
    nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'Few open questions', try: 'Ask two why questions' } },
    loop: { state: { angle: 'show' } },
    card,
    coachingSessionId: SID,
    ...extra,
  };
}
const GOOD = {
  seg_id: '10-s1', moment: { at: '00:30', quote: '[a student], tum batao: is this a triangle? Yes or no' },
  reason_en: 'At 00:30 the class could only answer yes or no. This clip shows a teacher asking why and how instead.',
  reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔', confidence: 0.7,
};
const ROMAN = { ...GOOD, reason_ur: 'کلاس agli dafa yeh karo اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔', confidence: 0.55 }; // validation:roman
const OFF_LIST = { ...GOOD, seg_id: '99-s9' }; // validation:candidate
function deps(answers) {
  const written = [];
  const completeJson = jest.fn();
  answers.forEach((a) => completeJson.mockResolvedValueOnce(a === 'length'
    ? { result: {}, usage: {}, finishReason: 'length' }
    : { result: a, usage: { prompt_tokens: 900, completion_tokens: 100 }, finishReason: 'stop' }));
  return {
    written,
    env: { VIDEO_RECO_ENABLED: 'true' },
    catalog: require('../../../bot/shared/services/coaching/video-reco/catalog').fromData(FIXTURE),
    store: {
      readForSession: jest.fn().mockResolvedValue(null),
      recentHistory: jest.fn().mockResolvedValue({ segments: [], modules: [] }),
      ladderProgress: jest.fn().mockResolvedValue({ level: 2, completedModules: [] }),
      trainingBands: jest.fn().mockResolvedValue([]),
      write: jest.fn(async (row) => { written.push(row); return { id: 'rec-1', ...row }; }),
    },
    v10GroupFor: jest.fn().mockResolvedValue({ group: 'C' }),
    completeJson,
  };
}
const FALLBACK_EN = (s, n) => `Your report asks you to try: "${s}". This ${n}-second clip shows one way to do it.`;
const FALLBACK_UR = (s, n) => `آپ کی رپورٹ کہتی ہے کہ یہ آزمائیں: "${s}"۔ یہ ${n} سیکنڈ کا کلپ اس کا ایک طریقہ دکھاتا ہے۔`;

describe('(a) ⛔9 post-redaction: the stored reason and quote are the redacted ones', () => {
  test('a lexicon child name in reason_en, reason_ur and the quote is stored as [a student]', async () => {
    const named = {
      ...GOOD,
      moment: { at: '00:30', quote: 'Ahmed, tum batao: is this a triangle? Yes or no' },
      reason_en: 'At 00:30 Ahmed could only answer yes or no. This clip shows a teacher asking why and how instead.',
      reason_ur: 'علی صرف ہاں یا نہیں میں جواب دے سکا؛ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔',
    };
    const d = deps([named]);
    const row = await E.recommendForReport({ ...args(), deps: d });
    expect(row).toMatchObject({ status: 'shown', seg_id: '10-s1', moment_source: 'transcript' });
    expect(row.reason_en).toBe('At 00:30 [a student] could only answer yes or no. This clip shows a teacher asking why and how instead.');
    expect(row.reason_ur).toBe('[a student] صرف ہاں یا نہیں میں جواب دے سکا؛ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔');
    expect(row.moment_quote).toBe('[a student], tum batao: is this a triangle? Yes or no');
    expect(JSON.stringify(d.written)).not.toMatch(/Ahmed|علی/);
  });

  test('a reason with no name is byte-identical', async () => {
    const d = deps([GOOD]);
    const row = await E.recommendForReport({ ...args(), deps: d });
    expect(row.reason_en).toBe(GOOD.reason_en);
    expect(row.reason_ur).toBe(GOOD.reason_ur);
    expect(row.moment_quote).toBe(GOOD.moment.quote);
  });

  test('the post-redaction is the NON-strict one: ordinary capitalised English words survive', async () => {
    const plain = { ...GOOD, reason_en: 'At 00:30 the class answered only Yes or No. This clip shows Think-Pair-Share instead of chorus answers.' };
    const row = await E.recommendForReport({ ...args(), deps: deps([plain]) });
    expect(row.reason_en).toBe(plain.reason_en);
  });
});

describe('(b) the card-sentence fallback', () => {
  test('retry fails on validation:roman with a candidate seg_id → shown with the fallback reason, no quote, no third call', async () => {
    const d = deps([ROMAN, ROMAN]);
    const row = await E.recommendForReport({ ...args(), deps: d });
    expect(d.completeJson).toHaveBeenCalledTimes(2);
    expect(row).toMatchObject({
      status: 'shown', seg_id: '10-s1', module_id: 10, start_s: 30, end_s: 120,
      moment_at: null, moment_quote: null, moment_source: 'card', none_reason: null,
      attempts: 2, first_none_reason: 'validation:roman', confidence: 0.55,
    });
    expect(row.reason_en).toBe(FALLBACK_EN('Ask two why questions about shapes', 90));
    expect(row.reason_ur).toBe(FALLBACK_UR('Ask two why questions about shapes', 90));
  });

  test('a first-attempt pick that passes keeps moment_source transcript (the fallback never touches it)', async () => {
    const row = await E.recommendForReport({ ...args(), deps: deps([GOOD]) });
    expect(row.moment_source).toBe('transcript');
  });

  test('the retry says none (llm_none) → the none is unchanged', async () => {
    const row = await E.recommendForReport({ ...args(), deps: deps([ROMAN, { ...GOOD, seg_id: null }]) });
    expect(row).toMatchObject({ status: 'none', none_reason: 'llm_none', seg_id: null });
  });

  test('the retry is truncated → the none is unchanged', async () => {
    const row = await E.recommendForReport({ ...args(), deps: deps([ROMAN, 'length']) });
    expect(row).toMatchObject({ status: 'none', none_reason: 'llm_truncated', seg_id: null });
  });

  test('a seg_id outside the candidates → the none is unchanged', async () => {
    const row = await E.recommendForReport({ ...args(), deps: deps([ROMAN, OFF_LIST]) });
    expect(row).toMatchObject({ status: 'none', none_reason: 'validation:candidate', seg_id: null });
  });

  test('a 280-code-point sentence → the composed Urdu reason is over 300, the none stands', async () => {
    const long = 'ب'.repeat(280);
    const row = await E.recommendForReport({ ...args({}, { indicator: 'C1', action: long }), deps: deps([ROMAN, ROMAN]) });
    expect(row).toMatchObject({ status: 'none', none_reason: 'validation:roman', seg_id: null });
  });

  test('the length cap is on the TEACHER\'s language: an en teacher with a sentence that fits in en gets the clip', async () => {
    const s = 'a'.repeat(220); // en template + 220 = 293 ≤ 300; the ur one would be 302
    expect([...FALLBACK_EN(s, 90)].length).toBeLessThanOrEqual(300);
    expect([...FALLBACK_UR(s, 90)].length).toBeGreaterThan(300);
    const row = await E.recommendForReport({ ...args({}, { indicator: 'C1', action: s }, 'en'), deps: deps([ROMAN, ROMAN]) });
    expect(row).toMatchObject({ status: 'shown', moment_source: 'card', reason_en: FALLBACK_EN(s, 90) });
  });

  test('no retry ran (engine budget under 20 s) → the first none stands: the fallback follows a FAILED retry only', async () => {
    const row = await E.recommendForReport({ ...args(), timeoutMs: 19000, deps: deps([ROMAN]) });
    expect(row).toMatchObject({ status: 'none', none_reason: 'validation:roman', attempts: 1 });
  });

  test('an empty sentence (no card action, no step try, no try_this_tomorrow) → the none stands', async () => {
    const a = args({}, { indicator: 'C1', action: '' });
    a.nextStep.target.try = '';
    const row = await E.recommendForReport({ ...a, deps: deps([ROMAN, ROMAN]) });
    expect(row).toMatchObject({ status: 'none', none_reason: 'validation:roman' });
  });

  test('the card action opening with the teacher\'s name: the address is dropped, no name and no [TEACHER] is stored', async () => {
    const row = await E.recommendForReport({ ...args({}, { indicator: 'C1', action: 'Saima Khan، کل دو کیوں والے سوال پوچھیں' }), deps: deps([ROMAN, ROMAN]) });
    expect(row).toMatchObject({ status: 'shown', moment_source: 'card' });
    expect(row.reason_ur).toBe(FALLBACK_UR('کل دو کیوں والے سوال پوچھیں', 90));
    expect(JSON.stringify(row)).not.toMatch(/Saima|\[TEACHER\]/);
  });

  test('a child\'s name inside the card sentence is [a student] in the stored fallback', async () => {
    const row = await E.recommendForReport({ ...args({}, { indicator: 'C1', action: 'Ask Ahmed two why questions' }), deps: deps([ROMAN, ROMAN]) });
    expect(row.reason_en).toBe(FALLBACK_EN('Ask [a student] two why questions', 90));
  });

  test('control arm: the fallback row is stored as shadow, like any other pick', async () => {
    const d = deps([ROMAN, ROMAN]);
    d.env = { VIDEO_RECO_ENABLED: 'true', VIDEO_RECO_MODE: 'shadow' };
    expect(await E.recommendForReport({ ...args(), deps: d })).toMatchObject({ status: 'shadow', moment_source: 'card' });
  });
});

describe('select.cardFallback (pure): which validation rules it follows', () => {
  const list = { candidates: [{ seg_id: '10-s1', indicator: 'C1' }] };
  const base = { segId: '10-s1', shortlist: list, sentence: 'Ask two why questions', startS: 30, endS: 120, language: 'en' };
  test.each(['validation:roman', 'validation:quote', 'validation:urdu', 'validation:length', 'validation:scorer', 'validation:id',
    'validation:name', 'validation:placeholder', 'validation:moment_at'])('%s → a fallback', (none) => {
    expect(S.cardFallback({ ...base, none })).toEqual({
      reason_en: FALLBACK_EN('Ask two why questions', 90), reason_ur: FALLBACK_UR('Ask two why questions', 90),
    });
  });
  test.each(['llm_none', 'llm_truncated', 'no_moments', 'error:Timeout', 'validation:candidate', 'validation:shape',
    'validation:step', 'validation:error'])('%s → null (a code gate failed, or no pick)', (none) => {
    expect(S.cardFallback({ ...base, none })).toBeNull();
  });
  test('N is round(end − start)', () => {
    expect(S.cardFallback({ ...base, none: 'validation:quote', startS: 10.4, endS: 55.9 }).reason_en).toContain('This 46-second clip');
  });
  test('a sentence that is only placeholders after redaction → null', () => {
    expect(S.cardFallback({ ...base, none: 'validation:quote', sentence: '[TEACHER]،  ' })).toBeNull();
  });
  test('a coach / school / phone placeholder left in the sentence → null (never shown to the teacher)', () => {
    expect(S.cardFallback({ ...base, none: 'validation:quote', sentence: 'Call [NUMBER] tomorrow' })).toBeNull();
    expect(S.cardFallback({ ...base, none: 'validation:quote', sentence: 'Ask [COACH] for help' })).toBeNull();
  });
});
