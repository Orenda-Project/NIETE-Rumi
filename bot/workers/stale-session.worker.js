/**
 * Stale Session Worker
 * Coaching Stuck Sessions - Railway Cron Service
 *
 * Runs every 15 minutes via Railway Cron
 *
 * Currently handles:
 * - Coaching sessions stuck in 'conducting_conversation' status
 *
 * Timeline for Coaching:
 * - 0h: User last interacted
 * - 2h: Send reminder (if idle)
 * - 12h: Auto-generate partial report (if still no response)
 *
 * Future extensibility:
 * - Reading assessments (stuck in awaiting_audio)
 * - Lesson plan generation (stuck in processing)
 * - Any other multi-step flows
 *
 * Created: November 30, 2025
 */

require('dotenv').config();
const supabase = require('../shared/config/supabase');
const { logToFile } = require('../shared/utils/logger');
const WhatsAppService = require('../shared/services/whatsapp.service');
const CoachingJobQueueService = require('../shared/services/coaching/coaching-job-queue.service');
const { runSonioxCleanup } = require('../shared/services/soniox-cleanup.service');
const { classifyStuckInitiatedSession, classifyStuckMidFlightSession } = require('../shared/services/coaching/coaching-stale-recovery');

// Coaching thresholds (in milliseconds).
//
// bd-2700: these were hardcoded, which made the reflection-timeout path
// untestable — one end-to-end verification cost 12 hours of waiting. They are now
// env-overridable in MINUTES, defaulting to the production values. Staging sets
// COACHING_REMINDER_MINUTES=2 / COACHING_AUTO_COMPLETE_MINUTES=5 so the whole
// reminder → auto-complete → partial-report path can be exercised in one sitting.
//
// PRODUCTION MUST NOT SET THESE. A 5-minute auto-complete on prod would cut real
// teachers off mid-reflection and ship them a partial report while they type.
const MINUTE_MS = 60 * 1000;

/**
 * Read a minutes-valued env override, falling back to a default when unset,
 * non-numeric, or negative. Zero IS honoured — COACHING_USER_ACTIVE_MINUTES=0
 * deliberately disables the "user is active, skip them" guard, which otherwise
 * swallows every short-threshold test run (a teacher actively testing is never
 * idle enough to sweep).
 */
function _minutesFromEnv(name, defaultMs) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return defaultMs;
  const mins = Number(raw);
  if (!Number.isFinite(mins) || mins < 0) return defaultMs;
  return mins * MINUTE_MS;
}

const COACHING_REMINDER_THRESHOLD_MS = _minutesFromEnv('COACHING_REMINDER_MINUTES', 2 * 60 * MINUTE_MS);  // default 2 hours
const COACHING_AUTO_COMPLETE_THRESHOLD_MS = _minutesFromEnv('COACHING_AUTO_COMPLETE_MINUTES', 12 * 60 * MINUTE_MS);  // default 12 hours
const USER_ACTIVE_THRESHOLD_MS = _minutesFromEnv('COACHING_USER_ACTIVE_MINUTES', 5 * MINUTE_MS);  // default 5 minutes
// bd-j3j4b: how long a session may sit at the photo / lesson-plan gate before we
// auto-advance it to a report (default 60 min). The photo/LP is optional.
const PHOTO_GATE_THRESHOLD_MS = _minutesFromEnv('COACHING_PHOTO_GATE_MINUTES', 60 * MINUTE_MS);
const { PHOTO_GATE_STATUSES, shouldAutoAdvancePhotoGate } = require('../shared/services/coaching/photo-gate-sweep');

// Future: Reading assessment thresholds
// const READING_REMINDER_THRESHOLD_MS = 1 * 60 * 60 * 1000;  // 1 hour
// const READING_CANCEL_THRESHOLD_MS = 24 * 60 * 60 * 1000;   // 24 hours

/**
 * Main entry point - called by Railway Cron
 */
