'use strict';
/** V1.6.19 — RLS on assessment_topics, no policies (the bot reads with the service role). SQL-text contract test. */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../../infrastructure/supabase/migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const UP = read('V1.6.19__assessment_topics_rls.sql');
const DOWN = read('ROLLBACK_V1.6.19__assessment_topics_rls.sql');

test('the forward file enables RLS on assessment_topics and nothing else', () => {
  expect(UP).toBe('alter table assessment_topics enable row level security;');
});

test('no policies or grants: the service role bypasses RLS', () => {
  expect(UP).not.toMatch(/create policy|grant /);
});

test('the rollback disables RLS on assessment_topics and nothing else', () => {
  expect(DOWN).toBe('alter table assessment_topics disable row level security;');
});
