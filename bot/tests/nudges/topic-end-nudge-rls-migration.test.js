'use strict';
/**
 * bd-pw1ccr.18 — V1.8.4 created niete_topic_nudge_ab_assignment without row level security. V1.8.7 turns it on with
 * no policies (the V1.6.19 convention), so anon/authenticated see nothing; the bot uses the service role.
 */
const fs = require('fs');
const path = require('path');

jest.mock('../../shared/config/supabase', () => ({}));
const { TABLE } = require('../../shared/services/nudges/topic-end-arm');

const dir = path.join(__dirname, '../../../infrastructure/supabase/migrations');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const code = (sql) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('V1.8.7 enables RLS on the table the arm reads, and adds no policy', () => {
  const up = code(read('V1.8.7__topic_nudge_ab_rls.sql'));
  expect(up).toMatch(new RegExp(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;`));
  expect(up).not.toMatch(/CREATE POLICY/i);
  expect(up).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/);
});

test('its rollback turns RLS back off on that table', () => {
  expect(code(read('ROLLBACK_V1.8.7__topic_nudge_ab_rls.sql'))).toMatch(new RegExp(`ALTER TABLE ${TABLE} DISABLE ROW LEVEL SECURITY;`));
});