async function main() {
  const startTime = Date.now();
  console.log('============================================');
  console.log('🕐 Stale session worker started:', new Date().toISOString());
  console.log('============================================');

  try {
    // Process coaching sessions
    const coachingResults = await processStaleCoachingSessions();
    console.log('📊 Coaching results:', coachingResults);

    // bd-2417: recover sessions frozen at the confirmation gate.
    const stuckInitiatedResults = await processStuckInitiatedSessions();
    console.log('🔓 Stuck-initiated recovery:', stuckInitiatedResults);

    // bd-2378: purge old Soniox transcriptions + files so the account never
    // fills up (~2000) and starts failing every transcription. Best-effort —
    // never fails the cron.
    try {
      const sonioxResults = await runSonioxCleanup();
      console.log('🧹 Soniox cleanup:', sonioxResults);
    } catch (cleanupErr) {
      console.error('⚠️ Soniox cleanup failed (non-fatal):', cleanupErr.message);
    }

    // Future: Process reading assessments
    // const readingResults = await processStaleReadingAssessments();
    // console.log('📊 Reading results:', readingResults);

    const duration = Date.now() - startTime;
    console.log(`✅ Worker completed in ${duration}ms`);
    console.log('============================================');
    process.exit(0);
  } catch (error) {
    console.error('❌ Worker error:', error);
    logToFile('❌ Stale session worker error', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

/**
 * Process coaching sessions in 'conducting_conversation' status
 * @returns {Promise<object>} Results summary
 */
async function processStaleCoachingSessions() {
  const now = Date.now();
  let reminders = 0;
  let autoCompleted = 0;
  let skipped = 0;

  // Query sessions in conducting_conversation status
  const { data: staleSessions, error } = await supabase
    .from('coaching_sessions')
    .select(`
      id, user_id, status, conversation_state,
      transcript_text, analysis_data, lesson_plan_text,
      reminder_sent_at, created_at,
      users!inner(first_name, phone_number)
    `)
    .eq('status', 'conducting_conversation')
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to query stale sessions: ${error.message}`);
  }

  console.log(`📋 Found ${staleSessions?.length || 0} sessions in conducting_conversation`);

  for (const session of staleSessions || []) {
    // Get last interaction time from conversation_state
    const lastInteraction = session.conversation_state?.last_interaction
      ? new Date(session.conversation_state.last_interaction).getTime()
      : new Date(session.created_at).getTime();

    const idleTime = now - lastInteraction;
    const idleHours = (idleTime / (1000 * 60 * 60)).toFixed(1);

    console.log(`  → Session ${session.id.substring(0, 8)}... idle for ${idleHours}h`);

    // Check if user is currently active (don't interrupt)
    const isUserBusy = await checkUserActivity(session.user_id);
    if (isUserBusy) {
      console.log(`    ⏳ User active, skipping`);
      skipped++;
      continue;
    }

    // Phase 2: Auto-complete (12h threshold)
    if (idleTime >= COACHING_AUTO_COMPLETE_THRESHOLD_MS) {
      console.log(`    🔄 Auto-completing (${idleHours}h > 12h threshold)`);
      await autoCompleteSession(session);
      autoCompleted++;
      continue;
    }

    // Phase 1: Send reminder (2h threshold, not already sent)
    if (idleTime >= COACHING_REMINDER_THRESHOLD_MS && !session.reminder_sent_at) {
      console.log(`    📨 Sending reminder (${idleHours}h > 2h threshold)`);
      await sendSessionReminder(session);
      reminders++;
    }
  }

  return { total: staleSessions?.length || 0, reminders, autoCompleted, skipped };
}

/**
 * Check if user is currently active (don't interrupt them)
 * @param {string} userId - User UUID
 * @returns {Promise<boolean>} True if user is active
 */
async function checkUserActivity(userId) {
  const now = Date.now();

  // Check 1: Recent conversation activity
  const { data: recentConversation } = await supabase
    .from('conversations')
    .select('updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (recentConversation) {
    const lastActivity = new Date(recentConversation.updated_at).getTime();
    if (now - lastActivity < USER_ACTIVE_THRESHOLD_MS) {
      logToFile('User has recent conversation activity', {
        userId,
        lastActivity: recentConversation.updated_at
      });
      return true;
    }
  }

  // Check 2: Active reading assessment in progress
  const { data: activeReading } = await supabase
    .from('reading_assessments')
    .select('id, status')
    .eq('user_id', userId)
    .in('status', ['awaiting_audio', 'transcribing', 'analyzing'])
    .limit(1)
    .single();

  if (activeReading) {
    logToFile('User has active reading assessment', {
      userId,
      assessmentId: activeReading.id,
      status: activeReading.status
    });
    return true;
  }

  // Check 3: Another coaching session in active state
  const { data: activeCoaching } = await supabase
    .from('coaching_sessions')
    .select('id, status')
    .eq('user_id', userId)
    .in('status', ['transcribing', 'analyzing', 'awaiting_lesson_plan', 'generating_report'])
    .limit(1)
    .single();

  if (activeCoaching) {
    logToFile('User has another active coaching session', {
      userId,
      sessionId: activeCoaching.id,
      status: activeCoaching.status
    });
    return true;
  }

  return false; // User is idle, safe to send reminder
}

/**
 * Extract context from session for user-friendly reminder
 * @param {object} session - Coaching session data
 * @returns {object} Context with topic and subject
 */
async function extractSessionContext(session) {
  // Strategy 1: Use lesson plan if available
  if (session.lesson_plan_text) {
    const lpPreview = session.lesson_plan_text.substring(0, 200);
    const topicMatch = lpPreview.match(/topic[:\s]+([^\n]+)/i);
    const subjectMatch = lpPreview.match(/subject[:\s]+([^\n]+)/i);

    if (topicMatch || subjectMatch) {
      return {
        topic: topicMatch?.[1]?.trim() || 'your lesson',
        subject: subjectMatch?.[1]?.trim() || null
      };
    }
  }

  // Strategy 2: Extract from transcript first meaningful content
  if (session.transcript_text) {
    const cleanedTranscript = session.transcript_text
      .replace(/\[\d+:\d+\]\s*(Teacher|Student)\s*\([A-Z]{2}\):\s*/gi, '')
      .trim();

    const words = cleanedTranscript.split(/\s+/).slice(0, 50);
    const topicPreview = words.join(' ') + '...';

    // Detect subject from keywords
    const subjectKeywords = {
      'math': ['number', 'add', 'subtract', 'multiply', 'equation', 'geometry', 'count'],
      'english': ['read', 'write', 'letter', 'word', 'sentence', 'story', 'alphabet'],
      'urdu': ['حروف', 'لفظ', 'جملہ', 'پڑھنا', 'لکھنا'],
      'science': ['plant', 'animal', 'body', 'experiment', 'observe', 'earth']
    };

    let detectedSubject = null;
    for (const [subject, keywords] of Object.entries(subjectKeywords)) {
      if (keywords.some(kw => cleanedTranscript.toLowerCase().includes(kw))) {
        detectedSubject = subject;
        break;
      }
    }

    return {
      topic: topicPreview,
      subject: detectedSubject
    };
  }

  // Strategy 3: Fallback to date
  const createdDate = new Date(session.created_at);
  return {
    topic: `your ${createdDate.toLocaleDateString()} classroom recording`,
    subject: null
  };
}

/**
 * Send reminder message for stale session
 * @param {object} session - Coaching session with user data
 */
async function sendSessionReminder(session) {
  try {
    const context = await extractSessionContext(session);
    const questionsAnswered = session.conversation_state?.questions_answered || 0;
    const questionsRemaining = 3 - questionsAnswered;

    // Build contextual message
    let reminderText;

    if (context.subject) {
      reminderText = `Hi ${session.users.first_name}! 👋\n\n` +
        `You have an incomplete coaching session for your ${context.subject} lesson` +
        (questionsAnswered > 0
          ? ` (${questionsAnswered}/3 reflections completed).\n\n`
          : `.\n\n`) +
        `Ready to continue? I just have ${questionsRemaining} more question${questionsRemaining > 1 ? 's' : ''} for you!`;
    } else {
      reminderText = `Hi ${session.users.first_name}! 👋\n\n` +
        `You started a coaching session but didn't finish the reflective conversation.\n\n` +
        (questionsAnswered > 0
          ? `✅ Progress: ${questionsAnswered}/3 questions answered\n\n`
          : '') +
        `Would you like to continue and get your personalized feedback?`;
    }

    // Send interactive message with buttons
    await WhatsAppService.sendInteractiveButtons(session.users.phone_number, {
      body: reminderText,
      buttons: [
        { id: `coaching_continue_${session.id}`, title: 'Continue Now' },
        { id: `coaching_finish_${session.id}`, title: 'Get Report Now' }
      ]
    });

    // Record that reminder was sent
    await supabase
      .from('coaching_sessions')
      .update({
        reminder_sent_at: new Date().toISOString(),
        conversation_state: {
          ...session.conversation_state,
          reminder_sent: true,
          reminder_sent_at: new Date().toISOString()
        }
      })
      .eq('id', session.id);

    logToFile('📨 Coaching reminder sent', {
      sessionId: session.id,
      userId: session.user_id,
      questionsAnswered,
      contextTopic: context.topic?.substring(0, 50)
    });
  } catch (error) {
    logToFile('❌ Failed to send reminder', {
      sessionId: session.id,
      error: error.message
    });
  }
}

/**
 * Auto-complete session with partial report
 * @param {object} session - Coaching session with user data
 */
async function autoCompleteSession(session) {
  try {
    const questionsAnswered = session.conversation_state?.questions_answered || 0;

    logToFile('🔄 Auto-completing stale coaching session', {
      sessionId: session.id,
      questionsAnswered,
      totalQuestions: 3
    });

    // 1. Update conversation state to mark as auto-completed
    const updatedState = {
      ...session.conversation_state,
      current_state: 'AUTO_COMPLETED',
      auto_completed: true,
      auto_completed_at: new Date().toISOString(),
      reflective_skipped: questionsAnswered < 3,
      questions_at_completion: questionsAnswered
    };

    await supabase
      .from('coaching_sessions')
      .update({
        conversation_state: updatedState,
        status: 'generating_report'
      })
      .eq('id', session.id);

    // 2. Queue report generation with partial flag
    await CoachingJobQueueService.queueReport(session.id, {
      from: session.users.phone_number,
      partial: questionsAnswered < 3,
      autoCompleted: true
    });

    // 3. Notify user
    const notificationText = questionsAnswered > 0
      ? `Hi ${session.users.first_name}! I noticed you didn't get back to complete your coaching session. ` +
        `No worries - I'm generating your report now based on the ${questionsAnswered} reflection${questionsAnswered > 1 ? 's' : ''} you provided. 📊`
      : `Hi ${session.users.first_name}! Since you didn't continue the reflective conversation, ` +
        `I'm generating your coaching report based on the classroom audio analysis. 📊`;

    await WhatsAppService.sendMessage(session.users.phone_number, notificationText);

    logToFile('✅ Auto-complete initiated', {
      sessionId: session.id,
      questionsAnswered,
      notificationSent: true
    });
  } catch (error) {
    logToFile('❌ Failed to auto-complete session', {
      sessionId: session.id,
      error: error.message
    });
  }
}

// Gated — requiring this file as a library (e.g. from a test harness) does
// NOT fire the stale-session sweep. To run the sweep manually, invoke the
// exported `main` function.
if (require.main === module) {
  main();
}

/**
 * bd-2417 (row 13): recover coaching sessions frozen at the confirmation gate
 * ('initiated' / AWAITING_CONFIRMATION). Past a grace window we proceed with the
 * recording (auto-confirm → queue transcription) so the teacher still gets her
 * report; if the audio is too old to still exist, mark it abandoned. This is
 * what stops Sidra's 16-min recording sitting frozen with "still analyzing".
 */
async function processStuckInitiatedSessions() {
  const { data: stuck } = await supabase
    .from('coaching_sessions')
    .select('id, user_id, status, created_at, audio_id, users!inner(phone_number, first_name)')
    .eq('status', 'initiated')
    .order('created_at', { ascending: true })
    .limit(50);

  let confirmed = 0; let abandoned = 0; let skipped = 0;
  for (const session of (stuck || [])) {
    const decision = classifyStuckInitiatedSession(session);
    if (decision.action === 'skip') { skipped += 1; continue; }

    try {
      if (decision.action === 'auto_confirm') {
        await supabase.from('coaching_sessions').update({
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
          conversation_state: { current_state: 'AWAITING_ANALYSIS' },
          updated_at: new Date().toISOString(),
        }).eq('id', session.id);
        await CoachingJobQueueService.queueTranscription(session.id, {
          from: session.users.phone_number,
          audioId: session.audio_id,
        });
        await WhatsAppService.sendMessage(
          session.users.phone_number,
          `Hi ${session.users.first_name || ''}! I've gone ahead and started analysing your classroom recording — your report is on the way. 📊`,
        );
        confirmed += 1;
        logToFile('🔄 Stuck confirmation-gate session auto-proceeded', { sessionId: session.id, reason: decision.reason });
      } else if (decision.action === 'abandon') {
        await supabase.from('coaching_sessions').update({
          status: 'abandoned',
          error_message: `Confirmation gate: ${decision.reason} (bd-2417)`,
          updated_at: new Date().toISOString(),
        }).eq('id', session.id);
        abandoned += 1;
        logToFile('🚫 Stuck confirmation-gate session abandoned', { sessionId: session.id, reason: decision.reason });
      }
    } catch (err) {
      logToFile('⚠️ Failed to recover stuck initiated session', { sessionId: session.id, error: err.message });
    }
  }
  return { total: (stuck || []).length, confirmed, abandoned, skipped };
}


/** One replica sweeps at a time. Six of them multiply every message sent. */
const UNTAPPED_SWEEP_LOCK = 'observe-untapped-sweep';
const UNTAPPED_SWEEP_LOCK_TTL_SECONDS = 10 * 60;
/** Rows per read. The candidate set is 61 today; the paging is the guarantee. */
const UNTAPPED_PAGE_SIZE = 200;
/** 5,000 candidates. Past this the sweep says so instead of silently stopping. */
const UNTAPPED_MAX_PAGES = 25;

/** Reports acted on in ONE tick. A backlog drains over ticks, never in one. */
function untappedMaxPerTick() {
  const n = Number(process.env.OBSERVE_UNTAPPED_MAX_PER_TICK);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 25;
}

/**
 * Read every report still waiting on a tap, oldest first.
 *
 * bd-n6fl1. The previous read was `.limit(500)` with NO `.order()`, over a pool
 * of 1,518 rows growing ~500 a week. An unordered limit returns whichever rows
 * the planner hands back, so once the pool crossed 500 the overdue reports fell
 * outside the slice and stayed outside it: measured on prod 2026-09-08, 31 of 31
 * overdue reports invisible, 0 visible, every one at heap rank >= 505.
 *
 * Ordering alone does not fix that — oldest-500-of-a-growing-pool re-reads the
 * same settled rows for ever and still never reaches the new ones. What fixes it
 * is asking for the ACTIONABLE rows: the three JSON-path predicates below narrow
 * 1,518 to 61, and because every action we take writes `nudged_at` or
 * `gave_up_at`, the set drains instead of cycling. The paging is then real
 * progression rather than a fixed window, and the classifier still decides in JS
 * so a drifting operator can only ever cost us rows, never send a wrong message.
 *
 * The narrow projection from bd-mwn4j is untouched: `analysis_data` is a ~62 KB
 * JSONB per row and pulling it whole is what OOM-wedged prod on 24/25 Aug.
 *
 * Load math, measured against prod via PostgREST on 2026-09-08:
 *   before — 500 rows x 1.3 KB = 616 KB, 0.78 s, x6 replicas x4/hr = 15 MB/hr
 *   after  —  61 rows x 1.3 KB =  76 KB, 1.33 s, x1 replica  x4/hr = 0.3 MB/hr
 * The query is slower per run (it evaluates the predicate over the whole
 * `leader_observation` set rather than stopping at the first 500) and ~50x
 * cheaper per hour, because single-flight removes the replica multiplier. That
 * per-run cost grows with the pool; a partial index on the delivery status is
 * what removes it, and is filed rather than smuggled in here.
 */
async function readUntappedCandidates(tally) {
  const rows = [];
  for (let page = 0; page < UNTAPPED_MAX_PAGES; page += 1) {
    const from = page * UNTAPPED_PAGE_SIZE;
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase
      .from('coaching_sessions')
      .select('id, teacher_delivery:analysis_data->teacher_delivery')
      .eq('observation_type', 'leader_observation')
      .not('analysis_data->teacher_delivery', 'is', null)
      .eq('analysis_data->teacher_delivery->>status', 'awaiting_teacher_tap')
      .is('analysis_data->teacher_delivery->>tapped_at', null)
      .is('analysis_data->teacher_delivery->>gave_up_at', null)
      .order('analysis_data->teacher_delivery->>template_sent_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + UNTAPPED_PAGE_SIZE - 1);
    if (error) {
      logToFile('⚠️ untapped sweep: query failed', { page, error: error.message });
      tally.queryFailed = true;
      return rows;
    }
    const batch = data || [];
    rows.push(...batch);
    tally.pages = page + 1;
    if (batch.length < UNTAPPED_PAGE_SIZE) return rows;
    if (page + 1 === UNTAPPED_MAX_PAGES) {
      // Never stop silently. THIS is the line whose absence hid six blind days.
      logToFile('⚠️ untapped sweep: page ceiling hit — more candidates than one tick can read', {
        pages: UNTAPPED_MAX_PAGES, read: rows.length,
      });
      tally.ceilingHit = true;
    }
  }
  return rows;
}

/**
 * Reports still waiting on a teacher's tap.
 *
 * A cold teacher gets a template she must tap before the report itself can be
 * sent. The planner (observe-untapped.service) decides; observe-send executes.
 * It is deliberately bounded — one nudge, then we stop and tell the coach — per
 * the operator's instruction not to trap anyone in an endless chase.
 *
 * Periodic-job contract (database-engineering §2), which this job now meets:
 *   J1 single-flight — one Redis lock, so six replicas send one set of messages
 *   J2 per-tick cap, oldest first — a backlog drains over ticks
 *   J3 narrow reads — the teacher_delivery slice only, never the whole JSONB
 *   J4 kill switch — OBSERVE_UNTAPPED_SWEEP_OFF=1 (unset = ON)
 *   J5 idempotent, notify-once — nudged_at / gave_up_at are written on the row
 *   J6 age ceiling — anything unchased past the ceiling is closed SILENTLY
 *   J7 a per-tick log line, every tick, including the ticks that found nothing
 */
async function processUntappedReports() {
  const tally = {
    total: 0, found: 0, scanned: 0, nudged: 0, gaveUp: 0, expired: 0,
    skipped: 0, failed: 0, remaining: 0, pages: 0,
  };

  // J4. Unset = ON: a sweep that fails open is the safer direction, because the
  // failure mode we are fixing is the one where nobody is ever told anything.
  if (process.env.OBSERVE_UNTAPPED_SWEEP_OFF === '1') {
    logToFile('🔔 untapped sweep off', { ...tally, reason: 'OBSERVE_UNTAPPED_SWEEP_OFF=1' });
    return { ...tally, disabled: true };
  }

  // J1. Required lazily so this worker keeps loading in tests and one-shot runs
  // that never reach the sweep.
  const RedisService = require('../shared/services/cache/railway-redis.service');
  const lockId = `${process.pid}-${Date.now()}`;
  const gotLock = await RedisService.acquireLock(
    UNTAPPED_SWEEP_LOCK, lockId, UNTAPPED_SWEEP_LOCK_TTL_SECONDS,
  );
  if (!gotLock) {
    // acquireLock fails CLOSED when the cache is unreachable: no lock, no sweep.
    // The right direction — a nudge not sent this tick is sent next tick, a nudge
    // sent six times cannot be unsent — but it must never be silent.
    logToFile('🔔 untapped sweep skipped — lock held elsewhere or cache unreachable', tally);
    return { ...tally, skippedLocked: true };
  }

  try {
    return await runUntappedSweep(tally);
  } finally {
    await RedisService.releaseLock(UNTAPPED_SWEEP_LOCK, lockId).catch(() => {});
  }
}

async function runUntappedSweep(tally) {
  const startedAt = Date.now();
  const ObserveSend = require('../shared/services/observe/observe-send.service');
  const { classifyUntappedDelivery } = require('../shared/services/observe/observe-untapped.service');

  const rows = await readUntappedCandidates(tally);
  tally.scanned = rows.length;

  // The server narrowed; the planner still decides. If the JSON operators ever
  // drift and stop filtering, this catches it rather than acting on the wrong rows.
  const offContract = rows.filter((r) => (r.teacher_delivery || {}).status !== 'awaiting_teacher_tap');
  if (offContract.length) {
    logToFile('⚠️ untapped sweep: rows came back that the query should have excluded', {
      scanned: rows.length, offContract: offContract.length,
    });
  }

  const actionable = rows.filter((r) => classifyUntappedDelivery(r.teacher_delivery || {}).action !== 'skip');
  tally.found = actionable.length;
  tally.total = actionable.length;
  tally.skipped = rows.length - actionable.length;

  // J2. Oldest first, capped. The read is already ordered by template_sent_at, so
  // the cap takes the reports that have been waiting longest.
  const cap = untappedMaxPerTick();
  const batch = actionable.slice(0, cap);
  tally.remaining = actionable.length - batch.length;

  for (const row of batch) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const decision = await ObserveSend.processUntappedDelivery(row.id);
      if (decision.action === 'nudge') tally.nudged += 1;
      else if (decision.action === 'give_up') tally.gaveUp += 1;
      else if (decision.action === 'expire') tally.expired += 1;
      else tally.skipped += 1;
    } catch (err) {
      tally.failed += 1;
      logToFile('⚠️ untapped sweep: failed on one report', { sessionId: row.id, error: err.message });
    }
  }

  // J7. EVERY tick, not only the ones with work. The old line fired only when
  // candidates > 0, so six days of seeing nothing looked exactly like six days of
  // there being nothing to see.
  logToFile('🔔 untapped sweep done', { ...tally, ms: Date.now() - startedAt });
  return tally;
}

