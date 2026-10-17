#!/usr/bin/env node
/**
 * Release the HELD I-SAPS written-answer (CRQ) results — silently (bd-s42dye.5).
 *
 *   node scripts/release-isaps-held-attempts.js --target prod                 # dry-run (default)
 *   node scripts/release-isaps-held-attempts.js --target prod --apply         # writes; flag must be flipped FIRST
 *
 *   --target sandbox|staging|prod   REQUIRED. The Supabase project ref in SUPABASE_URL (and in the
 *                                   service-role key) must match the target, checked BEFORE any connection.
 *   --apply                         write. Without it nothing is written and the LLM is never called.
 *   --env-file <path>               load SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (and the LLM / R2 keys the
 *                                   re-score and the certificate PDF need) from this file, overriding the shell.
 *   --only-users <uuid,uuid>        restrict to these users (for sandbox proofs). Default: every held attempt.
 *   --out <path>                    also write the JSON summary here.
 *
 * Order of operations for the operator (the flag flip is a SEPARATE, explicit step):
 *   1. run the SQL printed by --apply when it refuses (or the one in the PR);
 *   2. --dry-run, read the counts;
 *   3. --apply;
 *   4. verify with the query in the README.
 *
 * No WhatsApp, no Slack, nothing outbound. See isaps-held-release.service.js.
 */
const fs = require('fs');
const path = require('path');

const TARGET_REFS = {
  sandbox: 'olvritwoqujtjvwfulbh',
  staging: 'rpqkekcfvumypldbejhp',
  prod: 'ihzciabopbttygxxgrkm',
};

function parseArgs(argv) {
  const out = { target: null, apply: false, envFile: null, out: null, onlyUsers: null };
  let sawDry = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--dry-run') sawDry = true;
    else if (a === '--target') out.target = argv[++i];
    else if (a === '--env-file') out.envFile = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--only-users') out.onlyUsers = String(argv[++i] || '').split(',').map(x => x.trim()).filter(Boolean);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!out.target || !Object.prototype.hasOwnProperty.call(TARGET_REFS, out.target)) {
    throw new Error(`--target is required and must be one of: ${Object.keys(TARGET_REFS).join(', ')}`);
  }
  if (out.apply && sawDry) throw new Error('--apply and --dry-run are mutually exclusive');
  return out;
}

function refOfUrl(url) {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.(co|in)\b/i.exec(String(url || ''));
  return m ? m[1] : null;
}

/** Abort unless SUPABASE_URL is the target's project. Runs before anything connects. */
function assertTargetRef(target, supabaseUrl) {
  const want = TARGET_REFS[target];
  const got = refOfUrl(supabaseUrl);
  if (!want) throw new Error(`unknown target ${target}`);
  if (got !== want) {
    throw new Error(`REF MISMATCH: --target ${target} expects Supabase project ${want}, but SUPABASE_URL points at ${got || '(unparseable / unset)'}. Aborting before any connection.`);
  }
  return got;
}

/** The service-role key is a JWT carrying the project ref; it must agree too (a stray prod key with a sandbox URL is the trap). */
function assertKeyRef(target, key) {
  const want = TARGET_REFS[target];
  const parts = String(key || '').split('.');
  if (parts.length !== 3) return null;   // not a JWT (e.g. an sb_secret_ key): nothing to compare
  let ref = null;
  try { ref = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).ref || null; } catch (_) { return null; }
  if (ref && ref !== want) {
    throw new Error(`REF MISMATCH: SUPABASE_SERVICE_ROLE_KEY belongs to project ${ref}, not ${want} (${target}). Aborting before any connection.`);
  }
  return ref;
}

function loadEnvFile(file) {
  const dotenv = require(require.resolve('dotenv', { paths: [path.join(__dirname, '..', 'bot'), path.join(__dirname, '..')] }));
  const parsed = dotenv.parse(fs.readFileSync(file));
  Object.assign(process.env, parsed);
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.envFile) loadEnvFile(args.envFile);
  else {
    // Same default the bot uses (cwd .env). Never overrides what the shell already set.
    try { require(require.resolve('dotenv', { paths: [path.join(__dirname, '..', 'bot'), path.join(__dirname, '..')] })).config({ quiet: true }); } catch (_) { /* optional */ }
  }

  const ref = assertTargetRef(args.target, process.env.SUPABASE_URL);
  assertKeyRef(args.target, process.env.SUPABASE_SERVICE_ROLE_KEY);
  process.stderr.write(`[release-isaps] target=${args.target} ref=${ref} mode=${args.apply ? 'APPLY' : 'dry-run'}\n`);

  // Only now is anything that connects loaded.
  const supabase = require('../bot/shared/config/supabase');
  const { releaseHeldAttempts } = require('../bot/shared/services/training/isaps-held-release.service');

  let scoreAnswer = async () => { throw new Error('dry-run must not call the LLM'); };
  if (args.apply) ({ scoreAnswer } = require('../bot/shared/services/training/capstone-delivery.service'));

  let summary;
  try {
    summary = await releaseHeldAttempts({ supabase, apply: args.apply, scoreAnswer, onlyUserIds: args.onlyUsers, log: m => process.stderr.write(`[release-isaps] ${m}\n`) });
  } catch (e) {
    if (e && e.code === 'FLAG_STILL_HELD') { process.stderr.write(`\n${e.message}\n`); process.exitCode = 3; return null; }
    throw e;
  }
  const json = JSON.stringify({ target: args.target, ref, at: new Date().toISOString(), ...summary }, null, 2);
  process.stdout.write(`${json}\n`);   // not console.log: the bot logger rewrites it into a log line
  if (args.out) fs.writeFileSync(args.out, `${json}\n`);
  if (summary.errors.length) process.exitCode = 2;
  return summary;
}

module.exports = { TARGET_REFS, parseArgs, assertTargetRef, assertKeyRef, main };

if (require.main === module) {
  main(process.argv.slice(2)).then(() => process.exit(process.exitCode || 0)).catch(e => { console.error(`[release-isaps] ABORTED: ${e.message}`); process.exit(1); });
}
