'use strict';
/**
 * PR-E (m-links) — the FLN landing target a /go token may carry: `fln:<plan id>` → the plan page.
 * Pure module: no env, no I/O.
 */
const { FLN_TARGET, isFlnTarget, flnPathFor } = require('../../bot/shared/services/fln-go-target');

test('fln:<digits> is a target and lands on the plan page with ?src=send', () => {
  expect(isFlnTarget('fln:11156')).toBe(true);
  expect(flnPathFor('fln:11156')).toBe('/portal/fln/p/11156?src=send');
  expect(flnPathFor('fln:1')).toBe('/portal/fln/p/1?src=send');
  expect(flnPathFor('fln:123456789')).toBe('/portal/fln/p/123456789?src=send');
});

test.each([
  ['fln:'], ['fln:abc'], ['fln:12a'], ['fln:-1'], ['fln:1234567890'], ['FLN:1'], [' fln:1'], ['fln:1 '],
  ['fln:1/../x'], ['lesson_plan'], ['menu'], [''], [null], [undefined], [42], [{}],
])('%p is not a target and has no path', (f) => {
  expect(isFlnTarget(f)).toBe(false);
  expect(flnPathFor(f)).toBeNull();
});

test('the pattern is anchored and bounded (1..9 digits)', () => {
  expect(FLN_TARGET.source).toBe('^fln:(\\d{1,9})$');
});
