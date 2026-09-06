#!/usr/bin/env node
/**
 * apply-lp612-figure-notes.js — write the diagram plan's figure directive into
 * each segment's `notes`, ADDITIVELY.
 *
 * bd-17mht. `notes` is rendered by buildUserPrompt as
 *   "## SEGMENT NOTES (operator/reviewer instructions — obey these over your own instincts)"
 * so it is the channel the author already obeys. 5,376 of 5,466 rows already
 * carry notes from the segmentation lane; those MUST survive.
 *
 * The block is delimited:
 *     <!-- lp612:figures:begin -->  …  <!-- lp612:figures:end -->
 * Re-running replaces only what is between the markers, so the script is
 * idempotent and never compounds.
 *
 * SAFETY
 *  - refuses to run against any project ref but the expected one (--expect-ref),
 *    checked BEFORE the first write;
 *  - writes a backup of every row's original notes to --backup, which
 *    revert-lp612-figure-notes.js replays verbatim.
 *
 * Usage:
 *   node bot/scripts/apply-lp612-figure-notes.js --blocks <prompt_blocks.jsonl> \
 *        --backup <file.jsonl> --expect-ref rpqkekcfvumypldbejhp [--dry-run] [--limit N]
 */
const fs = require('fs');

const supabase = require('../shared/config/supabase');

const TABLE = 'niete_lp612_segments';
const BEGIN = '<!-- lp612:figures:begin -->';
const END = '<!-- lp612:figures:end -->';
const CHUNK = 100;

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
}
const DRY = process.argv.includes('--dry-run');
const BLOCKS = arg('blocks');
const BACKUP = arg('backup');
const EXPECT_REF = arg('expect-ref');
const LIMIT = parseInt(arg('limit', '0'), 10);

/** Remove any previously-applied block, leaving the lane's own notes intact. */
function stripBlock(notes) {
  const s = String(notes || '');
  const i = s.indexOf(BEGIN);
  if (i === -1) return s;
  const j = s.indexOf(END, i);
  if (j === -1) return s.slice(0, i).trimEnd();
  return (s.slice(0, i) + s.slice(j + END.length)).replace(/\n{3,}/g, '\n\n').trim();
}

function compose(existing, block) {
  const base = stripBlock(existing);
  return base ? `${base}\n\n${block}` : block;
}

function assertRef() {
  const url = process.env.SUPABASE_URL || '';
  const m = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  const ref = m ? m[1] : null;
  if (!EXPECT_REF) throw new Error('--expect-ref is required; refusing to guess the database');
  if (ref !== EXPECT_REF) {
    throw new Error(
      `REFUSING TO WRITE: SUPABASE_URL points at project "${ref}", expected "${EXPECT_REF}". ` +
        'This bucket/database pair is one mistake away from another region.'
    );
  }
  return ref;
}

async function main() {
  if (!BLOCKS) {
    console.error('usage: --blocks <file.jsonl> --backup <file.jsonl> --expect-ref <ref> [--dry-run]');
    process.exit(2);
  }
  const ref = assertRef();
  console.log(`project ref: ${ref}  (asserted)`);

  let blocks = fs
    .readFileSync(BLOCKS, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  if (LIMIT > 0) blocks = blocks.slice(0, LIMIT);
  const byId = new Map(blocks.map((b) => [b.segment_id, b]));
  console.log(`blocks to apply: ${byId.size}`);

  // Fetch current notes for exactly these ids.
  const ids = [...byId.keys()];
  const current = new Map();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from(TABLE)
      .select('segment_id, notes')
      .in('segment_id', slice);
    if (error) throw new Error(`select failed: ${error.message}`);
    for (const r of data) current.set(r.segment_id, r.notes);
  }
  console.log(`rows found in DB: ${current.size} / ${ids.length}`);

  const updates = [];
  let unchanged = 0;
  let hadNotes = 0;
  for (const [id, b] of byId) {
    if (!current.has(id)) continue;
    const existing = current.get(id);
    if (existing && String(existing).trim()) hadNotes += 1;
    const next = compose(existing, b.block);
    if (next === String(existing || '')) {
      unchanged += 1;
      continue;
    }
    updates.push({ segment_id: id, notes: next, previous: existing ?? null });
  }
  console.log(`  already carried notes : ${hadNotes}`);
  console.log(`  need update           : ${updates.length}`);
  console.log(`  already correct       : ${unchanged}`);

  if (DRY) {
    console.log('\nDRY RUN — nothing written. Sample:');
    const s = updates[0];
    if (s) {
      console.log(`  ${s.segment_id}`);
      console.log(`  previous notes length: ${(s.previous || '').length}`);
      console.log(`  new notes length     : ${s.notes.length}`);
      console.log(`  ---\n${s.notes.slice(0, 700)}`);
    }
    return;
  }

  if (BACKUP) {
    // Store the notes with ANY existing block stripped — the pristine
    // segmentation-lane text. Storing the raw previous value would, on a second
    // run, capture notes that already contain a block, and a later revert would
    // "restore" that block instead of the true original.
    const rows = [...byId.keys()]
      .filter((id) => current.has(id))
      .map((id) => {
        const pristine = stripBlock(current.get(id));
        return JSON.stringify({ segment_id: id, notes: pristine === '' ? null : pristine });
      });
    // Never clobber an existing backup with a weaker one.
    if (fs.existsSync(BACKUP)) {
      const keep = `${BACKUP}.${Date.now()}.bak`;
      fs.renameSync(BACKUP, keep);
      console.log(`existing backup preserved as ${keep}`);
    }
    fs.writeFileSync(BACKUP, rows.join('\n') + '\n');
    console.log(`backup written: ${BACKUP} (${rows.length} rows, blocks stripped)`);
  }

  let done = 0;
  let failed = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from(TABLE)
      .update({ notes: u.notes })
      .eq('segment_id', u.segment_id);
    if (error) {
      failed += 1;
      console.error(`  FAIL ${u.segment_id}: ${error.message}`);
    } else {
      done += 1;
    }
    if ((done + failed) % 250 === 0) console.log(`  … ${done + failed}/${updates.length}`);
  }
  console.log(`\nupdated ${done}, failed ${failed}`);
  if (failed) process.exit(1);
}

module.exports = { stripBlock, compose, BEGIN, END };

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
