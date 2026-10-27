'use strict';
/**
 * bd-8hhqhf (VIDREC round 7, red7 075837 / 080908): a reason that copied the transcript's line prefix
 * («[10:51] Teacher: "…"») reads as a log line; 126 of 4,876 reasons in scale-run's shards. At composition, code-only:
 *  - a copied prefix at a sentence start ("[mm:ss] <speaker label>:", "mm:ss:", a bare label) is dropped entirely
 *    (COS 081156: the panel's option 1, no clock stamp and no label in a teacher-facing reason);
 *  - in the English reason every Urdu run not already isolated sits in FSI…PDI, so an UNQUOTED moment renders in
 *    place too; no quote mark is ever added (quote marks assert verbatim speech, ⛔2).
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');

let E;
let C;
const SID = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';
const FSI = '⁨';
const PDI = '⁩';

beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase in these tests'); }) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
  C = require('../../../bot/shared/services/coaching/video-reco/copy');
});

function args(lines) {
  return {
    session: { id: SID, user_id: UID, transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: 'ur' }, diarization_data: { segments: lines } },
    analysis: {
      framework: 'fico',
      domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'x', evidence_summary: 'x', timestamp: '[12:08]' }] } },
      subject_resolution: { code: 'urdu', grade: '3', confidence: 'high' },
    },
    nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'Few open questions', try: 'Ask two why questions' } },
    loop: { state: { angle: 'show' } },
    card: { indicator: 'C1', action: 'Ask two why questions about the poem' },
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

// 867856ac (scale-run shard, 3b3e0d9b5f): the moment is copied WITHOUT quote marks, elided with "...".
const LINE = 'اب یہ ہم نے ریڈنگ کی، میں نے آپ کو کر کے پڑھائی، اس کا مقصود سمجھایا۔ اب آپ لوگ بیٹھے ہوئے ہیں، دو دو کر کے۔ جو پڑھا ہے اس کو ذرا پڑھیں۔';
// R7f 1b: an instruction to read is no gap for an open-questions chapter (not_gap), so this shape is kept on a wait-time chapter
const A867 = {
  seg_id: '10-s2', moment: { at: '12:08', quote: LINE },
  reason_en: '[12:08] Teacher: اب یہ ہم نے ریڈنگ کی، میں نے آپ کو کر کے پڑھائی... جو پڑھا ہے اس کو ذرا پڑھیں۔ Only the teacher read. The clip shows a teacher preparing one easy and one challenge version of a poem task.', // R7b: no claim the chapter cannot back
  reason_ur: '[12:08] Teacher: اب یہ ہم نے ریڈنگ کی، میں نے آپ کو کر کے پڑھائی... جو پڑھا ہے اس کو ذرا پڑھیں۔ اس کلپ میں استاد ایک آسان اور ایک مشکل ورژن تیار کرتے ہیں۔',
  confidence: 0.6,
};

test('867856ac: prefix dropped, the unquoted Urdu moment in one FSI…PDI, no quote mark added (en); prefix only (ur)', async () => {
  const row = await E.recommendForReport({ ...args([{ start_ms: 728000, label: 'Teacher', text: LINE }, { start_ms: 729000, label: 'Student', text: 'جی۔' }]), deps: deps([A867]) });
  expect(row.status).toBe('shown');
  expect(row.reason_en).toBe(`${FSI}اب یہ ہم نے ریڈنگ کی، میں نے آپ کو کر کے پڑھائی... جو پڑھا ہے اس کو ذرا پڑھیں۔${PDI} Only the teacher read. This clip is about: Wait before taking answers.`); // R7f 1b: the fixture names a gap // R7d §6: the clip half is the chapter's title
  expect(row.reason_en).not.toMatch(/"/);
  expect(row.reason_ur).toMatch(/^سبق میں استاد نے بچوں سے پوچھا، "/); // R7j: the terms file's frame
  expect(row.reason_ur).not.toMatch(/\[\d{1,2}:\d{2}\]|Teacher:/);
});

test.each([
  // 2366d25c, 574f7d6b (shards): quoted moments behind a prefix
  ['[10:51] Teacher: "آپ باقی سب غور سے سنیں۔" Clip shows a routine.', `"${FSI}آپ باقی سب غور سے سنیں۔${PDI}" Clip shows a routine.`],
  ['[00:14] Student (UR): "ایچ سی ایف۔" The clip shows a check.', `"${FSI}ایچ سی ایف۔${PDI}" The clip shows a check.`],
  ['Teacher: "سب کتاب کھولیں" The clip shows how to start.', `"${FSI}سب کتاب کھولیں${PDI}" The clip shows how to start.`],
  ['00:00: "سب کتاب کھولیں" The clip shows how to start.', `"${FSI}سب کتاب کھولیں${PDI}" The clip shows how to start.`],
  // red7 081458: a lower-case label at a sentence start (7a2cc41e's shape)
  ['teacher: "All kids mark it." The clip shows pair talk.', `"${FSI}All kids mark it.${PDI}" The clip shows pair talk.`],
  ['The class was quiet. [04:10] Teacher: "سب سنیں" The clip shows wait time.', `The class was quiet. "${FSI}سب سنیں${PDI}" The clip shows wait time.`],
])('copy.composeReason en: %s', (raw, want) => {
  expect(C.composeReason(raw, 'en')).toBe(want);
});

test('Urdu bare label removed in the Urdu reason; nothing else changes', () => {
  expect(C.composeReason('استاد: "سب کتاب کھولیں" اس کلپ میں آغاز دکھایا گیا ہے۔', 'ur')).toBe(`"${FSI}سب کتاب کھولیں${PDI}" اس کلپ میں آغاز دکھایا گیا ہے۔`);
});

test('a reason with no prefix and no Urdu is byte-identical; "the teacher:" inside a sentence is not a label', () => {
  // an in-sentence time ("At 12:08 …") is the model's wording, not a copied prefix: a prompt matter, not this code
  const t = 'At 12:08 the class read aloud together. The clip shows the teacher: modelling first, then pairs.';
  expect(C.composeReason(t, 'en')).toBe(t);
});
