'use strict';
/**
 * bd-8hhqhf R7o-b (COS 20261024T194233 §3; panel v10, ped-scale 194500 "other findings"). Card mode (VIDEO_RECO_REASON=card),
 * the shipped catalogue. Shapes from the v10 items; wording synthetic where a name or a lesson could be read back.
 *  a1 «open‑ended» with a non-breaking hyphen (U+2011) is an open question (Z168)
 *  a2 a tiered tail does not silence a card whose HEAD asks an open question (Z240 Z190 Z033)
 *  a3 a label card that names the move («Open questions, one child each») → the plain frame, not silence (Z007 Z257)
 *  a4 card mode quotes the card, never a lesson moment: no excerpt is not a silence (Z010 Z076 Z088 Z289)
 *  (a5, Z228, is not here: an English reader's why chapter, 95-s3, is refused by notFor's reading of «…in English only»;
 *  it waits for the catalogue's not_for_subjects, eng-fix 210903)
 *  b  a card_text chapter whose move the lexicon cannot judge, or whose tag is weak, is not sent on the card's nouns (Z203 Z056)
 *  d  a teacher who already asks why / how is not sent the yes/no-to-why chapter (Z071 Z186 Z224 Z242)
 */
const SHIPPED = require('../../../bot/shared/data/video-catalog.v1.json');

