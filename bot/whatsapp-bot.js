// Structured logging - must be first to capture all console.log calls
const { generateCorrelationId, runWithCorrelation } = require('./shared/utils/structured-logger');

require('dotenv').config();
const express = require('express');
const fs = require('fs');

// Import Services
const WhatsAppService = require('./shared/services/whatsapp.service');
const SessionService = require('./shared/services/session.service');
const OpenAIService = require('./shared/services/openai.service');
const CoachingService = require('./shared/services/coaching-orchestrator.service');
const PortalInviteService = require('./shared/services/portal-invite.service');
const ReadingAssessmentService = require('./shared/services/reading-assessment.service');

// Import Handlers
const { handleTextMessage, isSelectVideoButton } = require('./shared/handlers/text-message.handler');
// bd-ri5o9.1 — the report-invite template's QUICK_REPLY had no reader at all.
const { matchObserveReportTap, isObserveReportTapText } = require('./shared/services/observe/report-tap-routing');
const { handleVoiceMessage } = require('./shared/handlers/voice-message.handler');
const { handleImageMessage } = require('./shared/handlers/image-message.handler');

// LP fidelity: the coaching LP-selection list is populated from the teacher's recent downloads (labelled
// like the delivery caption she saw when she made the LP — D25), and each row carries the LP-version keys
// the fidelity pass resolves. Flag-gated OFF (LP_FIDELITY_ENABLED); any failure returns [] so the flow
// falls back to the Yes/No prompt. Non-blocking by construction.
async function __recentFidelityLps(userId) {
  try {
    const { isFidelityEnabled } = require('./shared/services/coaching/fidelity/fidelity-orchestrator');
    if (!isFidelityEnabled() || !userId) return [];
    const { getRecentFidelityLps } = require('./shared/services/coaching/lp-coaching/recent-fidelity-lps.service');
    return await getRecentFidelityLps(userId);
  } catch (e) {
    try { require('./shared/utils/logger').logToFile('[lp-fidelity] recent LP fetch failed (Yes/No fallback)', { error: e.message }); } catch (_) { /* ignore */ }
    return [];
  }
}

// bd-lqpog — route the LP-selection prompt to the right send method (a list payload
// throws in sendInteractiveButtons and stalls coaching). Extracted + unit-tested.
const { sendLpPrompt: __sendLpPrompt } = require('./shared/services/coaching/lp-coaching/send-lp-prompt');
const ExamCheckerHandler = require('./shared/handlers/exam-checker.handler');

// Import Utils
const { logToFile, logError, LOGS_DIR } = require('./shared/utils/logger');
const validators = require('./shared/utils/validators');
const constants = require('./shared/utils/constants');
const { setUserLanguage } = require('./shared/utils/language-cache');

// Import Database helpers
const { getOrCreateUser, trackChatStart } = require('./shared/database/bot-helpers');
const ConversationState = require('./shared/services/conversation-state.service');
const supabase = require('./shared/config/supabase');
const railwayRedis = require('./shared/services/cache/railway-redis.service');

// Live voice calls (bd-1hae7) — the bot only RECOGNISES and FORWARDS call
// events; all media work lives in the separate `calls` Railway service.
const { extractCallEvents, forwardCallEvents } = require('./shared/calls/call-forwarder');

// Import Routes (Flow encryption endpoints)
const flowEndpointRoutes = require('./shared/routes/flow-endpoint.routes');

// Create Express app
const app = express();
app.use(express.json());

// Mount routes (Flow encryption endpoints)
app.use('/api/flows', flowEndpointRoutes);
// service-to-service API (portal → bot). Shared-secret auth lives
// inside the router. Mounted before the inline /api/internal/send-password-reset
// route below; Express falls through when no route in the router matches.
const internalApiRoutes = require('./shared/routes/internal-api.routes');
const { clampLanguage } = require('./shared/config/ux-strings');
app.use('/api/internal', internalApiRoutes);

// Create temp directory if it doesn't exist
if (!fs.existsSync(constants.TEMP_DIR)) {
  fs.mkdirSync(constants.TEMP_DIR, { recursive: true });
}

/**
 * Handle broadcast status webhooks (delivered/read notifications)
 * Updates broadcast_messages table with delivery status for tracking
 * @param {Array} statuses - Array of status objects from webhook
 */
async function handleBroadcastStatusWebhook(statuses) {
  for (const status of statuses) {
    try {
      const messageWamid = status.id;
      const newStatus = status.status; // 'sent', 'delivered', 'read', 'failed'
      const timestamp = status.timestamp ? new Date(parseInt(status.timestamp) * 1000).toISOString() : new Date().toISOString();

      // Log failed message statuses with error details
      // Error 131042 (payment issue), 131049 (frequency cap), etc. come here
      if (newStatus === 'failed') {
        const errorCode = status.errors?.[0]?.code || 'unknown';
        const errorTitle = status.errors?.[0]?.title || 'Unknown error';
        const errorMessage = status.errors?.[0]?.message || '';
        logToFile('❌ MESSAGE DELIVERY FAILED', {
          messageWamid,
          errorCode,
          errorTitle,
          errorMessage,
          recipientId: status.recipient_id,
          timestamp,
          fullErrors: status.errors
        });
        // Don't continue - let it fall through to potentially update broadcast_messages if needed
      }

      // Only track delivered and read statuses for broadcasts (not sent/failed)
      if (!['delivered', 'read', 'failed'].includes(newStatus)) {
        continue;
      }

      logToFile('📬 Broadcast status update received', {
        messageWamid,
        status: newStatus,
        timestamp
      });

      // Find the broadcast message by message_id (WhatsApp wamid) and update its status
      const { data: broadcastMessage, error: findError } = await supabase
        .from('broadcast_messages')
        .select('id, broadcast_id, status')
        .eq('message_id', messageWamid)
        .single();

      if (findError || !broadcastMessage) {
        // Not a broadcast message - this is normal for regular messages
        continue;
      }

      // Only update if new status is "higher" than current
      // Status progression: pending → sent → delivered → read
      const statusOrder = { 'pending': 0, 'sent': 1, 'delivered': 2, 'read': 3, 'failed': -1 };
      if (statusOrder[newStatus] <= statusOrder[broadcastMessage.status]) {
        continue; // Don't downgrade status
      }

      // Update the broadcast message status
      const updateFields = { status: newStatus };
      if (newStatus === 'delivered') {
        updateFields.delivered_at = timestamp;
      } else if (newStatus === 'read') {
        updateFields.read_at = timestamp;
      }

      const { error: updateError } = await supabase
        .from('broadcast_messages')
        .update(updateFields)
        .eq('id', broadcastMessage.id);

      if (updateError) {
        logToFile('❌ Failed to update broadcast message status', {
          error: updateError.message,
          messageId: broadcastMessage.id
        });
        continue;
      }

      // Update the count in broadcast_logs using RPC function
      if (newStatus === 'delivered') {
        await supabase.rpc('increment_broadcast_count', {
          p_broadcast_id: broadcastMessage.broadcast_id,
          p_column_name: 'delivered_count'
        });
      } else if (newStatus === 'read') {
        await supabase.rpc('increment_broadcast_count', {
          p_broadcast_id: broadcastMessage.broadcast_id,
          p_column_name: 'read_count'
        });
      }

      logToFile('✅ Broadcast message status updated', {
        messageId: broadcastMessage.id,
        broadcastId: broadcastMessage.broadcast_id,
        newStatus
      });
    } catch (error) {
      logToFile('❌ Error processing broadcast status', {
        error: error.message,
        status
      });
    }
  }
}

/**
 * bd-2482 (NIETE port of PK bd-1598): video-library broadcast "Select Video"
 * CTA tap. Opens the Student Videos Flow directly, bypassing any per-user
 * gate in text-message.handler.js. On any sendFlow error, falls back to the
 * keyword path (handleTextMessage 'video') so the tap never dead-ends.
 */
/**
 * Attendance taps — the principal's tap-or-voice choice, and legacy class picks.
 *
 * `att_method_*` is the live one: it answers "how would you like to mark?", which the
 * router asks in chat because the voice half cannot be answered from inside a Flow
 * `att_class_*` is a picker button from before the register moved into the Flow, and may
 * still be sitting on a handset; the chat class picker is no longer produced.
 *
 * Registered for BOTH button_reply and list_reply: a list selection arrives in a
 * different branch than a button, and emitting an id with a consumer in only one
 * branch is how a tap silently does nothing — a past fix shipped exactly that.
 */
async function handleAttendanceTap(interactiveId, from, user) {
  const AttendanceRouter = require('./shared/services/attendance-router.service');
  const constants = require('./shared/utils/constants');

  let decision;
  if (interactiveId.startsWith('att_method_')) {
    decision = await AttendanceRouter.resolveMethodChoice(user.id, interactiveId);
    // Answered by tapping, so stop listening for a typed answer — otherwise the next
    // message containing "voice" would be read as choosing it all over again.
    if (decision.action !== 'ASK_METHOD') await AttendanceRouter.closeMethodQuestion(user.id);
  } else if (interactiveId.startsWith('att_voice_')) {
    // Which class the voice note is for. Only the voice branch asks this — the tap
    // branch picks its class on a Flow screen.
    decision = await AttendanceRouter.resolveVoiceClassChoice(user.id, interactiveId);
  } else if (interactiveId.startsWith('att_class_')) {
    decision = await AttendanceRouter.resolveClassChoice(user.id, interactiveId);
  } else {
    return false;
  }

  // Voice leaves the Flow behind — a Flow cannot receive a voice note. Arm the wait
  // and hand the conversation back to chat; voice-message.handler picks it up.
  if (decision.action === 'AWAIT_VOICE') {
    const VoiceAttendance = require('./shared/services/voice-attendance.service');
    await VoiceAttendance.arm(user.id, { subject: decision.subject, targetId: decision.targetId });
    await WhatsAppService.sendMessage(from, decision.message);
    return true;
  }

  // "Which class is the voice note for?" — buttons while they fit, a list past that.
  if (decision.action === 'ASK_CLASS_FOR_VOICE') {
    await WhatsAppService.sendInteractiveButtons(from, {
      body: decision.message,
      buttons: decision.buttons,
    });
    return true;
  }

  if (decision.action === 'ASK_CLASS_FOR_VOICE_LIST') {
    await WhatsAppService.sendInteractiveMessage(from, {
      body: { text: decision.message },
      action: { button: 'Choose class', sections: [{ title: 'Your classes', rows: decision.rows }] },
    });
    if (decision.truncated) {
      await WhatsAppService.sendMessage(from, `Showing your first ${AttendanceRouter.MAX_ROWS} classes.`);
    }
    return true;
  }

  // Re-ask rather than assume, when a method id comes back that we do not know.
  if (decision.action === 'ASK_METHOD') {
    await WhatsAppService.sendInteractiveButtons(from, {
      body: decision.message,
      buttons: decision.buttons,
    });
    return true;
  }

  // One Flow, opened with the bare user id for a teacher; it picks the class
  // and the date. MARK_* carry an explicit target — a principal always.
  if (decision.action === 'OPEN_REGISTER'
      || decision.action === 'MARK_TEACHERS' || decision.action === 'MARK_STUDENTS') {
    if (!constants.ATTENDANCE_MARKING_FLOW_ID) {
      await WhatsAppService.sendMessage(from, 'Attendance is not available on this number yet.');
      return true;
    }
    await WhatsAppService.sendFlow(from, {
      flowId: constants.ATTENDANCE_MARKING_FLOW_ID,
      header: '📋 Attendance',
      body: decision.action === 'MARK_TEACHERS'
        ? "Mark your school's teachers — pick the day, then tap whoever is away."
        : 'Mark your class for today.',
      buttonText: 'Mark attendance',
      flowToken: decision.flowToken,
    });
    return true;
  }

  // /class owns class creation now — attendance points at it rather than shipping a
  // second way to make one. flowToken is the bare user id, the class-manager
  // endpoint's convention (NOT a composite token). (bd-2724)
  if (decision.action === 'SEND_CLASS_MANAGER') {
    if (constants.CLASS_MANAGER_FLOW_ID) {
      await WhatsAppService.sendFlow(from, {
        flowId: constants.CLASS_MANAGER_FLOW_ID,
        header: '🏫 Your classes',
        body: decision.message,
        buttonText: 'Manage classes',
        flowToken: user.id,
      });
      return true;
    }
    await WhatsAppService.sendMessage(from, `${decision.message} Send /class to set one up.`);
    return true;
  }

  // bd-2713: a class that exists but has no students. Send them where the
  // students are added instead of opening a register with nobody on it. Without
  // this branch EMPTY_CLASS falls through to the generic message below and the
  // teacher gets told what is wrong with no way to act on it.
  if (decision.action === 'EMPTY_CLASS') {
    if (constants.EDIT_CLASS_FLOW_ID) {
      await WhatsAppService.sendFlow(from, {
        flowId: constants.EDIT_CLASS_FLOW_ID,
        header: '📋 Add students',
        body: decision.message,
        buttonText: 'Add students',
        flowToken: `${user.id}:${decision.listId}`,
      });
      return true;
    }
    await WhatsAppService.sendMessage(from, decision.message);
    return true;
  }

  await WhatsAppService.sendMessage(from, decision.message || 'Sorry, something went wrong.');
  return true;
}

async function openStudentVideosFlowFromCta(message, from, user) {
  const { STUDENT_VIDEOS_FLOW_ID } = require('./shared/utils/constants');
  logToFile('🎬 Student Videos: Select Video CTA tapped', { from, userId: user?.id });
  if (STUDENT_VIDEOS_FLOW_ID) {
    try {
      await WhatsAppService.sendFlow(from, {
        flowId: STUDENT_VIDEOS_FLOW_ID,
        header: '🎬 Student Videos',
        body: 'Choose your class, subject and topic — I will send the video to your chat.',
        buttonText: 'Browse',
        flowToken: `${user?.id || from}:student-videos:${Date.now()}`,
      });
      return;
    } catch (flowErr) {
      logToFile('Student Videos CTA: sendFlow failed, falling back to keyword path', { error: flowErr.message });
    }
  }
  await handleTextMessage(message, from, 'video', user);
}

