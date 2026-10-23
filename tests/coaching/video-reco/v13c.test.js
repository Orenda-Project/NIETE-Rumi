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
// bd-8hhqhf: the card sentence sits in an FSI…PDI isolate. R7d: no seconds (the header says minutes); n is unused.
const FALLBACK_EN = (s, n) => `Your report asks you to try: "\u2068${s}\u2069". This clip shows one way to do it.`;
const FALLBACK_UR = (s, n) => `آپ کی رپورٹ کہتی ہے کہ یہ آزمائیں: "\u2068${s}\u2069"۔ یہ کلپ اس کا ایک طریقہ دکھاتا ہے۔`;
// R7b: the STORED reason is composed, and Urdu prose takes Urdu digits, so the clip's seconds read «۹۰»
// R7c §6: an English sentence is not quoted inside the Urdu line of an English reader's message
const PLAIN_UR = (n) => `آپ کی رپورٹ اگلی کلاس کے لیے ایک قدم بتاتی ہے۔ یہ کلپ اسے کرنے کا ایک طریقہ دکھاتا ہے۔`;
const STORED_UR = (s, n) => FALLBACK_UR(s, String(n).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]));

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
    expect(row.reason_en).toBe('At 00:30 [a student] could only answer yes or no. This clip is about: Ask why and how.'); // R7d §6: the clip half is the chapter's title
    expect(row.reason_ur).toBe('[a student] صرف ہاں یا نہیں میں جواب دے سکا۔ یہ کلپ اس بارے میں ہے: عنوان۔');
    expect(row.moment_quote).toBe('[a student], tum batao: is this a triangle? Yes or no');
    expect(JSON.stringify(d.written)).not.toMatch(/Ahmed|علی/);
  });

  test('a reason with no name is byte-identical', async () => {
    const d = deps([GOOD]);
    const row = await E.recommendForReport({ ...args(), deps: d });
    expect(row.reason_en).toBe('At 00:30 the class could only answer yes or no. This clip is about: Ask why and how.'); // R7d §6: the clip half is the chapter's title
    expect(row.reason_ur).toBe('کلاس صرف ہاں یا نہیں میں جواب دے سکی۔ یہ کلپ اس بارے میں ہے: عنوان۔');
    expect(row.moment_quote).toBe(GOOD.moment.quote);
  });

  test('the post-redaction is the NON-strict one: ordinary capitalised English words survive', async () => {
    const plain = { ...GOOD, reason_en: 'At 00:30 the class answered only Yes or No. This clip shows Why and How questions instead of chorus answers.' }; // R7b: a claim the clip backs
    const row = await E.recommendForReport({ ...args(), deps: deps([plain]) });
    expect(row.reason_en).toBe('At 00:30 the class answered only Yes or No. This clip is about: Ask why and how.'); // R7d §6: the clip half is the chapter's title
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
    expect(row.reason_ur).toBe(STORED_UR('Ask two why questions about shapes', 90));
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
    const s = `Ask ${'a'.repeat(224)}`; // en template + 228 = 296 ≤ 300; the ur one would be 302 (R7b: a sentence with a move; R7d: no seconds)
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
    expect(row.reason_ur).toBe(STORED_UR('کل دو کیوں والے سوال پوچھیں', 90));
    expect(JSON.stringify(row)).not.toMatch(/Saima|\[TEACHER\]/);
  });

  test('a child\'s name inside the card sentence: no fallback (R7c ⛔9, was: shown as [a student])', async () => {
    const row = await E.recommendForReport({ ...args({}, { indicator: 'C1', action: 'Ask Ahmed two why questions' }), deps: deps([ROMAN, ROMAN]) });
    expect(row).toMatchObject({ status: 'none', none_reason: 'validation:roman' });
  });

  test('control arm: the fallback row is stored as shadow, like any other pick', async () => {
    const d = deps([ROMAN, ROMAN]);
    d.env = { VIDEO_RECO_ENABLED: 'true', VIDEO_RECO_MODE: 'shadow' };
    expect(await E.recommendForReport({ ...args(), deps: d })).toMatchObject({ status: 'shadow', moment_source: 'card' });
  });
});