/**
 * Run every recovery sweep WITHOUT process.exit — for the always-on sqs-worker
 * to call on its interval (NIETE has no Railway Cron, so the standalone main()
 * never fires here). main() wraps this for a standalone/cron invocation.
 */
async function runRecovery() {
  const coaching = await processStaleCoachingSessions();
  const stuckInitiated = await processStuckInitiatedSessions();
  // Never let one sweep's failure hide the others.
  let untapped = { total: 0 };
  try {
    untapped = await processUntappedReports();
  } catch (err) {
    logToFile('⚠️ untapped sweep threw (non-blocking)', { error: err.message });
  }
  let photoGate = { found: 0, advanced: 0 };
  try {
    photoGate = await processStuckPhotoGateSessions();
  } catch (err) {
    logToFile('⚠️ photo-gate sweep threw (non-blocking)', { error: err.message });
  }
  let midFlight = { total: 0 };
  try {
    midFlight = await processStuckMidFlightSessions();
  } catch (err) {
    logToFile('⚠️ mid-flight watchdog threw (non-blocking)', { error: err.message });
  }
  return { coaching, stuckInitiated, untapped, photoGate, midFlight };
}

/**
 * bd-h9gnk — the mid-flight watchdog. A session untouched for >45 min in any
 * processing status (transcribing → generating_report) gets ONE retry from the
 * phase it died in (stamped into analysis_data.watchdog so it can never loop);
 * a spent retry fails the session LOUDLY and tells the teacher to resend.
 *
 * bd-go4tl: observations are IN this sweep now. They were excluded at the query,
 * deferring to a "bd-tju8f sweep" that does not exist, so an observation that
 * died between transcribing and generating_report had nothing watching it — the
 * coach's only lever was tapping the row, which refused, while telling her the
 * team had been notified. Nobody was. Identity is the one thing that differs:
 * on a bound observation every message and job callback goes to the COACH. The
 * observed teacher never started this and must never hear about it; if the coach
 * cannot be resolved we go silent rather than message the wrong person.
 */