/**
 * Track when a user replies after receiving a broadcast
 * Updates broadcast_messages.replied_at and increments replied_count
 * @param {string} userId - User UUID
 */
async function trackBroadcastReply(userId) {
  try {
    // Find any broadcast messages for this user that:
    // 1. Were sent/delivered/read (not pending or failed)
    // 2. Haven't been marked as replied yet
    // 3. Were sent in the last 7 days (reasonable engagement window)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: unrepliedMessages, error: findError } = await supabase
      .from('broadcast_messages')
      .select('id, broadcast_id')
      .eq('user_id', userId)
      .in('status', ['sent', 'delivered', 'read'])
      .is('replied_at', null)
      .gte('sent_at', sevenDaysAgo)
      .limit(10); // Cap to prevent large updates

    if (findError || !unrepliedMessages || unrepliedMessages.length === 0) {
      return; // No unreplied broadcasts to track
    }

    logToFile('📬 User replied after broadcast', {
      userId,
      unrepliedCount: unrepliedMessages.length
    });

    // Mark all as replied
    const messageIds = unrepliedMessages.map(m => m.id);
    const { error: updateError } = await supabase
      .from('broadcast_messages')
      .update({ replied_at: new Date().toISOString() })
      .in('id', messageIds);

    if (updateError) {
      logToFile('❌ Failed to update broadcast replied_at', {
        error: updateError.message,
        messageIds
      });
      return;
    }

    // Increment replied_count for each unique broadcast
    const broadcastIds = [...new Set(unrepliedMessages.map(m => m.broadcast_id))];
    for (const broadcastId of broadcastIds) {
      // Use RPC function to increment replied_count
      await supabase.rpc('increment_replied_count', { p_broadcast_id: broadcastId });
    }

    logToFile('✅ Broadcast reply tracked', {
      userId,
      messagesUpdated: messageIds.length,
      broadcastsUpdated: broadcastIds.length
    });
  } catch (error) {
    logToFile('❌ Error in trackBroadcastReply', {
      error: error.message,
      userId
    });
  }
}

/**
 * Webhook verification endpoint (GET)
 */
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('Webhook verification request received');
  console.log('Mode:', mode);
  console.log('Token:', token);

  if (mode === 'subscribe' && token === constants.WEBHOOK_VERIFY_TOKEN) {
    console.log('Webhook verified successfully!');
    res.status(200).send(challenge);
  } else {
    console.log('Webhook verification failed');
    res.status(403).send('Forbidden');
  }
});

/**
 * Webhook endpoint to receive messages (POST)
 */
