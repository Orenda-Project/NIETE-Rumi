/**
 * bd-t74k6s — re-run the coaching analyses that failed when NIETE prod's OpenRouter key hit its total cap
 * (25 Nov 2026, 05:05-05:44Z: "403 Key limit exceeded"). SQS's three receives recovered most of them; a row
 * that spent all three sits at status=failed. This puts each such recording back at 'analyzing' with an
 * updated_at 46 minutes old, so the bd-h9gnk mid-flight watchdog (stale-session worker, every 15 min) retries
 * it ONCE from analysis, the way it retries any dead mid-flight session. No message is sent by this script.
 *
 *   node bot/scripts/rerun-capped-coaching.js --env-file .env.prod [--since 2026-11-25T00:00:00Z]          # dry run
 *   node bot/scripts/rerun-capped-coaching.js --env-file .env.prod [--since ...] --apply                    # PROD WRITE
 *
 * --apply writes to the production database: it needs the operator's go (root CLAUDE.md Rule 7).
 */

const CAP_ERROR = /Key limit exceeded/i;
const WATCHDOG_AGE_MS = 46 * 60 * 1000; // one minute past the watchdog's 45-minute line

function reasonToSkip(r) {
  if (r.status !== 'failed') return 'not_failed';
  if (!CAP_ERROR.test(r.error_message || '')) return 'not_the_cap_error';
  if (!r.transcript_text) return 'no_transcript';
  if (r.watchdog && r.watchdog.retried_at) return 'watchdog_retry_spent';
  return null;
}

/**
 * @param {object[]} failedRows candidate coaching_sessions rows (with `watchdog` = analysis_data->watchdog)
 * @param {object[]} otherRows the same teachers' other sessions since the outage
 * @returns {{rerun: object[], skipped: {id:string, reason:string}[]}}
 */
function planRerun(failedRows, otherRows) {
  const rerun = [];
  const skipped = [];
  const seen = new Set();
  const sorted = [...failedRows].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  for (const r of sorted) {
    const reason = reasonToSkip(r);
    if (reason) { skipped.push({ id: r.id, reason }); continue; }
    const key = `${r.user_id}|${r.audio_hash || r.id}`;
    if (seen.has(key)) { skipped.push({ id: r.id, reason: 'duplicate_upload' }); continue; }
    if (r.audio_hash && otherRows.some((o) => o.user_id === r.user_id && o.audio_hash === r.audio_hash
      && o.id !== r.id && o.status !== 'failed')) {
      skipped.push({ id: r.id, reason: 'resent_and_going' });
      continue;
    }
    seen.add(key);
    rerun.push(r);
  }
  return { rerun, skipped };
}

/**
 * @param {{rerun: object[]}} plan
 * @param {{apply: boolean, patch: (id:string, whileStatus:string, fields:object) => Promise<number>, now?: number}} opts
 *   patch returns how many rows it changed (0 when the row is no longer in `whileStatus`).
 */
async function rerun(plan, { apply, patch, now = Date.now() }) {
  let written = 0;
  if (!apply) return { planned: plan.rerun.length, written };
  const updatedAt = new Date(now - WATCHDOG_AGE_MS).toISOString();
  for (const r of plan.rerun) {
    const n = await patch(r.id, 'failed', { status: 'analyzing', updated_at: updatedAt });
    if (n > 0) written += 1;
  }
  return { planned: plan.rerun.length, written };
}

/* istanbul ignore next — CLI wiring over the two functions above */
async function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const apply = argv.includes('--apply');
  require('dotenv').config({ path: arg('--env-file') || '.env' });
  const { createClient } = require('@supabase/supabase-js');
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const since = arg('--since') || '2026-11-25T00:00:00Z';

  const { data: failed, error } = await db.from('coaching_sessions')
    .select('id, user_id, status, error_message, transcript_text, audio_hash, created_at, watchdog:analysis_data->watchdog')
    .eq('status', 'failed').ilike('error_message', '%Key limit exceeded%').gte('created_at', since);
  if (error) throw new Error(error.message);
  const users = [...new Set(failed.map((r) => r.user_id))];
  const { data: others } = users.length
    ? await db.from('coaching_sessions').select('id, user_id, status, audio_hash').in('user_id', users).gte('created_at', since)
    : { data: [] };

  const plan = planRerun(failed, others || []);
  plan.rerun.forEach((r) => console.log('re-run ', r.id, r.created_at));
  plan.skipped.forEach((s) => console.log('skip   ', s.id, s.reason));

  const patch = async (id, whileStatus, fields) => {
    const { data, error: e } = await db.from('coaching_sessions').update(fields)
      .eq('id', id).eq('status', whileStatus).select('id');
    if (e) throw new Error(e.message);
    return (data || []).length;
  };
  const out = await rerun(plan, { apply, patch });
  console.log(apply ? `written ${out.written} of ${out.planned}` : `DRY RUN: ${out.planned} would be re-run (add --apply)`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { planRerun, rerun, CAP_ERROR, WATCHDOG_AGE_MS };
