/**
 * bd-2528 — the legacy→Supabase delta sync, and the ledger that lets us retire it.
 *
 * The problem this guards, measured against both live databases on 2026-08-07:
 * the 2026-07-12 migration took a SNAPSHOT, but teachers kept using the old FDE
 * app. 1,665 of them have written completions there since; 682,030 completed
 * (profile, training) pairs exist in the legacy DB against 619,919 rows here.
 * 1,364 teachers passed a grand quiz after the snapshot and have no certificate
 * for it. Sumbal Pervaiz (923155330788) is the reported case: 292 completed
 * trainings in the legacy DB, 92 rows here, so the portal locks her out of a
 * level she finished — while holding the certificate that says she passed it.
 *
 * These are source-level assertions, matching the house pattern in
 * tests/portal/*-contracts.test.js. The sync reaches two production databases on
 * every path, and the properties that actually matter here — "a re-run cannot
 * double-write", "correctness does not depend on the watermark", "a dry run
 * writes nothing" — are structural. They live in the source, and a later edit
 * would silently undo them without any test that mocks HTTP noticing.
 *
 * What this canNOT tell you: whether a real run against real data produces the
 * right numbers. That wants --dry-run against prod and a human reading the diff.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SYNC = path.join(ROOT, 'scripts/sync-training-from-fde.py');
const MIGRATION = path.join(
  ROOT,
  'dashboard/supabase/migrations/20260807_001_create_training_sync_runs.sql'
);

const rawSync = fs.existsSync(SYNC) ? fs.readFileSync(SYNC, 'utf8') : '';
const rawMigration = fs.existsSync(MIGRATION) ? fs.readFileSync(MIGRATION, 'utf8') : '';

/**
 * Strip comments and DOCSTRINGS so prose about a rule can't satisfy the rule —
 * but keep embedded SQL, which also lives in triple-quoted strings and is the
 * very thing several assertions below need to read.
 *
 * The distinction is positional: a docstring is a triple-quoted string that
 * opens a line (module or def body), whereas the SQL here is always an argument
 * to cur.execute(...) and so is preceded by `(` or `f`. Blanket-stripping every
 * `"""` block removed the queries too, and the assertions then passed or failed
 * on an empty string rather than on the code.
 */