let E;
let C;
let S;
let SIL;
beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase'); }) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
  C = require('../../../bot/shared/services/coaching/video-reco/catalog');
  S = require('../../../bot/shared/services/coaching/video-reco/select');
  SIL = require('../../../bot/shared/services/coaching/video-reco/silence');
});
const T = (mmss, who, text) => ({ start_ms: ((+mmss.split(':')[0] * 60) + +mmss.split(':')[1]) * 1000, label: who, text });
// recall and chorus yes/no: the lesson every C1 card here is about
const RECALL_UR = [
  T('01:00', 'Teacher', 'بچو، پچھلی کلاس میں ہم نے کیا پڑھا تھا؟ یاد ہے؟'), T('01:04', 'Student', 'جی ہاں'), T('01:08', 'Teacher', 'زمین کی کتنی تہیں ہوتی ہیں؟ تین ہوتی ہیں نا؟'),
  T('01:12', 'Student', 'جی تین'), T('01:16', 'Teacher', 'شاباش۔ سب نے کتاب کھولی؟ صفحہ بارہ کھولیں۔'), T('01:20', 'Student', 'جی'),
  T('01:24', 'Teacher', 'یہ کور ہے نا؟ ٹھیک ہے؟'), T('01:28', 'Student', 'جی ہاں'), T('01:32', 'Teacher', 'اچھا، اب سب مل کر پڑھیں۔'), T('01:36', 'Student', 'زمین کی تہیں'),
];
// a class that already gives reasons to the teacher's why / how (Z186 Z224 shape): three children's «کیونکہ» lines
const PROBING_UR = [
  T('01:00', 'Teacher', 'بچو، یہ پانی کیوں جم گیا؟ کیوں ہوا ایسا؟'), T('01:05', 'Student', 'کیونکہ ٹھنڈ تھی'), T('01:10', 'Teacher', 'اچھا، آپ کو کیسے پتا چلا کہ ٹھنڈ کی وجہ سے؟'),
  T('01:16', 'Student', 'کیونکہ برف بھی ٹھنڈی ہوتی ہے'), T('01:22', 'Teacher', 'تو اگر دھوپ میں رکھیں تو کیا ہوگا؟ کیوں؟'), T('01:28', 'Student', 'پگھل جائے گا کیونکہ گرمی ہے'),
  T('01:34', 'Teacher', 'شاباش۔ اور کون بتائے گا کہ ایسا کیوں ہوتا ہے؟'), T('01:40', 'Student', 'جی میں'), T('01:44', 'Teacher', 'بتائیں، آپ نے یہ کیسے سوچا؟'), T('01:50', 'Student', 'کتاب میں تھا'),
];
const run = ({ lines = RECALL_UR, indicator = 'C1', action, lang = 'ur', transcript = 'ur', subject = 'science', analysis = null, env = {}, unstamped = false, level = 2 }) => E.recommendForReport({
  session: { id: 's1', user_id: 'u1', transcript_language: transcript, users: { name: 'Saima Khan', preferred_language: lang },
    ...(unstamped ? { transcript_text: lines.map((l) => l.text).join('\n') } : { diarization_data: { segments: lines } }) },
  analysis: analysis || { framework: 'fico', indicator_scheme: 'fico_main_37', domains: indicator ? { C: { indicators: [{ id: indicator, name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed. Quote: "یہ کور ہے نا؟"', timestamp: '[01:24]' }] } } : {}, subject_resolution: { code: subject, grade: '4', confidence: 'high' } },
  nextStep: indicator ? { target: { indicator, rung: 1, rationale: 'x', try: action } } : null, card: { indicator, action }, coachingSessionId: 's1',
  deps: { env: { VIDEO_RECO_ENABLED: 'true', VIDEO_RECO_REASON: 'card', ...env }, catalog: C.fromData(SHIPPED), store: { readForSession: async () => null, recentHistory: async () => ({ segments: [], modules: [] }), ladderProgress: async () => ({ level, completedModules: [] }), trainingBands: async () => [], write: async (r) => r }, v10GroupFor: async () => null,
    completeJson: async () => { throw new Error('card mode makes no model call'); } },
});
const quoted = (row) => /["“”]/.test(`${row.reason_en || ''}${row.reason_ur || ''}`);

describe('a1 a non-breaking hyphen in «open‑ended» (Z168)', () => {
  const CARD = 'بورڈ پر ایک open‑ended سوال لکھیں اور سوال کے بعد خاموشی سے 7–10 سیکنڈ دیں، پھر cold‑call کریں۔';
  test('is an open-question card', () => {
    expect(SIL.whyWaitCard(CARD)).toBe(true);
    expect(S.cardMoveOk(CARD, C.fromData(SHIPPED).segment('51-s1').segment)).toBe(true);
  });
  test('engine: shown, not card_mode:no_frame', async () => {
    const row = await run({ indicator: null, action: CARD });
    expect(row.status).toBe('shown');
  });
});

describe('a2 a tiered tail after an open-question head (Z240 Z190)', () => {
  test('the head asks: shown', async () => {
    const row = await run({ action: 'اگلی کلاس میں پہلے 2 open-ended questions (Why/How) پوچھیں، 5–7 سیکنڈ wait time دیں، پھر writing کے لیے تین سطحی کام دیں: 1-sentence، 2-sentences، short paragraph۔' });
    expect(row.status).toBe('shown');
    expect(row.none_reason || null).toBeNull();
  });
  test('control: a card that is all levels stays silent', async () => {
    const row = await run({ action: 'ہر گروپ کو تین سطحی کام دیں: آسان اور مشکل، اور بچے خود چنیں۔' });
    expect(row.status).toBe('none');
  });
});

describe('a3 a label card that names the move (Z007 Z257)', () => {
  test.each(['Open questions, one child each', "Plus a 'why' and a follow-up"])('%s → shown 51-s1 on the plain frame', async (action) => {
    const row = await run({ action, lang: 'en' });
    expect(row).toMatchObject({ status: 'shown', seg_id: '51-s1' });
    expect(quoted(row)).toBe(false);
  });
  test('control: a label card naming a non-asking move («… together, worked alone», v10 Z103 Z237) stays silent', async () => {
    const row = await run({ indicator: null, action: 'Planned together, worked alone', lang: 'en' });
    expect(row.status).toBe('none');
  });
  test('control: a diagnosis with no move named stays silent', async () => {
    const row = await run({ action: 'The lesson lacked pace and the class was restless', lang: 'en' });
    expect(row.status).toBe('none');
  });
});

describe('a4 card mode needs no lesson excerpt (Z010 Z076: an unstamped transcript has lines but no excerpt)', () => {
  test('a card_text open-question card on an unstamped recall lesson is shown, not no_moments', async () => {
    const row = await run({ indicator: null, unstamped: true, action: 'ہر نئے لفظ پر ایک open-ended سوال شامل کریں اور 3–5 سیکنڈ انتظار کریں۔' });
    expect(row.none_reason || null).not.toBe('no_moments');
    expect(row.status).toBe('shown');
  });
  test('control: an empty transcript is still no_moments', async () => {
    const row = await run({ indicator: null, lines: [], action: 'ہر نئے لفظ پر ایک open-ended سوال شامل کریں اور 3–5 سیکنڈ انتظار کریں۔' });
    expect(row.status).toBe('none');
  });
});

describe('b a card_text chapter sent on the card\'s nouns (Z203)', () => {
  test('«exit routine» on an error-correction card is not the management-routines chapter', async () => {
    const row = await run({ indicator: null, lang: 'en', action: "End the class with a 3-minute exit routine: pairs check each other's comma and apostrophe errors, then fix one sentence together." });
    expect(row.seg_id).not.toBe('86-s2');
  });
});

describe('d a teacher who already asks why / how (Z186 Z224)', () => {
  test('C1 card on a probing lesson: not the yes/no-to-why chapter', async () => {
    const row = await run({ lines: PROBING_UR, action: 'اگلی کلاس میں ہر جواب کے بعد ایک کیوں والا سوال پوچھیں اور پانچ سیکنڈ انتظار کریں۔' });
    expect(row.seg_id).not.toBe('51-s1');
  });
  test('control: the same card on a recall lesson still gets 51-s1', async () => {
    const row = await run({ action: 'اگلی کلاس میں ہر جواب کے بعد ایک کیوں والا سوال پوچھیں اور پانچ سیکنڈ انتظار کریں۔' });
    expect(row.seg_id).toBe('51-s1');
  });
});
