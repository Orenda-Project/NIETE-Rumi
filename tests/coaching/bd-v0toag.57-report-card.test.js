'use strict';
/**
 * v10 coaching test (bd-v0toag.57): the card's content, shared by the /cr page (.55) and the slim WhatsApp
 * image, so the two always say the same thing. Pure.
 */
const { stepOf, wells, cardHeader, pktDate } = require('../../bot/shared/services/coaching/report-card');

const A = {
  grade: 2, subject: 'Maths', topic: 'Adding tens',
  scores: { overall_percentage: 61.4, overall_marks: 90, overall_max_marks: 148 },
  strengths: [{ title: 'Clear board work' }, 'Called children by name', { title: 'Kept the plan order' }],
  lp_fidelity: { strengths: [{ move_id: 'm4', text: 'Count in tens with sticks' }] },
};

test('stepOf: the plan phase → the template step, null for an unknown phase', () => {
  expect(stepOf('warm_up')).toEqual({ name: 'Opening', index: 1 });
  expect(stepOf('explain')).toEqual({ name: 'Explanation', index: 2 });
  expect(stepOf('guided')).toEqual({ name: 'We Do', index: 3 });
  expect(stepOf('independent')).toEqual({ name: 'You Do', index: 4 });
  expect(stepOf('peer_review')).toEqual({ name: 'Check', index: 5 });
  expect(stepOf('preview')).toBeNull();
  expect(stepOf(null)).toBeNull();
});

test('wells: a better swap first, then the grader\'s strengths, three at most', () => {
  expect(wells(A, 'en')).toEqual(['You did “Count in tens with sticks” your own way, and it worked better.', 'Clear board work', 'Called children by name']);
  expect(wells(A, 'ur')[0]).toBe('آپ نے «Count in tens with sticks» اپنے طریقے سے کیا، اور وہ بہتر رہا۔');
  expect(wells({}, 'en')).toEqual([]);
  expect(wells({ strengths: ['  ', null, { title: '' }] }, 'en')).toEqual([]);
});

test('cardHeader: first name, grade · subject · topic, PKT date, rounded score', () => {
  expect(cardHeader({ created_at: '2026-10-19T20:30:00Z' }, A, 'Sadia', 'en'))
    .toEqual({ name: 'Sadia', meta: 'Grade 2 · Maths · Adding tens', date: '20 Oct 2026', pct: 61, marks: 90, max: 148 });
  expect(cardHeader({}, A, '', 'ur').meta).toBe('جماعت 2 · Maths · Adding tens');
  expect(cardHeader({}, {}, null, 'en')).toEqual({ name: '', meta: '', date: '', pct: null, marks: null, max: null });
});

test('pktDate: a bad date is empty', () => {
  expect(pktDate('nope')).toBe('');
});