app.post('/webhook', async (req, res) => {
  // Generate correlation ID for tracing this request across all logs
  const correlationId = generateCorrelationId();

  // Wrap the entire request processing with correlation context
  // All console.log calls inside will automatically include correlationId
  await runWithCorrelation(correlationId, async () => {
    logToFile('=== INCOMING WEBHOOK ===', { correlationId });

    // Issue #58 FIX: Add button payload diagnostic logging
    // Helps debug why some button clicks aren't being processed
    const webhookChange = req.body.entry?.[0]?.changes?.[0];
    const webhookValue = webhookChange?.value;
    const webhookField = webhookChange?.field;
    logToFile('Webhook diagnostic', {
      correlationId,
      field: webhookField,
      hasMessages: !!webhookValue?.messages,
      hasStatuses: !!webhookValue?.statuses,
      messageType: webhookValue?.messages?.[0]?.type,
      buttonPayload: webhookValue?.messages?.[0]?.button?.payload,
      interactiveType: webhookValue?.messages?.[0]?.interactive?.type,
      interactiveId: webhookValue?.messages?.[0]?.interactive?.list_reply?.id ||
                     webhookValue?.messages?.[0]?.interactive?.button_reply?.id
    });
    if (webhookField && webhookField !== 'messages') {
      logToFile('Non-messages webhook payload', {
        correlationId,
        field: webhookField,
        value: JSON.stringify(webhookValue).slice(0, 2000),
      });
    }

    try {
      // Live voice calls (bd-1hae7.2) — handled FIRST and returned, so a calls
      // payload can never fall through into message handling. The media work
      // runs in a separate Railway service; this hands the event over the
      // private network and answers Meta immediately. Forwarding is
      // fire-and-forget: if the calls service is down we still 200, because a
      // Meta retry storm on the messages webhook would be far worse.
      const callEvents = extractCallEvents(req.body);
      if (callEvents) {
        logToFile('Call events received', {
          correlationId,
          count: callEvents.calls.length,
          events: callEvents.calls.map((c) => `${c.event || '?'}:${c.id}`),
        });
        void forwardCallEvents(callEvents);
        res.status(200).send('EVENT_RECEIVED');
        return;
      }

      // Check for status webhooks first (delivered/read notifications)
      // Used for broadcast delivery tracking
      const statusValidation = validators.validateWebhookStatus(req);
      if (statusValidation) {
        await handleBroadcastStatusWebhook(statusValidation.statuses);
        res.status(200).send('EVENT_RECEIVED');
        return;
      }

      // Validate webhook structure
      const validation = validators.validateWebhookMessage(req);

    if (!validation) {
      res.status(200).send('EVENT_RECEIVED');
      return;
    }

    const { entry, message, from, messageBody, messageType, messageTimestamp, phoneNumberId } = validation;

    // Skip webhooks for other phone numbers (prevents cross-WABA processing)
    if (!validators.isOurPhoneNumber(phoneNumberId)) {
      res.status(200).send('EVENT_RECEIVED');
      return;
    }

    // Skip test webhooks
    if (validators.isTestWebhook(entry)) {
      res.status(200).send('EVENT_RECEIVED');
      return;
    }

    logToFile(`Message received from ${from}`, {
      messageType: messageType,
      messageId: message.id,
      timestamp: messageTimestamp,
      hasText: !!message.text,
      hasAudio: !!message.audio,
      hasVoice: !!message.voice,
      fullMessage: message
    });

    // Skip test phone numbers
    if (validators.isTestPhoneNumber(from)) {
      res.status(200).send('EVENT_RECEIVED');
      return;
    }

    // Check message timestamp (24-hour window)
    if (!validators.isWithin24Hours(messageTimestamp, from)) {
      res.status(200).send('EVENT_RECEIVED');
      return;
    }

    // Per-phone rate limit (Redis sliding window; RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_SECONDS).
    // Fails open when Redis is down. A misbehaving phone is dropped BEFORE we spend LLM/Gamma dollars on it.
    // We deliberately do NOT reply on the burst message — that would double the cost. First over-limit send
    // gets a one-off "slow down" nudge (also rate-limited via the same window at 1/window/user).
    const rateCheck = await railwayRedis.checkRateLimit(from);
    if (!rateCheck.allowed) {
      logToFile('⛔ Rate limit exceeded, dropping message', {
        from, count: rateCheck.count, limit: constants.RATE_LIMIT_MAX,
        windowSeconds: constants.RATE_LIMIT_WINDOW_SECONDS, resetAt: rateCheck.resetAt
      });
      const nudgeCheck = await railwayRedis.checkRateLimit(`ratenudge:${from}`, 1, constants.RATE_LIMIT_WINDOW_SECONDS);
      if (nudgeCheck.allowed) {
        try {
          const WhatsAppService = require('./shared/services/whatsapp.service');
          await WhatsAppService.sendMessage(from, `You're sending messages very quickly. Please slow down and try again in a minute.`);
        } catch (e) {
          logToFile('nudge send failed', { error: e.message });
        }
      }
      res.status(200).send('EVENT_RECEIVED');
      return;
    }

    // Check if already processed (Redis-backed duplicate detection)
    const alreadyProcessed = await SessionService.isProcessed(message.id);
    if (alreadyProcessed) {
      logToFile('⚠️  Duplicate message detected and skipped', {
        messageId: message.id,
        from,
        timestamp: messageTimestamp
      });
      res.status(200).send('EVENT_RECEIVED');
      return;
    }

    // Mark as processed
    await SessionService.markAsProcessed(message.id);

    logToFile('✅ Message accepted for processing', {
      messageId: message.id,
      from,
      type: messageType
    });

    // Send appropriate reaction based on whether this is user's first message
    const emoji = SessionService.getReactionEmoji(from);
    await WhatsAppService.sendReaction(from, message.id, emoji);

    // Show typing indicator
    await WhatsAppService.showTypingIndicator(from, message.id);

    // Get or create user in database
    let user = null;
    try {
      user = await getOrCreateUser(from);
      logToFile('User retrieved/created', { userId: user.id, phoneNumber: from });
    } catch (error) {
      logToFile('⚠️ Error with database user operation', { error: error.message });
      // Continue without database - bot will still work
    }

    // Track chat start for funnel analysis (for all message types)
    if (user) {
      try {
        // For text messages, pass the messageBody to extract session_id
        // For voice/audio messages, pass empty string (no session_id possible)
        const trackingMessage = messageType === 'text' ? messageBody : '';
        await trackChatStart(user, from, trackingMessage);
      } catch (error) {
        logToFile('⚠️ Error with funnel tracking', { error: error.message });
        // Continue - tracking failure shouldn't break bot
      }

      // Track broadcast reply engagement (non-blocking)
      trackBroadcastReply(user.id).catch(err => {
        logToFile('⚠️ Error tracking broadcast reply', { error: err.message });
      });
    }

    // Route to appropriate handler based on message type
    if (messageType === 'text' && messageBody) {
      await handleTextMessage(message, from, messageBody, user);
    } else if (messageType === 'audio' || messageType === 'voice') {
      await handleVoiceMessage(message, from, user);
    } else if (messageType === 'image' && message.image) {
      // Handle image messages for multimodal vision analysis
      await handleImageMessage(message, from, user);
    } else if (messageType === 'document' && message.document) {
      // Handle document uploads (lesson plans for coaching)
      await handleDocumentMessage(message, from, user);
    } else if (messageType === 'interactive' && message.interactive?.type === 'button_reply') {
      // Handle interactive button responses
      const buttonId = message.interactive.button_reply.id;
      logToFile('📱 Interactive button clicked', { buttonId, from });

      // "Pick up where you left off" / "Start fresh" — the answer to an interrupted
      // task the sweeper offered back. Routed FIRST because it is a decision about a
      // task that is already paused: any other branch that matched would start
      // something new on top of it. The handler returns false for ids it does not
      // own, so nothing else is shadowed.
      if (user) {
        const ConversationResume = require('./shared/services/conversation-resume.service');
        if (await ConversationResume.handleResumeButton(user, from, buttonId)) return;
      }

      // bd-2712 — "Grade another teacher?" after a Supervisor Remark submit.
      // Re-enters through handleRemarkCommand rather than reaching into the flow
      // sender directly, so BOTH gates (capability + open cycle) are re-checked:
      // a cycle can close between two teachers, and a principal must not keep a
      // private door open just because she was mid-session.
      if (buttonId === 'remark_next') {
        const { handleRemarkCommand } = require('./shared/handlers/remark-command.handler');
        await handleRemarkCommand(user, from, '/remark');
        return;
      }

      // Teacher-training module + quiz buttons
      if (buttonId.startsWith('training_module_done_')) {
        const moduleId = buttonId.replace('training_module_done_', '');
        const ContentDelivery = require('./shared/services/training/content-delivery.service');
        await ContentDelivery.handleModuleDone(user.id, moduleId, from);
        return;
      }
      if (buttonId === 'training_pause') {
        await WhatsAppService.sendMessage(from, '⏸ Paused. Send /training when you want to pick up where you left off.');
        return;
      }
      // immediate retry of a failed module quiz. Must be matched
      // BEFORE the generic `training_quiz_` answer handler below, whose id
      // regex expects `training_quiz_<uuid>_<option>` and would reject this.
      if (buttonId.startsWith('training_quiz_retry_')) {
        const moduleId = buttonId.replace('training_quiz_retry_', '');
        const QuizDelivery = require('./shared/services/training/quiz-delivery.service');
        await QuizDelivery.startTrainingQuiz(user.id, parseInt(moduleId, 10), from);
        return;
      }
      if (buttonId.startsWith('training_quiz_')) {
        const QuizDelivery = require('./shared/services/training/quiz-delivery.service');
        // bd-2525: pass the inbound wamid so the answer tap itself gets the
        // ✅/❌ reaction.
        await QuizDelivery.handleQuizButton(user.id, buttonId, from, message.id);
        return;
      }
      // BH open-ended capstone start 
      if (buttonId.startsWith('capstone_start_')) {
        const CapstoneDelivery = require('./shared/services/training/capstone-delivery.service');
        await CapstoneDelivery.handleCapstoneButton(user.id, buttonId, from);
        return;
      }

      // Commitment-card buttons ("Will you commit to trying this in your next
      // class?" → Yes / Maybe later / Not for me) — sent after every self-serve
      // coaching report. They were registered nowhere: every tap fell through to
      // generic text handling and was lost. One-line delegation; id parsing, the
      // record merge and the ack live in the service.
      if (buttonId.startsWith('card_')) {
        const { handleCardButton } = require('./shared/services/coaching/coaching-card/card-response.service');
        if (await handleCardButton(buttonId, from, user && user.preferred_language)) return;
      }

      // Coaching survey buttons (👍 Yes / 👎 Not really) — sent once the report AND the
      // voice debrief have both landed. Must be registered here: an unrecognised prefix
      // falls through to generic text handling and the tap is silently lost.
      if (buttonId.startsWith('coaching_fb_yes_') || buttonId.startsWith('coaching_fb_no_')) {
        const CoachingFeedbackService = require('./shared/services/coaching/coaching-feedback.service');
        await CoachingFeedbackService.handleFeedbackButton(buttonId, from);
        return;
      }

      // LP feedback survey buttons (👍 Yes / 👎 Not really) — 30s after LP delivery
      if (buttonId.startsWith('lp_feedback_yes_') || buttonId.startsWith('lp_feedback_no_')) {
        const LpFeedbackService = require('./shared/services/lp-feedback.service');
        await LpFeedbackService.handleFeedbackButton(buttonId, from);
        return;
      }

      // LP usage follow-up (bd-vw0aj) — the 👍 path when a voice note was delivered.
      // `lp_used_(taught|planned|not_yet)_<uuid>`. An unregistered prefix falls through to
      // generic text handling and the tap is silently lost, so this must stay beside the
      // survey buttons it follows.
      if (buttonId.startsWith('lp_used_')) {
        const LpFeedbackService = require('./shared/services/lp-feedback.service');
        await LpFeedbackService.handleUsageButton(buttonId, from);
        return;
      }

      // FEAT-080  — Oxbridge Grade 6-12 LP picker buttons.
      // `oxbridge_lp_pick_<catalogRowId>` → deliver the verbatim Oxbridge LP.
      // `oxbridge_lp_rumi`                → re-run the standard LLM LP path.
      if (buttonId.startsWith('oxbridge_lp_pick_') || buttonId === 'oxbridge_lp_rumi') {
        const OxbridgeLpService = require('./shared/services/oxbridge-lp.service');
        const pending = await OxbridgeLpService.getPendingPicker(from);
        try {
          if (buttonId.startsWith('oxbridge_lp_pick_')) {
            const rowId = parseInt(buttonId.replace('oxbridge_lp_pick_', ''), 10);
            const row = await OxbridgeLpService.getById(rowId);
            const language = (pending && pending.language) || 'en';
            if (row) {
              await OxbridgeLpService.deliverOxbridgeLp(from, row, language);
            } else {
              await WhatsAppService.sendMessage(
                from,
                language === 'ur'
                  ? 'معذرت — Oxbridge لیسن پلان دستیاب نہیں ہو سکا۔'
                  : "Sorry — that Oxbridge lesson plan wasn't available."
              );
            }
          } else {
            // "Generate Rumi LP" — re-invoke the normal LLM LP path using the
            // topic we cached at picker-send time.
            const topic = (pending && pending.topic) || '';
            const language = (pending && pending.language) || null;
            if (topic && user) {
              const { handleLessonPlanRequest } = require('./shared/handlers/text-message.handler');
              const typingController = WhatsAppService.startContinuousTypingIndicator(from, message.id);
              try {
                await handleLessonPlanRequest(from, topic, user, null, language, typingController);
              } finally {
                try { typingController.stop(); } catch (_) { /* best-effort */ }
              }
            } else {
              await WhatsAppService.sendMessage(
                from,
                'OK — please tell me the topic again and I\'ll generate a fresh lesson plan.'
              );
            }
          }
        } finally {
          await OxbridgeLpService.clearPendingPicker(from);
        }
        return;
      }

      // Coaching confirmation buttons
      if (buttonId.startsWith('coaching_confirm_')) {
        const sessionId = buttonId.replace('coaching_confirm_', '');
        await CoachingService.handleConfirmation(sessionId, from, true);
      } else if (buttonId.startsWith('att_method_') || buttonId.startsWith('att_voice_')
                 || buttonId.startsWith('att_class_')) {
        if (user?.id) { await handleAttendanceTap(buttonId, from, user); }
        else { await WhatsAppService.sendMessage(from, 'Please say "register" first.'); }
} else if (buttonId.startsWith('coaching_cancel_')) {
        const sessionId = buttonId.replace('coaching_cancel_', '');
        await CoachingService.handleConfirmation(sessionId, from, false);
      }
      // bd-tju8f — resume / cancel family. ORDER: the *_yes_/_no_ variants must
      // precede the bare observe_cancel_ prefix they share.
      else if (buttonId.startsWith('observe_cancel_yes_')) {
        const ObserveResume = require('./shared/services/observe/observe-resume.service');
        if (user) await ObserveResume.cancelObservation(buttonId.replace('observe_cancel_yes_', ''), from, user);
      }
      else if (buttonId.startsWith('observe_cancel_no_')) {
        const ObserveResume = require('./shared/services/observe/observe-resume.service');
        if (user) await ObserveResume.keepObservation(buttonId.replace('observe_cancel_no_', ''), from, user);
      }
      else if (buttonId.startsWith('observe_cancel_')) {
        const ObserveResume = require('./shared/services/observe/observe-resume.service');
        if (user) await ObserveResume.askCancel(buttonId.replace('observe_cancel_', ''), from, user);
      }
      else if (buttonId.startsWith('observe_form_')) {
        const ObserveResume = require('./shared/services/observe/observe-resume.service');
        if (user) await ObserveResume.sendForm(buttonId.replace('observe_form_', ''), from, user);
      }
      else if (buttonId.startsWith('observe_retry_')) {
        const ObserveResume = require('./shared/services/observe/observe-resume.service');
        if (user) await ObserveResume.runRetry(buttonId.replace('observe_retry_', ''), from, user);
      }
      else if (buttonId.startsWith('observe_ok_')) {
        logToFile('🔁 observe-resume: wait acknowledged', { buttonId });
      }
      // FEAT-102 /observe buttons — teacher-manage / send-to-teacher / debrief
      else if (buttonId.startsWith('observe_tmg_')) {
        const ObserveSend = require('./shared/services/observe/observe-send.service');
        if (user) await ObserveSend.handleTeacherManageButton(user, from, buttonId);
        else logToFile('⚠️ observe teacher-manage button without user', { buttonId });
      }
      else if (buttonId.startsWith('observe_send_')) {
        const ObserveSend = require('./shared/services/observe/observe-send.service');
        const parsed = ObserveSend.parseSendButtonId(buttonId);
        if (parsed && user) {
          if (parsed.action === 'start') await ObserveSend.startSendFlow(parsed.sessionId, from, user);
          else if (parsed.action === 'later') await ObserveSend.handleSendLater(parsed.sessionId, from, user);
          else if (parsed.action === 'confirm') await ObserveSend.handleSendConfirm(parsed.sessionId, from, user);
          else if (parsed.action === 'cancel') await ObserveSend.handleSendCancel(parsed.sessionId, from, user);
        } else {
          logToFile('⚠️ observe send button without user/parse', { buttonId, hasUser: !!user });
        }
      }
      else if (buttonId.startsWith('observe_debrief_now_') || buttonId.startsWith('observe_debrief_later_')) {
        const ObserveDebrief = require('./shared/services/observe/observe-debrief.service');
        const parsed = ObserveDebrief.parseDebriefButtonId(buttonId);
        if (parsed && user) {
          if (parsed.action === 'now') await ObserveDebrief.startDebrief(parsed.sessionId, from, user);
          else await ObserveDebrief.handleDebriefLater(parsed.sessionId, from, user);
        } else {
          logToFile('⚠️ observe debrief button without user/parse', { buttonId, hasUser: !!user });
        }
      }
      // Lesson plan buttons
      else if (buttonId.startsWith('lessonplan_yes_')) {
        const sessionId = buttonId.replace('lessonplan_yes_', '');
        await CoachingService.handleLessonPlanResponse(sessionId, from, true);
      } else if (buttonId.startsWith('lessonplan_no_')) {
        const sessionId = buttonId.replace('lessonplan_no_', '');
        await CoachingService.handleLessonPlanResponse(sessionId, from, false);
      }
      // Classroom-photo prompt buttons (Phase 1C-B). The photo-prompt.service
      // emits these IDs but neither was previously routed → sessions got stuck
      // at status=awaiting_photo with no way for the teacher to advance.
      // "No" → transition to the LP prompt (same next step as post-photo).
      // "Yes" → set status=awaiting_classroom_photo and tell the teacher to
      //         upload the photo now (image-message.handler picks it up).
      else if (buttonId.startsWith('photo_no_')) {
        const sessionId = buttonId.replace('photo_no_', '');
        logToFile('📸 User declined classroom photo — advancing to LP prompt', { sessionId, from });

        // Update conversation state past AWAITING_PHOTO.
        // bd-3ipd2: MERGE, don't replace — a bare { current_state } drops any
        // fields already on conversation_state (e.g. a race-held classroom_photos).
        // bd-9hzdn.3: also read user_id — the recent-LP menu must show the LPs of the
        // session OWNER (the observed teacher in /observe), not the tapper (the coach).
        const { data: noSession } = await supabase
          .from('coaching_sessions')
          .select('conversation_state, user_id')
          .eq('id', sessionId)
          .maybeSingle();

        // Send the same LP prompt the OECD/HOTS pre-photo-prompt flow used.
        // Language = the TAPPER's preference (teacher flow: the teacher; observe: the coach).
        // Recents = the session OWNER's LPs (identical in the teacher flow; the teacher's in observe).
        const { buildLPSelectionList } = require('./shared/services/coaching/lp-coaching/lp-selection-list.service');
        const { data: userRow } = await supabase
          .from('users')
          .select('preferred_language, region')
          .eq('id', user.id)
          .maybeSingle();
        const lang = userRow?.preferred_language || 'en';
        const lpPrompt = buildLPSelectionList(sessionId, await __recentFidelityLps(noSession?.user_id || user.id), lang, userRow?.region);
        // bd-zrlcp — send FIRST, commit only if the prompt actually went out.
        // sendInteractiveMessage returns false (it does not throw) when it refuses
        // a payload, so committing first parked sessions at a step the user was
        // never shown, with no sweeper to recover them.
        const lpSent = await __sendLpPrompt(WhatsAppService, from, lpPrompt);
        if (lpSent) {
          await supabase
            .from('coaching_sessions')
            .update({
              conversation_state: { ...(noSession?.conversation_state || {}), current_state: 'AWAITING_LESSON_PLAN' },
              status: 'awaiting_lesson_plan'
            })
            .eq('id', sessionId);
        } else {
          logToFile('⚠️ LP prompt could not be delivered — session left in place', { sessionId, from });
        }
      } else if (buttonId.startsWith('photo_yes_')) {
        const sessionId = buttonId.replace('photo_yes_', '');
        logToFile('📸 User will send classroom photo', { sessionId, from });

        // bd-3ipd2: MERGE conversation_state (don't clobber existing fields).
        const { data: yesSession } = await supabase
          .from('coaching_sessions')
          .select('conversation_state')
          .eq('id', sessionId)
          .maybeSingle();
        await supabase
          .from('coaching_sessions')
          .update({
            conversation_state: { ...(yesSession?.conversation_state || {}), current_state: 'AWAITING_CLASSROOM_PHOTO' },
            status: 'awaiting_classroom_photo'
          })
          .eq('id', sessionId);

        const { data: userRow } = await supabase
          .from('users')
          .select('preferred_language')
          .eq('id', user.id)
          .maybeSingle();
        const lang = userRow?.preferred_language || 'en';
        const msg = lang === 'ur'
          ? '📸 براہ کرم اپنی کلاس روم کی تصویر بھیجیں۔ میں اس کا تجزیہ کروں گا اور آپ کی رپورٹ میں شامل کروں گا۔'
          : '📸 Please send your classroom photo now. I\'ll analyze it and include it in your report.';
        await WhatsAppService.sendMessage(from, msg);
      }
      // bd-u35ex: the classroom-photo collection (image-message.handler.js Phase 3)
      // sends "Add another / Done" buttons (photo_more_ / photo_done_) after each
      // photo — but NEITHER had a handler, so tapping "Done" was a DEAD END: the
      // session stayed at awaiting_classroom_photo, analysis was never queued, and
      // no report was produced (only the early generic voice ack). This is the
      // "photo wiring off / lessons drop in the middle" cluster (R26/49/52/53 and
      // the downstream no-report reports). Both buttons are now wired.
      else if (buttonId.startsWith('photo_done_')) {
        const sessionId = buttonId.replace('photo_done_', '');
        logToFile('📸 User done adding classroom photos — advancing to LP prompt', { sessionId, from });

        // Advance to the SAME lesson-plan step the skip-photo path uses (photo_no),
        // which is the flow that works (R49). PRESERVE the existing conversation_state
        // (it holds the uploaded classroom_photos) — only move current_state forward.
        // bd-9hzdn.3: read user_id too — recents come from the session OWNER (the
        // observed teacher in /observe), language from the tapper.
        const { data: doneSession } = await supabase
          .from('coaching_sessions')
          .select('conversation_state, user_id')
          .eq('id', sessionId)
          .maybeSingle();

        const { buildLPSelectionList } = require('./shared/services/coaching/lp-coaching/lp-selection-list.service');
        const { data: userRow } = await supabase
          .from('users')
          .select('preferred_language, region')
          .eq('id', user.id)
          .maybeSingle();
        const lang = userRow?.preferred_language || 'en';
        const lpPrompt = buildLPSelectionList(sessionId, await __recentFidelityLps(doneSession?.user_id || user.id), lang, userRow?.region);
        // bd-zrlcp — send FIRST, commit only if the prompt actually went out.
        // sendInteractiveMessage returns false (it does not throw) when it refuses
        // a payload, so committing first parked sessions at a step the user was
        // never shown, with no sweeper to recover them.
        const lpSent = await __sendLpPrompt(WhatsAppService, from, lpPrompt);
        if (lpSent) {
          await supabase
            .from('coaching_sessions')
            .update({
              conversation_state: { ...(doneSession?.conversation_state || {}), current_state: 'AWAITING_LESSON_PLAN' },
              status: 'awaiting_lesson_plan'
            })
            .eq('id', sessionId);
        } else {
          logToFile('⚠️ LP prompt could not be delivered — session left in place', { sessionId, from });
        }
      }
      // bd-u35ex: "Add another" — keep collecting; the image handler (Phase 3) picks
      // up the next photo. Session stays at awaiting_classroom_photo.
      else if (buttonId.startsWith('photo_more_')) {
        const sessionId = buttonId.replace('photo_more_', '');
        logToFile('📸 User wants to add another classroom photo', { sessionId, from });
        const { data: userRow } = await supabase
          .from('users')
          .select('preferred_language')
          .eq('id', user.id)
          .maybeSingle();
        const lang = userRow?.preferred_language || 'en';
        const msg = lang === 'ur'
          ? '📸 اگلی تصویر بھیجیں۔'
          : '📸 Please send the next photo.';
        await WhatsAppService.sendMessage(from, msg);
      }
      // Stale session reminder buttons - Continue coaching
      else if (buttonId.startsWith('coaching_continue_')) {
        const sessionId = buttonId.replace('coaching_continue_', '');
        logToFile('🔄 User clicked Continue on stale session reminder', { sessionId, from });

        // Fetch session to determine where to resume
        const { data: session } = await supabase
          .from('coaching_sessions')
          .select('conversation_state, transcript_text, analysis_data')
          .eq('id', sessionId)
          .single();

        if (session) {
          const questionsAnswered = session.conversation_state?.questions_answered || 0;
          const nextQuestionNumber = questionsAnswered + 1;

          logToFile('📊 Resuming coaching session', {
            sessionId,
            questionsAnswered,
            nextQuestionNumber
          });

          if (nextQuestionNumber > 3) {
            // All questions already answered, go to report
            const CoachingJobQueueService = require('./shared/services/coaching/coaching-job-queue.service');
            await CoachingJobQueueService.queueReport(sessionId, { from });
            await WhatsAppService.sendMessage(from,
              "Great! All your reflections are recorded. Generating your coaching report now..."
            );
          } else {
            // Resume reflective conversation from next question
            const ReflectiveConversationService = require('./shared/services/coaching/reflective-conversation.service');
            await ReflectiveConversationService.conductReflectiveConversation(
              sessionId,
              from,
              nextQuestionNumber
            );

            // Clear reminder_sent_at since user re-engaged
            await supabase
              .from('coaching_sessions')
              .update({ reminder_sent_at: null })
              .eq('id', sessionId);
          }
        } else {
          await WhatsAppService.sendMessage(from, 'Sorry, I could not find that coaching session.');
        }
      }
      // Stale session reminder buttons - Finish and get partial report
      else if (buttonId.startsWith('coaching_finish_')) {
        const sessionId = buttonId.replace('coaching_finish_', '');
        logToFile('📊 User clicked Finish on stale session reminder', { sessionId, from });

        // Fetch session to get progress
        const { data: session } = await supabase
          .from('coaching_sessions')
          .select('conversation_state')
          .eq('id', sessionId)
          .single();

        if (session) {
          const questionsAnswered = session.conversation_state?.questions_answered || 0;

          // Update state to mark as user-requested early completion
          await supabase
            .from('coaching_sessions')
            .update({
              status: 'generating_report',
              conversation_state: {
                ...session.conversation_state,
                current_state: 'USER_REQUESTED_EARLY_COMPLETION',
                early_completion_at: new Date().toISOString(),
                questions_at_completion: questionsAnswered
              }
            })
            .eq('id', sessionId);

          // Queue report generation with partial flag
          const CoachingJobQueueService = require('./shared/services/coaching/coaching-job-queue.service');
          await CoachingJobQueueService.queueReport(sessionId, {
            from,
            partial: questionsAnswered < 3,
            userRequestedEarly: true
          });

          const progressMsg = questionsAnswered > 0
            ? `Got it! I'll generate your report based on the ${questionsAnswered} reflection${questionsAnswered > 1 ? 's' : ''} you provided. 📊`
            : `Got it! I'll generate your report based on your classroom audio analysis. 📊`;

          await WhatsAppService.sendMessage(from, progressMsg);
        } else {
          await WhatsAppService.sendMessage(from, 'Sorry, I could not find that coaching session.');
        }
      }
      // Vocabulary comprehension button answers
      else if (buttonId.startsWith('vocab_answer_')) {
        const selectedOption = buttonId.replace('vocab_answer_', '');  // "1", "2", or "3"
        logToFile('📖 Vocabulary answer button clicked', { buttonId, selectedOption, from });

        // Check if user is in comprehension flow
        const RedisComprehensionService = require('./shared/services/redis-comprehension.service');
        // Correct function name (was getFlowByUserId, should be findActiveFlowByUser)
        const flowData = await RedisComprehensionService.findActiveFlowByUser(user.id);

        if (flowData) {
          const assessmentId = flowData.assessment_id; // Use correct property name
          const questions = flowData.questions;
          const currentQuestionIndex = flowData.current_question_index;
          const currentQuestion = questions[currentQuestionIndex];

          // Record the answer
          const isCorrect = currentQuestion.expected_answer === selectedOption;
          const answerResult = {
            questionId: currentQuestion.id,
            questionType: currentQuestion.type,
            question: currentQuestion.question,
            studentAnswer: selectedOption,
            expectedAnswer: currentQuestion.expected_answer,
            correct: isCorrect,
            confidence: 1.0,  // Button answers are definitive
            explanation: isCorrect ? 'Correct button selection' : 'Incorrect button selection'
          };

          // recordAnswer only takes 2 params (assessmentId, answerResult)
          const updatedFlow = await RedisComprehensionService.recordAnswer(
            assessmentId,
            answerResult
          );

          logToFile('✅ Vocabulary answer recorded', {
            assessmentId,
            questionIndex: currentQuestionIndex,
            selectedOption,
            isCorrect
          });

          // Send feedback
          if (isCorrect) {
            await WhatsAppService.sendMessage(from, '✅ Correct!');
          } else {
            await WhatsAppService.sendMessage(from, `❌ That was ${currentQuestion.expected_answer}`);
          }

          // Check if more questions
          const nextQuestionIndex = updatedFlow.current_question_index;
          if (nextQuestionIndex < questions.length) {
            const nextQuestion = questions[nextQuestionIndex];

            // Send next question (handle image questions)
            if (nextQuestion.imageUrl && nextQuestion.buttons) {
              await WhatsAppService.sendImageWithButtons(
                from,
                nextQuestion.imageUrl,
                `Question ${nextQuestionIndex + 1}/${questions.length}: ${nextQuestion.question}`,
                nextQuestion.buttons
              );
            } else {
              await WhatsAppService.sendMessage(
                from,
                `Question ${nextQuestionIndex + 1}/${questions.length}: ${nextQuestion.question}`
              );
            }
          } else {
            // All questions answered - finalize
            const ComprehensionService = require('./shared/services/reading/comprehension.service');
            const { data: assessment } = await supabase
              .from('reading_assessments')
              .select('grade_level')
              .eq('id', assessmentId)
              .single();

            const comprehensionAnalysis = await ComprehensionService.analyzeComprehension(
              questions,
              updatedFlow.answers,
              assessment?.grade_level || 2,
              user.language || 'en'
            );

            // Store results
            await supabase
              .from('reading_assessments')
              .update({
                comprehension_answers: updatedFlow.answers,
                comprehension_score: comprehensionAnalysis.score,
                comprehension_analysis: comprehensionAnalysis
              })
              .eq('id', assessmentId);

            // Clear Redis state
            await RedisComprehensionService.clearFlow(assessmentId);

            // Generate combined report
            const AnalysisService = require('./shared/services/reading/analysis.service');
            await AnalysisService.generateCombinedReport(
              assessmentId,
              user.id,
              from,
              user.language || 'en'
            );
          }
        } else {
          logToFile('⚠️ No comprehension flow found for vocab answer', { userId: user.id });
          await WhatsAppService.sendMessage(from, 'Please start a reading assessment first.');
        }
      }
      // Feature video consent buttons (Integration Point 1 - after feature completion)
      else if (buttonId.startsWith('show_feature_video_') || buttonId.startsWith('skip_feature_video_')) {
        logToFile('🎥 Feature consent button clicked', { buttonId, from, userId: user?.id });

        if (user) {
          const FeatureLinkerService = require('./shared/services/feature-linker.service');
          const handled = await FeatureLinkerService.handleConsentButtonResponse(user.id, from, buttonId);

          if (!handled) {
            logToFile('⚠️ Feature consent button not handled', { buttonId, userId: user.id });
          }
        } else {
          logToFile('⚠️ No user found for feature consent button', { buttonId, from });
        }
      }
      // Keyword detection consent buttons (Integration Point 3 - chat keywords)
      else if (buttonId.startsWith('keyword_show_video_') || buttonId.startsWith('keyword_skip_video_')) {
        logToFile('🔍 Keyword consent button clicked', { buttonId, from, userId: user?.id });

        if (user) {
          const FeatureKeywordDetectorService = require('./shared/services/feature-keyword-detector.service');
          const handled = await FeatureKeywordDetectorService.handleKeywordConsentButton(user.id, from, buttonId);

          if (!handled) {
            logToFile('⚠️ Keyword consent button not handled', { buttonId, userId: user.id });
          }
        } else {
          logToFile('⚠️ No user found for keyword consent button', { buttonId, from });
        }
      }
      // Issue #35: Video Style Selection - Carousel button callback
      else if (buttonId.startsWith('style_')) {
        logToFile('🎨 Video style button clicked', { buttonId, from, userId: user?.id });

        if (user) {
          const VideoOrchestrator = require('./shared/services/video/video-orchestrator.service');
          const { parseStyleFromButtonId } = require('./shared/handlers/text-message.handler');

          // Parse style from button ID (style_photorealistic → photorealistic)
          const selectedStyle = parseStyleFromButtonId(buttonId);

          // Check if user was awaiting style selection
          const styleState = await VideoOrchestrator.checkAwaitingStyle(user.id);

          if (styleState) {
            logToFile('✅ Processing video style selection', {
              userId: user.id,
              selectedStyle,
              topic: styleState.topic
            });

            await VideoOrchestrator.handleStyleSelection(
              user,
              from,
              selectedStyle,
              styleState.sessionId,
              styleState.topic,
              styleState.language,
              styleState.customization
            );
          } else {
            // No awaiting state - might be stale button click
            logToFile('⚠️ Style button clicked but no awaiting state', { buttonId, userId: user.id });
            await WhatsAppService.sendMessage(from,
              "That style selection has expired. Please use /video to start a new video request."
            );
          }
        } else {
          logToFile('⚠️ No user found for style button', { buttonId, from });
        }
      }
      // Exam Checker buttons
      else if (ExamCheckerHandler.isExamCheckerButton(buttonId)) {
        if (user) {
          await ExamCheckerHandler.handleExamButton(buttonId, from, user);
        } else {
          logToFile('⚠️ No user found for exam checker button', { buttonId, from });
        }
      }
      // Quiz invite buttons (free-message path) — a parent taps "Start Quiz"
      // or "Not now". No Rumi account required (parent isn't necessarily a user).
      else if (buttonId === 'quiz_invite_start') {
        const QuizSessionService = require('./shared/services/quiz/quiz-session.service');
        logToFile('▶️ quiz_invite_start tapped', { from });
        await QuizSessionService.startQuizFromInvite(from);
      }
      else if (buttonId === 'quiz_invite_skip') {
        const QuizSessionService = require('./shared/services/quiz/quiz-session.service');
        logToFile('⏭️ quiz_invite_skip tapped', { from });
        const state = await QuizSessionService.getActiveState(from);
        if (state) await QuizSessionService.endSession(from, state, 'incomplete');
      }
      // Quiz answer buttons: quiz_<questionId>_<A|B|C>
      else if (/^quiz_[a-zA-Z0-9\-]+_[ABC]$/i.test(buttonId)) {
        const QuizSessionService = require('./shared/services/quiz/quiz-session.service');
        logToFile('🅰️ Quiz answer button tapped', { buttonId, from });
        const state = await QuizSessionService.getActiveState(from);
        if (state) {
          await QuizSessionService.handleAnswer(from, buttonId, state);
        } else {
          logToFile('⚠️ Quiz answer tapped but no active state', { buttonId, from });
        }
      }
      // Follow-up LP buttons (post-report): stash intent + ask for next topic;
      // text-message.handler intercepts the reply and queues the LP.
      else if (
        buttonId.startsWith('quiz_revise_next_') ||
        buttonId.startsWith('quiz_revise_only_') ||
        buttonId.startsWith('quiz_extend_') ||
        buttonId.startsWith('quiz_bridge_')
      ) {
        const QuizFollowUpService = require('./shared/services/quiz/quiz-follow-up.service');
        await QuizFollowUpService.handleFollowUpButton(buttonId, user, from);
      }
      else if (buttonId === 'quiz_skip_followup') {
        logToFile('⏭️ quiz_skip_followup tapped', { from, userId: user?.id });
        // Silent skip — teacher acknowledged the report, no follow-up LP this round.
      }
      // Two-button confirmation on a quiz intent (send to class vs show in chat).
      else if (buttonId === 'quiz_send_to_class' || buttonId === 'quiz_show_in_chat') {
        try {
          const QuizIntentRouter = require('./shared/services/quiz/quiz-intent-router.service');
          await QuizIntentRouter.handleConfirmationButton(buttonId, user, from);
        } catch (err) {
          logToFile('❌ quiz intent button routing failed', { buttonId, error: err.message });
        }
      }
      // Student Video Library post-delivery survey (👍 Yes / 👎 Not really).
      else if (buttonId.startsWith('student_video_feedback_yes_') || buttonId.startsWith('student_video_feedback_no_')) {
        const StudentVideoFeedbackService = require('./shared/services/student-video-feedback.service');
        await StudentVideoFeedbackService.handleFeedbackButton(buttonId, from);
      }
      // bd-2482 (NIETE port of PK bd-2308/2313): Video quizzes — the offer
      // after a video, an answer tap, the share-with-class offer, the
      // invite-a-friend offer. All use the `vq_` prefix so they can never
      // collide with the parent-quiz `quiz_` ids handled elsewhere.
      // handleAnswer stays LAST: it treats anything left as an answer id, so
      // a new offer button placed after it would be swallowed as a wrong answer.
      else if (buttonId.startsWith('vq_')) {
        const VideoQuizService = require('./shared/services/quiz/video-quiz.service');
        const VideoQuizShare = require('./shared/services/quiz/video-quiz-share.service');
        const VideoQuizInvite = require('./shared/services/quiz/video-quiz-invite.service');
        // bd-2475 (ported from PK) — the watch-more/binge offer, chained
        // after a declined invite. Same LAST-before-handleAnswer placement,
        // same reason.
        const VideoQuizBinge = require('./shared/services/quiz/video-quiz-binge.service');
        const handled = await VideoQuizService.handleOfferButton(buttonId, from)
          || await VideoQuizShare.handleShareButton(buttonId, from)
          || await VideoQuizInvite.handleInviteButton(buttonId, from)
          || await VideoQuizBinge.handleMoreButton(buttonId, from)
          || await VideoQuizService.handleAnswer(from, buttonId);
        if (!handled) {
          logToFile('⚠️ unrouted vq_ button', { buttonId, from });
        }
      }
      // Edit-class multi-class picker: open the edit-class flow for the chosen class.
      else if (buttonId.startsWith('edit_class_')) {
        const listId = buttonId.replace('edit_class_', '');
        logToFile('📋 Edit class button selected', { listId, userId: user?.id, from });
        if (!user?.id) {
          await WhatsAppService.sendMessage(from, 'Sorry, I could not identify your account. Please try "edit class" again.');
        } else if (!constants.EDIT_CLASS_FLOW_ID) {
          await WhatsAppService.sendMessage(from, 'Sorry, class editing is not available right now. Please try again later.');
        } else {
          const { data: classRow } = await supabase
            .from('student_lists')
            .select('id, class_name, section')
            .eq('id', listId)
            .eq('user_id', user.id)
            .eq('is_active', true)
            .single();
          if (!classRow) {
            await WhatsAppService.sendMessage(from, 'I could not find that class. Please say "edit class" to refresh your class list.');
          } else {
            const flowToken = `${user.id}:${classRow.id}`;
            await WhatsAppService.sendFlow(from, {
              flowId: constants.EDIT_CLASS_FLOW_ID,
              header: '📋 Edit Class',
              body: `Edit roster for ${classRow.section ? `${classRow.class_name} - ${classRow.section}` : classRow.class_name}`,
              buttonText: 'Edit Class',
              flowToken
            });
          }
        }
      }
      // bd-2482 (NIETE port of PK bd-1598): video-library broadcast
      // "Select Video" CTA arriving as an interactive button_reply.
      else if (buttonId === 'select_video' || isSelectVideoButton({ buttonId })) {
        await openStudentVideosFlowFromCta(message, from, user);
      }
      else {
        logToFile('⚠️ Unknown button ID', { buttonId });
      }
    } else if (messageType === 'button' && message.button) {
      // Issue #35: Handle carousel template button responses
      // Carousel template buttons come as messageType='button' with payload in message.button.payload
      const buttonPayload = message.button.payload;
      const buttonText = message.button.text;

      logToFile('🎠 Carousel template button clicked', {
        buttonPayload,
        buttonText,
        from,
        userId: user?.id
      });

      // bd-nnco2: the DC-intro broadcast's "View notification" quick-reply —
      // deliver the official FDE authorization letter (repo asset — no hosting,
      // no expiring URL) and log a countable tap event for broadcast tracking.
      if (buttonPayload === 'VIEW_FDE_NOTIFICATION') {
        logToFile('📄 FDE notification requested (broadcast button)', {
          event: 'broadcast.fde_notification_viewed',
          from,
          userId: user?.id || null,
        });
        // local require: `path` is NOT a module-scope import in this file, and an
        // untested branch is exactly where a ReferenceError hides (bd-nnco2 QA).
        const fdePdf = require('path').join(__dirname, 'shared', 'assets', 'fde-notification-digital-coach.pdf');
        await WhatsAppService.sendDocument(
          from,
          fdePdf,
          'FDE Notification - Digital Coach.pdf',
          'FDE کا سرکاری notification — Digital Coach'
        );
      }
      // Handle style_* payloads from video style carousel
      else if (buttonPayload && buttonPayload.startsWith('style_')) {
        if (user) {
          const VideoOrchestrator = require('./shared/services/video/video-orchestrator.service');
          const { parseStyleFromButtonId } = require('./shared/handlers/text-message.handler');

          // Parse style from payload (style_photorealistic → photorealistic)
          const selectedStyle = parseStyleFromButtonId(buttonPayload);

          // Check if user was awaiting style selection
          const styleState = await VideoOrchestrator.checkAwaitingStyle(user.id);

          if (styleState) {
            logToFile('✅ Processing video style selection (carousel template)', {
              userId: user.id,
              selectedStyle,
              topic: styleState.topic
            });

            await VideoOrchestrator.handleStyleSelection(
              user,
              from,
              selectedStyle,
              styleState.sessionId,
              styleState.topic,
              styleState.language,
              styleState.customization
            );
          } else {
            // No awaiting state - might be stale button click
            logToFile('⚠️ Style carousel button clicked but no awaiting state', {
              buttonPayload,
              userId: user.id
            });
            await WhatsAppService.sendMessage(from,
              "That style selection has expired. Please use /video to start a new video request."
            );
          }
        } else {
          logToFile('⚠️ No user found for carousel button', { buttonPayload, from });
        }
      } else if (buttonPayload && buttonPayload.startsWith('menu_')) {
        // Handle menu_* payloads from feature menu carousel
        if (user) {
          const MenuService = require('./shared/services/menu.service');

          logToFile('📋 Processing menu selection (carousel/list)', {
            userId: user.id,
            buttonPayload
          });

          await MenuService.handleMenuButtonResponse(
            user,
            from,
            buttonPayload,
            user.language || 'en'
          );
        } else {
          logToFile('⚠️ No user found for menu button', { buttonPayload, from });
        }
      }
      // bd-2482 (NIETE port of PK bd-1598): video-library broadcast
      // "Select Video" QUICK_REPLY. Templates deliver QUICK_REPLY as
      // messageType:'button'; match payload OR button text (EN/UR) since
      // Meta strips the payload on some registrations.
      else if (isSelectVideoButton({ buttonPayload, buttonText })) {
        await openStudentVideosFlowFromCta(message, from, user);
      }
      // bd-ri5o9.1 — the teacher tapped "Get Report" on the report-invite
      // template. MUST stay above the bd-kggts fallthrough: below it this branch
      // is unreachable, which is exactly the bug. The payload carries the session,
      // and the worker's 'teacher_tap' phase re-checks that `from` is the number
      // the coach named before it delivers anything.
      else if (matchObserveReportTap({ payload: buttonPayload, text: buttonText })) {
        const sessionId = matchObserveReportTap({ payload: buttonPayload, text: buttonText });
        logToFile('📨 observe report tap received', {
          event: 'observe.report.tap_received', sessionId, from, userId: user?.id || null,
        });
        const CoachingJobQueueService = require('./shared/services/coaching/coaching-job-queue.service');
        await CoachingJobQueueService.queueObserveTeacherReport(sessionId, { from, phase: 'teacher_tap' });
      }
      // …the same button with the payload stripped by Meta (bd-2482 class). The
      // label proves intent but never WHICH report, so we must not guess a
      // session — tell the teacher we are on it and leave a countable event.
      else if (isObserveReportTapText(buttonText)) {
        logToFile('📨 observe report tap — text only, no session payload', {
          event: 'observe.report.tap_no_payload', buttonText, from, userId: user?.id || null,
        });
        await handleTextMessage(message, from, String(buttonText).trim(), user);
      }
      // FALLTHROUGH (bd-kggts). A QUICK_REPLY is the teacher saying that phrase —
      // so route its text through the normal text path instead of dead-ending.
      //
      // Before this, anything that was not style_* or the bd-2482 video CTA was
      // logged and dropped. The K-5 lesson-plan broadcast button
      // ("Lesson Plans & Assessment") matches the LP intent matcher at STRONG tier,
      // but the text never reached the matcher, so tapping it did nothing.
      //
      // Text first, payload second: Meta strips the payload on some registrations
      // (already learned on bd-2482), so the visible label is the reliable signal.
      else {
        const asText = String(buttonText || buttonPayload || '').trim();
        // bd-ri5o9.1 — this fallthrough is deliberately silent about intent, so a
        // payload nobody routes becomes an ordinary chat message with no error
        // anywhere. That is how the whole report-tap path stayed dead for a month.
        // Emit a countable event so the NEXT unrouted payload is visible on day one.
        if (buttonPayload) {
          logToFile('⚠️ Template button payload matched no branch — routed as text', {
            event: 'observe.report.tap_unrouted', buttonPayload, buttonText, from,
          });
        }
        if (asText) {
          logToFile('↩️ Template button → text handler', { asText, buttonPayload, from });
          await handleTextMessage(message, from, asText, user);
        } else {
          logToFile('⚠️ Template button with no text or payload', { buttonPayload, buttonText });
        }
      }
    } else if (messageType === 'interactive' && message.interactive?.type === 'nfm_reply') {
      // Handle WhatsApp Flow submissions (registration, reading assessment, etc.)
      const flowName = message.interactive?.nfm_reply?.name || '';

      // Parse response_json to determine flow type
      let responseJson = {};
      try {
        responseJson = JSON.parse(message.interactive?.nfm_reply?.response_json || '{}');
      } catch (error) {
        logToFile('❌ Failed to parse flow response_json', { from, error: error.message });
      }

      // bd-2482 (NIETE port of PK bd-2309/2338): video-quiz Flow submissions
      // are routed on the FLOW TOKEN (`vq:<sessionId>:<questionId>` for a
      // picture-answer, `vqjoin:...` for a new student's name+class) — not on
      // response shape, since a generic {screen_0_..: "2"} payload would have
      // to be guessed at. The token is ours by construction.
      const vqToken = responseJson.flow_token || message.interactive?.nfm_reply?.flow_token || '';

      if (typeof vqToken === 'string' && vqToken.startsWith('vqjoin:')) {
        try {
          const VideoQuizShare = require('./shared/services/quiz/video-quiz-share.service');
          const handled = await VideoQuizShare.handleJoinFlowReply(from, vqToken, responseJson);
          if (handled) return;
        } catch (joinErr) {
          logToFile('❌ student join Flow reply routing failed', { error: joinErr.message });
        }
      }

      if (typeof vqToken === 'string' && vqToken.startsWith('vq:')) {
        try {
          const [, , questionId] = vqToken.split(':');
          const picked = Object.entries(responseJson)
            .filter(([k]) => k !== 'flow_token')
            .map(([, v]) => v)
            .find((v) => /^\d+$/.test(String(v)));
          if (questionId && picked !== undefined) {
            const VideoQuizService = require('./shared/services/quiz/video-quiz.service');
            await VideoQuizService.handleAnswer(from, `vq_${questionId}_${picked}`);
            return;
          }
          logToFile('⚠️ video-quiz Flow reply had no option index', { vqToken, responseJson });
        } catch (vqFlowErr) {
          logToFile('❌ video-quiz Flow reply routing failed', { error: vqFlowErr.message });
        }
      }

      // Use centralized flow type detection (fixes registration→attendance misrouting)
      const { detectFlowType } = require('./shared/utils/flow-type-detector');
      const flowType = detectFlowType(responseJson);

      logToFile('📋 Processing flow submission', {
        from,
        flowName,
        flowType,
        responseFields: Object.keys(responseJson)
      });

      const FlowResponseHandler = require('./shared/handlers/flow-response.handler');

      if (flowType === 'reading_assessment') {
        // Reading Assessment Flow
        logToFile('📖 Detected reading assessment flow submission', {
          from,
          responseFields: Object.keys(responseJson)
        });

        try {
          const success = await FlowResponseHandler.handleReadingAssessmentFlow(message, from, user.id);

          if (!success) {
            logToFile('❌ Reading assessment flow processing failed', { from, responseJson });
          } else {
            logToFile('✅ Reading assessment flow processed successfully', { from });
          }
        } catch (flowError) {
          logToFile('❌ Exception in reading assessment flow handler', {
            from,
            error: flowError.message,
            stack: flowError.stack,
            responseJson
          });
        }
      } else if (flowType === 'registration') {
        // Registration Flow
        logToFile('📝 Detected registration flow submission', {
          from,
          responseFields: Object.keys(responseJson)
        });

        try {
          const success = await FlowResponseHandler.handleRegistrationFlow(message, from, user?.id);

          if (!success) {
            logToFile('❌ Registration flow processing failed', { from, responseJson });
            await WhatsAppService.sendMessage(from, 'Sorry, something went wrong with your registration. Please try /register to try again.');
          } else {
            logToFile('✅ Registration flow processed successfully', { from });
          }
        } catch (flowError) {
          logToFile('❌ Exception in registration flow handler', {
            from,
            error: flowError.message,
            stack: flowError.stack
          });
          await WhatsAppService.sendMessage(from, 'Sorry, something went wrong with your registration. Please try /register to try again.');
        }
      } else if (flowType === 'attendance_setup') {
        // Attendance Setup — endpoint flow's terminal ack. The endpoint at
        // /api/flows/attendance-setup already parsed the roster, created the
        // class, and rendered the confirmation in its own SUCCESS screen.
        // Nothing to do here except log completion.
        //
        // bd-2714: this used to call FlowResponseHandler.handleAttendanceSetupFlow,
        // which the 2026-08-10 teardown (696fbd9) deleted while leaving the call
        // behind — so every completion threw `is not a function` into a catch whose
        // user-visible error was suppressed on 2026-07-13. Silent, and live on main.
        logToFile('📋 Attendance setup flow completion (class already created by endpoint)', {
          from,
          responseFields: Object.keys(responseJson)
        });
      } else if (flowType === 'attendance_marking') {
        // Attendance Marking — endpoint flow's terminal ack. The endpoint at
        // /api/flows/attendance-marking already wrote the register through
        // attendance-write.service (one write path for both actors) and rendered
        // the tallies in its own SAVED screen. Nothing to do here except log.
        //
        // bd-2714: this used to call FlowResponseHandler.handleAttendanceMarkingFlow,
        // deleted by the 2026-08-10 teardown (696fbd9) with the call left behind.
        // Observed on staging 2026-08-14 08:01:40Z: the write succeeded ("Teacher
        // attendance saved", 3 present) and then the completion threw
        // `handleAttendanceMarkingFlow is not a function` — swallowed, so the
        // principal got no acknowledgement at all. Live on main too.
        //
        // This branch is also the seam a future register -> /staff hand-off travels
        // through, so it needs to stay reachable.
        logToFile('📋 Attendance marking flow completion (register already written by endpoint)', {
          from,
          responseFields: Object.keys(responseJson)
        });
      } else if (flowType === 'roster') {
        // The Flow already showed the saved count on its own terminal screen; this
        // is the chat breadcrumb so the coach can see it later in the thread.
        const cls = responseJson.roster_class || 'That class';
        const n = responseJson.roster_count;
        await WhatsAppService.sendMessage(
          from,
          n
            ? `📋 ${cls} saved — ${n} students on the roster. Send /roster again for the next class.`
            : `📋 ${cls} saved. Send /roster again for the next class.`
        );
      } else if (flowType === 'remark') {
        // Supervisor Remark (bd-2712). The endpoint already did every write
        // before the Flow closed, so this branch ONLY acknowledges — it must not
        // re-persist anything. Without it the principal lands on the catch-all
        // "Thanks for your response! Type /menu…", which reads as the evaluation
        // having gone nowhere (whatsapp-flows rules 10 + 11).
        logToFile('📝 Detected supervisor remark flow submission', {
          from, responseFields: Object.keys(responseJson),
        });
        try {
          const { resolveUx } = require('./shared/config/ux-strings');
          const left = Number(responseJson.remark_left || 0);
          const teacher = responseJson.remark_teacher || '';

          // ONE message, not two. The confirmation and the next-step prompt are
          // the same beat, and an earlier version sent the ack ("…Send /remark
          // again for the next teacher.") AND a button underneath — telling her
          // the same thing twice, once in prose she must retype and once as a tap.
          //
          // The button is single, not a yes/no pair: finishing is the common case
          // and must not cost a tap, so "no" is simply not answering. Any other
          // reply falls through to normal chat, which is why there is no state to
          // clear either.
          if (left > 0) {
            await WhatsAppService.sendInteractiveButtons(from, {
              body: resolveUx('remarkAckSubmitted', {
                user,
                params: { teacher, left: resolveUx('remarkAnotherPrompt', { user }) },
              }),
              buttons: [{ id: 'remark_next', title: resolveUx('remarkAnotherButton', { user }) }],
            });
          } else {
            await WhatsAppService.sendMessage(from, resolveUx('remarkAckSubmitted', {
              user,
              params: { teacher, left: resolveUx('remarkAckAllDone', { user }) },
            }));
          }
        } catch (ackError) {
          logError('❌ Exception acking supervisor remark', {
            from, error: ackError.message, stack: ackError.stack,
          });
        }
      } else if (flowType === 'teacher_training') {
        // Teacher Training Flow — hand off to FlowResponseHandler which routes
        // by training_action to content delivery or grand quiz start.
        logToFile('🎓 Detected teacher training flow submission', {
          from,
          responseFields: Object.keys(responseJson)
        });
        try {
          await FlowResponseHandler.handleTeacherTrainingFlow(message, from, user.id);
        } catch (flowError) {
          logToFile('❌ Exception in teacher training flow handler', {
            from, error: flowError.message, stack: flowError.stack
          });
          await WhatsAppService.sendMessage(from, 'Sorry, something went wrong loading your training content. Please try /training again.');
        }
      } else if (flowType === 'training_msq') {
        // Training multi-answer question — the CheckboxGroup Flow's completion
        // payload IS the answer. Unlike the other endpoint flows nothing was
        // persisted during the exchange (the screen completes rather than
        // round-tripping), so this branch owns the write: grade the set,
        // advance the attempt, send the next question.
        logToFile('🎓 Detected multi-answer training question submission', {
          from,
          responseFields: Object.keys(responseJson)
        });
        try {
          const QuizDelivery = require('./shared/services/training/quiz-delivery.service');
          // message.id is the wamid of the teacher's own Flow submission, so the
          // ✅/❌ verdict reaction lands on her message exactly as it does on the
          // interactive-list surface (bd-2525 / bd-43496).
          const recorded = await QuizDelivery.handleQuizFlowSubmission(user.id, responseJson, from, message.id);
          if (!recorded) {
            logToFile('⚠️ Multi-answer submission was not recorded', { from });
          }
        } catch (msqError) {
          logToFile('❌ Exception handling multi-answer training submission', {
            from, error: msqError.message, stack: msqError.stack
          });
          await WhatsAppService.sendMessage(from, 'Sorry, something went wrong saving your answer. Please send /training to continue.');
        }
      } else if (flowType === 'observe') {
        // FEAT-102: the editable FICO observation form was submitted. The
        // endpoint already applied the observer's v2 edits; ack + offer the
        // debrief (Now / Later). Failure here never un-persists the submission.
        try {
          const { observeStrings } = require('./shared/services/observe/observe-strings');
          const ObserveDebrief = require('./shared/services/observe/observe-debrief.service');
          const tokenParts = (responseJson.flow_token || '').split(':');
          const observerId = tokenParts[0];
          const observeSessionId = tokenParts[1];
          const { data: obsRow } = await supabase
            .from('users').select('preferred_language').eq('id', observerId).maybeSingle();
          const obsLang = clampLanguage(obsRow?.preferred_language);
          const S = observeStrings(obsLang);
          await WhatsAppService.sendMessage(from, S.submitted_ack);
          if (observerId) await ObserveDebrief.clearStateAfterSubmit(observerId, observeSessionId);
          if (observeSessionId) {
            await WhatsAppService.sendInteractiveButtons(
              from, ObserveDebrief.buildDebriefChoiceButtons(observeSessionId, S));
          }
          logToFile('🔭 Observe FICO submission acknowledged', { from, sessionId: observeSessionId });
        } catch (observeAckErr) {
          logToFile('⚠️ observe ack failed (submission itself already persisted)', { error: observeAckErr.message });
        }
      } else if (flowType === 'observe_visit') {
        // bd-2432 (port of main-bot FEAT-116 bd-2301): the visit picker's
        // "Start observation" completion — bind the picked teacher and send
        // the record prompt. Without this branch the completion falls to the
        // generic "/menu" fallback below (the exact upstream bd-2294 failure).
        logToFile('🔭 Detected observe-visit flow submission', { from, responseFields: Object.keys(responseJson) });
        try {
          await FlowResponseHandler.handleObserveVisitFlow(message, from, user?.id);
        } catch (visitErr) {
          logToFile('❌ observe-visit completion handler failed', { from, error: visitErr.message });
        }
      } else if (flowType === 'status') {
        // /status. The endpoint did every write before the Flow closed,
        // so this branch ONLY acknowledges. Without it the completion landed on the
        // catch-all below and answered "Thanks for your response! Type /menu…" —
        // so a teacher who had just stopped a task was told nothing about it, and
        // every /status use logged a spurious unknown-flow warning.
        logToFile('📋 Detected status flow submission', {
          from, responseFields: Object.keys(responseJson),
        });
        try {
          await FlowResponseHandler.handleStatusFlowCompletion(responseJson, from, user);
        } catch (statusAckErr) {
          logToFile('❌ status completion handler failed', { from, error: statusAckErr.message }, 'error');
        }
      } else {
        // Unknown flow type
        logToFile('⚠️ Received unknown flow submission', {
          from,
          flowType,
          responseFields: Object.keys(responseJson)
        });

        await WhatsAppService.sendMessage(
          from,
          "Thanks for your response! Type /menu to see what I can help you with."
        );
      }
    } else if (messageType === 'interactive' && message.interactive?.type === 'list_reply') {
      // Handle interactive list responses (Reading Assessment, Teacher Training quiz, ...)
      const listReply = message.interactive.list_reply;
      const listId = listReply.id;
      logToFile('📋 Interactive list item selected', { listId, from });

      // bd-2482 (NIETE port of PK bd-2309): video-quiz answers arrive as
      // list_reply whenever the question has 4 options or a title too long
      // for a 20-char button. Same `vq_` ids as the button path — routed
      // here too, or a four-option question would accept no answer at all.
      if (listId.startsWith('att_class_') || listId.startsWith('att_method_')
          || listId.startsWith('att_voice_')) {
        if (user?.id && await handleAttendanceTap(listId, from, user)) return;
      }

      if (listId.startsWith('vq_')) {
        const VideoQuizService = require('./shared/services/quiz/video-quiz.service');
        if (await VideoQuizService.handleAnswer(from, listId)) return;
      }

      // Teacher-training grand quiz answers — handle before Reading Assessment routing.
      if (listId && listId.startsWith('training_quiz_')) {
        const QuizDelivery = require('./shared/services/training/quiz-delivery.service');
        // bd-2525: the LIST path is the one teachers actually take — quiz
        // options are delivered as an interactive list — so the wamid matters
        // most here. Same reaction as the button path above.
        await QuizDelivery.handleQuizButton(user.id, listId, from, message.id);
        return;
      }

      // bd-wa5io — LP-selection menu taps (lp_select_/lp_upload_/lp_none_). The
      // menu became a LIST when LP fidelity shipped, but these ids had no
      // list_reply routing: the linker was never called and the session hung at
      // awaiting_lesson_plan. Handle BEFORE the Reading-Assessment session logic.
      if (/^lp_(select|upload|none)_/.test(listId)) {
        const { handleLpListSelection } = require('./shared/services/coaching/lp-coaching/lp-list-selection.handler');
        if (await handleLpListSelection(listId, from)) return;
      }

      // CRITICAL: Get the CURRENT session first, then query conversations in THAT session
      const { getOrCreateSession } = require('./shared/database/bot-helpers');
      const currentSessionId = await getOrCreateSession(user.id);

      logToFile('📋 Current session retrieved', { currentSessionId });

      // the SAME reader the text and voice handlers use.
      //
      // This was a third, subtly different read of `conversations.current_state`.
      // Unlike the other two it filtered `.not('current_state','is',null)`, so it
      // could actually find a value — but it also filtered by `session_id`, and
      // chat_sessions rotate after 30 minutes idle. A teacher who opened the reading
      // test, got pulled away for half an hour and came back to tap her language
      // landed in a NEW session, so her own state was invisible and the tap was
      // refused. State is now keyed on the teacher, so a break cannot orphan it.
      const activeState = await ConversationState.getState(user.id);
      const sessionId = activeState?.payload?.sessionId || currentSessionId;
      const currentState = activeState?.step || null;

      logToFile('📋 Interactive list - session state check', {
        listId,
        currentSessionId,
        stateFound: Boolean(activeState),
        flow: activeState?.flow || null,
        sessionId,
        currentState,
      });

      // Reading Assessment language selection
      if (listId.startsWith('reading_lang_')) {
        const language = listId.replace('reading_lang_', ''); // 'en' or 'ur'

        if (currentState !== 'AWAITING_READING_LANGUAGE') {
          logToFile('⚠️ Invalid state for language selection', {
            currentState: currentState || 'null/undefined',
            expectedState: 'AWAITING_READING_LANGUAGE',
            sessionDataFound: !!sessionData,
            userId: user?.id
          });
          await WhatsAppService.sendMessage(
            from,
            'Sorry, this selection is no longer valid. Please start a new reading test with /reading test'
          );
          return;
        }

        try {
          await ReadingAssessmentService.handleLanguageSelection(
            user.id,
            sessionId,
            from,
            language,
            user.preferred_language || 'en'
          );
          logToFile('✅ Language selection processed', { userId: user.id, language });
        } catch (error) {
          logToFile('❌ Error processing language selection', {
            userId: user.id,
            error: error.message,
            stack: error.stack
          });
          await WhatsAppService.sendMessage(
            from,
            'Sorry, there was an error processing your selection. Please try again with /reading test'
          );
        }
      }
      // Reading Assessment grade level selection
      else if (listId.startsWith('reading_grade_')) {
        const gradeLevel = parseInt(listId.replace('reading_grade_', '')); // 0-4

        if (currentState !== 'AWAITING_READING_GRADE') {
          logToFile('⚠️ Invalid state for grade selection', { currentState, expectedState: 'AWAITING_READING_GRADE' });
          await WhatsAppService.sendMessage(
            from,
            'Sorry, this selection is no longer valid. Please start a new reading test with /reading test'
          );
          return;
        }

        try {
          await ReadingAssessmentService.handleGradeSelection(
            user.id,
            sessionId,
            from,
            gradeLevel,
            user.preferred_language || 'en'
          );
          logToFile('✅ Grade selection processed', { userId: user.id, gradeLevel });
        } catch (error) {
          logToFile('❌ Error processing grade selection', {
            userId: user.id,
            error: error.message,
            stack: error.stack
          });
          await WhatsAppService.sendMessage(
            from,
            'Sorry, there was an error processing your selection. Please try again with /reading test'
          );
        }
      }
      // Language preference selection (from /language command)
      else if (listId.startsWith('lang_')) {
        const languageCode = listId.replace('lang_', ''); // 'ur' or 'en'

        logToFile('🌐 Language preference selection', { listId, languageCode, userId: user?.id });

        try {
          // There is deliberately no 'auto' branch any more. "Auto-detect" was a
          // user-facing switch that UNLOCKED the preference, which is the one
          // thing protecting a teacher's choice from being overwritten by the
          // language of a classroom recording. In a two-language market with a
          // working picker its upside was saving a tap; its downside was the
          // wrong-language class this workstream exists to remove.
          //
          // An unknown code cannot reach here from our own list, but a stale
          // client could replay an old row id — so the writer validates against
          // the offer and returns false rather than storing it.
          const success = await setUserLanguage(user.id, languageCode, true);

          if (!success) {
            logToFile('❌ Failed to update language preference', { userId: user.id, languageCode });
            await WhatsAppService.sendMessage(from, 'Sorry, there was an error updating your language preference. Please try again.');
            return;
          }

          // Confirm in the language she just chose — the first message after a
          // switch contradicting the switch is its own bug.
          const confirmMessages = {
            'ur': '✅ زبان اردو میں تبدیل ہو گئی۔ اب میں اردو میں جواب دوں گی۔',
            'en': '✅ Language set to English. I will now respond in English.',
          };

          const confirmMessage = confirmMessages[languageCode] || confirmMessages.en;
          await WhatsAppService.sendMessage(from, confirmMessage);
          logToFile('✅ Language preference updated', { userId: user.id, languageCode, locked: true });
        } catch (error) {
          logToFile('❌ Error processing language selection', {
            userId: user?.id,
            languageCode,
            error: error.message,
            stack: error.stack
          });
          await WhatsAppService.sendMessage(from, 'Sorry, there was an error processing your selection. Please try again with /language');
        }
      }
      // Issue #35: Video style selection via list fallback (when carousel template fails)
      else if (listId.startsWith('style_')) {
        logToFile('🎨 Video style list selection detected (fallback)', { listId, userId: user?.id });

        if (user) {
          const VideoOrchestrator = require('./shared/services/video/video-orchestrator.service');
          const { parseStyleFromButtonId } = require('./shared/handlers/text-message.handler');

          // Parse style from list ID (style_photorealistic → photorealistic)
          const selectedStyle = parseStyleFromButtonId(listId);

          // Check if user was awaiting style selection
          const styleState = await VideoOrchestrator.checkAwaitingStyle(user.id);

          if (styleState) {
            logToFile('✅ Processing video style selection (list fallback)', {
              userId: user.id,
              selectedStyle,
              topic: styleState.topic
            });

            await VideoOrchestrator.handleStyleSelection(
              user,
              from,
              selectedStyle,
              styleState.sessionId,
              styleState.topic,
              styleState.language,
              styleState.customization
            );
          } else {
            // No awaiting state - might be stale selection
            logToFile('⚠️ Style list selection but no awaiting state', { listId, userId: user.id });
            await WhatsAppService.sendMessage(from,
              "That style selection has expired. Please use /video to start a new video request."
            );
          }
        } else {
          logToFile('⚠️ No user found for style list selection', { listId, from });
        }
      }
      // Feature menu selection via list fallback (when carousel template fails)
      else if (listId.startsWith('menu_')) {
        logToFile('📋 Menu list selection detected (fallback)', { listId, userId: user?.id });

        if (user) {
          const MenuService = require('./shared/services/menu.service');

          logToFile('✅ Processing menu selection (list fallback)', {
            userId: user.id,
            listId
          });

          await MenuService.handleMenuButtonResponse(
            user,
            from,
            listId,
            user.language || 'en'
          );
        } else {
          logToFile('⚠️ No user found for menu list selection', { listId, from });
        }
      }
      // Video language selection (Issue #8 fix - handler was missing)
      else if (['en', 'ur', 'ar', 'es', 'bal-PK', 'sd-PK', 'ps-PK', 'pa-PK', 'ta-LK'].includes(listId)) {
        logToFile('🎬 Video language selection detected', { listId, userId: user?.id });

        try {
          const VideoOrchestrator = require('./shared/services/video/video-orchestrator.service');
          const languageState = await VideoOrchestrator.checkAwaitingLanguage(user.id);

          if (languageState) {
            await VideoOrchestrator.handleLanguageSelection(
              user,
              from,
              listId,
              languageState.sessionId,
              languageState.topic
            );
            logToFile('✅ Video language selection processed', { userId: user.id, language: listId });
          } else {
            // No video language state - might be stale selection
            logToFile('⚠️ Video language selection but no awaiting state', { listId, userId: user?.id });
          }
        } catch (error) {
          logToFile('❌ Error processing video language selection', {
            userId: user?.id,
            language: listId,
            error: error.message,
            stack: error.stack
          });
          await WhatsAppService.sendMessage(from, 'Sorry, there was an error processing your language selection. Please try /video again.');
        }
      }
      // FEAT-102 bd-2215 — the /observe interactive-list rows. Ported from the
      // main bot; NIETE had the button handlers but NOT these list branches, so
      // every row in the pending list dead-ended at "Unknown list item ID".
      // Riffat hit it (2026-07-20): after finishing one observation, tapping
      // "🎙 New observation" did nothing, so a second observation was impossible.
      //
      // Manage-list rows (observe_tmg_<idx>).
      else if (listId.startsWith('observe_tmg_')) {
        const ObserveSend = require('./shared/services/observe/observe-send.service');
        if (user) await ObserveSend.handleTeacherManage(user, from, listId);
        else logToFile('⚠️ observe teacher-manage tap without user', { listId });
      }
      // bd-2668 "who did you observe?" rows (observe_who_<sessionId>_<idx|other>),
      // sent after an unbound capture. Distinct prefix, so ordering among the
      // other observe_ branches does not matter — kept here beside its siblings.
      else if (listId.startsWith('observe_who_')) {
        const ObserveWho = require('./shared/services/observe/observe-who.service');
        if (user) await ObserveWho.handleObservedTeacherPick(user, from, listId);
        else logToFile('⚠️ observe who-pick tap without user', { listId });
      }
      // Teacher-pick rows (observe_pickt_<idx> | observe_pickt_new).
      // MUST stay ahead of observe_send_ — both are observe list prefixes.
      else if (listId.startsWith('observe_pickt_')) {
        const ObserveSend = require('./shared/services/observe/observe-send.service');
        if (user) await ObserveSend.handleTeacherPick(user, from, listId);
        else logToFile('⚠️ observe teacher-pick tap without user', { listId });
      }
      // bd-tju8f — stage-A resume rows + the binding-prompt rows.
      else if (listId.startsWith('observe_resume_')) {
        const ObserveResume = require('./shared/services/observe/observe-resume.service');
        if (user) await ObserveResume.resume(listId.replace('observe_resume_', ''), from, user);
        else logToFile('⚠️ observe resume tap without user', { listId });
      }
      else if (listId.startsWith('observe_bind_')) {
        const ObserveBinding = require('./shared/services/observe/observe-binding.service');
        if (user) await ObserveBinding.handleBindingTap(listId, from, user);
        else logToFile('⚠️ observe bind tap without user', { listId });
      }
      // Unsent-report rows (observe_send_<sessionId>).
      else if (listId.startsWith('observe_send_')) {
        const ObserveSend = require('./shared/services/observe/observe-send.service');
        if (user) await ObserveSend.startSendFlow(listId.replace('observe_send_', ''), from, user);
        else logToFile('⚠️ observe send list tap without user', { listId });
      }
      // Pending-debrief rows (observe_debrief_<sessionId>) + the
      // "new observation" sentinel (observe_new).
      else if (listId.startsWith('observe_debrief_') || listId === 'observe_new') {
        const ObserveDebrief = require('./shared/services/observe/observe-debrief.service');
        const parsed = ObserveDebrief.parseDebriefListReplyId(listId);
        logToFile('🔭 Observe debrief-list row tapped', { listId, from });
        if (parsed && user) {
          if (parsed.action === 'debrief') {
            // bd-tju8f: a parked debrief recording (the binding sheet's "this is
            // a debrief" row) is consumed by THIS pick — she never re-sends it.
            const ObserveBinding = require('./shared/services/observe/observe-binding.service');
            const consumedParked = await ObserveBinding.consumeParkedDebrief(user, from, parsed.sessionId);
            if (!consumedParked) await ObserveDebrief.startDebrief(parsed.sessionId, from, user);
          } else {
            // "new observation" — same arm as /observe's capture path.
            // bd-2432 (upstream bd-2330): an assigned coach reaches the
            // school→teacher→brief picker from THIS tap too — the pending-
            // debrief list preempts /observe, so without this route a coach
            // with a pending debrief could never reach the picker.
            const { maybeLaunchVisitFlow } = require('./shared/handlers/observe-command.handler');
            if (!(await maybeLaunchVisitFlow(user, from))) {
              // observeLang (NOT the main bot's sw/en test) — NIETE serves ur/en,
              // and Riffat's list rendered in Urdu, so the sw test would have
              // replied in English to an Urdu user.
              const { observeStrings, observeLang } = require('./shared/services/observe/observe-strings');
              const ObserveState = require('./shared/services/observe/observe-state.service');
              const { getObserveArm } = require('./shared/services/observe/observe-gate');
              await WhatsAppService.sendMessage(from, observeStrings(observeLang(user)).capture_prompt);
              await ObserveState.setState(user.id, 'awaiting_audio', { arm: getObserveArm(user) });
            }
          }
        } else {
          logToFile('⚠️ observe debrief list tap without user/parse', { listId, hasUser: !!user });
        }
      }
      else {
        logToFile('⚠️ Unknown list item ID', { listId });
      }
    } else {
      // bd-fbih0: reactions/stickers get NO reply (reacting 👍 used to trigger
      // the error text); video gets an explanatory line naming the supported
      // inputs (a coach mid-photo-capture read the old generic reply as the
      // bot breaking). Everything else keeps the historical fallback.
      const { unsupportedTypeReply } = require('./shared/utils/unsupported-message');
      // The interactive SUB-type matters: WhatsApp posts `call_permission_reply`
      // around a voice call, and answering it told the teacher "I can only reply
      // to text and voice" the moment she hung up (bd-1hae7).
      const interactiveSubType = message.interactive?.type;
      const reply = unsupportedTypeReply(messageType, interactiveSubType);
      logToFile(`⚠️ Unsupported message type: ${messageType}`, {
        replied: !!reply, interactiveType: interactiveSubType,
      });
      if (reply) await WhatsAppService.sendMessage(from, reply);
    }

    // Always respond with 200 OK to acknowledge receipt
    res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    logToFile('❌ Error processing webhook', {
      error: error.message,
      stack: error.stack
    });
    res.status(200).send('EVENT_RECEIVED'); // Still send 200 to avoid retries
  }
  }); // End of runWithCorrelation
});

