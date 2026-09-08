#!/usr/bin/env node
/**
 * revert-lp612-figure-notes.js — put `notes` back exactly as the backup found it.
 *
 * bd-17mht. Companion to apply-lp612-figure-notes.js. The backup is one
 * {segment_id, notes} per line, `notes` being the value BEFORE the block was
 * added (null where the row had none), so the revert is a replay, not a guess.
 *
 * Usage:
 *   node bot/scripts/revert-lp612-figure-notes.js --backup <file.jsonl> \
 *        --expect-ref rpqkekcfvumypldbejhp [--dry-run]
 */
const fs = require('fs');

const supabase = require('../shared/config/supabase');

const TABLE = 'niete_lp612_segments';

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
}
const DRY = process.argv.includes('--dry-run');
const BACKUP = arg('backup');
const EXPECT_REF = arg('expect-ref');

function assertRef() {
  const url = process.env.SUPABASE_URL || '';
  const m = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  const ref = m ? m[1] : null;
  if (!EXPECT_REF) throw new Error('--expect-ref is required; refusing to guess the database');
  if (ref !== EXPECT_REF) {
    throw new Error(`REFUSING TO WRITE: project "${ref}", expected "${EXPECT_REF}".`);
  }
  return ref;
}

async function main() {
  if (!BACKUP) {
    console.error('usage: --backup <file.jsonl> --expect-ref <ref> [--dry-run]');
    process.exit(2);
  }
  const ref = assertRef();
  console.log(`project ref: ${ref}  (asserted)`);

  const rows = fs
    .readFileSync(BACKUP, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  console.log(`rows to restore: ${rows.length}`);
  if (DRY) {
    console.log('DRY RUN — nothing written.');
    return;
  }

  let done = 0;
  let failed = 0;
  for (const r of rows) {
    const { error } = await supabase
      .from(TABLE)
      .update({ notes: r.notes })
      .eq('segment_id', r.segment_id);
    if (error) {
      failed += 1;
      console.error(`  FAIL ${r.segment_id}: ${error.message}`);
    } else {
      done += 1;
    }
  }
  console.log(`restored ${done}, failed ${failed}`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