/**
 * bd-go4tl — who the mid-flight watchdog should talk to about this session.
 * Teacher session: the teacher. Bound observation: the COACH, in the COACH's
 * language. Coach unresolvable: nobody (better silent than the wrong person —
 * the same call the photo-gate sweep already makes).
 */
async function resolveMidFlightRecipient(session) {
  // Language resolution goes through observeLang, the single owner — never a
  // local `|| 'en'` floor (language-protocol: language is data, not code).
  const { observeLang } = require('../shared/services/observe/observe-strings');
  const u = session.users || {};
  const isObservation = session.observation_type === 'leader_observation'
    && !!session.observer_user_id && session.observer_user_id !== session.user_id;
  if (!isObservation) {
    return { phone: u.phone_number, name: u.first_name, lang: observeLang(u), isObservation: false };
  }
  const { data: coach } = await supabase
    .from('users').select('phone_number, first_name, preferred_language')
    .eq('id', session.observer_user_id).maybeSingle();
  if (!coach || !coach.phone_number) {
    logToFile('⚠️ mid-flight watchdog: could not resolve the coach — staying silent', {
      sessionId: session.id, observerUserId: session.observer_user_id }, 'error');
    return { phone: null, name: null, lang: observeLang(null), isObservation: true };
  }
  return { phone: coach.phone_number, name: coach.first_name, lang: observeLang(coach), isObservation: true };
}

