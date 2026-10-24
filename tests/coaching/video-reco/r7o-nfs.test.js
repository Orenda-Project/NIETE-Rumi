'use strict';
/**
 * bd-8hhqhf R7o-b, not_for_subjects (eng-fix 20261024T210903, red7 211001, COS 210937 §2, ped-scale 211122).
 * notFor() read the free-text not_for prose word by word, so a module was refused the very subject it carries: 95's
 * «…it is in English only» kept 95-s3 (list A) from every English lesson; maths modules' «…maths lessons» kept them from
 * maths. The catalogue now carries the panel's reading as `not_for_subjects`; the engine reads that list when present and
 * never the prose. The intended narrowings (32/33 not for Urdu, 44 not for English) are kept.
 */
const SHIPPED = require('../../../bot/shared/data/video-catalog.v1.json');

let SH;
let C;
let E;
beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase'); }) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  SH = require('../../../bot/shared/services/coaching/video-reco/shortlist');
  C = require('../../../bot/shared/services/coaching/video-reco/catalog');
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
});
const mod = (id) => SHIPPED.modules.find((m) => m.module_id === id);

describe('the shipped catalogue, read through not_for_subjects (notFor: is this lesson subject excluded?)', () => {
  test.each([[95, 'english', false], [95, 'urdu', false], [13, 'maths', false], [13, 'english', true], [44, 'urdu', false],
    [32, 'urdu', true], [33, 'urdu', true], [44, 'english', true]])('module %p, a %s lesson → excluded %p', (id, subject, out) => {
    expect(SH.notFor(mod(id), subject)).toBe(out);
  });
  test('every shipped module carries the list, and none excludes a subject its own subjects carry', () => {
    for (const m of SHIPPED.modules) {
      expect(Array.isArray(m.not_for_subjects)).toBe(true);
      const own = new Set((m.subjects || []).map((x) => String(x).toLowerCase()));
      expect(m.not_for_subjects.filter((x) => own.has(x))).toEqual([]);
    }
  });
});

describe('the list wins over the prose; no list → the prose, as before', () => {
  const prose = { module_id: 900, subjects: ['maths'], not_for: 'Teachers outside Grades 3-5 maths lessons; it is in English only.', segments: [] };
  test('an empty list: a maths lesson is not excluded whatever the prose says', () => {
    expect(SH.notFor({ ...prose, not_for_subjects: [] }, 'maths')).toBe(false);
    expect(SH.notFor({ ...prose, not_for_subjects: [] }, 'english')).toBe(false);
  });
  test('a listed subject is excluded', () => {
    expect(SH.notFor({ ...prose, not_for_subjects: ['science'] }, 'science')).toBe(true);
  });
  test('control: no list → the prose is read as before (maths and English excluded)', () => {
    expect(SH.notFor(prose, 'maths')).toBe(true);
    expect(SH.notFor(prose, 'english')).toBe(true);
  });
});

describe('engine: an English reader on an English lesson can now be sent 95-s3 (Z228 shape)', () => {
  const T = (mmss, who, text) => ({ start_ms: ((+mmss.split(':')[0] * 60) + +mmss.split(':')[1]) * 1000, label: who, text });
  const EN = [T('01:00', 'Teacher', 'You came by bus, very good. Did you like it?'), T('01:04', 'Student', 'Yes'), T('01:08', 'Teacher', 'It was a big bus, no?'), T('01:12', 'Student', 'Yes'),
    T('01:16', 'Teacher', 'Good. Open your books to page five.'), T('01:20', 'Student', 'Okay'), T('01:24', 'Teacher', 'Is this a cat? Yes?'), T('01:28', 'Student', 'Yes')];
  test('card mode, a why card: shown 95-s3, not no_target', async () => {
    const row = await E.recommendForReport({
      session: { id: 's1', user_id: 'u1', transcript_language: 'en', users: { name: 'Saima Khan', preferred_language: 'en' }, diarization_data: { segments: EN } },
      analysis: { framework: 'fico', indicator_scheme: 'fico_main_37', domains: {}, subject_resolution: { code: 'english', grade: '4', confidence: 'high' } },
      nextStep: null, card: { indicator: null, action: "Pick two sentences from the story and ask: 'Why did he do this? Give one reason.' Wait 5–8 seconds, then cold-call two students." }, coachingSessionId: 's1',
      deps: { env: { VIDEO_RECO_ENABLED: 'true', VIDEO_RECO_REASON: 'card' }, catalog: C.fromData(SHIPPED), store: { readForSession: async () => null, recentHistory: async () => ({ segments: [], modules: [] }), ladderProgress: async () => ({ level: 4, completedModules: [] }), trainingBands: async () => [], write: async (r) => r }, v10GroupFor: async () => null,
        completeJson: async () => { throw new Error('card mode makes no model call'); } },
    });
    expect(row).toMatchObject({ status: 'shown', seg_id: '95-s3' });
  });
});
