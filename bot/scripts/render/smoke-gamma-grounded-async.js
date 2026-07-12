// End-to-end smoke test for the ASYNC Gamma-grounded LP path (added 2026-07-12).
//
// Exercises the full production code path:
//   1. Handler finds an AST row with NO R2 cache
//   2. Handler sends an ack message (captured, not delivered) + queues a job
//   3. Handler returns { source: 'ast_queued' }
//   4. We then drive the worker DIRECTLY with the captured job payload
//   5. Worker fetches AST → Gamma renders → uploads to R2 → sends PDF
//   6. Second run of the SAME topic returns ast_cached (~1s)
//
// Stubs applied:
//   - WhatsAppService.sendMessage  (captures ack + apology, doesn't hit Meta)
//   - WhatsAppService.sendDocument (captures delivered PDF, doesn't hit Meta)
//   - SQSQueueService.queueCoachingJob (captures job payload for direct dispatch)
//
// Usage:
//   NIETE_ENV_PATH=/path/to/NIETE-Rumi/.env node smoke-gamma-grounded-async.js
//   node smoke-gamma-grounded-async.js --topic="sum and difference detectives"
//   node smoke-gamma-grounded-async.js --topic="..." --language=ur

const path = require('path');
const fs = require('fs');

function loadEnv(p) {
  const txt = fs.readFileSync(p, 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnv(process.env.NIETE_ENV_PATH || path.resolve(__dirname, '..', '..', '..', '.env'));

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

const TOPIC = args.topic || 'sum and difference detectives';
const GRADE = args.grade ? parseInt(args.grade, 10) : 1;
const SUBJECT = args.subject || 'maths';
const CURRICULUM = args.curriculum || 'taleemabad';
const LANGUAGE = args.language || 'en';
const USER_ID = args.userId || '923333232533';

// ─── Stubs applied BEFORE requiring any bot module ─────────────────────────
const WhatsAppService = require('../../shared/services/whatsapp.service');
const sends = { messages: [], documents: [] };
WhatsAppService.sendMessage = async (userId, body) => {
  sends.messages.push({ userId, body });
  console.log(`  [sendMessage STUBBED] userId=${userId} body="${body.slice(0, 80)}…"`);
  return { success: true };
};
WhatsAppService.sendDocument = async (userId, filePath, filename) => {
  const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  const cp = `/tmp/smoke-async-lp-${Date.now()}.pdf`;
  if (fs.existsSync(filePath)) fs.copyFileSync(filePath, cp);
  sends.documents.push({ userId, filename, size, cp });
  console.log(`  [sendDocument STUBBED] userId=${userId} file=${filename} size=${(size/1024).toFixed(1)}KB → ${cp}`);
  return { success: true };
};

// Capture SQS enqueues so we can drive the worker directly without Amazon.
const SQSQueueService = require('../../shared/services/queue');
const enqueued = [];
const originalQueue = SQSQueueService.queueCoachingJob;
SQSQueueService.queueCoachingJob = async (id, type, data) => {
  enqueued.push({ id, type, data });
  console.log(`  [queueCoachingJob STUBBED] type=${type} sourceLpUuid=${data.sourceLpUuid || '(none)'}`);
  return { messageId: `stubbed-${id}` };
};

const handleCurriculumLessonPlan = require('../../shared/handlers/lesson-plan-v2.handler');
const LessonPlanGenerationWorker = require('../../workers/lesson-plan-generation.worker');
const supabase = require('../../shared/config/supabase');

(async () => {
  console.log('=== Async grounded smoke ===');
  console.log(`Topic: "${TOPIC}"`);
  console.log(`Grade: ${GRADE}   Subject: ${SUBJECT}   Curriculum: ${CURRICULUM}   Lang: ${LANGUAGE}`);

  // Look up (or fail loudly on) a user record for the phone we'll pretend to be.
  // The async queue path requires users.id (UUID) as lesson_plan_requests.user_id.
  const { data: userRow } = await supabase
    .from('users').select('id, phone_number').eq('phone_number', USER_ID).maybeSingle();
  if (!userRow) {
    console.log(`\n❌ No users row for phone_number=${USER_ID}. Create a test user first, e.g.:`);
    console.log(`   supabase.from('users').insert({ phone_number: '${USER_ID}', first_name: 'Smoke Test' })`);
    process.exit(2);
  }
  const USER_DB_ID = userRow.id;
  console.log(`User UUID: ${USER_DB_ID}\n`);

  // ─── Round 1: handler-side ────────────────────────────────────────────
  const t0 = Date.now();
  const r1 = await handleCurriculumLessonPlan({
    userId: USER_ID, userDbId: USER_DB_ID,
    topic: TOPIC, grade: GRADE, subject: SUBJECT, curriculum: CURRICULUM, language: LANGUAGE,
  });
  const dtHandler = Date.now() - t0;
  console.log(`\n[Handler] result (${dtHandler}ms):`, JSON.stringify(r1));
  console.log(`  ack messages sent: ${sends.messages.length}`);
  console.log(`  documents sent  : ${sends.documents.length}`);
  console.log(`  jobs enqueued   : ${enqueued.length}`);

  if (r1.source === 'ast_cached') {
    console.log('\n✅ Already cached — handler served synchronously. Async path not exercised.');
    console.log('  Try a DIFFERENT --topic to hit a fresh render.');
    SQSQueueService.queueCoachingJob = originalQueue;
    process.exit(0);
  }
  if (r1.source !== 'ast_queued') {
    console.log(`\n❌ Expected ast_queued or ast_cached, got: ${r1.source}`);
    process.exit(2);
  }
  if (sends.messages.length !== 1) {
    console.log(`\n❌ Expected 1 ack message, got: ${sends.messages.length}`);
    process.exit(2);
  }
  if (enqueued.length !== 1) {
    console.log(`\n❌ Expected 1 queued job, got: ${enqueued.length}`);
    process.exit(2);
  }

  const job = enqueued[0];
  console.log('\n[Worker] dispatching queued job directly …');
  const t1 = Date.now();
  await LessonPlanGenerationWorker.process(job.data);
  const dtWorker = Date.now() - t1;
  console.log(`\n[Worker] finished in ${dtWorker}ms`);
  console.log(`  documents sent (cumulative): ${sends.documents.length}`);
  if (sends.documents.length < 1) {
    console.log('\n❌ Worker did not deliver a PDF');
    process.exit(2);
  }

  // ─── Round 2: cache-hit sanity ────────────────────────────────────────
  console.log('\n[Handler round 2] same topic — should hit R2 cache now …');
  const t2 = Date.now();
  const r2 = await handleCurriculumLessonPlan({
    userId: USER_ID, userDbId: USER_DB_ID,
    topic: TOPIC, grade: GRADE, subject: SUBJECT, curriculum: CURRICULUM, language: LANGUAGE,
  });
  const dtRound2 = Date.now() - t2;
  console.log(`[Handler round 2] result (${dtRound2}ms):`, JSON.stringify(r2));
  if (r2.source !== 'ast_cached') {
    console.log(`\n❌ Expected ast_cached on round 2, got: ${r2.source}`);
    process.exit(2);
  }

  console.log('\n─── SUMMARY ───');
  console.log(`  Round 1 (queue)  : ${dtHandler}ms  → ast_queued   (1 ack + 1 job)`);
  console.log(`  Worker render    : ${dtWorker}ms  → PDF delivered via stub`);
  console.log(`  Round 2 (cached) : ${dtRound2}ms  → ast_cached   (2 total docs sent)`);
  console.log('\n✅ Async grounded path verified end-to-end.');

  SQSQueueService.queueCoachingJob = originalQueue;
})().catch(e => { console.error('FATAL:', e.message); console.error(e.stack); process.exit(2); });
