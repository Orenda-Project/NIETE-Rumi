'use strict';
/** bd-pw1ccr.8.4 — V1.8.5 seeds the FA video switch OFF without overwriting a live value; the rollback removes it. */
const fs = require('fs');
const path = require('path');
const { FLAG_KEY } = require('../../shared/services/fa-video/broadcast');

const dir = path.join(__dirname, '../../../infrastructure/supabase/migrations');
const up = fs.readFileSync(path.join(dir, 'V1.8.5__fa_video_broadcast.sql'), 'utf8');
const code = (sql) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const down = fs.readFileSync(path.join(dir, 'ROLLBACK_V1.8.5__fa_video_broadcast.sql'), 'utf8');

test('the switch is seeded off, without overwriting a live value, and nothing else changes', () => {
  expect(up).toMatch(new RegExp(`'${FLAG_KEY}', 'false'::jsonb`));
  expect(up.match(/ON CONFLICT \(key\) DO NOTHING/g)).toHaveLength(1);
  expect(code(up)).not.toMatch(/CREATE TABLE|ALTER TABLE|DROP |\bBEGIN\b|\bCOMMIT\b/);
});

test('the rollback deletes only the switch', () => {
  expect(down).toMatch(new RegExp(`DELETE FROM app_settings WHERE key = '${FLAG_KEY}'`));
  expect(code(down)).not.toMatch(/DROP |ALTER TABLE/);
});
