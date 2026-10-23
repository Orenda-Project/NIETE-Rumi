'use strict';
/**
 * V1.7.7 swaps the lesson_plan_requests source CHECK (DROP + ADD + VALIDATE takes an ACCESS EXCLUSIVE lock).
 * Both directions must bound the wait for that lock, so a busy table makes the migration fail fast instead
 * of queueing every reader behind it.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../infrastructure/supabase/migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const LOCK = /set_config\('lock_timeout',\s*'5s',\s*true\)/;

test.each([
  ['forward', 'V1.7.7__lp_source_freeform.sql'],
  ['rollback', 'ROLLBACK_V1.7.7__lp_source_freeform.sql'],
])('%s sets lock_timeout before it touches the constraint', (_n, file) => {
  const sql = read(file);
  const lock = sql.search(LOCK);
  const drop = sql.indexOf('DROP CONSTRAINT');
  expect(lock).toBeGreaterThanOrEqual(0);
  expect(drop).toBeGreaterThan(lock);
});
