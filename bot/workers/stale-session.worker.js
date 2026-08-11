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

// Coaching thresholds (in milliseconds)
const COACHING_REMINDER_THRESHOLD_MS = 2 * 60 * 60 * 1000;  // 2 hours
const COACHING_AUTO_COMPLETE_THRESHOLD_MS = 12 * 60 * 60 * 1000;  // 12 hours
const USER_ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;  // 5 minutes = user considered active

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

    // bd-2508 follow-up: nudge teachers who paused a reflection to switch to
    // another service. Only fires inside the 20:00-22:00 Asia/Karachi window.
    const pausedResults = await processPausedCoachingReminders();
    console.log('🌙 Paused-session reminders:', pausedResults);

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
    // bd-2508 follow-up: `paused` is deliberately NOT included here. A paused
    // session is intentionally idle (the teacher switched to another service), so
    // the 12h auto-complete below would turn it into a partial report — the exact
    // data loss the pause exists to prevent. Paused sessions are handled by
    // processPausedCoachingReminders() instead.
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
 * bd-2508 follow-up — evening nudge for PAUSED coaching sessions.
 *
 * A teacher who runs /video mid-reflection now gets asked first, and on YES the
 * session goes to `paused` instead of `abandoned`. This is the other half of that
 * promise: one nudge in the evening so the reflection actually gets finished.
 *
 * Window and window-checking live in coaching-pause.service.js so the handler,
 * this worker, and the tests all agree on one definition (20:00-21:59
 * Asia/Karachi). `evening_reminder_sent_at` guarantees exactly one ping per pause
 * — it is a SEPARATE column from `reminder_sent_at`, which the 2h stale reminder
 * above owns; sharing one would make either ping suppress the other.
 *
 * @returns {Promise<Object>} Counts, or a skip marker when outside the window
 */
async function processPausedCoachingReminders() {
  const CoachingPauseService = require('../shared/services/coaching/coaching-pause.service');
  const hour = CoachingPauseService.currentHourInTz();

  if (!CoachingPauseService.isEveningWindow(hour)) {
    return { skipped: 'outside evening window', hour };
  }

  const { data: paused, error } = await supabase
    .from('coaching_sessions')
    .select(`
      id, user_id, conversation_state, paused_at, pause_reason,
      users!inner(first_name, phone_number)
    `)
    .eq('status', 'paused')
    .is('evening_reminder_sent_at', null);

  if (error) {
    throw new Error(`Failed to query paused sessions: ${error.message}`);
  }

  console.log(`🌙 Found ${paused?.length || 0} paused session(s) awaiting an evening nudge`);

  let sent = 0;
  let skipped = 0;

  for (const session of paused || []) {
    // Never interrupt a teacher who is mid-conversation right now.
    if (await checkUserActivity(session.user_id)) {
      console.log(`    ⏳ User active, skipping ${session.id.substring(0, 8)}...`);
      skipped++;
      continue;
    }

    const answered = CoachingPauseService.answeredCount(session);
    const name = session.users?.first_name ? ` ${session.users.first_name}` : '';

    try {
      // Catalog string, substituted here — keeps the nudge translatable 1:1
      // (tests/setup/no-hardcoded-coaching-strings.test.js).
      const { getCoachingMessage } = require('../shared/config/coaching-messages');
      const { getUserLanguage } = require('../shared/utils/language-cache');
      let languageCode = 'en';
      try {
        languageCode = (await getUserLanguage(session.user_id)) || 'en';
      } catch {
        // Best-effort: an English nudge beats no nudge.
      }

      await WhatsAppService.sendMessage(
        session.users.phone_number,
        getCoachingMessage('pausedEveningReminder', languageCode)
          .replace('{{name}}', name)
          .replace(
            '{{progress}}',
            answered > 0 ? ` after ${answered} question${answered === 1 ? '' : 's'}` : ''
          )
      );

      // Critical write kept on its own, per the cross-agent-safety rule about not
      // bundling critical and best-effort columns in one update.
      await supabase
        .from('coaching_sessions')
        .update({ evening_reminder_sent_at: new Date().toISOString() })
        .eq('id', session.id);

      sent++;
      console.log(`    📨 Evening nudge sent for ${session.id.substring(0, 8)}...`);
    } catch (err) {
      // Best-effort: one teacher's failed nudge must never fail the cron.
      logToFile('⚠️ Evening reminder failed (non-fatal)', {
        coachingSessionId: session.id,
        error: err.message,
      });
    }
  }

  return { total: paused?.length || 0, sent, skipped, hour };
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
 * Run every recovery sweep WITHOUT process.exit — for the always-on sqs-worker
 * to call on its interval (NIETE has no Railway Cron, so the standalone main()
 * never fires here). main() wraps this for a standalone/cron invocation.
 */
async function runRecovery() {
  const coaching = await processStaleCoachingSessions();
  const stuckInitiated = await processStuckInitiatedSessions();
  return { coaching, stuckInitiated };
}

module.exports = { main, runRecovery, processStuckInitiatedSessions, processStaleCoachingSessions };
