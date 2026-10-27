'use strict';
/**
 * bd-8hhqhf R7k (COS 20261024T044233 §1c; panel v8 Z377 ⛔9): a child's name that is also a dictionary word, as the
 * closing vocative of the cited question («…، X؟»), was masked by no rule, so the one gate never held it. A word set off
 * in that position, or right after a greeting, that the lesson says 3 times or fewer is a name, whatever the lexicon says,
 * unless it is the lesson's own term. Synthetic names only («بہار» is a common word in the lexicon).
 */
const { vocativeKeys } = require('../../../bot/shared/services/coaching/video-reco/redact-names');

const once = new Map([['بہار', 1]]);

describe('vocativeKeys', () => {
  test('Z377 shape: «…، X؟» with X said once → a name', () => {
    expect(vocativeKeys('اچھا بچو، پودے کو کیا چاہیے، بہار؟', { counts: once })).toEqual(['بہار']);
  });
  test('right after a greeting → a name', () => {
    expect(vocativeKeys('السلام علیکم بہار، آج ہم پودے پڑھیں گے۔', { counts: once })).toEqual(['بہار']);
  });
  test.each([
    ['said 12 times in the lesson (content)', 'اچھا بچو، پودے کو کیا چاہیے، بہار؟', { counts: new Map([['بہار', 12]]) }],
    ['the lesson\'s own term', 'اچھا بچو، پودے کو کیا چاہیے، بہار؟', { counts: once, vocab: ['بہار'] }],
    ['the object of the question, not set off', 'کون کون سا پرندہ؟', { counts: new Map() }],
    ['a verb or auxiliary', 'اچھا، پھر کیا ہوگا؟', { counts: new Map() }],
    ['an English question word set off', 'How else could we solve this? Why?', { counts: new Map() }],
    ['a word inside the sentence', 'بہار کے موسم میں کیا ہوتا ہے؟', { counts: once }],
  ])('%s → none', (_, text, ctx) => expect(vocativeKeys(text, ctx)).toEqual([]));
});

describe('engine: the stored quote and both reasons never carry the vocative name (R7i harness)', () => {
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
  const Q = 'اپنے دوست کی خوبی بتانا چاہے؟ ہاں جی، بہار؟';
  const LINES = [
    T('00:40', 'Teacher', 'کیا یہ مثلث ہے؟'), T('00:42', 'Student', 'جی'), T('00:44', 'Teacher', 'کیا یہ مربع ہے؟'), T('00:45', 'Student', 'نہیں'),
    T('00:47', 'Teacher', `اچھا۔ اور کوئی بچہ ${Q}`), T('00:50', 'Student', 'جی'),
    T('00:52', 'Teacher', 'کیا یہ دائرہ ہے؟'), T('00:54', 'Student', 'جی'),
  ];
  const deps = {
    env: { VIDEO_RECO_ENABLED: 'true' },
    store: { readForSession: async () => null, recentHistory: async () => ({ segments: [], modules: [] }), ladderProgress: async () => ({ level: 2, completedModules: [] }), trainingBands: async () => [], write: async (r) => ({ id: 'r1', ...r }) },
    v10GroupFor: async () => null,
    completeJson: async (p) => ({ result: { seg_id: (p.split('CANDIDATE CLIPS')[1].match(/\b\d{1,3}-s\d+\b/) || [])[0], moment: { at: '00:47', quote: Q }, confidence: 0.7,
      reason_en: `The teacher asked, "${Q}" and moved straight on to asking for answers. The clip explains why questions.`,
      reason_ur: `استاد نے پوچھا، "${Q}" اور فوراً جواب مانگے۔ یہ کلپ کیوں والے سوال سمجھاتا ہے۔` }, usage: {}, finishReason: 'stop' }),
  };
  const args = (lang) => ({
    session: { id: 's1', user_id: 'u1', transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: lang }, diarization_data: { segments: LINES } },
    analysis: { framework: 'fico', domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed. Quote: "کیا یہ مثلث ہے؟"', timestamp: '[00:40]' }] } }, subject_resolution: { code: 'maths', grade: '3', confidence: 'high' } },
    nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'Few open questions', try: 'Ask two why questions about shapes.' } },
    card: { indicator: 'C1', action: 'Ask two why questions about shapes.' },
    coachingSessionId: 's1',
  });
  test.each(['ur', 'en'])('reader %s', async (lang) => {
    const row = await E.recommendForReport({ ...args(lang), deps: { ...deps, catalog: C.fromData(FIXTURE) } });
    expect(row && row.status).not.toBe('none');
    expect(`${row.reason_en} ${row.reason_ur} ${row.moment_quote || ''}`).not.toMatch(/(?<![\p{L}])بہار(?![\p{L}])/u);
  });
});
