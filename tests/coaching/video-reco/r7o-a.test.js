'use strict';
/**
 * bd-8hhqhf R7o-a (COS 20261024T194233 §1; panel v10 Z044/Z054 ⛔9, Z253).
 * 1. A quoted card sentence goes through the STRICT name redactor, as the excerpts do, before it is quoted: any word it
 *    masks → the plain frame, no quote. Z044's shape: an unknown word naming a child inside an Urdu card, which the strict
 *    redactor masks ('oov') but childFreeCard kept («…کرائیں: X 1 منٹ جوڑوں میں بیان کرے۔»). Names here are synthetic.
 * 2. A long recording with little speech and no classroom talk is not a lesson (Z253: 398 words in 15 min, a car ride with
 *    adults labelled "Student"), whatever its speakers were labelled; unknown duration → as before.
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');

let S;
let C;
let SIL;
let E;
beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase'); }) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  S = require('../../../bot/shared/services/coaching/video-reco/select');
  C = require('../../../bot/shared/services/coaching/video-reco/catalog');
  SIL = require('../../../bot/shared/services/coaching/video-reco/silence');
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
});

describe('1. the quoted card sentence passes the strict redactor, or the plain frame', () => {
  const frame = (sentence, extra = {}) => {
    const cat = C.fromData(FIXTURE);
    const hit = cat.segment('10-s1');
    return S.cardFrame({ sentence, startS: hit.segment.start_s, endS: hit.segment.end_s, language: 'ur', teacherName: 'Saima Khan', module: hit.module, subject: 'maths', vocab: S.subjectVocab(), segment: hit.segment, plainIfNamed: true, ...extra });
  };
  const plainUr = () => {
    const cat = C.fromData(FIXTURE);
    return S.plainFrame ? S.plainFrame('ur', cat.segment('10-s1').segment) : null;
  };
  test.each(['زونی', 'ریشا', 'شانو', 'نینا', 'زرشی'])('Z044 shape, synthetic name %s: no quote, the plain frame', (nm) => {
    const out = frame(`ایک مثال بورڈ پر حل کریں، پھر 'Think-Pair-Share' کرائیں: ${nm} 1 منٹ جوڑوں میں بیان کرے۔`);
    expect(out).not.toBeNull();
    expect(out.reason_ur).not.toContain(nm);
    expect(out.reason_en).not.toContain(nm);
    if (plainUr()) expect(out.reason_ur).toBe(plainUr());
  });
  test('without plainIfNamed (the LLM-path fallback): no clip rather than a quoted name', () => {
    expect(frame("ایک مثال بورڈ پر حل کریں، پھر 'Think-Pair-Share' کرائیں: زونی 1 منٹ جوڑوں میں بیان کرے۔", { plainIfNamed: false })).toBeNull();
  });
  test('control: the same card with no name is still quoted', () => {
    const out = frame("ایک مثال بورڈ پر حل کریں، پھر 'Think-Pair-Share' کرائیں: ہر جوڑی 1 منٹ بیان کرے۔");
    expect(out.reason_ur).toContain('Think-Pair-Share');
  });
  test('control: an English card with no name is still quoted', () => {
    const out = frame("After a one-word answer, ask 'why do you think so?' and wait five seconds.", { language: 'en' });
    expect(out.reason_en).toMatch(/why do you think so/);
  });
});

describe('2. a slow recording with no classroom talk is not a lesson', () => {
  const T = (s, who, text) => `[${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}] ${who}: ${text}`;
  // Z253's shape, synthetic: adult talk labelled Teacher/Student, ~400 words over 15 min, no child addressed, no book
  const ADULT = ['گیٹ کے آگے روک دیں، لیفٹ سائیڈ۔ جی، لیفٹ۔ نہیں، نہیں، بس یہیں روک دیں۔ یہ لے لیں۔', 'نماز کا ٹائم ہے، ابھی نہیں ہو سکتی، میٹنگ ہے۔ چلیں؟',
    'اوکے، پھر ملتے ہیں، ادھر ہی ملیں گے یہاں پہ۔', 'Also, previously the website had been outsourced, so no updates have been made ever since then.'];
  const car = [];
  for (let i = 0; i < 22; i += 1) car.push(T(30 + i * 40, i % 2 ? 'Student (UR)' : 'Teacher (UR)', ADULT[i % ADULT.length]));
  const wpm = (lines, durationS) => (lines.join(' ').replace(/\[[\d:]+\] [^:]+:/g, '').match(/[\p{L}\p{N}]+/gu) || []).length / (durationS / 60);
  test('the synthetic recording is Z253-slow (< 30 words a minute)', () => { expect(wpm(car, 906)).toBeLessThan(30); });
  test('Z253 shape: notLesson with the duration', () => {
    expect(SIL.notLesson(car, { durationS: 906 })).toBe(true);
  });
  test('control: the same lines with no duration known → as before (false)', () => {
    expect(SIL.notLesson(car)).toBe(false);
  });
  test('control: a slow lesson that talks to children (Z003 shape, 19 wpm) stays a lesson', () => {
    const LESSON = ['بچو، کتاب کا صفحہ 12 کھولیں۔', 'شاباش بیٹا، اب سوال نمبر دو کا جواب بتائیں۔', 'جی، بورڈ پر دیکھیں اور کاپی میں لکھیں۔', 'Very good. Read the next line please.'];
    const slow = [];
    for (let i = 0; i < 22; i += 1) slow.push(T(30 + i * 45, i % 2 ? 'Student (UR)' : 'Teacher (UR)', `${LESSON[i % LESSON.length]} ${ADULT[i % ADULT.length]}`));
    expect(SIL.notLesson(slow, { durationS: 1692 })).toBe(false);
  });
  test('control: a normal-pace lesson is never judged by talk alone', () => {
    expect(SIL.notLesson(car, { durationS: 300 })).toBe(false);
  });
  test('engine: the Z253 shape → none / no_moments:not_lesson, no model call', async () => {
    const cj = jest.fn();
    const segments = car.map((l) => {
      const m = /^\[(\d+):(\d+)\] ([^:]+): (.*)$/.exec(l);
      return { start_ms: (Number(m[1]) * 60 + Number(m[2])) * 1000, label: m[3].replace(/ \(UR\)$/, ''), text: m[4] };
    });
    const WHY = "After a one-word answer, ask 'why do you think so?' and wait five seconds.";
    const row = await E.recommendForReport({
      session: { id: 's1', user_id: 'u1', transcript_language: 'ur', audio_duration_seconds: 906, users: { name: 'Saima Khan', preferred_language: 'ur' }, diarization_data: { segments } },
      analysis: { framework: 'fico', domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'x', timestamp: '[00:30]' }] } }, subject_resolution: { code: 'science', grade: '3', confidence: 'high' } },
      nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'x', try: WHY } }, card: { indicator: 'C1', action: WHY }, coachingSessionId: 's1',
      deps: { env: { VIDEO_RECO_ENABLED: 'true', VIDEO_RECO_REASON: 'card' }, catalog: C.fromData(FIXTURE), store: { readForSession: async () => null, recentHistory: async () => ({ segments: [], modules: [] }), ladderProgress: async () => ({ level: 2, completedModules: [] }), trainingBands: async () => [], write: async (r) => r }, v10GroupFor: async () => null, completeJson: cj },
    });
    expect(cj).not.toHaveBeenCalled();
    expect(row.status).toBe('none');
    expect(row.none_reason).toBe('no_moments:not_lesson');
  });
});
