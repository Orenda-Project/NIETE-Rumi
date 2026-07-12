// LP Feedback local E2E smoke test.
//
// Drives the FULL lifecycle end-to-end against real Supabase, using an
// in-memory Redis stub (no local Redis needed), stubs WhatsApp HTTP so no
// message actually reaches Meta.
//
// What runs REAL:
//   - NIETE Supabase — writes to lesson_plans + lp_feedback, reads current data
//   - handleCurriculumLessonPlan handler code path
//   - CurriculumLpAstService.findByTopic (against 2,415 imported LPs)
//   - storeLessonPlan (writes a real row)
//   - LpFeedbackService (scheduler, button handler, reason middleware)
//
// What is stubbed:
//   - WhatsAppService.sendMessage / sendDocument / sendInteractiveButtons
//     (would otherwise fire real HTTP requests to Meta / real phone)
//   - Redis (in-memory Map — the service's Redis client is disabled locally)
//   - LpFeedbackService.scheduleFeedbackPrompt delayMs (shortened from 30s
//     to 500ms so the smoke finishes in ~10s instead of ~40s)
//
// Usage:
//   NIETE_ENV_PATH=/path/to/.env node lp-feedback-e2e.js
//
// Cleanup: the smoke deletes its own lesson_plans + lp_feedback rows at the
// end. If a run crashes, they'll linger — filterable by user_id + topic.

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

const TEST_PHONE = process.env.TEST_PHONE || '923333232533';
const TEST_TOPIC = process.env.TEST_TOPIC || 'number buddies';

// ─── Stub WhatsAppService (before requiring anything that imports it) ─────
const WhatsAppService = require('../../shared/services/whatsapp.service');
const captured = { messages: [], documents: [], interactives: [] };
WhatsAppService.sendMessage = async (phone, body) => {
  captured.messages.push({ phone, body });
  console.log(`  [WA sendMessage] to=${phone}\n      body="${body.slice(0, 100)}"`);
  return { success: true };
};
WhatsAppService.sendDocument = async (phone, filePath, filename) => {
  const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  captured.documents.push({ phone, filename, size });
  console.log(`  [WA sendDocument] to=${phone} file=${filename} size=${(size/1024).toFixed(1)}KB`);
  return { success: true };
};
WhatsAppService.sendInteractiveButtons = async (phone, { body, buttons }) => {
  captured.interactives.push({ phone, body, buttons });
  console.log(`  [WA sendInteractiveButtons] to=${phone}`);
  console.log(`      body="${body}"`);
  for (const b of buttons) console.log(`      button: id="${b.id}" title="${b.title}"`);
  return true;
};

// ─── Stub Redis (in-memory Map — the local Redis is disabled) ─────────────
const redisService = require('../../shared/services/cache/railway-redis.service');
const memRedis = new Map();
redisService.set = async (k, v, _ttl) => { memRedis.set(k, v); return true; };
redisService.get = async (k) => memRedis.get(k) ?? null;
redisService.delete = async (k) => { memRedis.delete(k); return true; };

// ─── Shorten the feedback-prompt delay for smoke speed ─────────────────────
const LpFeedbackService = require('../../shared/services/lp-feedback.service');
const originalSchedule = LpFeedbackService.scheduleFeedbackPrompt;
LpFeedbackService.scheduleFeedbackPrompt = (opts) => originalSchedule({ ...opts, delayMs: 500 });

// ─── Under test ────────────────────────────────────────────────────────────
const handleCurriculumLessonPlan = require('../../shared/handlers/lesson-plan-v2.handler');
const supabase = require('../../shared/config/supabase');

function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }

function step(n, title) {
  console.log(`\n═════════ Step ${n}: ${title} ═════════`);
}

function assert(cond, msg) {
  if (!cond) { console.error(`  ❌ ${msg}`); process.exit(2); }
  console.log(`  ✅ ${msg}`);
}

