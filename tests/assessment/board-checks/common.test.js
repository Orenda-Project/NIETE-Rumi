'use strict';
const { q, issue } = require('../../../bot/shared/services/assessment/board-checks/common');

test('q rounds to quarter-marks exactly', () => {
  expect(q(0.5)).toBe(2);
  expect(q(2.5) + q(2.5) + q(1)).toBe(q(6));
  expect(q(null)).toBe(0);
});

test('issue builds the contract shape plus rule/slot', () => {
  expect(issue('D12', 'TOTAL', 'x#1', 'msg', true, 'x')).toEqual({ check: 'D12', rule: 'TOTAL', item_ref: 'x#1', msg: 'TOTAL: msg', hard: true, slot: 'x' });
  expect(issue('D13', 'R', 'r', 'm', false).slot).toBeUndefined();
});
