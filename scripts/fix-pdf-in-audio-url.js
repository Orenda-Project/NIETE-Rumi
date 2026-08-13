#!/usr/bin/env node
/**
 * Move PDFs that were written into `audio_url` over to `source_media_url`.
 *
 * WHY
 * ---
 * The schema reserves audio_url for voice notes ("R2 URL for WhatsApp
 * voice-note delivery"). 36 active modules had a PDF there instead. No
 * delivery path reads audio_url for documents — isPdfModule() checks
 * source_media_url, the video branch checks video_url — so those modules told
 * every teacher "No file is available for this module yet" while a perfectly
 * healthy PDF sat on R2. 8,660 completions were logged against them.
 *
 * The fix corrects the DATA rather than widening the delivery code to accept
 * PDFs in audio_url: doing the latter would redefine the column as "audio, or
 * maybe a document" and hand that ambiguity to every future reader. Once the
 * row is shaped correctly the existing PDF path handles it with no code
 * change at all.
 *
 * SAFETY
 *  - Dry-run by default; --apply to write.
 *  - Targets an explicit environment (--env=prod|stage), and asserts the
 *    resolved project ref matches that choice before opening a connection.
 *    A worktree is seeded with the WRONG .env, so this is load-bearing.
 *  - Only touches rows that are unambiguously broken: active, no video_url,
 *    no source_media_url, and audio_url ending in .pdf.
 *  - Writes a per-environment snapshot of every affected row before applying.
 *  - Idempotent: once moved, a row no longer matches the selector.
 *
 * USAGE
 *   node scripts/fix-pdf-in-audio-url.js --env=prod
 *   node scripts/fix-pdf-in-audio-url.js --env=prod  --apply
 *   node scripts/fix-pdf-in-audio-url.js --env=stage --apply
 */

const path = require('path');
const fs = require('fs');
const fromBot = (mod) => require(path.join(__dirname, '..', 'bot', 'node_modules', mod));

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ENV = (args.find((a) => a.startsWith('--env=')) || '').split('=')[1];

const TARGETS = {
  prod: { file: '.env', ref: 'ihzciabopbttygxxgrkm' },
  stage: { file: '.env.stage', ref: 'rpqkekcfvumypldbejhp' },
};

if (!TARGETS[ENV]) {
  console.error('\n❌ Pass --env=prod or --env=stage (explicit by design).\n');
  process.exit(1);
}

fromBot('dotenv').config({ path: path.join(__dirname, '..', TARGETS[ENV].file), quiet: true });
const { createClient } = fromBot('@supabase/supabase-js');

function assertTarget() {
  const url = process.env.SUPABASE_URL || '';
  const m = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  if (!m) throw new Error(`Unrecognized SUPABASE_URL: ${url}`);
  if (m[1] !== TARGETS[ENV].ref) {
    throw new Error(
      `ABORT: --env=${ENV} expects ref '${TARGETS[ENV].ref}' but ${TARGETS[ENV].file} resolves to '${m[1]}'.`
    );
  }
  return m[1];
}

(async () => {
  const ref = assertTarget();
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  console.log(`\nfix: PDFs parked in audio_url`);
  console.log(`  env      : ${ENV}`);
  console.log(`  supabase : ${ref}`);
  console.log(`  mode     : ${APPLY ? 'APPLY (writes)' : 'DRY RUN'}\n`);

  const { data, error } = await sb
    .from('training_modules')
    .select('id,title,audio_url,video_url,source_media_url,is_active')
    .eq('is_active', true)
    .limit(5000);
  if (error) throw new Error(error.message);

  const broken = data.filter(
    (m) => !m.video_url && !m.source_media_url && m.audio_url && /\.pdf(\?|$)/i.test(m.audio_url)
  );

  console.log(`  ${broken.length} module(s) with a PDF in audio_url\n`);
  if (!broken.length) {
    console.log('  Nothing to do — no module has a PDF parked in audio_url.\n');
    return;
  }

  for (const m of broken.slice(0, 10)) {
    console.log(`   id=${m.id} · ${String(m.title).slice(0, 56)}`);
  }
  if (broken.length > 10) console.log(`   … and ${broken.length - 10} more`);

  if (!APPLY) {
    console.log(`\n  Dry run — re-run with --apply to correct these rows.\n`);
    return;
  }

  const snapshot = path.join(__dirname, '..', 'docs', 'migration', `bd-2671-${ENV}-before.json`);
  fs.writeFileSync(
    snapshot,
    JSON.stringify({ env: ENV, ref, captured_at: new Date().toISOString(), rows: broken }, null, 1)
  );
  console.log(`\n  snapshot -> docs/migration/${path.basename(snapshot)}`);

  let ok = 0;
  const failed = [];
  for (const m of broken) {
    const { error: upErr } = await sb
      .from('training_modules')
      .update({ source_media_url: m.audio_url, audio_url: null })
      .eq('id', m.id);
    if (upErr) {
      failed.push({ id: m.id, reason: upErr.message });
      console.log(`  ❌ module ${m.id}: ${upErr.message}`);
    } else {
      ok += 1;
    }
  }

  console.log(`\n  corrected: ${ok}/${broken.length}`);
  if (failed.length) {
    console.log(`  failed:    ${failed.length}`);
    process.exitCode = 1;
  }
  console.log('');
})().catch((e) => {
  console.error(`\n❌ ${e.message}\n`);
  process.exit(1);
});
