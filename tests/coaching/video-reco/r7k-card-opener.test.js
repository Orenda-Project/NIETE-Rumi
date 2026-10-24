'use strict';
/**
 * bd-8hhqhf (ped-scale 20261024T042448, panel v8 Z086 ⛔9; scale-run 042756): the report's card sentence opens with the
 * teacher's own name in Urdu script, three words the redactor also knows as dictionary words, then «،». Nothing masked
 * it, so leadingVocative kept it and the card frame quoted it in the Urdu WhatsApp line. A card's 2–3 Urdu-script opener
 * before «،» is now the address unless it is a reviewed non-name opener or holds a function, role or verb word.
 * Synthetic names only.
 */
const { leadingVocative, vocativeNames } = require('../../../bot/shared/services/coaching/video-reco/copy-rules');

const REST = 'اپنی اگلی کلاس کے 5 منٹ بچوں کو جوڑوں میں بات کرنے دیں۔';

describe('Z086: a dictionary-word Urdu name heading the card is the address', () => {
  test.each([
    ['three words', 'چاند تارا روشنی'],
    ['two words', 'گلاب بہار'],
    ['two words and a title', 'محترمہ چاند تارا'],
    ['red7 H1 (K21): a role word before the name', 'میڈم چاند تارا'],
    ['red7 H2: a diacritic inside a name word', 'چاندَ تارا روشنی'],
    ['red7 H3 (K9): four words', 'چاند تارا روشنی بہار'],
  ])('%s → dropped', (_, name) => {
    const card = `${name}، ${REST}`;
    expect(card.slice(leadingVocative(card))).toBe(REST);
  });
  test('vocativeNames gives the name words without the title', () => {
    expect(vocativeNames(`محترمہ چاند تارا، ${REST}`)).toEqual(['چاند', 'تارا']);
    expect(vocativeNames(`میڈم چاندَ تارا، ${REST}`)).toEqual(['چاند', 'تارا']);
  });
});

describe('controls: an opener that is not a name stays', () => {
  test.each([
    ['next class (function word)', 'اگلی کلاس میں،'],
    ['reviewed non-name opener', 'ایک سوال پوچھیں،'],
    ['reviewed non-name opener 2', 'سبق کے شروع،'],
    ['a verb (imperative)', 'سوال پوچھیں،'],
    ['a role word', 'ٹیچر صاحبہ،'],
    ['a digit', 'پہلے 5،'],
    ['five words', 'چاند تارا روشنی بہار گلاب،'],
    ['a role word alone with an honorific', 'ٹیچر صاحبہ،'],
    ['a colon, not a comma', 'چاند تارا روشنی:'],
  ])('%s', (_, opener) => {
    const card = `${opener} ${REST}`;
    expect(leadingVocative(card)).toBe(0);
  });
  test('a Latin two-word opener is unchanged (not read by the inverse rule)', () => {
    expect(leadingVocative(`Next class, ${REST}`)).toBe(0);
  });
});

describe('engine: the card frame on an Urdu reader never carries the opener name', () => {
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
  const T = (sec, who, text) => ({ start_ms: sec * 1000, label: who, text });
  const LINES = [T(30, 'Teacher', 'Is this a triangle? Yes or no?'), T(33, 'Student', 'Yes'), T(36, 'Teacher', 'Is this a square?'), T(39, 'Student', 'No'), T(42, 'Teacher', 'Is it red?'), T(45, 'Student', 'Yes')];
  const SHORT = (p) => ({ seg_id: (p.split('CANDIDATE CLIPS')[1].match(/\b\d{1,3}-s\d+\b/) || [])[0], moment: { at: '00:33', quote: 'Yes' }, reason_en: 'x', reason_ur: 'y', confidence: 0.6 });
  const prompts = [];
  const run = (action, lang) => E.recommendForReport({
    session: { id: 's1', user_id: 'u1', transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: lang }, diarization_data: { segments: LINES } },
    analysis: { framework: 'fico', domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed. Quote: "Is this a triangle? Yes or no"', timestamp: '[00:30]' }] } }, subject_resolution: { code: 'maths', grade: '3', confidence: 'high' } },
    nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'x', try: action } }, card: { indicator: 'C1', action }, coachingSessionId: 's1',
    deps: { env: { VIDEO_RECO_ENABLED: 'true' }, catalog: C.fromData(FIXTURE), store: { readForSession: async () => null, recentHistory: async () => ({ segments: [], modules: [] }), ladderProgress: async () => ({ level: 2, completedModules: [] }), trainingBands: async () => [], write: async (r) => r }, v10GroupFor: async () => null, completeJson: async (p) => { prompts.push(p); return { result: SHORT(p), usage: {}, finishReason: 'stop' }; } },
  });
  const CARD = "چاند تارا روشنی، اگلی کلاس میں جب جواب ایک لفظ کا ہو تو پوچھیں 'کیوں؟' اور پانچ سیکنڈ رکیں۔";
  test.each(['ur', 'en'])('reader %s: no opener word in any stored teacher-facing string or in the model input', async (lang) => {
    prompts.length = 0;
    const row = await run(CARD, lang);
    expect(row && row.status).not.toBe('none');
    const out = `${row.reason_en} ${row.reason_ur} ${row.moment_quote || ''}`;
    for (const w of ['چاند', 'تارا', 'روشنی']) {
      expect(out).not.toMatch(new RegExp(`(?<![\\p{L}])${w}(?![\\p{L}])`, 'u'));
      for (const p of prompts) expect(p).not.toMatch(new RegExp(`(?<![\\p{L}])${w}(?![\\p{L}])`, 'u'));
    }
  });
});