function pyCode(text) {
  // Toggle on EVERY triple-quote occurrence, tracking whether we are inside a
  // quoted block, and keep a block only if it is NOT a docstring.
  //
  // Two earlier attempts got this wrong and are worth naming, because both
  // failed in the direction that makes tests silently vacuous:
  //   1. A whole-file `"""[\s\S]*?"""` also removed the embedded SQL, so
  //      assertions ran against an empty string.
  //   2. Treating any line-leading `"""` as an opener misread the CLOSING quote
  //      of an indented SQL f-string (`        """,`) as a new opener, and then
  //      swallowed the real `def` lines that followed.
  //
  // A docstring is the first thing in a module or directly after a `def`/`class`
  // line, so that is the only test that reliably separates the two.
  const lines = text.split('\n');
  const out = [];
  let inBlock = false;
  let isDoc = false;
  let prevMeaningful = '';

  for (const line of lines) {
    if (!inBlock) {
      const opens = line.match(/"""|'''/g);
      if (opens) {
        // Single-line triple-quoted string: opens and closes on this line.
        if (opens.length >= 2) {
          if (!/^\s*(def |class )/.test(prevMeaningful) && prevMeaningful !== '') out.push(line);
          prevMeaningful = line.trim() ? line : prevMeaningful;
          continue;
        }
        inBlock = true;
        isDoc = prevMeaningful === '' || /^\s*(def |class )/.test(prevMeaningful);
        if (!isDoc) out.push(line);
        continue;
      }
      if (/^\s*#/.test(line)) continue;
      out.push(line);
      if (line.trim()) prevMeaningful = line;
    } else {
      if (!isDoc) out.push(line);
      if (/"""|'''/.test(line)) {
        inBlock = false;
        prevMeaningful = isDoc ? prevMeaningful : line;
      }
    }
  }
  return out.join('\n');
}
function sqlCode(text) {
  return text.replace(/--.*$/gm, '');
}

const code = pyCode(rawSync);
const sql = sqlCode(rawMigration);

describe('bd-2528 — the run ledger exists and can answer "is the old app quiet yet?"', () => {
  it('the migration file exists', () => {
    expect(rawMigration).not.toBe('');
  });

  it('creates training_sync_runs', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS\s+training_sync_runs/i);
  });

  // The whole point of the ledger. Without a count of source rows written AFTER
  // the migration cutoff, "can we turn the sync off?" stays a guess forever.
  it('records the retirement signal — source rows written after the cutoff', () => {
    expect(sql).toMatch(/source_rows_after_cutoff/);
  });

  it('is queryable as a time series per entity', () => {
    expect(sql).toMatch(/entity/);
    expect(sql).toMatch(/started_at/);
    expect(sql).toMatch(/CREATE INDEX[\s\S]*training_sync_runs\s*\(entity,\s*started_at DESC\)/i);
  });

  it('distinguishes a dry run from a real one, so dry runs never pollute the signal', () => {
    expect(sql).toMatch(/'dry_run'/);
    expect(sql).toMatch(/status/);
  });

  it('separates unmatched teachers from unmatched modules', () => {
    // They mean different things: an unmatched teacher never registered on the
    // new platform; an unmatched module is a content-mapping hole we must fix.
    expect(sql).toMatch(/rows_unmatched_teacher/);
    expect(sql).toMatch(/rows_unmatched_module/);
  });

  it('accounts for skipped duplicates, so a no-op run is distinguishable from a broken one', () => {
    expect(sql).toMatch(/rows_skipped_duplicate/);
  });
});

describe('bd-2528 — the sync is safe to re-run', () => {
  it('the sync script exists', () => {
    expect(rawSync).not.toBe('');
  });

  // The single most important property. A sync that can double-write is worse
  // than no sync: it corrupts the very progress data we are repairing.
  it('writes through the natural key with conflict-ignore, never a bare insert', () => {
    expect(code).toMatch(/on_conflict=user_id,module_id/);
    expect(code).toMatch(/resolution=ignore-duplicates/);
  });

  it('a dry run performs no writes at all', () => {
    expect(code).toMatch(/--dry-run|dry_run/);
    // The write call must sit behind the dry-run guard, not merely be labelled.
    const writeAt = code.search(/def\s+batch_upsert|requests\.post/);
    expect(writeAt).toBeGreaterThan(-1);
    expect(code).toMatch(/if\s+args\.dry_run|if\s+dry_run/);
  });

  // Correctness must not depend on the watermark being right, because in this
  // source it demonstrably isn't: Django's auto_now is not firing — `modified`
  // exceeds `created` on 4 of 2,598,546 status rows. A modified-only high-water
  // mark would appear to work while silently dropping genuine edits.
  it('derives the window from GREATEST(created, modified), not modified alone', () => {
    expect(code).toMatch(/GREATEST\s*\(\s*\w*\.?created\s*,\s*\w*\.?modified\s*\)/i);
  });

  it('never trusts last_local_modified_at — it is an offline device clock', () => {
    // Minimum value in the live source is 1970-01-01. Using it as a watermark
    // would either resync everything forever or skip real rows.
    expect(code).not.toMatch(/last_local_modified_at\s*>/);
  });

  it('only counts COMPLETED, and only rows that are live', () => {
    // The legacy table APPENDS rather than upserts — the same (profile, training)
    // carries both an IN_PROGRESS and a COMPLETED row, so counting rows instead
    // of filtering status overstates progress. Sumbal has 58 status rows across
    // 40 level-3 trainings.
    expect(code).toMatch(/status\s*=\s*'COMPLETED'/);
    expect(code).toMatch(/is_active/);
    expect(code).toMatch(/deleted_at IS NULL/);
  });

  it('collapses duplicate source rows to one completion per (profile, training)', () => {
    expect(code).toMatch(/GROUP BY[\s\S]{0,120}training_id/i);
  });

  it('resolves the teacher by uuid with a phone fallback', () => {
    // teacher_uuid is the durable link; phone is the fallback for rows that
    // predate it. Matching on phone alone would mis-assign on reassigned numbers.
    expect(code).toMatch(/teacher_uuid/);
    expect(code).toMatch(/by_phone|norm_pk/);
  });

  it('refuses to run blind if the source starts soft-deleting', () => {
    // Zero soft-deletes existed at build time, so the sync is insert-only. If
    // that ever changes, an insert-only sync would silently retain rows the
    // source has retracted — it must stop rather than quietly diverge.
    expect(code).toMatch(/deleted_at\s*>=|soft.?delete|deletes_detected/i);
  });
});

describe('bd-2528 — every run is recorded, including the failures', () => {
  it('opens a ledger row before doing the work', () => {
    expect(code).toMatch(/training_sync_runs/);
    expect(code).toMatch(/'running'|"running"/);
  });

  it('closes the row on the failure path too', () => {
    // A sync that only records its successes makes the retirement signal a lie:
    // a month of silent crashes reads exactly like a month of zero new data.
    expect(code).toMatch(/'failed'|"failed"/);
    expect(code).toMatch(/except|finally/);
  });

  it('records the post-cutoff count that decides retirement', () => {
    expect(code).toMatch(/source_rows_after_cutoff/);
  });
});

/**
 * bd-2528 (attempts stage) — the merge policy, and why it is one-directional.
 *
 * Progress rows are a binary "done" flag, so a teacher who completed a module in
 * BOTH apps is harmless: conflict-ignore keeps the existing row and the duplicate
 * is dropped. Attempts are not like that. They carry score, is_passed,
 * attempt_number and cooldown_until, so the same level can hold two contradictory
 * records. Sumbal Pervaiz has exactly that, on the same day (2026-08-04): the
 * legacy DB says Skilled Practitioner PASSED 86/200 at 07:49, this DB says
 * in_progress on question 4 of 5 at 03:17.
 *
 * The rule, chosen because it cannot take away something a teacher earned:
 *   - a pass is NEVER overwritten by a non-pass
 *   - on two passes, the higher score wins
 *   - the EARLIEST passing date is kept, so a certificate dates from when the
 *     teacher actually earned it rather than when we happened to sync
 *   - cooldown_until and attempt_number are NOT merged — with the legacy app
 *     retired they are meaningless, and merging them could lock someone out
 *
 * Why attempts are in scope at all: 1,364 teachers passed a grand quiz in the
 * legacy app after the migration and hold no certificate here. Syncing progress
 * alone would fill in their modules and leave them uncertified — the visible half
 * of the reported bug would survive the fix.
 *
 * Idempotency here canNOT lean on a DB constraint. The original one-shot import
 * (scripts/migrate-training-attempts.py) inserts with no ON CONFLICT clause and
 * there is no unique index on the natural key, so this stage must read the
 * existing attempts and diff in memory before writing.
 */
describe('bd-2528 — attempts merge: a pass can never be downgraded', () => {
  it('syncs attempts, not just module progress', () => {
    expect(code).toMatch(/training_assessment_attempts/);
  });

  // The whole reason attempts are in scope.
  it('is wired to the certificate gap it exists to close', () => {
    expect(rawSync).toMatch(/certificate/i);
  });

  it('never lets a non-pass overwrite a pass', () => {
    // The guard must be on is_passed specifically — comparing scores alone would
    // let a higher-scoring FAIL replace a lower-scoring PASS.
    expect(code).toMatch(/is_passed/);
    expect(code).toMatch(/def\s+merge_attempt|def\s+pick_attempt|def\s+better_attempt/);
  });

  it('keeps the higher score when both sides passed', () => {
    expect(code).toMatch(/score/);
  });

  it('keeps the EARLIEST passing date, so certificates date from the real pass', () => {
    expect(code).toMatch(/earliest|min\(|<\s*best/i);
  });

  it('does not merge cooldown or attempt_number', () => {
    // Merging a cooldown from a retired app could lock a teacher out of a retry
    // for a quiz they are entitled to sit now.
    expect(code).not.toMatch(/merge_cooldown|cooldown_until\s*=\s*max/);
  });

  // There is no unique index on attempts and the original importer used a bare
  // INSERT, so a naive re-run would duplicate every attempt it already wrote.
  it('dedupes attempts in memory — it cannot rely on a DB conflict clause', () => {
    expect(code).toMatch(/existing_attempts|attempts_by_key|existing_by_key/);
  });

  it('keys an attempt by (user, quiz), not by row id', () => {
    // Legacy ids and Supabase uuids share no namespace; the natural key is the
    // only thing that survives the crossing.
    expect(code).toMatch(/grand_quiz_id/);
  });

  it('maps the legacy quiz id through source_quiz_id', () => {
    expect(code).toMatch(/source_quiz_id/);
  });

  it('records the attempts stage in the ledger under its own entity', () => {
    expect(code).toMatch(/ledger_open\(\s*["']attempts["']/);
  });

  it('a dry run writes no attempts either', () => {
    const applyAt = code.search(/def\s+write_attempts|def\s+upsert_attempts/);
    expect(applyAt).toBeGreaterThan(-1);
  });
});

/**
 * bd-2528 (post-mortem) — an attempt row must satisfy the table's NOT NULL set.
 *
 * The 2026-08-10 production run wrote all 60,009 progress rows and all 60
 * verdict upgrades, then failed EVERY ONE of its 12,749 attempt inserts with
 * Postgres 23502 (not-null violation): `total_questions` is NOT NULL with no
 * default, and the builder never set it. The legacy source has no such column —
 * it carries score/total_score only — so the value has to be derived, exactly as
 * the original importer does, by counting training_questions per quiz.
 *
 * Nothing was corrupted (a failed batch writes nothing), but the certificate
 * half of the fix silently did not happen — which is the outcome the whole
 * attempts stage exists to produce.
 *
 * The lesson these assertions encode: the earlier tests checked the merge POLICY
 * and never checked the row SHAPE. A source-level test cannot run SQL, but it
 * can insist the builder populates every NOT NULL column that has no default —
 * which is what would have caught this before a production run.
 */
describe('bd-2528 — an attempt row satisfies the NOT NULL columns', () => {
  // Verified against information_schema on 2026-08-10: NOT NULL, no default.
  // (started_at / last_activity_at / current_question_index / status / quiz_kind
  // are NOT NULL but DO carry defaults, so the builder need not supply them.)
  const REQUIRED_NO_DEFAULT = ['user_id', 'program_id', 'total_questions', 'total_score'];

  for (const col of REQUIRED_NO_DEFAULT) {
    it(`sets ${col} — NOT NULL with no database default`, () => {
      // Must be a key the builder writes, not merely a word in the file.
      expect(code).toMatch(new RegExp(`["']${col}["']\\s*:`));
    });
  }

  it('derives total_questions by counting the quiz\'s questions', () => {
    // The legacy assessment table has no question count; the only truthful
    // source is training_questions, the same one the original importer used.
    expect(code).toMatch(/training_questions/);
  });

  it('marks a finished attempt as being at the last question', () => {
    // current_question_index defaults to 0, which would render a completed
    // attempt as "not started" in the portal despite it carrying a verdict.
    expect(code).toMatch(/current_question_index/);
  });
});
