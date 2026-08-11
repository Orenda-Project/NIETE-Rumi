/**
 * Supervisor Remark — narrative retry sweep (Railway Cron)
 *
 * bd-2531. Companion to workers/stale-session.worker.js, and deliberately the
 * same shape: a cron that SWEEPS A TABLE BY STATUS rather than draining a jobs
 * table. (`coaching_jobs` exists in the schema with full retry machinery and
 * nothing has ever processed it — a queue nobody drains is worse than no queue,
 * because it looks like the work is handled.)
 *
 * What it picks up — supervisor_remarks that are SUBMITTED but whose teacher
 * never received the narrative:
 *   * narrative_generated_at IS NULL  → the LLM failed at submit; generate + send
 *   * narrative_sent_at IS NULL only  → generation succeeded, WhatsApp did not;
 *                                       re-send the STORED text, never re-generate
 *
 * Re-generating a stored narrative would burn an LLM call and could hand the
 * teacher different words for the same evaluation — so the two states are
 * distinguished rather than collapsed into "not done".
 *
 * An UNSUBMITTED remark is never swept: a principal mid-rubric must not have a
 * narrative fired at her teacher. That exclusion lives in
 * findPendingNarratives() and is unit-tested.
 *
 * Idempotent: a remark whose send succeeds gets narrative_sent_at stamped and
 * drops out of the next sweep. A crash mid-run simply leaves it for next time.
 *
 * Suggested cadence: every 15 minutes, matching stale-session.
 */

require('dotenv').config();
const supabase = require('../shared/config/supabase');
const { logToFile } = require('../shared/utils/logger');
const {
  findPendingNarratives, PENDING_REASON, resolveTeacherLanguage,
} = require('../shared/services/remark/remark-delivery.service');
const { generateRemarkNarrative } = require('../shared/services/remark/remark-narrative.service');

// Bound the blast radius of one run. A backlog drains over successive sweeps
// rather than issuing hundreds of LLM calls in a single burst.
const BATCH = Number(process.env.REMARK_RETRY_BATCH || 25);

async function loadCandidates() {
  const { data, error } = await supabase
    .from('supervisor_remarks')
    .select('id, teacher_id, principal_user_id, cycle_id, comment_text, '
      + 'submitted_at, narrative_text, narrative_generated_at, narrative_sent_at')
    .not('submitted_at', 'is', null)
    .is('narrative_sent_at', null)
    .order('submitted_at', { ascending: true })
    .limit(BATCH);
  if (error) throw new Error(`remark-retry: candidate query failed — ${error.message}`);
  return data || [];
}

async function loadScores(remarkId) {
  const { data, error } = await supabase
    .from('supervisor_remark_scores')
    .select('indicator_ordinal, score')
    .eq('remark_id', remarkId);
  if (error) throw new Error(`remark-retry: score query failed — ${error.message}`);
  return (data || []).map((r) => ({ ordinal: r.indicator_ordinal, score: r.score }));
}

async function processOne(row, reason) {
  const { data: teacher } = await supabase
    .from('users')
    .select('id, first_name, phone_number, preferred_language')
    .eq('id', row.teacher_id)
    .maybeSingle();

  let narrative;
  if (reason === PENDING_REASON.DELIVER) {
    narrative = JSON.parse(row.narrative_text);   // re-send, never re-generate
  } else {
    const scores = await loadScores(row.id);
    narrative = await generateRemarkNarrative({
      scores,
      comment: row.comment_text || '',
      teacherName: (teacher && teacher.first_name) || 'Teacher',
      language: resolveTeacherLanguage(teacher, 'en'),
    });
    await supabase.from('supervisor_remarks').update({
      narrative_text: JSON.stringify(narrative),
      narrative_generated_at: new Date().toISOString(),
    }).eq('id', row.id);
  }

  const WhatsAppService = require('../shared/services/whatsapp.service');
  const body = [narrative.opening, narrative.strengths, narrative.growth, narrative.action_plan]
    .filter(Boolean).join('\n\n');
  await WhatsAppService.sendMessage(teacher.phone_number, body);

  await supabase.from('supervisor_remarks')
    .update({ narrative_sent_at: new Date().toISOString() })
    .eq('id', row.id);
}

async function main() {
  const started = Date.now();
  let done = 0;
  let failed = 0;
  try {
    const rows = await loadCandidates();
    const pending = findPendingNarratives(rows);
    logToFile(`🔁 remark-retry: ${pending.length} pending of ${rows.length} candidates`);

    for (const { id, reason } of pending) {
      const row = rows.find((r) => r.id === id);
      try {
        await processOne(row, reason);
        done += 1;
      } catch (err) {
        // One bad remark must not abort the sweep — the rest still drain, and
        // this one is picked up next run.
        failed += 1;
        logToFile('❌ remark-retry: remark failed, will retry next sweep', {
          remarkId: id, reason, error: err.message,
        });
      }
    }
  } catch (err) {
    logToFile('❌ remark-retry: sweep aborted', { error: err.message });
  }
  logToFile(`✅ remark-retry: ${done} delivered, ${failed} failed, ${Date.now() - started}ms`);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { main, loadCandidates, processOne, BATCH };
