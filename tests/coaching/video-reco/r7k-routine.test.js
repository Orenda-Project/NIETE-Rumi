'use strict';
/**
 * bd-8hhqhf R7k (COS 20261024T044233 §1b; panel v8 Z157 Z387 Z255 Z199 Z417 Z149 Z129): the 022905 §5 rule (a cited
 * greeting / page call / filler falls back to the card frame) did not fire on ab71c4f3fa. Why, per row: routineLine needs
 * 60% of the words in routine sentences (silence.js routineLine) and none of these matched a pattern — «کیسے ہیں سارے بچے»
 * (only «کیسے ہیں سب» was a greeting), «ٹھیک ہے؟» filler and «آج کون سا ڈے ہے» small talk (no pattern), «Grade 8 number?»
 * (no page word; and the page rule is skipped when the sentence asks), «بک … نکالیں» (only کتاب/کاپی), «I'm also fine»
 * (only "i'm fine"); Z199 and Z129 are a student's own line, which no rule read. Now: those patterns are routine for the
 * card frame, and a student's line, or a line said before any child has spoken, is no teaching moment.
 */
const SI = require('../../../bot/shared/services/coaching/video-reco/silence');

describe('routine lines the card frame carries (cardRoutine)', () => {
  test.each([
    ['Z157 greeting', 'کیا حال ہے؟ کیسے ہیں سارے بچے؟'],
    ['Z387 filler + the day', 'ٹھیک ہے؟ اچھا، آج کون سا ڈے ہے؟'],
    ['Z255 a number call', 'Grade 8 number?'],
    ['Z417 book call', 'جی تو بچو، میتھس کی بک نکالیں گے نا؟'],
    ['Z149 greeting reply + yesterday remembered', "Alhamdulillah, I'm also fine. آپ سارے بچوں کو کل کا لیسن اچھے سے یاد ہوگا؟"],
    ['the weather', 'آج موسم کیسا ہے؟'],
  ])('%s', (_, q) => {
    expect(SI.routineLine(q)).toBe(true);
    expect(SI.cardRoutine(q)).toBe(true);
  });
  test.each([
    ['a why question', 'پودے کو پانی کیوں چاہیے؟'],
    ['a numbered question that asks', 'Question 3: why does the sun rise?'],
    ['a content question about the class', 'اس کلاس میں کتنے بچوں کے پاس دو پنسلیں ہیں؟'],
  ])('control: %s is a moment', (_, q) => expect(SI.routineLine(q)).toBe(false));
});

describe('engine: a student line or a line before any child spoke → the card frame, never the cited moment', () => {
  const FIXTURE = require('./fixtures/catalog.fixture.json');
  let E;
  let C;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase'); }) }));
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
    E = require('../../../bot/shared/services/coaching/video-reco/engine');
    C = require('../../../bot/shared/services/coaching/video-reco/catalog');
  });
  const T = (mmss, who, text) => ({ start_ms: ((+mmss.split(':')[0] * 60) + +mmss.split(':')[1]) * 1000, label: who, text });
  const LINES = [
    T('00:20', 'Teacher', 'آج ہم پانی کے بارے میں بات کریں گے اور سب دھیان سے سنیں'), T('00:25', 'Teacher', 'پانی ہمارے لیے بہت ضروری ہے اور ہم اسے روز پیتے ہیں'),
    T('00:30', 'Teacher', 'پانی کہاں سے آتا ہے؟'),
    T('00:33', 'Student', 'جی پانی بادل سے آتا ہے'), T('00:36', 'Teacher', 'اور کہاں سے آتا ہے؟'), T('00:39', 'Student', 'دریا سے'),
    T('00:42', 'Teacher', 'ٹھیک ہے بچو، اور کون بتائے گا؟'), T('00:45', 'Student', 'جی'),
    T('00:50', 'Teacher', 'سب سنیں۔ آج کا ٹاپک پانی ہے۔ ٹھیک ہے؟'), T('00:53', 'Student', 'جی'),
  ];
  const run = (q, at, lang = 'ur') => E.recommendForReport({
    session: { id: 's1', user_id: 'u1', transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: lang }, diarization_data: { segments: LINES } },
    analysis: { framework: 'fico', domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed. Quote: "کیا یہ مثلث ہے یا نہیں ہے؟"', timestamp: '[00:30]' }] } }, subject_resolution: { code: 'maths', grade: '3', confidence: 'high' } },
    nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'x', try: 'Ask why after a one-word answer and wait five seconds.' } },
    card: { indicator: 'C1', action: 'Ask why after a one-word answer and wait five seconds.' }, coachingSessionId: 's1',
    deps: { env: { VIDEO_RECO_ENABLED: 'true' }, catalog: C.fromData(FIXTURE), store: { readForSession: async () => null, recentHistory: async () => ({ segments: [], modules: [] }), ladderProgress: async () => ({ level: 2, completedModules: [] }), trainingBands: async () => [], write: async (r) => r }, v10GroupFor: async () => null,
      completeJson: async (p) => ({ result: { seg_id: (p.split('CANDIDATE CLIPS')[1].match(/\b\d{1,3}-s\d+\b/) || [])[0], moment: { at, quote: q }, confidence: 0.7,
        reason_en: `In the lesson "${q}" was said and the class answered in one word. This clip shows how to ask why.`,
        reason_ur: `سبق میں یہ کہا گیا، "${q}" اور بچوں نے ایک لفظ میں جواب دیا۔ یہ کلپ دکھاتا ہے کہ کیوں کیسے پوچھیں۔` }, usage: {}, finishReason: 'stop' }) },
  });
  const cited = (row) => row.moment_source === 'transcript';
  test('Z199/Z129 shape: a student\'s own line', async () => {
    const row = await run('جی پانی بادل سے آتا ہے', '00:33');
    expect(cited(row)).toBe(false);
    expect([row.first_none_reason, row.none_reason]).toContain('validation:routine');
  });
  test('Z255 shape: a line said before any child has spoken (and not the question the first child answers)', async () => {
    const row = await run('پانی ہمارے لیے بہت ضروری ہے اور ہم اسے روز پیتے ہیں', '00:25');
    expect(cited(row)).toBe(false);
    expect([row.first_none_reason, row.none_reason]).toContain('validation:routine');
  });
  test('control: the opening question the first child answers is a moment', async () => {
    const row = await run('پانی کہاں سے آتا ہے؟', '00:30');
    expect([row.first_none_reason, row.none_reason]).not.toContain('validation:routine');
  });
  test('control: a teacher question after a child has spoken is cited', async () => {
    const row = await run('اور کہاں سے آتا ہے؟', '00:36');
    expect([row.first_none_reason, row.none_reason]).not.toContain('validation:routine');
  });
  test('red7 061530 R1 (Z180 Z143): an announcement only the filler made routine falls back like routine, never silence', async () => {
    const row = await run('سب سنیں۔ آج کا ٹاپک پانی ہے۔ ٹھیک ہے؟', '00:50');
    expect(row.moment_source).not.toBe('transcript');
    expect([row.first_none_reason, row.none_reason]).toContain('validation:routine');
    expect(row.none_reason).not.toBe('validation:not_moment');
  });
});
