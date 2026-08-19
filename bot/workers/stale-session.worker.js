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
const { classifyStuckInitiatedSession } = require('../shared/services/coaching/coaching-stale-recovery');

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


/**
 * bd-2675 — reports still waiting on a teacher's tap.
 *
 * A cold teacher gets a template she must tap before the report itself can be
 * sent. Until now nothing ever revisited those, so a report could sit unopened
 * forever with the coach believing it was delivered. The planner
 * (observe-untapped.service) decides; observe-send executes. It is deliberately
 * bounded — one nudge, then we stop and tell the coach — per the operator's
 * instruction not to trap anyone in an endless chase.
 *
 * The row count here is tiny (tens), so filtering in JS beats a JSON-path
 * query that would silently return nothing if the operator syntax drifted.
 */
async function processUntappedReports() {
  const ObserveSend = require('../shared/services/observe/observe-send.service');
  const { classifyUntappedDelivery } = require('../shared/services/observe/observe-untapped.service');
  let nudged = 0; let gaveUp = 0; let skipped = 0;
  const { data: rows, error } = await supabase
    .from('coaching_sessions')
    .select('id, analysis_data')
    .eq('observation_type', 'leader_observation')
    .limit(500);
  if (error) {
    logToFile('⚠️ untapped sweep: query failed', { error: error.message });
    return { total: 0, nudged, gaveUp, skipped };
  }
  const candidates = (rows || []).filter((r) => {
    const d = (r.analysis_data && r.analysis_data.teacher_delivery) || {};
    return classifyUntappedDelivery(d).action !== 'skip';
  });
  for (const row of candidates) {
    try {
      const decision = await ObserveSend.processUntappedDelivery(row.id);
      if (decision.action === 'nudge') nudged += 1;
      else if (decision.action === 'give_up') gaveUp += 1;
      else skipped += 1;
    } catch (err) {
      logToFile('⚠️ untapped sweep: failed on one report', { sessionId: row.id, error: err.message });
    }
  }
  if (candidates.length) logToFile('🔔 untapped sweep done', { candidates: candidates.length, nudged, gaveUp });
  return { total: candidates.length, nudged, gaveUp, skipped };
}

/**
 * Run every recovery sweep WITHOUT process.exit — for the always-on sqs-worker
 * to call on its interval (NIETE has no Railway Cron, so the standalone main()
 * never fires here). main() wraps this for a standalone/cron invocation.
 */
async function runRecovery() {
  const coaching = await processStaleCoachingSessions();
  const stuckInitiated = await processStuckInitiatedSessions();
  // bd-2675 — never let one sweep's failure hide the others.
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
  return { coaching, stuckInitiated, untapped, photoGate };
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
  const cutoff = new Date(Date.now() - PHOTO_GATE_THRESHOLD_MS).toISOString();
  const { data: stuck, error } = await supabase
    .from('coaching_sessions')
    .select('id, user_id, status, created_at, updated_at, transcript_text, users!inner(phone_number, first_name)')
    .in('status', PHOTO_GATE_STATUSES)
    .lt('created_at', cutoff);
  if (error) {
    logToFile('❌ photo-gate sweep query failed', { error: error.message });
    return { found: 0, advanced: 0 };
  }

  const now = Date.now();
  let advanced = 0;
  for (const session of stuck || []) {
    if (!shouldAutoAdvancePhotoGate(session, now, PHOTO_GATE_THRESHOLD_MS)) continue;
    try {
      // Move it off the gate status FIRST so the next tick can't re-sweep it.
      await supabase
        .from('coaching_sessions')
        .update({ status: 'analysis_started' })
        .eq('id', session.id);

      await CoachingJobQueueService.queueAnalysis(session.id, {
        from: session.users.phone_number,
        trigger: 'photo_gate_timeout',
        skipReflection: true,
      });

      await WhatsAppService.sendMessage(
        session.users.phone_number,
        `Hi ${session.users.first_name}! I'm putting together your coaching report from your class recording now. 📊`
      );

      advanced++;
      logToFile('✅ Photo-gate session auto-advanced → report', { sessionId: session.id, wasStatus: session.status });
    } catch (err) {
      logToFile('❌ Failed to auto-advance photo-gate session', { sessionId: session.id, error: err.message });
    }
  }
  if ((stuck || []).length) logToFile('🔔 photo-gate sweep done', { found: stuck.length, advanced });
  return { found: (stuck || []).length, advanced };
}

module.exports = {
  main,
  runRecovery,
  processStuckInitiatedSessions,
  processStaleCoachingSessions,
  processStuckPhotoGateSessions,
  processUntappedReports,
  // bd-2700: resolved thresholds, exported so tests can assert the env overrides
  // and so a deploy can log what it actually picked up (a staging value silently
  // shipping to prod is the failure mode worth catching loudly).
  __thresholds: {
    reminderMs: COACHING_REMINDER_THRESHOLD_MS,
    autoCompleteMs: COACHING_AUTO_COMPLETE_THRESHOLD_MS,
    userActiveMs: USER_ACTIVE_THRESHOLD_MS,
    photoGateMs: PHOTO_GATE_THRESHOLD_MS,
  },
};
