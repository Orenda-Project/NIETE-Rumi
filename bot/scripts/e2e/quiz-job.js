#!/usr/bin/env node
'use strict';
/**
 * quiz-job — put ONE quiz job in front of the local stack's worker, or run its handler now.
 *
 *   node bot/scripts/e2e/quiz-job.js enqueue <jobType> <groupId> '<payload json>' [delaySeconds]
 *   node bot/scripts/e2e/quiz-job.js run     <jobType> <groupId> '<payload json>'
 *
 * `enqueue` goes through the queue DRIVER (shared/services/queue → BullMQ on the stack's Redis), so
 * the real worker consumes it exactly as production would — the lever for "the scheduled report ran
 * after the teacher already had one" (T78) or "the quiet-quiz reminder came due" (T61). `run` calls
 * the same service the worker's case would, in THIS process, for a handler the worker would defer
 * (the nudge inside the 21:00–07:00 PKT quiet window re-queues itself until morning; a scenario
 * cannot wait for that).
 *
 * Run from the stack's source checkout (RUN_DIR/src): its .env carries REDIS_URL, QUEUE_DRIVER and
 * the sandbox DB. Refuses the production project outright. Mock lane only — never a deploy tool.
 */
const path = require('path');
const fs = require('fs');

const root = process.cwd();
const envFile = fs.existsSync(path.join(root, '.env')) ? path.join(root, '.env') : path.join(root, 'bot', '.env');
require(path.join(root, 'bot', 'node_modules', 'dotenv')).config({ path: envFile });

if (String(process.env.SUPABASE_URL || '').includes('ihzciabopbttygxxgrkm')) {
  console.error('quiz-job: refusing to touch the NIETE production project');
  process.exit(3);
}
const [mode, jobType, groupId, payloadJson, delay] = process.argv.slice(2);
if (!mode || !jobType || !groupId) {
  console.error('usage: quiz-job.js enqueue|run <jobType> <groupId> [payload json] [delaySeconds]');
  process.exit(2);
}
const payload = payloadJson ? JSON.parse(payloadJson) : {};

(async () => {
  if (mode === 'enqueue') {
    const Queue = require(path.join(root, 'bot', 'shared', 'services', 'queue'));
    const id = await Queue.queueJob(groupId, jobType, payload, {
      delaySeconds: Number(delay) || 0, deduplicationId: `${groupId}-${jobType}-e2e-${Date.now()}`,
    });
    console.log(JSON.stringify({ ok: true, mode, jobType, groupId, jobId: id }));
    process.exit(0);
  }
  if (mode === 'run') {
    let result;
    if (jobType === 'quiz_nudge_teacher') {
      result = await require(path.join(root, 'bot', 'shared', 'services', 'quiz', 'transcript-quiz-nudge.service')).process(payload.quizId || groupId);
    } else if (jobType === 'quiz_video_report') {
      result = await require(path.join(root, 'bot', 'shared', 'services', 'quiz', 'video-quiz-report.service'))
        .generate(payload.shareCodeId || groupId, { reason: payload.reason || 'scheduled', force: !!payload.force });
    } else {
      console.error('quiz-job run: no direct handler for ' + jobType + ' (use enqueue)');
      process.exit(2);
    }
    console.log(JSON.stringify({ ok: true, mode, jobType, groupId, result }));
    process.exit(0);
  }
  console.error('quiz-job: mode must be enqueue|run');
  process.exit(2);
})().catch((err) => { console.error(JSON.stringify({ ok: false, error: err.message })); process.exit(1); });
