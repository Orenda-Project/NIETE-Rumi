'use strict';
/**
 * bd-8hhqhf (red7 20261024T023206 S12; panel v7 Z382 ⛔9): a child's name in the POSSESSIVE inside the report's own sentence
 * ("Hope's answer", «کرن کے جواب»), quoted by the card frame. The card sentence is never quoted when its possessor is a
 * person: a capitalised word mid-sentence, a lexicon name in any case, a roster name, or an Urdu word before «کا/کی/کے»
 * and a person's noun. Synthetic names only.
 */
const { childFreeCard } = require('../../../bot/shared/services/coaching/video-reco/copy-rules');

const free = (s, o = {}) => childFreeCard(s, { vocab: [], oovVocab: [], ...o });

describe('a possessive person in the card sentence → the sentence is not quotable (null)', () => {
  test.each([
    ['S12b Latin dictionary-word name', "Next class, when Hope's answer is one word, ask 'why do you think so?' and wait five seconds."],
    ['S12g Latin strong name in lower case', "Next class, when ayesha's answer is one word, ask 'why do you think so?' and wait five seconds."],
    ['S12f Urdu vocabulary word as a name', "اگلی کلاس میں جب کرن کے جواب ایک لفظ کے ہوں تو پوچھیں 'کیوں؟' اور پانچ سیکنڈ رکیں۔"],
    ['S12e Urdu ambiguous name', "اگلی کلاس میں جب نور کی بات ایک لفظ کی ہو تو پوچھیں 'کیوں؟' اور پانچ سیکنڈ رکیں۔"],
  ])('%s', (_, s) => expect(free(s)).toBeNull());

  test('a roster child in the possessive (the raw roster, red7: a vocabulary word on the class list)', () => {
    expect(free("اگلی کلاس میں جب کرن کے جواب ایک لفظ کے ہوں تو پوچھیں 'کیوں؟'", { roster: new Set(['کرن']) })).toBeNull();
  });
});

describe('controls', () => {
  test.each([
    ['S12a capitalised strong name (already masked)', "Next class, when Ayesha's answer is one word, ask 'why do you think so?'"],
    ['S12c unknown capitalised name (already masked)', "Next class, when Pervaize's answer is one word, ask 'why do you think so?'"],
    ['S12d Urdu strong name (already masked)', "اگلی کلاس میں جب عائشہ کا جواب ایک لفظ کا ہو تو پوچھیں 'کیوں؟'"],
  ])('%s → still not quotable', (_, s) => expect(free(s)).toBeNull());
  test.each([
    ['an English common-noun possessive', "Next class, read the lesson's first question aloud, then ask each pair why the answer is right."],
    ['an Urdu content possessive', 'اگلی کلاس میں سوال کا جواب سننے کے بعد پوچھیں کہ یہ جواب کیوں درست ہے۔'],
    ['a demonstrative possessive', 'اگلی کلاس میں اس کا جواب سننے کے بعد پوچھیں کیوں۔'],
    ['a capitalised term possessive inside a term', "Next class, use Bloom's levels: ask one why question after each answer."],
  ])('%s → the sentence stays quotable', (_, s) => expect(free(s)).toBe(s));
});

describe('engine (red7 bin/attack_redactor_s12.js path): a refused answer, the card frame, no possessive name in either line', () => {
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
  const run = (action, lang) => E.recommendForReport({
    session: { id: 's1', user_id: 'u1', transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: lang }, diarization_data: { segments: LINES } },
    analysis: { framework: 'fico', domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed. Quote: "Is this a triangle? Yes or no"', timestamp: '[00:30]' }] } }, subject_resolution: { code: 'maths', grade: '3', confidence: 'high' } },
    nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'x', try: action } }, card: { indicator: 'C1', action }, coachingSessionId: 's1',
    deps: { env: { VIDEO_RECO_ENABLED: 'true' }, catalog: C.fromData(FIXTURE), store: { readForSession: async () => null, recentHistory: async () => ({ segments: [], modules: [] }), ladderProgress: async () => ({ level: 2, completedModules: [] }), trainingBands: async () => [], write: async (r) => r }, v10GroupFor: async () => null, completeJson: async (p) => ({ result: SHORT(p), usage: {}, finishReason: 'stop' }) },
  });
  test.each([
    ['S12b', "Next class, when Hope's answer is one word, ask 'why do you think so?' and wait five seconds.", 'Hope', 'en'],
    ['S12g', "Next class, when ayesha's answer is one word, ask 'why do you think so?' and wait five seconds.", 'ayesha', 'en'],
    ['S12f', "اگلی کلاس میں جب کرن کے جواب ایک لفظ کے ہوں تو پوچھیں 'کیوں؟' اور پانچ سیکنڈ رکیں۔", 'کرن', 'ur'],
  ])('%s', async (_, action, name, lang) => {
    const row = await run(action, lang);
    // whole words: the plain frame's own «کرنے» holds «کرن» as letters
    expect(`${row && row.reason_en} ${row && row.reason_ur}`).not.toMatch(new RegExp(`(?<![\\p{L}])${name}(?![\\p{L}])`, 'u'));
  });
});
