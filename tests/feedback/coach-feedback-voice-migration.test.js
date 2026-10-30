/**
 * bd-x1tl95 — Send feedback and Report an issue (bd-whlsm0) are one form, so they are one table: coach_feedback
 * gains the voice message, its transcript, the screenshots, where it was sent from and when the team was told, and
 * a voice message alone is enough (message may be NULL, never both empty). app_feedback is never created.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../bot/database/migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

describe('coach_feedback_voice migration', () => {
  const sql = read('coach_feedback_voice.sql');

  test('requires coach_feedback and adds each column once, idempotently', () => {
    expect(sql).toMatch(/--\s*requires:\s*coach_feedback\.sql/);
    for (const col of ['audio_key', 'audio_transcript', 'photo_keys', 'context', 'notified_at']) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`));
      expect(sql).toMatch(new RegExp(`COMMENT ON COLUMN public\\.coach_feedback\\.${col} IS '\\[(Internal|Confidential|PII)\\]`));
    }
  });

  test('a voice message alone is enough, but never nothing at all; at most three screenshots', () => {
    expect(sql).toMatch(/ALTER COLUMN message DROP NOT NULL/);
    expect(sql).toMatch(/CHECK \(message IS NOT NULL OR audio_key IS NOT NULL\)/);
    expect(sql).toMatch(/CHECK \(cardinality\(photo_keys\) <= 3\)/);
  });

  test('no transaction control (exec_sql refuses it) and a rollback beside it', () => {
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
    expect(read('coach_feedback_voice_rollback.sql')).toMatch(/DROP COLUMN IF EXISTS audio_key/);
  });

  test('there is no second feedback table', () => {
    const versioned = path.join(__dirname, '../../infrastructure/supabase/migrations');
    expect(fs.readdirSync(versioned).filter((f) => /app_feedback/.test(f))).toEqual([]);
    const schema = fs.readFileSync(path.join(__dirname, '../../infrastructure/supabase/00_complete-schema.sql'), 'utf8');
    expect(schema).not.toMatch(/CREATE TABLE IF NOT EXISTS app_feedback/);
    expect(schema).toMatch(/ALTER TABLE coach_feedback ADD COLUMN IF NOT EXISTS audio_key/);
  });
});
