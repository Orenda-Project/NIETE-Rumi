'use strict';
/**
 * bd-gzfdu9 — select.validate: what the model returns is checked before anything is stored or sent
 * (SPEC §3.5). An invented quote, an unknown clip or a weak "different indicator" pick is a none.
 */
const { validate } = require('../../../bot/shared/services/coaching/video-reco/select');
const C = require('../../../bot/shared/services/coaching/video-reco/catalog');

const cat = C.fromData(require('./fixtures/catalog.fixture.json'));
const shortlist = { candidates: [{ seg_id: '10-s1', indicator: 'C1' }, { seg_id: '11-s2', indicator: 'C2' }] };
const excerpts = ['[03:00] Teacher: Is this a triangle? Yes or no, quickly!', '[03:20] Student: جی ہاں، یہ مثلث ہے۔'];
const UR = 'استاد نے صرف ہاں یا نہیں والے سوال پوچھے؛ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔';
const good = () => ({
  seg_id: '10-s1', differs_from_step: false, moment: { at: '03:00', quote: 'Is this a triangle? Yes or no' },
  reason_en: 'At 03:00 the class only answered yes or no. This clip shows a teacher asking why and how instead.',
  reason_ur: UR, confidence: 0.7,
});
const opts = { stepIndicator: 'C1', catalog: cat };

test('a good pick passes', () => {
  expect(validate(good(), shortlist, excerpts, opts)).toEqual({ ok: true, none: null, differs: false, confidence: 0.7 });
});

test('seg_id null → llm_none', () => {
  expect(validate({ ...good(), seg_id: null, none_reason: 'nothing fits' }, shortlist, excerpts, opts)).toMatchObject({ ok: false, none: 'llm_none' });
});

test('a clip not in the shortlist → validation', () => {
  expect(validate({ ...good(), seg_id: '12-s1' }, shortlist, excerpts, opts)).toMatchObject({ ok: false, none: 'validation' });
});

test('an invented quote → validation; punctuation/spacing/case differences are fine; Urdu quotes match', () => {
  expect(validate({ ...good(), moment: { at: '03:00', quote: 'Please explain why the sky is blue' } }, shortlist, excerpts, opts).none).toBe('validation');
  expect(validate({ ...good(), moment: { at: '03:00', quote: 'is this a  TRIANGLE yes or no' } }, shortlist, excerpts, opts).ok).toBe(true);
  expect(validate({ ...good(), moment: { at: '03:20', quote: 'جی ہاں یہ مثلث ہے' } }, shortlist, excerpts, opts).ok).toBe(true);
  expect(validate({ ...good(), moment: null }, shortlist, excerpts, opts).none).toBe('validation');
});

test('reason_en must be 20–400 code points', () => {
  expect(validate({ ...good(), reason_en: 'Too short.' }, shortlist, excerpts, opts).none).toBe('validation');
  expect(validate({ ...good(), reason_en: 'x'.repeat(401) }, shortlist, excerpts, opts).none).toBe('validation');
});

test('reason_ur must be ≥ 60% Arabic-script letters (pedagogy terms in English letters are allowed)', () => {
  expect(validate({ ...good(), reason_ur: 'The teacher asked yes/no questions only, so watch this.' }, shortlist, excerpts, opts).none).toBe('validation');
  expect(validate({ ...good(), reason_ur: `${UR} open-ended questions` }, shortlist, excerpts, opts).ok).toBe(true);
});

test('a clip for another indicator needs confidence ≥ 0.8, whatever differs_from_step says', () => {
  const other = { ...good(), seg_id: '11-s2' };
  expect(validate({ ...other, differs_from_step: true, confidence: 0.79 }, shortlist, excerpts, opts).none).toBe('validation');
  expect(validate({ ...other, differs_from_step: false, confidence: 0.5 }, shortlist, excerpts, opts).none).toBe('validation');
  expect(validate({ ...other, differs_from_step: true, confidence: 0.85 }, shortlist, excerpts, opts)).toMatchObject({ ok: true, differs: true });
});

test('differs_from_step:true on a clip that does name the step → validation', () => {
  expect(validate({ ...good(), differs_from_step: true, confidence: 0.9 }, shortlist, excerpts, opts).none).toBe('validation');
});

test('a forced differ (the C1 trap) is not held to the 0.8 rule', () => {
  expect(validate({ ...good(), seg_id: '11-s2', confidence: 0.4 }, shortlist, excerpts, { ...opts, forcedDiffer: true })).toMatchObject({ ok: true, differs: true });
});

test('red-team H8: [a student] stands in for a name and still matches; the teacher\'s own name is refused', () => {
  const ex = ['[05:00] Teacher: Ahmed, tum batao is this a triangle'];
  expect(validate({ ...good(), moment: { at: '05:00', quote: '[a student], tum batao is this a triangle' } }, shortlist, ex, opts).ok).toBe(true);
  const named = { ...good(), reason_en: 'At 03:00 Saima Khan asked only yes or no questions; this clip shows why and how.' };
  expect(validate(named, shortlist, excerpts, { ...opts, teacherName: 'Saima Khan' }).none).toBe('validation');
  expect(validate(good(), shortlist, excerpts, { ...opts, teacherName: 'Saima Khan' }).ok).toBe(true);
});

test('confidence is clamped to 0–1', () => {
  expect(validate({ ...good(), confidence: 7 }, shortlist, excerpts, opts).confidence).toBe(1);
  expect(validate({ ...good(), confidence: 'x' }, shortlist, excerpts, opts).confidence).toBe(0);
});

test('junk → validation, never a throw', () => {
  expect(validate(null, shortlist, excerpts, opts).none).toBe('validation');
  expect(validate('text', null, null, null).none).toBe('validation');
});