async function processStuckMidFlightSessions() {
  const { getCoachingMessage } = require('../shared/config/coaching-messages');
  const { observeStrings } = require('../shared/services/observe/observe-strings');
  const staleBefore = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  // bd-go4tl / bd-mwn4j: project the SLICE, never the fat column. This sweep now
  // includes observations, whose analysis_data carries the whole FICO analysis —
  // pulling it for 25 rows every 15 minutes per replica is the exact shape that
  // OOM-wedged prod on 24/25 Aug. The planner only reads .watchdog; the one row
  // we actually act on re-reads its own analysis_data by primary key to merge.
  // Load math: 25 rows x ~200 bytes x 4 ticks/hr x replicas — kilobytes, not MB.
  const { data: stuck } = await supabase
    .from('coaching_sessions')
    .select('id, user_id, status, created_at, updated_at, audio_id, observation_type, observer_user_id, watchdog:analysis_data->watchdog, users!inner(phone_number, first_name, preferred_language)')
    .in('status', ['transcribing', 'transcription_complete', 'analyzing', 'analysis_started', 'analysis_complete', 'generating_report'])
    .lt('updated_at', staleBefore)
    .order('updated_at', { ascending: true })
    .limit(25);

  let retried = 0; let failed = 0; let skipped = 0;
  for (const session of (stuck || [])) {
    // The planner's contract is the full row shape; feed it the projected slice.
    const decision = classifyStuckMidFlightSession(
      { ...session, analysis_data: { watchdog: session.watchdog || null } });
    if (decision.action === 'skip') { skipped += 1; continue; }
    // bd-go4tl — WHO hears about this. On a bound observation the joined
    // `users` row is the observed TEACHER; she did not start this and must
    // never be messaged. An unresolvable coach means silence, not the teacher.
    const { phone, lang, isObservation } = await resolveMidFlightRecipient(session);
    // An observation with no reachable coach must not be re-queued: the job
    // metadata's `from` falls back to session.users.phone_number downstream,
    // which on a bound observation is the OBSERVED TEACHER. Re-queueing here
    // would message her about an observation she never started. Leave it for a
    // human instead of guessing a recipient.
    if (isObservation && !phone && decision.action === 'retry') { skipped += 1; continue; }
    try {
      if (decision.action === 'retry') {
        // Stamp FIRST — if the queue call dies, the next sweep fails loudly
        // instead of retrying forever. bd-go4tl: the stamp is also the
        // SINGLE-FLIGHT CLAIM (database-engineering J1) — CAS on the updated_at
        // this replica read, so of N replicas racing the same row exactly one
        // queues. Without it every replica re-queued the same session, which is
        // the bd-m1jih x10 spam shape.
        // Single-row PK read of the fat column, only for the row we are acting
        // on — legal under skill §1.1, and the only way to merge without
        // clobbering whatever else analysis_data holds.
        const { data: full } = await supabase
          .from('coaching_sessions').select('analysis_data').eq('id', session.id).maybeSingle();
        const { data: claimed } = await supabase.from('coaching_sessions').update({
          analysis_data: {
            ...((full && full.analysis_data) || {}),
            watchdog: { retried_at: new Date().toISOString(), from_status: session.status },
          },
          updated_at: new Date().toISOString(),
        }).eq('id', session.id).eq('updated_at', session.updated_at).select();
        if (!claimed || !claimed.length) { skipped += 1; continue; }   // another replica won
        if (decision.queue === 'transcription') {
          await CoachingJobQueueService.queueTranscription(session.id, { from: phone, audioId: session.audio_id });
        } else if (decision.queue === 'analysis') {
          await CoachingJobQueueService.queueAnalysis(session.id, { from: phone });
        } else {
          await CoachingJobQueueService.queueReport(session.id, { from: phone });
        }
        retried += 1;
        logToFile('🔁 Mid-flight watchdog: retried a dead session', {
          sessionId: session.id, fromStatus: session.status, queue: decision.queue });
      } else {
        const { data: closed } = await supabase.from('coaching_sessions').update({
          status: 'failed',
          error_message: `mid-flight watchdog: ${decision.reason} (bd-h9gnk/bd-go4tl)`,
          updated_at: new Date().toISOString(),
        }).eq('id', session.id).eq('updated_at', session.updated_at).select();
        if (!closed || !closed.length) { skipped += 1; continue; }     // another replica won
        if (phone) {
          // An observation gets the coach-addressed wording; a teacher session
          // keeps its own. Neither claims an escalation — nothing escalates
          // from a NIETE worker, which ships no logs at all (bd-162d5).
          const body = isObservation
            ? observeStrings(lang).watchdog_stalled_coach
            : getCoachingMessage('coaching_analysisStalledFail', lang);
          await WhatsAppService.sendMessage(phone, body).catch(() => {});
        }
        failed += 1;
        logToFile('🛑 Mid-flight watchdog: failed a dead session LOUDLY', {
          sessionId: session.id, fromStatus: session.status, reason: decision.reason }, 'error');
      }
    } catch (err) {
      logToFile('⚠️ Mid-flight watchdog: recovery attempt threw', { sessionId: session.id, error: err.message });
    }
  }
  return { total: (stuck || []).length, retried, failed, skipped };
}

