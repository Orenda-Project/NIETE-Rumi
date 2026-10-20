'use strict';
/**
 * The child's page parameters (dashboard/sa/sa-page.js): only a known battery name, a session id of the expected
 * shape and a same-origin way back are taken; the first name comes from the fragment only; a block runs its tasks.
 */
const { params, pick } = require('../sa/sa-page');

test('the page reads its link strictly', () => {
  expect(params('?s=3f1c2d4e-aaaa-4bbb-8ccc-123456789abc&form=sa.coach.G3.A.ur&mode=proctored&block=B2&back=/portal/leader/sa', '#n=Ali%20Testwala')).toEqual({
    session_id: '3f1c2d4e-aaaa-4bbb-8ccc-123456789abc', form: 'sa.coach.G3.A.ur', mode: 'proctored', lang: 'ur', block: 'B2',
    back: '/portal/leader/sa', skin: null, first_name: 'Ali Testwala',
  });
  const bad = params('?s=x&form=../../etc&mode=root&block=B99&back=//evil.example/x&n=Name', '');
  expect(bad).toMatchObject({ session_id: null, form: null, mode: 'proctored', block: null, back: null, first_name: null });
  expect(params('?s=abcdef12&form=sa.game.G23.en&mode=game&skin=game', '').lang).toBe('en');
  expect(params('?back=https://evil.example', '').back).toBeNull();
});

test('a block runs its own tasks in its own order; no blocks or "full" runs them all', () => {
  const b = { battery_id: 'x', tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], blocks: { B1: ['c', 'a'] } };
  expect(pick(b, 'B1').tasks.map((t) => t.id)).toEqual(['c', 'a']);
  expect(pick(b, 'B1').battery_id).toBe('x#B1');
  expect(pick(b, 'full')).toBe(b);
  expect(pick(b, 'B4')).toBe(b);
  expect(pick({ tasks: [{ id: 'a' }] }, 'B1').tasks).toHaveLength(1);
});

test('a game island or the tower runs its own tasks', () => {
  const b = { battery_id: 'g', tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], islands: { maths: ['b'] }, tower: ['c', 'a'] };
  expect(pick(b, 'maths').tasks.map((t) => t.id)).toEqual(['b']);
  expect(pick(b, 'tower').tasks.map((t) => t.id)).toEqual(['c', 'a']);
  expect(params('?s=abcdef12&form=sa.game.G23.ur&mode=game&block=maths', '').block).toBe('maths');
});
