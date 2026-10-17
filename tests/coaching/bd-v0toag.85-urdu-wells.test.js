'use strict';
/**
 * bd-v0toag.85: "what you did well" showed English on Urdu report pages. The grader writes its strengths in
 * English for everyone; the Urdu line is the report narrative's strength_note, written in her language.
 */
const { wells } = require('../../bot/shared/services/coaching/report-card');

const NOTE = 'آپ نے بچوں کو بولنے کا موقع دیا۔';
const A = {
  strengths: [{ title: 'Clear board work' }, 'Called children by name'],
  lp_fidelity: { strengths: [{ move_id: 'm4', text: 'Count in tens with sticks' }] },
  report_narrative: { _language: 'ur', strength_name: 'Student Talk', strength_note: NOTE },
};

test('ur: the stored Urdu strength_note, no English grader text', () => {
  expect(wells(A, 'ur')).toEqual([NOTE]);
});

test('ur: a narrative passed in (the slim card, before it is stored) is used the same way', () => {
  const { report_narrative: n, ...bare } = A;
  expect(wells(bare, 'ur', n)).toEqual([NOTE]);
});

test('ur: no narrative, or one in another language, gives nothing rather than English', () => {
  const { report_narrative: n, ...bare } = A;
  expect(wells(bare, 'ur')).toEqual([]);
  expect(wells({ ...bare, report_narrative: { ...n, _language: 'en' } }, 'ur')).toEqual([]);
  expect(wells({ ...bare, report_narrative: { _language: 'ur', strength_note: '  ' } }, 'ur')).toEqual([]);
});

test('en: unchanged, the swap then the grader strengths', () => {
  expect(wells(A, 'en')).toEqual(['You did “Count in tens with sticks” your own way, and it worked better.', 'Clear board work', 'Called children by name']);
});