/**
 * Handle document messages (classroom audio or lesson plan uploads for coaching)
 * @param {Object} message - WhatsApp message object
 * @param {string} from - Sender phone number
 * @param {Object|null} user - User object from database
 * @returns {Promise<void>}
 */
async function handleDocumentMessage(message, from, user) {
  logToFile('📄 Document received', { from, documentId: message.document.id });

  // Check if user exists
  if (!user) {
    await WhatsAppService.sendMessage(from, "Please complete registration first.");
    return;
  }

  try {
    const documentId = message.document.id;
    const mimeType = message.document.mime_type || '';
    const fileSize = message.document.file_size || 0;

    logToFile('Document details', { documentId, mimeType, filename: message.document.filename, fileSize });

    // bd-3ipd2: a classroom photo sent AS A DOCUMENT (Android "Document" picker /
    // full-resolution send) lands here, not in the image handler. Historically it
    // was dropped — the document handler only ever recognised AUDIO. If the teacher
    // is on the photo step, capture it exactly like an image-message photo.
    try {
      const { isImageMime, shouldCaptureDocumentAsClassroomPhoto, CLASSROOM_PHOTO_STATUSES } = require('./shared/services/coaching/photo-capture-routing');
      if (isImageMime(mimeType)) {
        const supabase = require('./shared/config/supabase');
        // bd-9hzdn.2: match observer_user_id too — a coach's photo-as-document
        // must attach to her leader-observation session (owned by the teacher).
        const { data: photoSession } = await supabase
          .from('coaching_sessions')
          .select('id, status, conversation_state, classroom_photos')
          .or(`user_id.eq.${user.id},observer_user_id.eq.${user.id}`)
          .in('status', CLASSROOM_PHOTO_STATUSES)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (shouldCaptureDocumentAsClassroomPhoto(photoSession, mimeType)) {
          const imageBuffer = await WhatsAppService.downloadMedia(documentId);
          const { capturePhotoAndPrompt } = require('./shared/services/coaching/classroom-photo/capture.service');
          await capturePhotoAndPrompt({ session: photoSession, imageBuffer, mimeType, from, user });
          return;
        }
      }
    } catch (photoDocErr) {
      logToFile('⚠️ Classroom-photo-as-document check failed (non-critical)', { error: photoDocErr.message });
      // fall through to normal document handling
    }

    // CLASSROOM COACHING DETECTION: Check if document is an audio file.
    // Rifat's ask (Coach Platform card): teachers can now upload classroom
    // recordings as WhatsApp documents (up to 100MB Meta limit) instead of
    // voice messages (16MB Meta limit). Below we (a) detect audio MIME,
    // (b) reject > 25MB before download (Whisper cap), (c) fall through to
    // the existing ffprobe + duration-based routing for anything smaller.
    const {
      classifyAudioDocument,
      buildTooLargeMessage,
    } = require('./shared/handlers/audio-document-router');
    const audioClassification = classifyAudioDocument({ mimeType, fileSize, filename: message.document.filename });

    if (audioClassification.decision === 'reject_too_large') {
      logToFile('🚫 Audio document exceeds Whisper 25MB cap — rejecting before download', {
        documentId,
        mimeType,
        fileSizeMB: audioClassification.sizeMB
      });
      await WhatsAppService.sendMessage(from, buildTooLargeMessage(audioClassification.sizeMB));
      return;
    }

    if (audioClassification.decision === 'route_to_audio_pipeline') {
      logToFile('🎵 Audio document detected, checking duration...', {
        fileSizeMB: audioClassification.sizeMB
      });

      try {
        // Download audio to check duration with ffprobe
        // WhatsApp API doesn't provide duration for documents, only for voice messages
        logToFile('Downloading audio document to check duration...');
        const audioBuffer = await WhatsAppService.downloadMedia(documentId);
        logToFile('Audio downloaded', { bufferSize: audioBuffer.length });

        // Get duration using ffprobe
        const AudioService = require('./shared/services/audio.service');
        const audioDuration = await AudioService.getAudioDuration(audioBuffer);
        const audioDurationRounded = Math.round(audioDuration); // Round to integer for database

        logToFile('Audio duration extracted via ffprobe', {
          duration: audioDuration,
          durationRounded: audioDurationRounded,
          durationMinutes: Math.round(audioDuration / 60),
          mimeType
        });

        // Check if audio is 15+ minutes (900 seconds) = classroom audio
        const CLASSROOM_AUDIO_THRESHOLD = 900; // 15 minutes in seconds

        if (audioDurationRounded >= CLASSROOM_AUDIO_THRESHOLD) {
          logToFile('🎓 CLASSROOM AUDIO DETECTED (15+ minutes)', {
            duration: audioDuration,
            durationMinutes: Math.round(audioDuration / 60)
          });

          // Create session for this user (needed for coaching flow)
          const { getOrCreateSession } = require('./shared/database/bot-helpers');
          const sessionId = await getOrCreateSession(user.id);

          logToFile('✅ Session created for classroom coaching', { sessionId });

          // FEAT-102 bd-29: a school leader's classroom recording arrives HERE
          // (phone recorders share a 40-min lesson as a FILE). Route it to the
          // /observe HITL flow, NEVER into teacher coaching. Dark-safe: inert
          // unless OBSERVE_MEWAKA_FLOW_ID is set (see observe-audio-router).
          {
            const { routeLeaderAudio } = require('./shared/services/observe/observe-audio-router');
            const observeHandled = await routeLeaderAudio({
              user, from, audioId: documentId, sessionId, isLongAudio: true,
            });
            if (observeHandled) return;
          }

          // Route to classroom coaching flow
          await CoachingService.initiateCoachingSession(
            user.id,
            sessionId,
            documentId,
            from,
            audioDurationRounded
          );

          return; // Exit early - coaching flow will handle everything
        }

        // Route short audio documents to voice handler for transcription
        // Instead of showing confusing "send classroom audio first" message
        // bd-tju8f: a LEADER's audio document is never "just a short audio" —
        // hand the router the resolved duration and let the wall decide (an
        // armed debrief consumes it; unbound classroom-length goes to binding).
        if (user) {
          const { isSchoolLeader } = require('./shared/services/observe/observe-gate');
          if (isSchoolLeader(user)) {
            const { routeLeaderAudio } = require('./shared/services/observe/observe-audio-router');
            const shortDocHandled = await routeLeaderAudio({
              user, from, audioId: documentId, sessionId: null,
              durationSeconds: audioDurationRounded || null,
            });
            if (shortDocHandled) return;
          }
        }
        logToFile('🎤 Audio document < 15 min, routing to voice handler for transcription', {
          duration: audioDuration,
          durationMinutes: Math.round(audioDuration / 60),
          documentId,
          mimeType
        });

        // Construct a message object that voice handler expects
        // Voice handler looks for message.audio?.id || message.voice?.id
        const voiceMessage = {
          audio: { id: documentId },
          // Include original message properties for compatibility
          from: from,
          type: 'audio'
        };

        // Route to voice message handler
        await handleVoiceMessage(voiceMessage, from, user);

        return; // Exit early - voice handler will process the audio
      } catch (durationError) {
        // enrich the log so the NEXT long-audio failure is fully
        // diagnosable (Maria's 29:40 recording died here with no userId/mediaId
        // logged, so the root could not be pinned; the truncation theory was
        // disproven — no session row was ever created).
        logToFile('⚠️ Could not get audio duration, treating as regular document', {
          error: durationError.message,
          stack: durationError.stack,
          userId: user && user.id,
          from,
          documentId,
          mimeType,
          fileSizeMB: audioClassification.sizeMB,
        });
        // INVARIANT: a school leader's long recording must NEVER fall
        // through to the misleading "send a classroom audio first" reply. If the
        // duration probe fails we cannot classify it as long, but a leader who
        // sent an audio DOCUMENT almost certainly sent a classroom recording —
        // route to /observe (dark-safe: inert unless OBSERVE is on). This upholds
        // observe-audio-router's stated invariant even on a probe failure.
        try {
          const { isSchoolLeader } = require('./shared/services/observe/observe-gate');
          if (isSchoolLeader(user)) {
            const { routeLeaderAudio } = require('./shared/services/observe/observe-audio-router');
            const observeHandled = await routeLeaderAudio({
              user, from, audioId: documentId, sessionId: null, isLongAudio: true,
            });
            if (observeHandled) return;
          }
        } catch (routeErr) {
          logToFile('⚠️ observe fallback on duration-probe failure errored', {
            userId: user && user.id, error: routeErr.message,
          });
        }
        // Continue with regular document flow if duration check fails
      }
    }

    // LESSON PLAN DOCUMENT: Check if there's an active coaching session awaiting lesson plan.
    // bd-9hzdn.2: match observer_user_id too — in the /observe flow the COACH uploads
    // the teacher's lesson plan; the session row is owned by the observed teacher.
    const { data: coachingSession } = await supabase
      .from('coaching_sessions')
      .select('*')
      .or(`user_id.eq.${user.id},observer_user_id.eq.${user.id}`)
      .eq('status', 'awaiting_lesson_plan')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (coachingSession) {
      // Document is lesson plan for active coaching session
      await CoachingService.handleLessonPlanResponse(
        coachingSession.id,
        from,
        true,
        documentId
      );
    } else {
      // No active coaching session - regular document
      await WhatsAppService.sendMessage(from,
        "I received your document. If you're trying to submit a lesson plan for classroom coaching, " +
        "please send me a classroom audio recording first (15+ minutes)."
      );
    }
  } catch (error) {
    // include userId + stack + documentId so a dropped recording is
    // attributable (Maria's 29:40 recording left NO diagnosable trail because
    // this catch logged only {error, from}).
    logToFile('❌ Error handling document', {
      error: error.message,
      stack: error.stack,
      userId: user && user.id,
      documentId: message && message.document && message.document.id,
      from
    });
    await WhatsAppService.sendMessage(from, "Sorry, I encountered an error processing your document.");
  }
}

