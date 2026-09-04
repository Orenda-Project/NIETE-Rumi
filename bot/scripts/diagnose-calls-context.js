'use strict';
/**
 * Read-only diagnostic: "what would a live call know about this caller?"
 * (bd-neeyat).
 *
 * Runs the EXACT connect-context path a real call uses — call-context.repo +
 * call-context.service — against the live DB, so it answers three questions that
 * otherwise only surface mid-call:
 *   1. Is the caller resolved to a user? (phone_number → users.id)
 *   2. Which context blocks actually populate — lessons, coaching, memory, …?
 *   3. Does the call_memory table exist and hold a summary for this caller?
 *
 * It writes NOTHING. Needs the same env the calls service uses (SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY), so run it where those exist — a Railway shell on
 * the calls/bot service, or locally with a filled .env:
 *
 *   node bot/scripts/diagnose-calls-context.js 923001234567
 *
 * Because it runs the real repo, it also exercises the real read routing: where
 * NIETE_SUPABASE_REPLICA_URL is set it reads the replica for everything except
 * `call_memory`, exactly as a call does. So a `memory: yes` here is evidence
 * about the primary, and a populated lessons/coaching block is evidence the
 * replica is reachable and caught up. Missing R2 env is harmless noise — the
 * voicenote lookups fail soft and the rest of the report still stands.
 */

require('dotenv').config();

const contextDeps = require('../shared/calls/call-context.repo');
const { buildCallContext } = require('../shared/calls/call-context.service');

const CLR = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', x: '\x1b[0m' };
const yn = (v) => (v ? `${CLR.g}yes${CLR.x}` : `${CLR.r}no${CLR.x}`);

async function main() {
  const from = (process.argv[2] || '').replace(/[^0-9]/g, '');
  if (!from) {
    console.error('Usage: node bot/scripts/diagnose-calls-context.js <caller-number>');
    process.exit(2);
  }

  console.log(`\n${CLR.d}caller${CLR.x} ${from}\n${'─'.repeat(60)}`);

  // 1) Identity — the gate for everything else.
  let user = null;
  try {
    user = await contextDeps.fetchUser(from);
  } catch (err) {
    console.log(`${CLR.r}identity lookup FAILED${CLR.x}: ${err.message}`);
  }
  console.log(`recognised user      : ${yn(!!user)}` + (user
    ? ` ${CLR.d}(${user.first_name || user.name || '?'}, role=${user.role || '—'}, `
      + `grade=${user.grade || (user.grades_taught || []).join('/') || '—'})${CLR.x}` : ''));
  if (!user) {
    console.log(`\n${CLR.y}This number is not in users.phone_number — a call would greet her as a `
      + `stranger and have NO lessons/coaching/memory. Check the number format stored in users.${CLR.x}\n`);
  }

  // 2) The full connect context, via the production assembler.
  const { block, known, userId, snapshot } = await buildCallContext({ from, deps: contextDeps });
  console.log(`\ncontext blocks (what she'd actually have):`);
  Object.entries(snapshot.blocks).forEach(([k, v]) => {
    console.log(`  ${k.padEnd(10)} : ${yn(v)}`);
  });
  if (snapshot.failures.length) {
    console.log(`  ${CLR.y}temporary failures${CLR.x}: ${snapshot.failures.join(', ')}`);
  }
  console.log(`\ncontext size         : ${block.length} chars`);

  // 3) Lesson plans specifically — the thing asked about.
  if (userId) {
    let lp = null;
    try { lp = await contextDeps.fetchLpContext(userId); } catch (err) { lp = `ERROR: ${err.message}`; }
    if (lp && !String(lp).startsWith('ERROR')) {
      console.log(`lesson-plan context  : ${CLR.g}present${CLR.x} ${CLR.d}(${String(lp).length} chars — `
        + `same builder as chat)${CLR.x}`);
    } else {
      console.log(`lesson-plan context  : ${CLR.y}none${CLR.x} `
        + `${CLR.d}(no shelf rows and no niete_lp_downloads in the last 7 days for this user)${CLR.x}`
        + (typeof lp === 'string' && lp.startsWith('ERROR') ? ` ${CLR.r}${lp}${CLR.x}` : ''));
    }
  }

  // 4) Memory table — the "what did we talk about last time?" path.
  console.log(`\n${'─'.repeat(60)}\npost-call memory (call_memory):`);
  try {
    const mem = await contextDeps.fetchMemory(from);
    if (mem && mem.summary) {
      console.log(`  ${CLR.g}stored${CLR.x} — call_count=${mem.call_count}, updated=${mem.updated_at}`);
      console.log(`  ${CLR.d}${mem.summary.slice(0, 300)}${mem.summary.length > 300 ? '…' : ''}${CLR.x}`);
    } else {
      console.log(`  ${CLR.y}no summary yet for this caller${CLR.x} `
        + `${CLR.d}(expected until she has completed at least one call SINCE the write-fix deploy)${CLR.x}`);
    }
  } catch (err) {
    console.log(`  ${CLR.r}call_memory lookup FAILED${CLR.x}: ${err.message}`);
    if (/relation .*call_memory.* does not exist|could not find the table/i.test(err.message)) {
      console.log(`  ${CLR.y}→ The call_memory table is missing. Run the migration:`
        + `\n     psql "$DATABASE_URL" -f bot/database/migrations/create_calls_tables.sql${CLR.x}`);
    }
  }

  console.log(`\n${CLR.d}Full assembled context follows:${CLR.x}\n${'═'.repeat(60)}`);
  console.log(block);
  console.log('═'.repeat(60) + '\n');
  console.log(`known=${known} userId=${userId || '—'}`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
