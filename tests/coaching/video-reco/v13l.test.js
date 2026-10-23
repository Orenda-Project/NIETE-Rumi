'use strict';
/**
 * bd-8hhqhf (VIDREC round 7, COS 081156 = the panel's option 1, ped-scale 081136): a teacher-facing reason never carries
 * a clock time or a speaker label; it opens at the lesson moment in words. The prompt asked for "the [mm:ss] and a short
 * quote" in the reason, so the model wrote «At 12:08 …» / «[10:51] Teacher: …». Prompt vr-6: the time lives only in
 * moment.at (validation still needs it); the reason describes the moment in words.
 */
const P = require('../../../bot/shared/services/coaching/video-reco/prompt');

const FIX = require('./fixtures/catalog.fixture.json');
const C = require('../../../bot/shared/services/coaching/video-reco/catalog');

const text = () => P.build({
  target: { indicator: 'C1', indicators: ['C1'], moves: [], source: 'step', scheme: 'fico_v4' },
  rationale: 'Few open questions', tryText: 'Ask two why questions', subject: 'urdu',
  excerpts: ['[00:30] Teacher: is this a triangle? Yes or no'], candidates: [{ seg_id: '10-s1', indicator: 'C1' }],
  catalog: C.fromData(FIX), scorerQuote: '', uptakeQuote: '', topRung: 2, reportLanguage: 'ur', lessonLanguage: 'ur',
});

test('PROMPT_VERSION is vr-9 (vr-6 + R7b + R7c)', () => expect(P.PROMPT_VERSION).toBe('vr-9'));

test('rule 2 no longer asks for "the [mm:ss]" in the reason', () => {
  expect(text()).not.toMatch(/cite ONE real moment: the \[mm:ss\]/);
});

test('the prompt tells the model: no clock time and no speaker label in reason_en / reason_ur; the time goes in moment.at', () => {
  const t = text();
  expect(t).toMatch(/never write a clock time/i);
  expect(t).toMatch(/speaker label/i);
  expect(t).toMatch(/moment\.at/);
});

test('the JSON shape still asks for moment.at as mm:ss (validation needs it)', () => {
  expect(text()).toMatch(/"moment": \{"at": "mm:ss"/);
});