/**
 * Health check endpoint
 */
app.get('/', (req, res) => {
  res.send('WhatsApp AI Bot is running!');
});

/**
 * Clear conversation history endpoint
 */
app.post('/clear-history/:userId', (req, res) => {
  const userId = req.params.userId;
  OpenAIService.clearHistory(userId);
  res.send(`Conversation history cleared for user ${userId}`);
});

/**
 * Get session statistics endpoint (for debugging)
 */
app.get('/stats', (req, res) => {
  const stats = SessionService.getStats();
  res.json(stats);
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  const path = require('path');
  const versionFile = path.join(__dirname, 'VERSION');
  let version = require('./package.json').version; // single source: package.json, overridden by VERSION file below

  try {
    if (fs.existsSync(versionFile)) {
      version = fs.readFileSync(versionFile, 'utf8').trim();
    }
  } catch (err) {
    console.error('Error reading VERSION file:', err);
  }

  res.json({
    status: 'healthy',
    service: 'Rumi WhatsApp Bot',
    version: version,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

/**
 * Internal API: Send password reset code via WhatsApp
 * Called by portal backend to send reset codes through the main bot
 *
 * Security: API key authentication required
 */
app.post('/api/internal/send-password-reset', async (req, res) => {
  try {
    // Verify API key (shared secret between portal and main bot)
    const apiKey = req.headers['x-api-key'];
    const expectedApiKey = process.env.INTERNAL_API_KEY;

    if (apiKey !== expectedApiKey) {
      logToFile('❌ Unauthorized internal API call', {
        endpoint: '/api/internal/send-password-reset',
        ip: req.ip
      });
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    const { phoneNumber, code, language } = req.body;

    if (!phoneNumber || !code) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: phoneNumber, code'
      });
    }

    logToFile('📞 Internal API: Sending password reset code', {
      phoneNumber,
      language,
      caller: 'portal-backend'
    });

    // Send via approved AUTHENTICATION template so delivery works
    // regardless of the 24-hour customer-service window. Body/footer are
    // Meta-generated ("*{{1}}* is your verification code." / "This code
    // expires in 10 minutes."); we only supply the code, twice (once as
    // the BODY variable, once as the OTP button payload so the tap-to-copy
    // button copies the same value).
    const templateLang = clampLanguage(language);
    const sent = await WhatsAppService.sendTemplate(
      phoneNumber,
      'portal_password_reset_niete',
      templateLang,
      [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: code }] },
      ]
    );

    if (sent) {
      logToFile('✅ Password reset code sent via WhatsApp', {
        phoneNumber,
        language
      });
      res.json({
        success: true,
        message: 'Password reset code sent successfully'
      });
    } else {
      logToFile('❌ Failed to send password reset code', {
        phoneNumber
      });
      res.status(500).json({
        success: false,
        error: 'Failed to send WhatsApp message'
      });
    }
  } catch (error) {
    logToFile('❌ Internal API error', {
      endpoint: '/api/internal/send-password-reset',
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Start server. Gated behind `require.main === module` so requiring this
 * file as a library (e.g. from a test harness or a downstream that wants the
 * Express `app` without its listener) does NOT bind to a port.
 */
function startServer() {
  return app.listen(constants.PORT, () => {
  // Read version from VERSION file
  const path = require('path');
  const versionFile = path.join(__dirname, 'VERSION');
  let version = require('./package.json').version; // single source: package.json, overridden by VERSION file below

  try {
    if (fs.existsSync(versionFile)) {
      version = fs.readFileSync(versionFile, 'utf8').trim();
    }
  } catch (err) {
    console.error('Error reading VERSION file:', err);
  }

  const startupMessage = `\n${'='.repeat(70)}
🤖 Rumi v${version}
${'='.repeat(70)}

✅ Server running on port ${constants.PORT}
📍 Local URL: http://localhost:${constants.PORT}
🔗 Health Check: http://localhost:${constants.PORT}/health

📝 LOGGING ENABLED
   All webhook activity is logged to: ${LOGS_DIR}
   Log file: bot-${new Date().toISOString().split('T')[0]}.log

${'='.repeat(70)}
📋 NEXT STEP: Start ngrok in a NEW terminal window
${'='.repeat(70)}

   Run this command in a new terminal:

   npx ngrok http ${constants.PORT}${process.env.NGROK_AUTHTOKEN ? ` --authtoken ${process.env.NGROK_AUTHTOKEN}` : ''}
   ${process.env.NGROK_AUTHTOKEN ? '' : '(first time? add your own token from https://dashboard.ngrok.com → set NGROK_AUTHTOKEN in .env)'}

${'='.repeat(70)}

Then copy the ngrok URL and configure it in Meta:
   1. Go to: https://developers.facebook.com/apps/
   2. Navigate to: WhatsApp → Configuration → Webhook
   3. Paste ngrok URL with /webhook (e.g., https://abc.ngrok-free.app/webhook)
   4. Verify Token: ${constants.WEBHOOK_VERIFY_TOKEN}
   5. Subscribe to: messages
   6. Send a test message to your WhatsApp bot number

${'='.repeat(70)}
\n`;

  console.log(startupMessage);
  logToFile('🚀 Bot server started', { port: constants.PORT, logsDir: LOGS_DIR });

  // Non-blocking startup checks (delayed to not slow boot)
  setTimeout(() => {
    try {
      const { validateBootRequirements } = require('./shared/utils/setup-validator');
      const result = validateBootRequirements();
      if (!result.ok) {
        logToFile('Setup validation issues detected', { warnings: result.warnings, errors: result.errors });
      }
    } catch (err) {
      // setup-validator is optional — skip silently if not present
    }

    try {
      const { checkForUpdates } = require('./shared/utils/version-check');
      checkForUpdates(version).catch(() => {});
    } catch (err) {
      // version-check is optional — skip silently if not present
    }
  }, 10000);
  });
}

if (require.main === module) {
  const server = startServer();
  // bd-gc7uc: graceful web drain. On a deploy SIGTERM, stop accepting new
  // connections and let in-flight webhook handlers finish before exit, so a
  // deploy never cuts a request mid-processing (e.g. a coaching audio being
  // enqueued). Railway's healthcheck already routes NEW webhooks to the new
  // container; this protects the old one's in-flight work. Hard-exit fallback so
  // we never hang past Railway's kill window.
  const gracefulWebShutdown = (signal) => {
    logToFile(`🛑 ${signal} received — draining HTTP server`);
    const force = setTimeout(() => { logToFile('⚠️ Web drain timeout — forcing exit'); process.exit(0); }, 25000);
    if (typeof force.unref === 'function') force.unref();
    server.close(() => { logToFile('✅ HTTP server drained, exiting'); process.exit(0); });
  };
  process.on('SIGTERM', () => gracefulWebShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulWebShutdown('SIGINT'));
}

module.exports = { app, startServer };