/**
 * bd-j3j4b: recover coaching sessions frozen at the photo / lesson-plan gate.
 * The photo/LP is optional and the FICO report is derivable from the class audio,
 * but a session that reached awaiting_photo / awaiting_classroom_photo /
 * awaiting_lesson_plan and never received a well-formed photo has nothing to
 * un-stick it (unlike conducting_conversation, which the 12h auto-complete
 * catches). Past PHOTO_GATE_THRESHOLD we auto-advance: queue analysis with
 * skipReflection (report-only — the teacher left; the vision pass still runs on
 * any captured photo) so she still gets her report.
 */
async function processStuckPhotoGateSessions() {
  // bd-tju8f (absorbs bd-m1jih) — six rules, all structural:
  //   single-flight claim  only the replica whose CAS update returns a row
  //                        queues + notifies (the 18-19 Aug x10-replica spam)
  //   updated_at staleness fresh activity is never yanked (the mid-flow yank)
  //   notify-once          a re-processed session never re-messages
  //   observer identity    a bound leader observation messages the COACH
  //   per-tick cap         oldest first; a backlog drains as a drip, never a burst
  //   age ceiling          older than the ceiling -> silently 'abandoned'
  const SWEEP_MAX_PER_TICK = Number(process.env.PHOTO_GATE_SWEEP_MAX_PER_TICK) || 8;
  const SWEEP_MAX_AGE_DAYS = Number(process.env.PHOTO_GATE_SWEEP_MAX_AGE_DAYS) || 7;
  const cutoff = new Date(Date.now() - PHOTO_GATE_THRESHOLD_MS).toISOString();
  const { data: stuck, error } = await supabase
    .from('coaching_sessions')
    .select('id, user_id, observer_user_id, observation_type, status, created_at, updated_at, transcript_text, conversation_state, users!inner(phone_number, first_name)')
    .in('status', PHOTO_GATE_STATUSES)
    .lt('updated_at', cutoff);
  if (error) {
    logToFile('❌ photo-gate sweep query failed', { error: error.message }, 'error');
    return { found: 0, advanced: 0, abandoned: 0 };
  }

  const now = Date.now();
  // bd-5knlj: per-session threshold — leader observations wait hours, not minutes.
  const { gateThresholdFor } = require('../shared/services/coaching/photo-gate-sweep');
  const eligible = (stuck || [])
    .filter((s) => shouldAutoAdvancePhotoGate(s, now, gateThresholdFor(s)))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));   // oldest first

  let advanced = 0;
  let abandoned = 0;
  for (const session of eligible) {
    if (advanced >= SWEEP_MAX_PER_TICK) break;
    const ageMs = now - Date.parse(session.created_at);
    const tooOld = ageMs > SWEEP_MAX_AGE_DAYS * 24 * 3600 * 1000;
    try {
      if (tooOld) {
        // Silent abandon: a report for a weeks-old lesson confuses more than it
        // helps. Audio + transcript stay on the row; nothing is messaged.
        const { data: claimedOld } = await supabase
          .from('coaching_sessions')
          .update({ status: 'abandoned' })
          .eq('id', session.id)
          .in('status', PHOTO_GATE_STATUSES)
          .select();
        if (claimedOld && claimedOld.length) {
          abandoned++;
          logToFile('🗃 photo-gate session past the age ceiling — abandoned silently', {
            sessionId: session.id, ageDays: Math.round(ageMs / 86400000) });
        }
        continue;
      }

      // SINGLE-FLIGHT CLAIM: exactly one replica wins the CAS; only the winner
      // queues + notifies. This is THE bd-m1jih fix.
      const alreadyNotified = !!(session.conversation_state && session.conversation_state.photo_gate_notified);
      const { data: claimed } = await supabase
        .from('coaching_sessions')
        .update({
          status: 'analysis_started',
          conversation_state: { ...(session.conversation_state || {}), photo_gate_notified: true },
        })
        .eq('id', session.id)
        .in('status', PHOTO_GATE_STATUSES)
        .select();
      if (!claimed || !claimed.length) continue;   // another replica won

      // Observer identity: on a bound leader observation, session.users is the
      // TEACHER — every message and job callback must reach the COACH.
      let notifyPhone = session.users.phone_number;
      let notifyName = session.users.first_name;
      if (session.observation_type === 'leader_observation'
          && session.observer_user_id && session.observer_user_id !== session.user_id) {
        const { data: coach } = await supabase
          .from('users').select('phone_number, first_name')
          .eq('id', session.observer_user_id).single();
        if (coach && coach.phone_number) { notifyPhone = coach.phone_number; notifyName = coach.first_name; }
        else {
          logToFile('⚠️ photo-gate: could not resolve the coach — advancing silently', {
            sessionId: session.id, observerUserId: session.observer_user_id });
          notifyPhone = null;   // better silent than the wrong person
        }
      }

      await CoachingJobQueueService.queueAnalysis(session.id, {
        from: notifyPhone || session.users.phone_number,
        trigger: 'photo_gate_timeout',
        skipReflection: true,
      });

      if (notifyPhone && !alreadyNotified) {
        const dated = ageMs > 24 * 3600 * 1000
          ? ` from your class on ${new Date(session.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
          : ' from your class recording';
        await WhatsAppService.sendMessage(
          notifyPhone,
          `Hi ${notifyName}! I'm putting together your coaching report${dated} now. 📊`
        );
      }

      advanced++;
      logToFile('✅ Photo-gate session auto-advanced → report', {
        sessionId: session.id, wasStatus: session.status, notified: !!(notifyPhone && !alreadyNotified) });
    } catch (err) {
      logToFile('❌ Failed to auto-advance photo-gate session', { sessionId: session.id, error: err.message }, 'error');
    }
  }
  if (eligible.length) logToFile('🔔 photo-gate sweep done', { found: eligible.length, advanced, abandoned });
  return { found: eligible.length, advanced, abandoned };
}

module.exports = {
  main,
  runRecovery,
  processStuckInitiatedSessions,
  processStaleCoachingSessions,
  processStuckPhotoGateSessions,
  processStuckMidFlightSessions,
  processUntappedReports,
  untappedMaxPerTick,
  // Resolved thresholds, exported so tests can assert the env overrides
  // and so a deploy can log what it actually picked up (a staging value silently
  // shipping to prod is the failure mode worth catching loudly).
  __thresholds: {
    reminderMs: COACHING_REMINDER_THRESHOLD_MS,
    autoCompleteMs: COACHING_AUTO_COMPLETE_THRESHOLD_MS,
    userActiveMs: USER_ACTIVE_THRESHOLD_MS,
    photoGateMs: PHOTO_GATE_THRESHOLD_MS,
  },
};
