'use strict';
/**
 * infrastructure/scripts/ab-ledger-backfill.sql (bd-9nb6s0.2): the two pre-ledger ICT tests into ab_card_lock and
 * ab_assignment. SQL-text contract (no database; run live on a throwaway Postgres by the workspace's
 * ab-testing/scripts/test_ledger_pg.py).
 */
const fs = require('fs');
const path = require('path');

const SQL = fs.readFileSync(path.join(__dirname, '../../infrastructure/scripts/ab-ledger-backfill.sql'), 'utf8')
  .replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();

test('stops before any write unless each draw table holds its seed\'s exact school count', () => {
  expect(SQL).toContain("where seed = 'coach-ab-v10-2026#11'");
  expect(SQL).toContain("where seed = 'lp-ab-ch310-2026#6'");
  expect(SQL).toMatch(/if v_coach <> 340 or v_lp <> 374 then raise exception/);
  expect(SQL.indexOf('raise exception')).toBeLessThan(SQL.indexOf('insert into'));
});

test('writes only the ab_ tables, and is idempotent', () => {
  for (const m of SQL.matchAll(/(?:insert into|update|delete from) (?:public\.)?(\w+)/g)) expect(m[1]).toMatch(/^ab_/);
  expect(SQL).not.toMatch(/delete from|truncate|drop /);
  expect(SQL.match(/on conflict/g)).toHaveLength(3);
});

test('the coaching test is running with its default declared; the LP test is concluded with its call', () => {
  expect(SQL).toMatch(/\('ict-v10-coaching',.*'running', 'a', 'ab_v10_enabled'/);
  expect(SQL).toMatch(/\('ict-lp-ch3-8',.*'concluded', null, 'ab_lp_ch310_enabled'.*'no_bar'/);
});

test('arms are the draw letters lower-cased, unit ids only', () => {
  expect(SQL.match(/lower\(a\.ab_group\)/g)).toHaveLength(2);
  expect(SQL).not.toMatch(/phone_number|first_name|email/);
});
