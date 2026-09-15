'use strict';
/**
 * The users history trigger must watch the columns users actually has.
 *
 * log_row_changes() reads each watched column out of to_jsonb(OLD) and
 * to_jsonb(NEW) BY NAME. A column that was renamed or dropped is not an error
 * there: it is null on both sides, so the trigger silently records nothing for
 * it. V1.4.5 renamed users.training_bands to users.teacher_level and left the
 * trigger on the old name. In production the next ten hours wrote 446 users
 * history rows and not one carried a level change, while 17 teachers' levels
 * moved (5 of them coach edits).
 *
 * The SQL that runs and the JS mirror in scripts/row-history-audit.js must
 * agree, so these tests read the trigger out of the migrations themselves.
 */
const fs = require('fs');
const path = require('path');
const { WATCHED } = require('../../scripts/row-history-audit');

const ROOT = path.join(__dirname, '..', '..');

// Columns the users table no longer has, and the migration that removed them.
const GONE_FROM_USERS = {
  first_name: 'V1.4.4', last_name: 'V1.4.4',
  levels: 'V1.4.5', grade: 'V1.4.5', training_bands: 'V1.4.5 (renamed to teacher_level)',
};

const version = (name) => (name.match(/^V(\d+)\.(\d+)\.(\d+)__/) || []).slice(1).map(Number);
const byVersion = (a, b) => {
  const [x, y] = [version(a), version(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

/**
 * The users_history_trigger definition that wins: the historical migrations in
 * bot/database/migrations run first, then the versioned ones in order, and the
 * last CREATE TRIGGER for users is the one the database carries.
 */
function effectiveUsersTrigger() {
  const files = [];
  const legacy = path.join(ROOT, 'bot/database/migrations');
  fs.readdirSync(legacy).filter((n) => n.endsWith('.sql') && !/rollback/i.test(n)).sort()
    .forEach((n) => files.push(path.join(legacy, n)));
  const versioned = path.join(ROOT, 'infrastructure/supabase/migrations');
  fs.readdirSync(versioned).filter((n) => /^V\d+\.\d+\.\d+__.*\.sql$/.test(n)).sort(byVersion)
    .forEach((n) => files.push(path.join(versioned, n)));

  let last = null;
  for (const file of files) {
    const sql = fs.readFileSync(file, 'utf8').replace(/--[^\n]*/g, '');
    const re = /CREATE\s+TRIGGER\s+users_history_trigger[\s\S]*?log_row_changes\(([\s\S]*?)\)\s*;/gi;
    let m;
    while ((m = re.exec(sql))) {
      last = { file: path.relative(ROOT, file), args: m[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1)) };
    }
  }
  return last;
}

describe('record_history — the users trigger watches real columns', () => {
  test('the trigger that runs watches teacher_level', () => {
    const trigger = effectiveUsersTrigger();
    expect(trigger).not.toBeNull();
    expect(trigger.args).toContain('teacher_level');
  });

  test('the trigger that runs names no column users has lost', () => {
    const { args, file } = effectiveUsersTrigger();
    const stale = args.filter((c) => GONE_FROM_USERS[c]);
    expect({ file, stale }).toEqual({ file, stale: [] });
  });

  test('the SQL allowlist and the JS mirror name the same columns', () => {
    const { args } = effectiveUsersTrigger();
    expect(args[0]).toBe('id');
    expect(args.slice(1)).toEqual(WATCHED.users);
  });

  test('the JS mirror watches teacher_level and no lost column', () => {
    expect(WATCHED.users).toContain('teacher_level');
    expect(WATCHED.users.filter((c) => GONE_FROM_USERS[c])).toEqual([]);
  });
});
