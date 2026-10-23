'use strict';
/**
 * bd-gzfdu9 — select.validate (SPEC v1.2.1 §3.5): checked before anything is stored or sent.
 */
const { validate } = require('../../../bot/shared/services/coaching/video-reco/select');
const C = require('../../../bot/shared/services/coaching/video-reco/catalog');

const cat = C.fromData(require('./fixtures/catalog.fixture.json'));
const shortlist = { candidates: [{ seg_id: '10-s1', indicator: 'C1' }, { seg_id: '11-s1', indicator: 'C1' }] };
const excerpts = ['[03:00] Teacher: Is this a triangle? Yes or no, quickly!', '[03:20] Student: جی ہاں، یہ مثلث ہے۔'];
const UR = 'استاد نے صرف ہاں یا نہیں والے سوال پوچھے؛ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔';
const good = () => ({
  seg_id: '10-s1', moment: { at: '03:00', quote: 'Is this a triangle? Yes or no' },
  reason_en: 'At 03:00 the class only answered yes or no. This clip shows a teacher asking why and how instead.',
  reason_ur: UR, confidence: 0.7,
});
const opts = { stepIndicator: 'C1', source: 'step', catalog: cat, scorerQuote: 'The class said yes all lesson' };

test('a good pick passes, its moment from the transcript', () => {
  expect(validate(good(), shortlist, excerpts, opts)).toEqual({ ok: true, none: null, confidence: 0.7, momentSource: 'transcript' });
});

test('the scorer\'s quote is an accepted moment (moment_source scorer)', () => {
  expect(validate({ ...good(), moment: { at: '03:10', quote: 'the class said yes all lesson' } }, shortlist, excerpts, opts))
    .toMatchObject({ ok: true, momentSource: 'scorer' });
});

test('seg_id null → llm_none; not shortlisted → validation', () => {
  expect(validate({ ...good(), seg_id: null }, shortlist, excerpts, opts)).toMatchObject({ ok: false, none: 'llm_none' });
  expect(validate({ ...good(), seg_id: '12-s1' }, shortlist, excerpts, opts).none).toMatch(/^validation:/);
});

test('indicator path: a chapter that does not name the step → validation (differs is 0 by construction)', () => {
  const sl = { candidates: [...shortlist.candidates, { seg_id: '11-s2', indicator: 'C2' }] };
  expect(validate({ ...good(), seg_id: '11-s2' }, sl, excerpts, opts).none).toMatch(/^validation:/);
});

test('an invented quote → validation; spacing/punctuation/case are fine; Urdu matches; [a student] stands in for a name', () => {
  expect(validate({ ...good(), moment: { at: '03:00', quote: 'Please explain why the sky is blue' } }, shortlist, excerpts, opts).none).toMatch(/^validation:/);
  expect(validate({ ...good(), moment: { at: '03:00', quote: 'is this a  TRIANGLE yes or no' } }, shortlist, excerpts, opts).ok).toBe(true);
  expect(validate({ ...good(), moment: { at: '03:20', quote: 'جی ہاں یہ مثلث ہے' } }, shortlist, excerpts, opts).ok).toBe(true);
  const ex = ['[05:00] Teacher: [a student], tum batao is this a triangle', '[05:01] Student: جی۔'];
  expect(validate({ ...good(), moment: { at: '05:00', quote: '[a student], tum batao is this a triangle' } }, shortlist, ex, opts).ok).toBe(true);
  expect(validate({ ...good(), moment: null }, shortlist, excerpts, opts).none).toMatch(/^validation:/);
});

test('reason_en 20–400 code points; reason_ur ≥ 60% Arabic script (English pedagogy terms allowed)', () => {
  expect(validate({ ...good(), reason_en: 'Too short.' }, shortlist, excerpts, opts).none).toMatch(/^validation:/);
  expect(validate({ ...good(), reason_en: 'x'.repeat(401) }, shortlist, excerpts, opts).none).toMatch(/^validation:/);
  expect(validate({ ...good(), reason_ur: 'The teacher asked yes/no questions only, so watch this.' }, shortlist, excerpts, opts).none).toMatch(/^validation:/);
  expect(validate({ ...good(), reason_ur: `${UR} open-ended questions` }, shortlist, excerpts, opts).ok).toBe(true);
});

test('H8: the teacher\'s own name in a quote or reason → validation', () => {
  const named = { ...good(), reason_en: 'At 03:00 Saima Khan asked only yes or no questions; this clip shows why and how.' };
  expect(validate(named, shortlist, excerpts, { ...opts, teacherName: 'Saima Khan' }).none).toMatch(/^validation:/);
  expect(validate(good(), shortlist, excerpts, { ...opts, teacherName: 'Saima Khan' }).ok).toBe(true);
});

test('approx aliases: a chapter for any of the target\'s indicators passes', () => {
  const sl = { candidates: [{ seg_id: '11-s2', indicator: 'C2' }] };
  expect(validate({ ...good(), seg_id: '11-s2' }, sl, excerpts, { ...opts, stepIndicator: 'F5', indicators: ['F5', 'C2'] }).ok).toBe(true);
});

test('card_text path: any shortlisted chapter is fine', () => {
  const sl = { candidates: [{ seg_id: '11-s2', indicator: 'C2' }] };
  expect(validate({ ...good(), seg_id: '11-s2' }, sl, excerpts, { ...opts, source: 'card_text', stepIndicator: null }).ok).toBe(true);
});

test('confidence clamped; junk → validation, never a throw', () => {
  expect(validate({ ...good(), confidence: 7 }, shortlist, excerpts, opts).confidence).toBe(1);
  expect(validate({ ...good(), confidence: 'x' }, shortlist, excerpts, opts).confidence).toBe(0);
  expect(validate(null, shortlist, excerpts, opts).none).toMatch(/^validation:/);
  expect(validate('text', null, null, null).none).toMatch(/^validation:/);
});