describe('select.cardFallback (pure): which validation rules it follows', () => {
  const list = { candidates: [{ seg_id: '10-s1', indicator: 'C1' }] };
  const base = { segId: '10-s1', shortlist: list, sentence: 'Ask two why questions', startS: 30, endS: 120, language: 'en', module: { subjects: ['general'] }, subject: null };
  test.each(['validation:roman', 'validation:quote', 'validation:urdu', 'validation:length', 'validation:scorer', 'validation:id',
    'validation:name', 'validation:placeholder', 'validation:moment_at'])('%s → a fallback', (none) => {
    expect(S.cardFallback({ ...base, none })).toEqual({
      reason_en: FALLBACK_EN('Ask two why questions', 90), reason_ur: PLAIN_UR(90),
    });
  });
  test.each(['llm_none', 'llm_truncated', 'no_moments', 'error:Timeout', 'validation:candidate', 'validation:shape',
    'validation:step', 'validation:error'])('%s → null (a code gate failed, or no pick)', (none) => {
    expect(S.cardFallback({ ...base, none })).toBeNull();
  });
  test('R7d: the line names no seconds, whatever the clip length (the header and button say minutes)', () => {
    expect(S.cardFallback({ ...base, none: 'validation:quote', startS: 10.4, endS: 55.9 }).reason_en).toContain('This clip shows one way to do it.');
  });
  test('a sentence that is only placeholders after redaction → null', () => {
    expect(S.cardFallback({ ...base, none: 'validation:quote', sentence: '[TEACHER]،  ' })).toBeNull();
  });
  test('a coach / school / phone placeholder left in the sentence → null (never shown to the teacher)', () => {
    expect(S.cardFallback({ ...base, none: 'validation:quote', sentence: 'Call [NUMBER] tomorrow' })).toBeNull();
    expect(S.cardFallback({ ...base, none: 'validation:quote', sentence: 'Ask [COACH] for help' })).toBeNull();
  });
});

describe('[v1.3c-2] the fallback carries its own subject gate (ped-review 20:45Z ⛔4, lead-review 20:48Z / 20:51Z)', () => {
  // m108 / m39 as in contracts/catalog.json: literacy modules whose not_for names maths and science.
  const M108 = { module_id: 108, subjects: ['english', 'literacy'], not_for: 'Teachers of maths or science, or of older classes' };
  const M39 = { module_id: 39, subjects: ['urdu', 'english', 'literacy'], not_for: 'Maths or science teachers, and teachers wanting to see a real classroom' };
  const GENERAL = { module_id: 10, subjects: ['general'], not_for: '' };
  const list = { candidates: [{ seg_id: '10-s1', indicator: 'C1' }] };
  const base = { none: 'validation:roman', segId: '10-s1', shortlist: list, sentence: 'Ask two why questions', startS: 30, endS: 120, language: 'en' };
  test('literacy-module clip (m108) + science lesson → the none stands', () => {
    expect(S.cardFallback({ ...base, module: M108, subject: 'science' })).toBeNull();
  });
  test('m39 (urdu/english/literacy, not_for "Maths or science teachers") + science lesson → the none stands', () => {
    expect(S.cardFallback({ ...base, module: M39, subject: 'science' })).toBeNull();
  });
  test('literacy-module clip + unknown lesson subject → the none stands (only a general module may fire)', () => {
    expect(S.cardFallback({ ...base, module: M108, subject: null })).toBeNull();
  });
  test('general module + unknown lesson subject → the fallback fires', () => {
    expect(S.cardFallback({ ...base, module: GENERAL, subject: null })).toEqual({
      reason_en: FALLBACK_EN('Ask two why questions', 90), reason_ur: PLAIN_UR(90),
    });
  });
  test('a literacy module on an Urdu lesson still fires (suitsSubject holds, not_for silent)', () => {
    expect(S.cardFallback({ ...base, module: M39, subject: 'urdu' })).not.toBeNull();
  });
  test('engine: a literacy-module chapter on a lesson with no subject_resolution → the validation none stands', async () => {
    const a = args();
    a.analysis.subject_resolution = null;
    const d = deps([ROMAN, ROMAN]);
    const lit = JSON.parse(JSON.stringify(FIXTURE));
    lit.modules.find((m) => m.module_id === 10).subjects = ['english', 'literacy'];
    d.catalog = require('../../../bot/shared/services/coaching/video-reco/catalog').fromData(lit);
    const row = await E.recommendForReport({ ...a, deps: d });
    expect(d.completeJson).toHaveBeenCalledTimes(2);
    expect(row).toMatchObject({ status: 'none', none_reason: 'validation:roman', seg_id: null });
  });
  test('engine: a general-module chapter on a lesson with no subject_resolution → the fallback fires', async () => {
    const a = args();
    a.analysis.subject_resolution = null;
    const row = await E.recommendForReport({ ...a, deps: deps([ROMAN, ROMAN]) });
    expect(row).toMatchObject({ status: 'shown', seg_id: '10-s1', moment_source: 'card' });
  });
});