(async () => {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  LP Feedback Local E2E Smoke');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Phone: ${TEST_PHONE}`);
  console.log(`  Topic: "${TEST_TOPIC}"`);

  // ─── 0. Look up (or fail on) the test user UUID ─────────────────────────
  step(0, 'Resolve test user UUID');
  const { data: userRow } = await supabase
    .from('users').select('id, first_name').eq('phone_number', TEST_PHONE).maybeSingle();
  if (!userRow) {
    console.error(`  ❌ No users row for phone_number=${TEST_PHONE}. Create one first.`);
    process.exit(2);
  }
  const USER_UUID = userRow.id;
  console.log(`  User UUID: ${USER_UUID}  (name: ${userRow.first_name || '(none)'})`);

  // Clean up any leftover feedback rows from prior smoke runs of this user
  await supabase.from('lp_feedback').delete().eq('user_id', USER_UUID);

  // ─── 1. Call the handler → cache-hit path ────────────────────────────────
  step(1, 'Handler cache-hit → PDF delivered + feedback scheduled');
  const t0 = Date.now();
  const result = await handleCurriculumLessonPlan({
    userId: TEST_PHONE, userDbId: USER_UUID,
    topic: TEST_TOPIC, grade: 1, subject: 'maths',
    curriculum: 'taleemabad', language: 'en',
  });
  const dt = Date.now() - t0;
  console.log(`  Handler returned in ${dt}ms:`, JSON.stringify(result));
  assert(result.source === 'ast_cached', 'handler served from R2 cache (ast_cached)');
  assert(captured.documents.length === 1, 'sendDocument was called exactly once');
  assert(captured.documents[0].filename.includes('Lesson Plan'), 'delivered filename contains "Lesson Plan"');

  // Confirm lesson_plans row was inserted
  const { data: recentLp } = await supabase
    .from('lesson_plans')
    .select('id, topic, pdf_url, content, created_at')
    .eq('user_id', USER_UUID)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  assert(!!recentLp, 'lesson_plans row was inserted');
  console.log(`  lesson_plans.id = ${recentLp.id}`);
  console.log(`  lesson_plans.content =`, JSON.stringify(recentLp.content));
  assert(recentLp.content?.lp_variant === 'taleemabad_ast', 'content.lp_variant is "taleemabad_ast"');
  const LESSON_PLAN_ID = recentLp.id;

  // ─── 2. Wait for the 30s feedback prompt (shortened to 500ms for smoke) ──
  step(2, 'Feedback prompt fires after delayMs → 2-button interactive sent');
  console.log('  Waiting ~1.5s for setTimeout to fire the prompt...');
  await sleep(1500);
  assert(captured.interactives.length === 1, 'sendInteractiveButtons was called exactly once');
  const prompt = captured.interactives[0];
  assert(prompt.buttons.length === 2, 'prompt has exactly 2 buttons');
  assert(prompt.buttons[0].id === `lp_feedback_yes_${LESSON_PLAN_ID}`, 'button[0] id matches lp_feedback_yes_<uuid>');
  assert(prompt.buttons[1].id === `lp_feedback_no_${LESSON_PLAN_ID}`, 'button[1] id matches lp_feedback_no_<uuid>');
  assert(/was it useful/i.test(prompt.body), 'prompt body reads "Was it useful for planning?"');

  // ─── 3. Simulate 👎 button tap (as if webhook delivered it) ──────────────
  step(3, 'Simulate 👎 tap → lp_feedback row inserted + Redis flag armed');
  captured.messages.length = 0; // reset to isolate this step's captures
  const ok = await LpFeedbackService.handleFeedbackButton(
    `lp_feedback_no_${LESSON_PLAN_ID}`, TEST_PHONE
  );
  assert(ok === true, 'handleFeedbackButton returned true (button matched)');
  assert(captured.messages.length === 1, 'follow-up "what didn\'t work?" message sent');
  assert(/what didn't work/i.test(captured.messages[0].body), 'follow-up body asks for reason');

  const { data: feedbackRow } = await supabase
    .from('lp_feedback')
    .select('id, user_id, lesson_plan_id, useful, lp_variant, grade, subject, chapter_number, topic, trigger_mode')
    .eq('user_id', USER_UUID).order('created_at', { ascending: false }).limit(1).maybeSingle();
  assert(!!feedbackRow, 'lp_feedback row was inserted');
  console.log(`  lp_feedback.id = ${feedbackRow.id}`);
  assert(feedbackRow.useful === false, 'lp_feedback.useful = false (👎 recorded)');
  assert(feedbackRow.lesson_plan_id === LESSON_PLAN_ID, 'lp_feedback.lesson_plan_id links to the delivered LP');
  assert(feedbackRow.lp_variant === 'taleemabad_ast', 'lp_feedback.lp_variant = "taleemabad_ast" (snapshot preserved)');
  assert(feedbackRow.topic?.includes('Numbers upto 9'), 'lp_feedback.topic snapshot is correct');
  assert(feedbackRow.trigger_mode === 'after_pdf_only', 'lp_feedback.trigger_mode = "after_pdf_only"');
  assert(feedbackRow.grade === 1, 'lp_feedback.grade = 1 (snapshot from content JSONB)');
  assert(feedbackRow.subject === 'maths', 'lp_feedback.subject = "maths" (snapshot from content JSONB)');
  assert(feedbackRow.chapter_number === 1, 'lp_feedback.chapter_number = 1 (snapshot from content JSONB)');

  // Redis flag verification (in-memory Map)
  const redisKey = LpFeedbackService.REDIS_REASON_KEY(USER_UUID);
  const redisEntry = memRedis.get(redisKey);
  assert(!!redisEntry, 'Redis flag was set (reason-capture window armed)');
  assert(redisEntry.lpFeedbackId === feedbackRow.id, 'Redis flag points at the feedback row id');
  assert(redisEntry.polarity === 'disliked', 'Redis flag polarity = "disliked"');

  // ─── 4. Simulate the reason reply within the window ─────────────────────
  step(4, 'Simulate reason reply → row updated + Redis flag cleared');
  captured.messages.length = 0;
  const REASON = "60 kids in my class — the stones activity isn't practical for us";
  const consumed = await LpFeedbackService.consumeReasonIfPending(USER_UUID, TEST_PHONE, REASON);
  assert(consumed === true, 'consumeReasonIfPending returned true (text consumed as reason)');
  assert(captured.messages.length === 1, 'final "got it, thanks" ack was sent');
  assert(/got it, thanks/i.test(captured.messages[0].body), 'final ack body is correct');
  assert(!memRedis.has(redisKey), 'Redis flag was cleared after reason capture');

  const { data: updatedRow } = await supabase
    .from('lp_feedback')
    .select('id, useful, reason_text, reason_language, reason_polarity, reason_received_at')
    .eq('id', feedbackRow.id).single();
  assert(updatedRow.reason_text === REASON, `lp_feedback.reason_text = "${REASON}"`);
  assert(updatedRow.reason_language === 'en', 'lp_feedback.reason_language = "en"');
  assert(updatedRow.reason_polarity === 'disliked', 'lp_feedback.reason_polarity = "disliked"');
  assert(!!updatedRow.reason_received_at, 'lp_feedback.reason_received_at is set');

  // ─── 5. Final DB dump — proof of the landed row ─────────────────────────
  step(5, 'Final lp_feedback row (post-full-lifecycle)');
  const { data: finalRow } = await supabase
    .from('lp_feedback').select('*').eq('id', feedbackRow.id).single();
  console.log(JSON.stringify(finalRow, null, 2));

  // ─── 6. Cleanup ─────────────────────────────────────────────────────────
  step(6, 'Cleanup — delete smoke rows');
  await supabase.from('lp_feedback').delete().eq('id', feedbackRow.id);
  await supabase.from('lesson_plans').delete().eq('id', LESSON_PLAN_ID);
  console.log('  Rows deleted.');

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ✅ ALL STEPS PASSED — LP Feedback E2E validated end-to-end');
  console.log('══════════════════════════════════════════════════════════════');
})().catch(e => { console.error('\n❌ FATAL:', e.message); console.error(e.stack); process.exit(2); });
