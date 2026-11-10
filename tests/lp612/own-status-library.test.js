'use strict';
/**
 * bd-snkn32.16 — her own-plan status read carries the AI reviewer's verdict for the library: library_eligible
 * (false until reviewed and passed) and the score (null until reviewed). Her status itself is unchanged by it.
 */
const { createOwnService, OWN_READ } = require('../../bot/shared/services/lp612-own.service');

const ROW = {
  id: 'own-1', user_id: 'u1', segment_id: 's1', lesson_id: null, status: 'ready', r2_key: 'lp612/x.pdf',
  error_code: null, lang: 'en', started_at: 't0', completed_at: 't1',
};
const svc = (row) => createOwnService({ selectOwn: jest.fn(async () => row), log: jest.fn() });

test('a reviewed, passing plan reads as library-eligible with its score', async () => {
  const out = await svc({ ...ROW, library_eligible: true, review_score: 91.2 }).ownStatus('own-1', 'u1');
  expect(out).toMatchObject({ status: 'ready', library_eligible: true, review_score: 91.2 });
});

test('a plan not yet reviewed (or the reviewer failed) reads as not eligible, score null, still ready', async () => {
  const out = await svc({ ...ROW }).ownStatus('own-1', 'u1');
  expect(out).toMatchObject({ status: 'ready', library_eligible: false, review_score: null });
});

test('the live read selects the review columns', () => {
  expect(OWN_READ).toMatch(/library_eligible/);
  expect(OWN_READ).toMatch(/review_score/);
});
