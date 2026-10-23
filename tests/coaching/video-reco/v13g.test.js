'use strict';
/**
 * bd-8hhqhf (VIDREC round 7, COS ruling 07:01Z): the strict excerpt redactor's vocabulary rule stops taking content
 * words for children's names on the PROMPT side, so the model sees "میڈین", not "[a student]", and quotes it.
 * Only the vocabulary rule ('oov') is narrowed; the lexicon, address, named, surname and compound rules are untouched.
 *  - Urdu-script words with a retroflex letter (ٹ ڈ ڑ ژ; 0 of the 472 lexicon names have one) or an English-loan
 *    ending (-نگ ing, -شن tion, -منٹ ment, -ٹی ity …) are content words;
 *  - common Devanagari function words (2 of 1,500 transcripts are in Devanagari) are content words;
 *  - the lesson's subject terms + topic words reach the prompt-side redactor as vocab.
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');

let E;
let R;
let P;
const SID = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';

beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase in these tests'); }) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
  R = require('../../../bot/shared/services/coaching/video-reco/redact-names');
  P = require('../../../bot/shared/services/coaching/video-reco/prompt');
});

const strict = (t, ctx = {}) => R.redactNames(t, { placeholders: { child: '[a student]' }, ...ctx });

describe('the vocabulary rule no longer masks content words', () => {
  test.each([
    ['retroflex: divisibility', 'آج ہم ڈویژبلٹی کے رولز پڑھیں گے'],
    ['retroflex: blend', 'یہ بلینڈ ہے، ٹھیک ہے؟'],
    ['-ing loan', 'اب رولنگ کر کے دکھائیں'],
    ['-tion loan', 'یہ وائبریشنز سے آواز بنتی ہے'],
  ])('%s → unchanged', (_, text) => {
    expect(strict(text)).toBe(text);
  });

  test('Devanagari function words → unchanged', () => {
    const t = 'और अब क्या ठीक है? आप जल्दी करें।';
    expect(strict(t)).toBe(t);
  });

  test('a Devanagari given name is still masked', () => {
    expect(strict('मुस्कान आप बताओ')).toContain('[a student]');
  });

  test('a retroflex given name the lexicon lacks (پیٹر, رابرٹ, ڈیزی) is still masked by the vocabulary rule', () => {
    expect(strict('کل پیٹر نے کتاب پڑھی')).toContain('[a student]');
    expect(strict('رابرٹ اور ڈیزی نے سوال کیا')).not.toMatch(/رابرٹ|ڈیزی/);
  });

  test('a lexicon name is still masked, retroflex rule or not', () => {
    expect(strict('احمد نے ڈویژبلٹی بتائی')).toBe('[a student] نے ڈویژبلٹی بتائی');
  });

  test('a retroflex nickname in an address slot is still masked (only the vocabulary rule is narrowed)', () => {
    expect(strict('گڈو، آپ بتائیں')).toBe('[a student]، آپ بتائیں');
    expect(strict('شاباش ڈوڈو۔')).toBe('شاباش [a student]۔');
  });

  test('vocab never shields a lexicon name', () => {
    expect(strict('احمد نے بتایا', { vocab: ['احمد'] })).toBe('[a student] نے بتایا');
  });

  test('red7 070505: on the prompt side a topic word never opens an address slot, and never shields a lexicon name', () => {
    const people = { teacher: 'Saima Khan', vocab: [], oovVocab: ['راشد', 'منہاج', 'شہید', 'کوئنچ'] };
    const s = (text) => ({ diarization_data: { segments: [{ start_ms: 1000, label: 'Teacher', text }] } });
    expect(P.excerpts(s('راشد، آپ پڑھیں'), {}, people)[0]).toContain('[a student]');
    expect(P.excerpts(s('منہاج، آپ پڑھیں'), {}, people)[0]).toContain('[a student]');
    expect(P.excerpts(s('آج ہم کوئنچ کا مطلب پڑھیں گے'), {}, people)[0]).toContain('کوئنچ'); // narration: the vocabulary rule only
  });

  test('the excerpt redaction takes the lesson vocab: کوئنچ (no retroflex) with vocab is kept', () => {
    const s = { diarization_data: { segments: [{ start_ms: 1000, label: 'Teacher', text: 'آج ہم کوئنچ کا مطلب پڑھیں گے، ٹھیک ہے؟' }] } };
    expect(P.excerpts(s, {}, { teacher: 'Saima Khan' })[0]).toContain('[a student]');
    expect(P.excerpts(s, {}, { teacher: 'Saima Khan', vocab: ['کوئنچ'] })[0]).toContain('کوئنچ');
  });
});

describe('engine: the prompt carries the subject word; the quote passes on the first try', () => {
  function args(lines) {
    return {
      session: { id: SID, user_id: UID, transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: 'ur' }, diarization_data: { segments: lines } },
      analysis: {
        framework: 'fico',
        domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed questions. Quote: "Is this a triangle? Yes or no"', evidence_summary: 'x', timestamp: '[00:01]' }] } },
        subject_resolution: { code: 'maths', grade: '9', confidence: 'high' },
        topic: 'median and mode',
      },
      nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'Few open questions', try: 'Ask two why questions' } },
      loop: { state: { angle: 'show' } },
      card: { indicator: 'C1', action: 'Ask two why questions about the median' },
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
  const LINES = [{ start_ms: 1000, label: 'Teacher', text: 'آج ہمارا جو ٹاپک ہے نا، وہ ہے میڈین کے بارے میں، ٹھیک ہے؟' }];
  const ANSWER = {
    seg_id: '10-s1', moment: { at: '00:01', quote: 'آج ہمارا جو ٹاپک ہے نا، وہ ہے میڈین کے بارے میں' },
    reason_en: 'At 00:01 the topic was named but no goal was written. This clip shows a teacher writing the objective on the board.',
    reason_ur: 'سبق کا موضوع بتایا گیا مگر مقصد نہیں لکھا گیا؛ اس کلپ میں استاد بورڈ پر مقصد لکھتے ہیں۔', confidence: 0.7,
  };

  test('d2a235f4 shape: the excerpt in the prompt says میڈین, and the verbatim quote is shown on attempt 1', async () => {
    const d = deps([ANSWER]);
    const row = await E.recommendForReport({ ...args(LINES), deps: d });
    expect(d.completeJson.mock.calls[0][0]).toContain('وہ ہے میڈین کے بارے میں');
    expect(row).toMatchObject({ status: 'shown', moment_source: 'transcript', attempts: 1, moment_quote: ANSWER.moment.quote });
  });
});
