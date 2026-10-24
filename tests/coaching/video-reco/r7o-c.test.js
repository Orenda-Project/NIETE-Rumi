'use strict';
/**
 * bd-8hhqhf R7o-c (ped-scale 20261024T220500, panel v11 fresh-5).
 *  1 the why / wait rescue (51-s1 by the enacted route) only when the card's HEAD move asks: on fresh-5 + fresh-4 the
 *    rescue was right 5/5 with an asking head, wrong 3/3 with a feedback head or none (Z134 Z181 Z249)
 *  2 the card frame never doubles the full stop after the closing quote («۔"۔», ~8 v11 bodies)
 */
const SHIPPED = require('../../../bot/shared/data/video-catalog.v1.json');

let E;
let C;
let S;
beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase'); }) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
  C = require('../../../bot/shared/services/coaching/video-reco/catalog');
  S = require('../../../bot/shared/services/coaching/video-reco/select');
});
const T = (mmss, who, text) => ({ start_ms: ((+mmss.split(':')[0] * 60) + +mmss.split(':')[1]) * 1000, label: who, text });
const RECALL = [
  T('01:00', 'Teacher', 'بچو، پچھلی کلاس میں ہم نے کیا پڑھا تھا؟ یاد ہے؟'), T('01:04', 'Student', 'جی ہاں'), T('01:08', 'Teacher', 'زمین کی کتنی تہیں ہوتی ہیں؟ تین ہوتی ہیں نا؟'),
  T('01:12', 'Student', 'جی تین'), T('01:16', 'Teacher', 'شاباش۔ سب نے کتاب کھولی؟ صفحہ بارہ کھولیں۔'), T('01:20', 'Student', 'جی'),
  T('01:24', 'Teacher', 'یہ کور ہے نا؟ ٹھیک ہے؟'), T('01:28', 'Student', 'جی ہاں'),
];
const LIST_A = '50-s2,51-s1,51-s3,95-s3';
const run = (action, lang = 'en') => E.recommendForReport({
  session: { id: 's1', user_id: 'u1', transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: lang }, diarization_data: { segments: RECALL } },
  analysis: { framework: 'fico', indicator_scheme: 'fico_main_37', domains: {}, subject_resolution: { code: 'science', grade: '4', confidence: 'high' } },
  nextStep: null, card: { indicator: null, action }, coachingSessionId: 's1',
  deps: { env: { VIDEO_RECO_ENABLED: 'true', VIDEO_RECO_REASON: 'card', VIDEO_RECO_ALLOWLIST: LIST_A }, catalog: C.fromData(SHIPPED), store: { readForSession: async () => null, recentHistory: async () => ({ segments: [], modules: [] }), ladderProgress: async () => ({ level: 4, completedModules: [] }), trainingBands: async () => [], write: async (r) => r }, v10GroupFor: async () => null,
    completeJson: async () => { throw new Error('card mode makes no model call'); } },
});

describe('1 the why / wait rescue needs an asking head', () => {
  test('a feedback-head card with a wait in its tail is not sent the why-swap chapter (Z181 shape)', async () => {
    const row = await run('Next class, after a child answers, name the reasoning, give one next step, then wait five seconds before the next child.');
    expect(row.seg_id).not.toBe('51-s1');
  });
  test('control (silent on the previous head too): a feedback card with «why» inside its example (Z134 shape)', async () => {
    const row = await run("After each group shares, give 'One strength + one next step' aloud (e.g., 'Good vocabulary; next, include one reason why').");
    expect(row.seg_id).not.toBe('51-s1');
  });
  test('control: an asking-head card still gets 51-s1', async () => {
    const row = await run("After a one-word answer, ask 'why do you think so?' and wait five seconds.");
    expect(row).toMatchObject({ status: 'shown', seg_id: '51-s1' });
  });
});

describe('2 no doubled full stop after the closing quote', () => {
  const frame = (sentence, language) => {
    const hit = C.fromData(SHIPPED).segment('51-s1');
    return S.cardFrame({ sentence, startS: hit.segment.start_s, endS: hit.segment.end_s, language, teacherName: 'Saima Khan', module: hit.module, subject: 'science', vocab: S.subjectVocab(), segment: hit.segment });
  };
  const bare = (t) => String(t || '').replace(/[⁦-⁩]/g, '');
  test('Urdu', () => {
    const out = frame('اگلی کلاس میں ہر جواب کے بعد ایک کیوں والا سوال پوچھیں اور پانچ سیکنڈ انتظار کریں۔', 'ur');
    expect(bare(out.reason_ur)).toContain('انتظار کریں"۔');
    expect(bare(out.reason_ur)).not.toContain('۔"۔');
  });
  test('English', () => {
    const out = frame("After a one-word answer, ask 'why do you think so?' and wait five seconds.", 'en');
    expect(bare(out.reason_en)).toContain('wait five seconds".');
    expect(bare(out.reason_en)).not.toContain('."."');
  });
  test('control: a question mark at the end stays', () => {
    const out = frame("Next class, after each answer ask: 'Why do you think so?'", 'en');
    expect(bare(out.reason_en)).toMatch(/\?'?"\./);
  });
});
