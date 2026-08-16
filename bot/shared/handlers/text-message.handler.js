const WhatsAppService = require('../services/whatsapp.service');
const { verifyOutputLanguage } = require('../utils/output-language-check');
const OpenAIService = require('../services/openai.service');
const ContentService = require('../services/content.service');
const LanguageDetectorService = require('../services/language-detector.service');
const FeatureRegistrationService = require('../services/feature-registration.service');
const ContextService = require('../services/context.service'); // Phase 2: Conditional Feature Context
const redisService = require('../services/cache/railway-redis.service');
const redis = redisService.redis; // Get Redis instance
const CoachingService = require('../services/coaching-orchestrator.service');
const ConversationState = require('../services/conversation-state.service');
const MenuService = require('../services/menu.service');
// MediaLibraryService removed - Issue #28: AI Video Generation replaces Media Library
const HelperAgentService = require('../services/helper-agent.service');
const { handlePortalCommand } = require('./portal-command.handler');
const ReadingAssessmentService = require('../services/reading-assessment.service');
const FeatureLinkerService = require('../services/feature-linker.service');
const FeatureIntroService = require('../services/feature-intro.service');
const LessonPlanQueueService = require('../services/lesson-plan-queue.service');
const LpFeedbackService = require('../services/lp-feedback.service');
const handleCurriculumLessonPlan = require('./lesson-plan-v2.handler');
const RegionFeaturesService = require('../services/region-features.service');
const { getUserRegion } = require('../utils/region');
const VideoOrchestrator = require('../services/video/video-orchestrator.service');
const ChildFlowToken = require('../services/quiz/child-flow-token'); // bd-2475 (ported from PK)
// tryChildVideoMenu reads the module-level constant (matches PK's
// pattern); the existing /video block below still keeps its own local
// process.env read (pre-existing NIETE code, untouched by this port).
const { STUDENT_VIDEOS_FLOW_ID } = require('../utils/constants');
const { logToFile } = require('../utils/logger');
const { matchDetail: matchLessonPlanIntent } = require('../utils/lp-intent');
const { TEMP_DIR, LOADING_STICKER_PATH, LOADING_STICKER_MEDIA_ID, OPENAI_API_KEY,
  ATTENDANCE_SETUP_FLOW_ID, ATTENDANCE_MARKING_FLOW_ID, EDIT_CLASS_FLOW_ID,
  CLASS_MANAGER_FLOW_ID } = require('../utils/constants');
const AttendanceRouter = require('../services/attendance-router.service');
const { getClient } = require('../services/llm-client');

const openai = getClient();
// Import REAL language detection utilities for command detection
const { detectLanguageOverride, isMarketLanguage } = require('../utils/language-detector');
const { getUserLanguage, setUserLanguage } = require('../utils/language-cache');
// Import language detection for content generation
const { detectRequestedLanguage, parseSubjectAndGrade } = require('../utils/language-detection');
const path = require('path');
const {
  getOrCreateUser,
  getOrCreateSession,
  updateSessionType,
  storeConversation,
  storeLessonPlan
} = require('../database/bot-helpers');
const supabase = require('../config/supabase');
// The one copy catalog + the one language clamp (see the language-protocol skill).
const { resolveUx } = require('../config/ux-strings');
const { isClassesCommand } = require('../services/classes/class-command');
const fs = require('fs');

// Subject aliases: parseSubjectAndGrade returns coarse buckets like 'math' / 'social_studies',
// but textbook_toc.subject uses the concrete subject slugs. Map on the way in.
const PARSED_SUBJECT_TO_TOC = {
  math: 'maths',
  english: 'english',
  urdu: 'urdu',
  science: 'science',
  social_studies: 'social_studies',
  islamiat: 'islamiat',
};

function normalizeGrade(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Curriculum pre-gen intercept. If the teacher's region enables curriculum LPs
 * (region_features.curriculum_lp_enabled) and the topic maps to a pre-generated
 * chapter LP, serve it and return true. Returns false (no-op) if the region
 * gate is off OR grade/subject cannot be resolved — the caller then falls
 * through to the standard Gamma flow.
 *
 * Grade/subject resolution order:
 *   1. Extracted from the current message via parseSubjectAndGrade
 *      ("grade 1 english time to recall" → {grade:1, subject:'english'})
 *   2. Bridge columns on the users row (`user.grade` / `user.subject`)
 * TODO(Track-01a): replace the user.grade/user.subject bridge with a join
 *   against the `user_classes` table when that lands. See
 *   docs/migration/01a-teacher-class-profile.md.
 */
async function tryCurriculumLessonPlanServe(from, topic, user, language) {
  try {
    const features = await RegionFeaturesService.getRegionFeatures(getUserRegion(user));
    if (!features.curriculum_lp_enabled || !features.curriculum_key) return false;

    const parsed = parseSubjectAndGrade(topic || '');
    const grade =
      normalizeGrade(parsed.grade) ??
      normalizeGrade(user && user.grade);
    const parsedSubject = parsed.subject ? (PARSED_SUBJECT_TO_TOC[parsed.subject] || parsed.subject) : null;
    const subject =
      parsedSubject ||
      ((user && user.subject) ? String(user.subject).toLowerCase() : null);

    if (grade === undefined || !subject) {
      logToFile('Curriculum LP intercept skipped — no grade/subject', { grade, subject, topic });
      return false;
    }

    // Fix C: LP content language follows the MESSAGE, not the user's UI language.
    // A teacher who prefers Urdu UI but asks in English for a math LP should get
    // the English-medium LP (or whatever the corpus has cached). If the caller
    // didn't pass an explicit language, detect it from the message itself.
    let contentLanguage = language;
    if (!contentLanguage) {
      try { contentLanguage = detectRequestedLanguage(topic || '') || 'en'; }
      catch (_) { contentLanguage = 'en'; }
    }

    const result = await handleCurriculumLessonPlan({
      userId: from,
      userDbId: user?.id, // UUID for lesson_plan_requests.user_id (required by ast_queued path)
      topic,
      grade,
      subject,
      curriculum: features.curriculum_key,
      language: contentLanguage,
    });
    // Any of these mean "handled — stop the message flow here, don't fall
    // through to freeform Gamma."
    //   ast_cached      — Taleemabad JSON corpus, PDF was in R2 cache (delivered synchronously)
    //   ast_queued      — Taleemabad JSON corpus, ack sent + background worker
    //                     will deliver the freshly rendered PDF in ~2 min
    //   pre_generated   — legacy Rumi PK Punjab PDF corpus (delivered synchronously)
    //   oxbridge_picker — FEAT-080 grade 6-12 Oxbridge match, picker sent;
    //                     the button reply resolves the pick.
    return !!(result && ['pre_generated', 'ast_cached', 'ast_queued', 'oxbridge_picker'].includes(result.source));
  } catch (e) {
    logToFile('Curriculum LP intercept failed, falling through to Gamma', { error: e.message });
    return false;
  }
}

/**
 * Handle text message processing
 * @param {Object} message - WhatsApp message object
 * @param {string} from - Sender phone number
 * @param {string} messageBody - Message text
 * @param {Object|null} user - User object from database (optional for backwards compatibility)
 * @returns {Promise<void>}
 */

const { evaluateHomeworkTrigger } = require('./homework-trigger');
const {
  parseCertificateCommand,
  deliverCertificateByCode,
} = require('../services/training/certificate-pdf.service');

// bd-2482 (NIETE port of PK bd-1598): the "Select Video" QUICK_REPLY tap on
// the video-library broadcast template. Matches the template button title,
// an explicit `select_video` payload, or the Urdu equivalent — pure /
// side-effect-free so it's unit-testable.
const SELECT_VIDEO_BUTTON_RX = /^(select[_\s]?video|ویڈیو\s*منتخب\s*کریں)$/i;
function isSelectVideoButton({ buttonId, buttonPayload, buttonText } = {}) {
  return [buttonId, buttonPayload, buttonText].some(
    (v) => v && SELECT_VIDEO_BUTTON_RX.test(String(v).trim())
  );
}

// bd-2486 (ported from PK) — the /video command, extended to match a bare
// "video" (no slash). A trimmed message equal to just "video" used to fall
// all the way through to intent detection, which routes intent.type===
// 'video' to the legacy AI VideoOrchestrator with the literal word "Video"
// as a nonsense topic — confirmed via a real Axiom trace (2026-08-04, PK).
// Exact-match only (never startsWith/contains), so "make me a video on
// photosynthesis" still falls through to AI video generation as intended.
// Pure / side-effect-free so it is unit-testable.
function isVideoCommand(trimmedMessage) {
  const t = String(trimmedMessage || '').trim();
  return t === '/video' || t.startsWith('/video ') || t.toLowerCase() === 'video';
}

/**
 * bd-2475 (ported from PK) — /video's promise to a binge-declining child
 * ("send /video anytime") only holds if it actually works with no `users`
 * row. Named by a SINGLE match on the phone (StudentIdentity.findByPhone —
 * siblings on one handset are ambiguous, so they fall through unchanged)
 * with at least one prior share_link quiz session (so we have a
 * shareCodeId to attribute the next round to). Returns false — never
 * throws — on any miss, so the caller can fall straight into the existing
 * noAccount message.
 */
async function tryChildVideoMenu(from, language) {
  try {
    const StudentIdentity = require('../services/quiz/student-identity.service');
    const known = await StudentIdentity.findByPhone(from);
    if (known.length !== 1) return false;

    const { data: lastSession } = await supabase
      .from('quiz_sessions')
      .select('share_code_id')
      .eq('student_id', known[0].id)
      .not('share_code_id', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!lastSession?.share_code_id || !STUDENT_VIDEOS_FLOW_ID) return false;

    const flowToken = ChildFlowToken.build({
      phone: from, shareCodeId: lastSession.share_code_id,
      studentId: known[0].id, language: language || 'en',
    });
    await WhatsAppService.sendFlow(from, {
      flowId: STUDENT_VIDEOS_FLOW_ID,
      header: '🎬 More Videos',
      body: 'Pick a class, subject and topic — I will send the video to your chat.',
      buttonText: 'Browse',
      flowToken,
    });
    return true;
  } catch (err) {
    logToFile('⚠️ /video: child fallback failed', { error: err.message });
    return false;
  }
}

async function handleTextMessage(message, from, messageBody, user = null) {
  logToFile(`Processing TEXT message: ${messageBody}`);

  // Start continuous typing indicator immediately
  const typingController = WhatsAppService.startContinuousTypingIndicator(from, message.id);

  try {
    // ============================================================
    // QUIZ STATE INTERCEPT — runs BEFORE user creation so parents (who may
    // not have a Rumi account) can answer quizzes. Post-quiz AI chat is checked
    // FIRST (it is the most-recent state; running getActiveState first could
    // recover a stale 'invited' session and send the wrong nudge), then an
    // active quiz session.
    // ============================================================
    if (messageBody) {
      try {
        const QuizSessionService = require('../services/quiz/quiz-session.service');

        const postQuizState = await QuizSessionService.getPostQuizState(from);
        if (postQuizState) {
          const lowerQ = (messageBody || '').trim().toLowerCase();
          if (lowerQ === 'stop' || lowerQ === 'done') {
            await QuizSessionService.endPostQuizChat(from);
          } else {
            await QuizSessionService.handlePostQuizChat(from, messageBody, postQuizState);
          }
          typingController.stop();
          return;
        }

        // BH open-ended capstone  — an in-progress capstone attempt
        // claims the teacher's next text messages as answers. Slash commands
        // pass through (the service refuses them), so /training etc. still work.
        const CapstoneDelivery = require('../services/training/capstone-delivery.service');
        if (await CapstoneDelivery.routeTextAnswer(from, messageBody)) {
          typingController.stop();
          return;
        }

        const quizState = await QuizSessionService.getActiveState(from);
        if (quizState) {
          const trimmedQ = messageBody.trim();
          const lowerQ = trimmedQ.toLowerCase();
          if (/^(start quiz|start_quiz|کوئز شروع کریں)$/i.test(trimmedQ)) {
            await QuizSessionService.startQuizFromInvite(from);
          } else if (lowerQ === 'stop' || trimmedQ === 'روکیں') {
            await QuizSessionService.endSession(from, quizState, 'incomplete');
          } else if (/^[abc]$/i.test(trimmedQ) && quizState.currentQuestionId) {
            await QuizSessionService.handleAnswer(from, trimmedQ, quizState);
          } else {
            await WhatsAppService.sendMessage(from,
              '❓ Tap one of the answer buttons above, or type A, B, or C.\n\nType STOP to exit the quiz.'
            );
          }
          typingController.stop();
          return;
        }
      } catch (qErr) {
        logToFile('⚠️ Quiz state intercept error (non-fatal)', { error: qErr.message });
      }
    }

    // ============================================================
    // bd-2482 (NIETE port of PK bd-2314/2315): Video-quiz share links.
    //
    // Deliberately BEFORE user lookup: a child arriving from a forwarded
    // wa.me link may have no users row at all, and their first message is
    // the auto-filled "QUIZ-ABC123". Routing that through normal onboarding
    // would answer a code with a menu.
    //
    // Two steps, both short-circuiting:
    //   1. the code itself -> greet, naming the teacher and the topic
    //   2. the next two texts -> their name, then their class
    // ============================================================
    if (messageBody) {
      try {
        const VideoQuizShare = require('../services/quiz/video-quiz-share.service');
        const code = VideoQuizShare.parseShareCode(messageBody);
        if (code) {
          await VideoQuizShare.beginFromCode(from, code);
          typingController.stop();
          return;
        }
        if (await VideoQuizShare.consumeJoinReply(from, messageBody)) {
          logToFile('Text consumed as video-quiz join detail — short-circuit', { from });
          typingController.stop();
          return;
        }
      } catch (vqErr) {
        logToFile('Video Quiz share: routing error', { error: vqErr.message });
      }
    }

    // ============================================================
    // DATABASE INTEGRATION: Use provided user or get/create
    // ============================================================
  if (!user) {
    try {
      user = await getOrCreateUser(from);
      logToFile('User retrieved/created', { userId: user.id, phoneNumber: from });
    } catch (error) {
      logToFile('⚠️ Error with database user operation', { error: error.message });
      // Continue without database - bot will still work
    }
  } else {
    logToFile('Using provided user object', { userId: user.id, phoneNumber: from });
  }

  // NOTE: Funnel tracking (chat start) is handled centrally in whatsapp-bot.js
  // before routing to this handler

  // Get or create session for this user
  let sessionId = null;
  if (user) {
    try {
      sessionId = await getOrCreateSession(user.id);
      logToFile('✅ Session retrieved/created', { sessionId });
    } catch (error) {
      logToFile('⚠️ Error with session management', { error: error.message });
    }
  }

  // ============================================================
  // LP FEEDBACK — REASON CAPTURE
  // If the teacher tapped 👎 on a recent LP within the last 10 minutes,
  // treat their next free-text message as the reason (Redis flag set by
  // lp-feedback.service.js handleFeedbackButton). Short-circuit here so
  // intent detection / AI chat doesn't eat the reason.
  // ============================================================
  if (user?.id) {
    try {
      const consumed = await LpFeedbackService.consumeReasonIfPending(user.id, from, messageBody);
      if (consumed) {
        logToFile('LP Feedback: reason captured, short-circuiting text handler', {
          userId: user.id, from,
        });
        return;
      }
    } catch (feedbackErr) {
      // Non-fatal — if the feedback middleware errors, fall through to normal routing
      logToFile('LP Feedback: consumeReasonIfPending error (non-fatal)', {
        error: feedbackErr.message, userId: user.id,
      });
    }
  }

  // ============================================================
  // FEATURE-BASED REGISTRATION: Check if waiting for name
  // ============================================================
  // bd-2447: `/register` is exempt from the pending-name intercept below —
  // otherwise the literal text "/register" gets swallowed as a name answer.
  // It falls through to the /register command branch, which always opens the
  // registration Flow.
  const isRegisterCommand = (messageBody || '').trim().toLowerCase() === '/register';

  if (user && !isRegisterCommand) {
    try {
      const isPendingName = await FeatureRegistrationService.isPendingName(user.id);
      if (isPendingName) {
        logToFile('📝 User is pending name registration, handling name response', { userId: user.id });

        // Get user's current language
        const userLanguage = user.preferred_language || 'en';

        // Handle the name response
        const result = await FeatureRegistrationService.handleNameResponse(
          user.id,
          messageBody,
          from,
          userLanguage,
          'text'
        );

        if (result.success) {
          logToFile('✅ Name registration completed via text', { userId: user.id, firstName: result.firstName });
        } else {
          logToFile('⚠️ Name extraction failed, asking again', { userId: user.id });
          // Ask again if extraction failed
          const retryMessages = {
            en: "I didn't quite catch that. What name should I call you by?",
            ur: "میں سمجھ نہیں سکی۔ آپ کو کس نام سے بلاؤں؟",
            ar: "لم أفهم ذلك. ما اسمك؟",
            es: "No entendí bien. ¿Cómo te llamo?"
          };
          await WhatsAppService.sendMessage(from, retryMessages[userLanguage] || retryMessages.en);
        }

        // Stop typing and return early
        if (typingController) typingController.stop();
        return;
      }
    } catch (error) {
      logToFile('⚠️ Error checking pending name status', { error: error.message });
      // Continue with normal flow if check fails
    }
  }

  // Get user's current language preference using user ID
  const currentLanguage = user ? await getUserLanguage(user.id) : 'en';
  logToFile('Current user language preference', { language: currentLanguage, userId: user?.id });

  // Check for explicit language switch command FIRST.
  // bd-2413 (row 11): only honour a switch to a MARKET language (en/ur). A
  // request for Punjabi (or any off-market language) is ignored — Rumi stays on
  // the teacher's current en/ur, rather than locking the whole conversation to
  // an unsupported language.
  const rawOverride = detectLanguageOverride(messageBody);
  const overrideLanguage = isMarketLanguage(rawOverride) ? rawOverride : null;
  if (rawOverride && !overrideLanguage) {
    logToFile('🌐 Off-market language override ignored (keeping en/ur)', {
      requested: rawOverride, userId: user?.id,
    });
  }
  let responseLanguage = currentLanguage;
  let languageSwitched = false;

  if (overrideLanguage && overrideLanguage !== currentLanguage) {
    // Update user's language preference in database and cache using user ID
    if (user) {
      await setUserLanguage(user.id, overrideLanguage);
    }
    responseLanguage = overrideLanguage;
    languageSwitched = true;

    logToFile('🌐 Language switched by user command', {
      from: currentLanguage,
      to: overrideLanguage,
      command: messageBody,
      phoneNumber: from
    });

    // Send confirmation in the NEW language
    const confirmations = {
      en: "✅ I've switched to English. How can I help you today?",
      ur: "✅ میں نے اردو میں تبدیل کر دیا ہے۔ آج میں آپ کی کیسے مدد کر سکتی ہوں؟",
      ar: "✅ لقد تحولت إلى اللغة العربية. كيف يمكنني مساعدتك اليوم؟",
      es: "✅ He cambiado al español. ¿Cómo puedo ayudarte hoy?"
    };

    await WhatsAppService.sendMessage(from, confirmations[overrideLanguage]);

    // Return early if this was just a language switch command
    return;
  }

  // ============================================================
  // ICE BREAKER DETECTION: Handle tapped ice breakers (fix)
  // ============================================================
  const trimmedMessage = messageBody.trim().toLowerCase();

  // Student Video feedback reason capture — if the teacher tapped "Not really"
  // on a recent video survey and is within the 10-min reason window, capture
  // this text as the reason and short-circuit. Slash commands bypass this
  // (handled inside consumeReasonIfPending).
  if (user?.id && messageBody) {
    try {
      const StudentVideoFeedbackService = require('../services/student-video-feedback.service');
      const consumed = await StudentVideoFeedbackService.consumeReasonIfPending(user.id, from, messageBody);
      if (consumed) {
        logToFile('Text consumed as Student Video feedback reason — short-circuit', { userId: user.id });
        return;
      }
    } catch (svFbErr) {
      logToFile('Student Video Feedback: consumeReasonIfPending error', { error: svFbErr.message });
    }
  }

  // When user taps ice breaker, WhatsApp sends the ice breaker text as message
  const iceBreakers = {
    'show menu - see all features i can help with': 'menu',
    'plan lesson - create pdf lesson plans instantly': 'lesson_plan',
    'create video - make animated educational videos': 'video',
    'get coaching - classroom audio feedback & tips': 'coaching'
  };

  if (iceBreakers[trimmedMessage]) {
    const action = iceBreakers[trimmedMessage];
    logToFile('🧊 Ice breaker detected', { action, userId: user?.id, phoneNumber: from });

    if (!user) {
      await WhatsAppService.sendMessage(
        from,
        'Sorry, I could not find your account. Please send me a message first.\n\nمعذرت، میں آپ کا اکاؤنٹ نہیں مل سکا۔'
      );
      typingController.stop();
      return;
    }

    try {
      switch (action) {
        case 'menu':
          await MenuService.sendMenu(from, user.id, sessionId, responseLanguage);
          break;
        case 'lesson_plan':
          await MenuService._handleLessonPlanningChoice(user.id, sessionId, from, responseLanguage);
          break;
        case 'video':
          await MenuService._handleMediaLibraryChoice(user.id, sessionId, from, responseLanguage);
          break;
        case 'coaching':
          await MenuService._handleClassroomCoachingChoice(user.id, sessionId, from, responseLanguage);
          break;
      }
      logToFile('✅ Ice breaker action completed', { action, userId: user.id });
    } catch (error) {
      logToFile('❌ Error handling ice breaker', { action, error: error.message });
      await WhatsAppService.sendMessage(from, 'Something went wrong. Please try again or type /menu.');
    }

    typingController.stop();
    return; // Stop further processing
  }

  // ============================================================
  // EXAM CHECKER DETECTION: Check for exam check trigger
  //
  // Skip for slash commands — they're explicit user intent and take
  // priority over keyword-based detection. Without this guard, `/exam`
  // (exam GENERATOR — a different feature) is greedily interpreted as
  // "start exam CHECKER" (OCR answer-sheet grading), and any future
  // `/exam*` variant would collide too.
  // ============================================================
  if (user && !trimmedMessage.startsWith('/')) {
    try {
      const ExamCheckerHandler = require('./exam-checker.handler');
      const result = await ExamCheckerHandler.handleExamText(message, from, user);
      if (result && result.handled) {
        logToFile('✅ Message handled by Exam Checker', { userId: user.id });
        typingController.stop();
        return;
      }
    } catch (error) {
      logToFile('⚠️ Error in exam checker detection', { error: error.message });
      // Continue with regular message handling
    }
  }

  // ============================================================
  // PORTAL COMMAND DETECTION: Check for /portal command
  // ============================================================
  if (trimmedMessage === '/portal' || trimmedMessage.startsWith('/portal ')) {
    logToFile('📱 /portal command detected', { userId: user?.id, phoneNumber: from });

    if (!user) {
      // Edge case: user not found in database
      await WhatsAppService.sendMessage(
        from,
        'Sorry, I could not find your account. Please send me a message first to register.\n\nمعذرت، میں آپ کا اکاؤنٹ نہیں مل سکا۔'
      );
      return;
    }

    try {
      const response = await handlePortalCommand(user, from);

      // Only send message if handler returned non-empty response
      // (PortalInviteService sends its own message for new invitations)
      if (response && response.trim().length > 0) {
        await WhatsAppService.sendMessage(from, response);
      }

      logToFile('✅ /portal command processed successfully', { userId: user.id });
    } catch (error) {
      logToFile('❌ Error processing /portal command', {
        userId: user.id,
        error: error.message,
        stack: error.stack
      });

      await WhatsAppService.sendMessage(
        from,
        'Sorry, something went wrong with the portal command. Please try again later.\n\nمعذرت، پورٹل کمانڈ میں کچھ غلط ہو گیا۔'
      );
    }

    return; // Stop further processing
  }

  // ============================================================
  // OBSERVE COMMAND (FEAT-102): /observe — ICT/NIETE school-leader (Coach /
  // Principal / AEO) classroom-observation capture on FICO. All gating
  // (capability via OBSERVE_MEWAKA_FLOW_ID, leader-role family, one-time
  // onboarding) lives in observe-gate.js + observe-command.handler.js. When
  // observe is OFF the handler returns false and the message falls through to
  // normal processing — teacher behaviour provably unchanged.
  // ============================================================
  if (/^\/observe\b/i.test(trimmedMessage)) {
    const { handleObserveCommand } = require('./observe-command.handler');
    const observeHandled = await handleObserveCommand(user, from, trimmedMessage);
    if (observeHandled) return;
  }

  // ============================================================
  // REMARK COMMAND : /remark — STEPS "S" Supervisor Remark, the
  // principal's quarterly evaluation of each teacher in her school. All gating
  // (capability `remark.author` via feature_permissions, plus an OPEN
  // evaluation cycle) lives in remark-gate.js + remark-command.handler.js.
  // Returns false on a non-match so normal chat is untouched.
  // ============================================================
  if (/^\/remark\b/i.test(trimmedMessage)) {
    const { handleRemarkCommand } = require('./remark-command.handler');
    const remarkHandled = await handleRemarkCommand(user, from, trimmedMessage);
    if (remarkHandled) return;
  }

  // FEAT-102: a school leader mid send-flow — the next text is the observed
  // teacher's name + phone (state-gated; teachers and normal chat untouched).
  {
    const { isSchoolLeader: _isLeader } = require('../services/observe/observe-gate');
    if (_isLeader(user)) {
      try {
        const ObserveState = require('../services/observe/observe-state.service');
        const sendState = await ObserveState.getState(user.id);
        if (sendState && sendState.state === 'awaiting_teacher_details') {
          const ObserveSend = require('../services/observe/observe-send.service');
          const consumed = await ObserveSend.handleTeacherDetailsText(user, from, trimmedMessage, sendState);
          if (consumed) return;
        }
      } catch (sendErr) {
        logToFile('⚠️ observe send-state check failed (falling through to chat)', {
          userId: user && user.id, error: sendErr.message,
        });
      }
    }
  }

  // ============================================================
  // READING TEST COMMAND DETECTION: Check for /reading test command
  // ============================================================
  if (trimmedMessage === '/reading test' || trimmedMessage === '/readingtest') {
    logToFile('📖 /reading test command detected', { userId: user?.id, phoneNumber: from });

    if (!user) {
      // Edge case: user not found in database
      await WhatsAppService.sendMessage(
        from,
        'Sorry, I could not find your account. Please send me a message first to register.\n\nمعذرت، میں آپ کا اکاؤنٹ نہیں مل سکا۔'
      );
      return;
    }

    try {
      // Stop typing indicator before sending video
      typingController.stop();

      // Get user's language for intro message
      const userLanguage = await getUserLanguage(from) || 'en';

      // Integration Point 2: First-time slash command - send intro video if first use
      // This is implicit consent since user initiated the command
      const videoSent = await FeatureIntroService.sendFirstUseIntroIfNeeded(
        user.id,
        from,
        'reading',
        userLanguage
      );

      if (videoSent) {
        logToFile('📹 First-use intro video sent for reading assessment', { userId: user.id });
      }

      // Send WhatsApp Flow for reading assessment setup
      const flowSent = await WhatsAppService.sendFlow(from, {
        flowId: process.env.READING_ASSESSMENT_FLOW_ID,
        header: '📚 Reading Assessment',
        body: 'Let\'s set up a reading assessment for your student. This will help measure their reading fluency and comprehension.',
        footer: 'Takes about 5-10 minutes',
        buttonText: 'Start Assessment',
        screen: 'BASIC_INFO'  // Multi-screen flow v3: first screen
      });

      if (flowSent) {
        logToFile('✅ Reading assessment flow sent successfully', { userId: user.id });
        // Mark feature as used (after video was shown)
        await FeatureIntroService.markFeatureUsed(user.id, 'reading');
      } else {
        throw new Error('Failed to send WhatsApp Flow');
      }
    } catch (error) {
      logToFile('❌ Error sending reading assessment flow', {
        userId: user?.id,
        error: error.message,
        stack: error.stack
      });

      await WhatsAppService.sendMessage(
        from,
        'Sorry, something went wrong starting the reading test. Please try again later.\n\nمعذرت، ریڈنگ ٹیسٹ شروع کرنے میں کچھ غلط ہو گیا۔'
      );
    }

    return; // Stop further processing
  }

  // ============================================================
  // QUIZ FOLLOW-UP: teacher tapped a follow-up button earlier ("Revise +
  // next topic" / "Extension" / "Bridge") and we asked for the next topic.
  // This reply is that topic — route it to the follow-up service.
  // ============================================================
  if (user?.id && messageBody) {
    try {
      const QuizFollowUpService = require('../services/quiz/quiz-follow-up.service');
      const awaiting = await QuizFollowUpService.getAwaitingState(user.id);
      if (awaiting) {
        typingController.stop();
        await QuizFollowUpService.handleNextTopicReply(user.id, from, await getUserLanguage(from) || 'en', messageBody);
        return;
      }
    } catch (e) {
      logToFile('⚠️ Quiz follow-up topic check error (non-fatal)', { error: e.message });
    }
  }

  // ============================================================
  // QUIZ TOPIC RESPONSE: user is replying with a quiz topic after /quiz
  // ============================================================
  if (user?.id) {
    try {
      const active = await ConversationState.getState(user.id);
      if (active && active.flow === 'quiz' && active.step === 'awaiting_topic') {
        const state = active.payload || {};
        await ConversationState.clearState(user.id, { flow: 'quiz' });
        typingController.stop();
        const QuizOrchestrator = require('../services/quiz/quiz-orchestrator.service');
        await QuizOrchestrator.handleTopicReply(user, from, messageBody.trim(), state);
        return;
      }
    } catch (error) {
      logToFile('⚠️ Error checking quiz topic state', { userId: user?.id, error: error.message });
    }
  }

  // ============================================================
  // TRAINING COMMAND: /training — open the Teacher Training Flow.
  // Renders 4 level cards with per-teacher progress + PNG badges (from R2).
  // Flow ID from env; if empty, we send a plain-text fallback so the command
  // never disappears (the Flow must be published to Meta separately).
  // ============================================================
  const lowerTrimmed = trimmedMessage.toLowerCase();
  if (
    trimmedMessage === '/training' ||
    trimmedMessage === '/trainings' ||
    lowerTrimmed === 'training' ||
    lowerTrimmed === 'trainings' ||
    lowerTrimmed === 'show me training' ||
    lowerTrimmed === 'show me trainings' ||
    lowerTrimmed === 'open training' ||
    lowerTrimmed === 'open trainings'
  ) {
    logToFile('🎓 /training command detected', { userId: user?.id, phoneNumber: from });
    if (!user) {
      typingController.stop();
      await WhatsAppService.sendMessage(
        from,
        'Sorry, I could not find your account. Please send me a message first to register.\n\nمعذرت، میں آپ کا اکاؤنٹ نہیں مل سکا۔'
      );
      return;
    }
    // one entry point, shared with the menu's Training row. A second
    // copy here is how the two would drift.
    typingController.stop();
    const trainingLanguage = await getUserLanguage(from) || 'en';
    const TrainingEntry = require('../services/training/training-entry.service');
    await TrainingEntry.openTrainingFlow(user, from, trainingLanguage);
    return;
  }

  // ============================================================
  // CERTIFICATES COMMAND
  //   /certificates            → list the teacher's earned certifications
  //   /certificate <CODE>      → send THAT certificate as a PDF document
  //
  // The PDF is fetched-or-minted through the same shared service the portal
  // reaches over the internal API, so a certificate a teacher can download in
  // the browser is exactly the one they get in chat — legacy certificates
  // included, which render on first request either way.
  //
  // Parsing and delivery live in the service, not here: this handler pulls in
  // ~40 services and cannot be booted in a test, so logic inlined in it is
  // untestable by construction.
  // ============================================================
  const certCommand = parseCertificateCommand(trimmedMessage);
  if (certCommand) {
    logToFile('🏆 /certificates command detected', { userId: user?.id, phoneNumber: from, code: certCommand.code });
    if (!user) {
      typingController.stop();
      await WhatsAppService.sendMessage(
        from,
        'Sorry, I could not find your account. Please send me a message first to register.'
      );
      return;
    }
    // A named certificate: fetch-or-mint it and send the file itself.
    if (certCommand.code) {
      const result = await deliverCertificateByCode(supabase, {
        userId: user.id,
        phoneNumber: from,
        certificateCode: certCommand.code,
      });
      typingController.stop();
      if (result.ok) return;
      await WhatsAppService.sendMessage(
        from,
        result.reason === 'not_found'
          ? `I could not find a certificate with the code \`${certCommand.code}\` in your records.\n\nSend /certificates to see the ones you have earned.`
          : "I could not prepare that certificate just now. Please try again in a moment — it is safe in your records either way."
      );
      return;
    }

    const { data: certs } = await supabase
      .from('training_certificates')
      .select('certificate_code, teacher_name_snapshot, level_name_snapshot, issued_at, level_id, training_levels(order_index)')
      .eq('user_id', user.id)
      .order('level_id', { ascending: true });
    typingController.stop();
    if (!certs || certs.length === 0) {
      await WhatsAppService.sendMessage(
        from,
        "You don't have any NIETE certifications yet.\n\nComplete a level's courses and pass the grand quiz to earn one. Type /training to get started."
      );
      return;
    }
    const fmtDate = (iso) => {
      const d = new Date(iso);
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    };
    const lines = certs.map(c => {
      const lvl = (c.training_levels?.order_index ?? 0) + 1;
      return `✅ *Level ${lvl} · ${c.level_name_snapshot}*\n   Passed ${fmtDate(c.issued_at)}\n   Cert: \`${c.certificate_code}\``;
    });
    const teacherName = certs[0].teacher_name_snapshot || 'Teacher';
    const body =
      `🏆 *NIETE Certifications — ${teacherName}*\n\n` +
      lines.join('\n\n') +
      `\n\n_Send_ \`/certificate <code>\` _to get the PDF._` +
      `\n_Type /training to continue with your next level._`;
    await WhatsAppService.sendMessage(from, body);
    logToFile('🏆 Sent certificates list', { userId: user.id, count: certs.length });
    return;
  }

  // ============================================================
  // NOTE — /exam trigger removed (Umama's spec 2026-07-16, bd-2033):
  // the legacy Exam Generator (WEEKLY/TERM composed from `exam_question_bank`)
  // is superseded by the Assessment Generator Flow below (UG_EG-backed).
  // `/assessment` is the single entry point for exam + practice creation.
  // The old exam-generator Flow + endpoint remain wired for now — they can
  // still be published under a different trigger if we ever need the fallback.
  // ============================================================

  // ============================================================
  // ASSESSMENT COMMAND: /assessment — open the Assessment Generator Flow.
  // Dynamic multi-screen state machine: SPEC → SEEN_UNSEEN → (fast-path SUCCESS
  // if 'Seen') → OBJ_SUBJ → QUESTION_TYPES (dynamic per subject+category) →
  // SUCCESS. Backend submits to external UG_EG service; result lands on
  // /webhooks/assessment-generator. See routes/assessment-gen-endpoint.js.
  // ============================================================
  if (trimmedMessage === '/assessment' || trimmedMessage === '/practice') {
    logToFile('📝 /assessment command detected', { userId: user?.id, phoneNumber: from });
    if (!user) {
      typingController.stop();
      await WhatsAppService.sendMessage(
        from,
        'Sorry, I could not find your account. Please send me a message first to register.\n\nمعذرت، میں آپ کا اکاؤنٹ نہیں مل سکا۔'
      );
      return;
    }
    // the Assessment Generator is held OFF until it is ready on BOTH
    // surfaces. The switch is one app_settings row shared with the portal, so
    // neither side can claim the feature is live while the other says it isn't.
    // Fail-closed: an absent row or a failed lookup reads as off.
    const { isAssessmentGeneratorEnabled } = require('../config/feature-flags');
    const assessmentLive = await isAssessmentGeneratorEnabled();
    const ASSESSMENT_GEN_FLOW_ID = process.env.ASSESSMENT_GEN_FLOW_ID || '';
    if (assessmentLive && ASSESSMENT_GEN_FLOW_ID) {
      typingController.stop();
      const flowToken = `${user.id}:assessment-gen:${Date.now()}`;
      const responseLanguage = await getUserLanguage(from) || 'en';
      await WhatsAppService.sendFlow(from, {
        flowId: ASSESSMENT_GEN_FLOW_ID,
        header: '📝 New assessment',
        body: ({
          ur: 'اپنی کلاس کے لیے امتحان یا مشق تیار کریں — گریڈ، مضمون، صفحات اور سوالات منتخب کریں۔',
        })[responseLanguage] || 'Build an exam or classroom practice — pick grade, subject, pages, and question types.',
        buttonText: ({
          ur: 'شروع کریں',
        })[responseLanguage] || 'Start',
        flowToken,
      });
      logToFile('📝 Sent assessment-gen flow (/assessment)', { userId: user.id });
      return;
    }
    typingController.stop();
    await WhatsAppService.sendMessage(
      from,
      "The assessment generator is being prepared for you. We'll notify you when it's live."
    );
    return;
  }

  // ============================================================
  // QUIZ COMMAND: /quiz [topic] — generate + send a quiz to the class.
  // Direct path (QuizOrchestrator). A Quiz Manager Flow can be layered later
  // via QUIZ_FLOW_ID, but the direct path needs no Meta-flow registration.
  // ============================================================
  if (trimmedMessage === '/quiz' || trimmedMessage.startsWith('/quiz ')) {
    logToFile('📝 /quiz command detected', { userId: user?.id, phoneNumber: from });
    if (!user) {
      typingController.stop();
      await WhatsAppService.sendMessage(
        from,
        'Sorry, I could not find your account. Please send me a message first to register.\n\nمعذرت، میں آپ کا اکاؤنٹ نہیں مل سکا۔'
      );
      return;
    }
    try {
      const QuizOrchestrator = require('../services/quiz/quiz-orchestrator.service');
      const responseLanguage = await getUserLanguage(from) || 'en';
      const topic = trimmedMessage.replace(/^\/quiz[\s,:;\-]*/i, '').trim() || null;
      await QuizOrchestrator.initiateQuizRequest(user, from, sessionId, responseLanguage, topic);
      logToFile('✅ Quiz orchestration started', { userId: user.id, topic });
    } catch (error) {
      logToFile('❌ Error initiating quiz', { userId: user?.id, error: error.message });
      typingController.stop();
      await WhatsAppService.sendMessage(
        from,
        'Sorry, something went wrong starting the quiz. Please try again.\n\nمعذرت، کوئز شروع کرنے میں کچھ غلط ہو گیا۔'
      );
    }
    return;
  }

  // ============================================================
  // PAKISTAN LP INTERCEPT (FEAT-059 / bd-hvhhu): ANY mention of a lesson plan
  // opens the LP menu — English, Urdu script, or Roman Urdu.
  //
  // This used to be exact-match only
  //   /^(lp|lesson\s*plan|لیسن\s*پلان|lesson-plan|\/lp)$/i
  // so "can you send me the lesson plan for tomorrow" fell through to the LLM
  // intent path and often produced a GENERATED plan instead of the ready-made
  // corpus a teacher was asking for. isLessonPlanRequest() is tiered (strong /
  // weak-needs-a-companion / blocked) so a generous trigger list does not cost
  // false positives — see shared/utils/lp-intent.js and its tests.
  //
  // Presence-gated on PAKISTAN_LP_FLOW_ID — when empty, the message falls
  // through to the existing curriculum-LP topic intercept.
  // ============================================================
  {
    const PAKISTAN_LP_FLOW_ID = process.env.PAKISTAN_LP_FLOW_ID || '';
    const lpMatch = matchLessonPlanIntent(trimmedMessage);
    if (PAKISTAN_LP_FLOW_ID && lpMatch.matched) {
      logToFile('📘 LP intent detected → opening Pakistan LP flow', {
        userId: user?.id, phoneNumber: from, message: trimmedMessage,
        tier: lpMatch.tier, token: lpMatch.token,
      });
      if (!user) {
        typingController.stop();
        await WhatsAppService.sendMessage(
          from,
          'Sorry, I could not find your account. Please send me a message first to register.\n\nمعذرت، میں آپ کا اکاؤنٹ نہیں مل سکا۔'
        );
        return;
      }
      typingController.stop();
      const responseLanguage = await getUserLanguage(from) || 'en';
      const flowToken = `${user.id}:pakistan-lp:${Date.now()}`;
      await WhatsAppService.sendFlow(from, {
        flowId: PAKISTAN_LP_FLOW_ID,
        header: '📘 Lesson Plans',
        body: ({
          ur: 'اپنی جماعت، مضمون اور باب چنیں، پھر اُس دن کا سبق — منصوبہ آپ کی چیٹ میں آ جائے گا۔',
        })[responseLanguage] || "Pick your class, subject and chapter, then the day's lesson — the plan lands in your chat.",
        buttonText: ({
          ur: 'شروع کریں',
        })[responseLanguage] || 'Browse',
        flowToken,
      });
      logToFile('📘 Sent Pakistan LP flow', { userId: user.id });
      return;
    }
  }

  // ============================================================
  // VIDEO GENERATION COMMAND: Check for /video command
  // bd-2482/bd-2486 (ported from PK): a bare "video" (no slash) also opens
  // the library — teachers type the plain word more often than the slash
  // form. Exact-match only (not startsWith/substring) so a real sentence
  // like "make me a video on photosynthesis" still falls through to AI
  // video generation below. isVideoCommand() is shared with PK's identical
  // fix, extracted into a named/testable matcher (mirrors isSelectVideoButton).
  // ============================================================
  if (isVideoCommand(trimmedMessage)) {
    logToFile('🎬 /video command detected', { userId: user?.id, phoneNumber: from });

    if (!user) {
      // bd-2475 (ported from PK) — a binge-declining child was told
      // "/video always works". Honour that before falling to the
      // teacher-only noAccount message.
      if (await tryChildVideoMenu(from, user?.preferred_language)) return;
      await WhatsAppService.sendMessage(
        from,
        'Sorry, I could not find your account. Please send me a message first to register.\n\nمعذرت، میں آپ کا اکاؤنٹ نہیں مل سکا۔'
      );
      return;
    }

    // Presence-gated: when STUDENT_VIDEOS_FLOW_ID is set, /video opens the
    // pre-made Student Video Library picker. When it is empty, /video falls
    // through to the runtime video generator below.
    const STUDENT_VIDEOS_FLOW_ID = process.env.STUDENT_VIDEOS_FLOW_ID || '';
    if (STUDENT_VIDEOS_FLOW_ID) {
      typingController.stop();
      const flowToken = `${user?.id || 'anon'}:student-videos:${Date.now()}`;
      await WhatsAppService.sendFlow(from, {
        flowId: STUDENT_VIDEOS_FLOW_ID,
        header: '🎬 Student Videos',
        body: ({
          ur: 'اپنی کلاس، مضمون اور موضوع چنیں — میں ویڈیو آپ کی چیٹ میں بھیج دوں گا۔',
        })[responseLanguage] || 'Pick a class, subject and topic — I will send the video to your chat.',
        buttonText: ({
          ur: 'تلاش کریں',
        })[responseLanguage] || 'Browse',
        flowToken,
      });
      logToFile('🎬 Sent student videos flow (/video)', { userId: user?.id });
      return;
    }

    try {
      typingController.stop();

      // Extract topic from command if provided (e.g., "/video gravity")
      const topic = trimmedMessage.replace(/^\/video\s*/i, '').trim() || null;

      await VideoOrchestrator.initiateVideoRequest(user, from, sessionId, responseLanguage, topic);
      logToFile('✅ Video generation initiated', { userId: user.id, topic });
    } catch (error) {
      logToFile('❌ Error initiating video generation', {
        userId: user?.id,
        error: error.message,
        stack: error.stack
      });

      await WhatsAppService.sendMessage(
        from,
        'Sorry, something went wrong starting video generation. Please try again later.\n\nمعذرت، ویڈیو بنانے میں کچھ غلط ہو گیا۔'
      );
    }

    return; // Stop further processing
  }

  // ============================================================
  // VIDEO TOPIC RESPONSE: Check if user is replying with video topic
  // CRITICAL: Must check BEFORE other processing to capture topic reply
  // ============================================================
  if (user) {
    try {
      const awaitingTopicState = await VideoOrchestrator.checkAwaitingTopic(user.id);

      if (awaitingTopicState) {
        logToFile('📹 User responding to video topic prompt', {
          userId: user.id,
          topic: messageBody.substring(0, 100)
        });

        typingController.stop();

        // Clear the awaiting state
        await VideoOrchestrator.clearAwaitingTopic(user.id);

        // Use the message as the topic and initiate video generation
        await VideoOrchestrator.initiateVideoRequest(
          user,
          from,
          awaitingTopicState.sessionId,
          awaitingTopicState.language,
          messageBody.trim()  // User's reply IS the topic
        );

        return; // Stop further processing
      }
    } catch (error) {
      logToFile('⚠️ Error checking video topic state', {
        userId: user?.id,
        error: error.message
      });
      // Continue with normal flow if state check fails
    }
  }

  // ============================================================
  // VIDEO CUSTOMIZATION RESPONSE: Check if user is providing customization
  // CRITICAL: Must check BEFORE other processing to capture customization reply
  // Issue #35: After customization → Style selection (not direct generation)
  // ============================================================
  if (user) {
    try {
      const awaitingCustomizationState = await VideoOrchestrator.checkAwaitingCustomization(user.id);

      if (awaitingCustomizationState) {
        logToFile('📹 User responding to video customization prompt', {
          userId: user.id,
          response: messageBody.substring(0, 100)
        });

        typingController.stop();

        // Clear the awaiting state
        await VideoOrchestrator.clearAwaitingCustomization(user.id);

        // Check if user wants to skip
        const skipKeywords = ['skip', 'no', 'نہیں', 'لا', 'تخطي', 'saltar'];
        const isSkip = skipKeywords.some(kw =>
          messageBody.toLowerCase().trim() === kw.toLowerCase()
        );

        const customization = isSkip ? null : messageBody.trim();

        // Issue #35: Proceed to style selection (not direct generation)
        await VideoOrchestrator.askForStyle(
          from,
          user.id,
          awaitingCustomizationState.sessionId,
          awaitingCustomizationState.language,
          awaitingCustomizationState.topic,
          customization
        );

        return; // Stop further processing
      }
    } catch (error) {
      logToFile('⚠️ Error checking video customization state', {
        userId: user?.id,
        error: error.message
      });
      // Continue with normal flow if state check fails
    }
  }

  // ============================================================
  // COMPREHENSION TEXT ANSWER HANDLING
  // CRITICAL: Must check BEFORE normal conversation to route comprehension answers
  // ============================================================
  if (user) {
    try {
      const RedisComprehensionService = require('../services/redis-comprehension.service');
      const activeFlow = await RedisComprehensionService.findActiveFlowByUser(user.id);

      logToFile('🔍 Text routing check - comprehension', {
        hasActiveFlow: !!activeFlow,
        assessmentId: activeFlow?.assessment_id || 'none',
        currentQuestion: activeFlow?.current_question_index,
        totalQuestions: activeFlow?.questions?.length,
        answersCollected: activeFlow?.answers?.length || 0
      });

      if (activeFlow) {
        logToFile('📝 Comprehension TEXT answer detected', {
          assessmentId: activeFlow.assessment_id,
          currentQuestion: activeFlow.current_question_index,
          answerText: messageBody.substring(0, 50) + '...'
        });

        // Stop typing indicator
        typingController.stop();

        // Import ComprehensionService
        const ComprehensionService = require('../services/reading/comprehension.service');

        // Get question data from Redis flow state
        const questions = activeFlow.questions;
        const currentQuestionIndex = activeFlow.current_question_index;
        const questionData = questions[currentQuestionIndex];
        const assessmentId = activeFlow.assessment_id;

        // Get language from assessment record
        const { data: assessment } = await supabase
          .from('reading_assessments')
          .select('language, grade_level')
          .eq('id', assessmentId)
          .single();
        const language = assessment?.language || 'en';

        // Evaluate TEXT answer directly (no transcription needed)
        const answerEvaluation = await ComprehensionService.evaluateTextAnswer(
          questionData,
          messageBody,
          language
        );

        logToFile('Comprehension text answer evaluated', {
          questionId: questionData.id,
          correct: answerEvaluation.correct,
          confidence: answerEvaluation.confidence
        });

        // Record answer in Redis and get updated state
        const updatedFlow = await RedisComprehensionService.recordAnswer(
          assessmentId,
          answerEvaluation
        );

        // Check if more questions remain
        const nextQuestionIndex = updatedFlow.current_question_index;

        logToFile('🔄 Comprehension progress check (text)', {
          currentQuestionIndex,
          nextQuestionIndex,
          totalQuestions: questions.length,
          answersCollected: updatedFlow.answers.length,
          hasMoreQuestions: nextQuestionIndex < questions.length
        });

        if (nextQuestionIndex < questions.length) {
          // Send next question immediately
          const nextQuestion = questions[nextQuestionIndex];

          logToFile('📤 Sending next comprehension question', {
            questionNumber: nextQuestionIndex + 1,
            totalQuestions: questions.length,
            questionType: nextQuestion.type,
            hasImage: !!nextQuestion.imageUrl
          });

          // Handle image questions (word-level comprehension)
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

          logToFile('✅ Next comprehension question sent (text flow)', {
            questionIndex: nextQuestionIndex,
            totalQuestions: questions.length,
            answersStored: updatedFlow.answers.length
          });
        } else {
          // All questions answered - finalize comprehension assessment
          const answers = updatedFlow.answers;
          logToFile('🎉 All comprehension questions answered (text) - finalizing assessment', {
            assessmentId,
            totalAnswers: answers.length,
            correctAnswers: answers.filter(a => a.correct).length,
            score: Math.round((answers.filter(a => a.correct).length / answers.length) * 100) + '%'
          });

          // Analyze comprehension results
          const comprehensionAnalysis = await ComprehensionService.analyzeComprehension(
            questions,
            answers,
            assessment.grade_level,
            language
          );

          // Save to reading_assessments table
          await supabase
            .from('reading_assessments')
            .update({
              comprehension_questions: questions,
              comprehension_answers: answers,
              comprehension_analysis: comprehensionAnalysis,
              comprehension_score: comprehensionAnalysis.score,
              status: 'comprehension_completed'
            })
            .eq('id', assessmentId);

          // Clean up Redis flow state
          await RedisComprehensionService.clearComprehensionState(assessmentId);

          // Generate combined fluency + comprehension report
          const ReadingAnalysisService = require('../services/reading/analysis.service');
          try {
            await ReadingAnalysisService.generateCombinedReport(assessmentId, from);
          } catch (reportError) {
            logToFile('❌ CRITICAL: Failed to generate combined report after comprehension completion', {
              assessmentId,
              error: reportError.message,
              stack: reportError.stack
            });
            await WhatsAppService.sendMessage(
              from,
              'Sorry, there was an error generating the final report. Please contact support.\n\nمعذرت، رپورٹ بنانے میں خرابی آ گئی۔'
            );
          }
        }

        return; // Exit early - comprehension flow handled
      }
    } catch (error) {
      logToFile('⚠️ Error checking comprehension state (text)', {
        userId: user?.id,
        error: error.message,
        stack: error.stack
      });
      // Don't return - let the message continue to normal processing if comprehension check fails
    }
  }

  // If no explicit switch, detect language from content and use it for response
  const detectedLanguage = LanguageDetectorService.detectLanguage(messageBody);

  // BUG FIX: Check if user has locked their language preference
  // If language_locked = true, use their preferred_language instead of auto-detection
  // This prevents auto-detection from overriding explicit user choice via /language command
  if (user && user.language_locked === true) {
    // Language is locked - use user's explicit preference
    responseLanguage = user.preferred_language || currentLanguage;

    logToFile('Language preference is LOCKED - using user preference over auto-detection', {
      detectedLanguage: detectedLanguage,
      userPreference: user.preferred_language,
      using: responseLanguage
    });
  } else if (detectedLanguage && detectedLanguage !== currentLanguage) {
    // Auto-detect mode: Use detected language for this response (temporary override, doesn't update stored preference)
    responseLanguage = detectedLanguage;

    logToFile('🔄 Auto-adapting response language based on message content (UNLOCKED)', {
      storedPreference: currentLanguage,
      detectedLanguage: detectedLanguage,
      usingForResponse: responseLanguage
    });
  } else {
    logToFile('Language detected from text content (UNLOCKED)', {
      detected: detectedLanguage,
      using: responseLanguage
    });
  }

  // Store user message in database with session
  if (user && sessionId) {
    try {
      await storeConversation(
        user.id,
        'user',
        messageBody,
        'text',
        sessionId,
        'text', // inputFormat
        responseLanguage, // Use the actual response language
        null, // outputFormat (not applicable for user messages)
        null  // outputLanguage (not applicable for user messages)
      );
      logToFile('✅ User message stored in database with session and language');
    } catch (error) {
      logToFile('⚠️ Failed to store user message', { error: error.message });
    }
  }

  // CHECK FOR ACTIVE COACHING SESSION (Reflective Question Response)
  if (user) {
    try {
      const { data: activeCoaching } = await supabase
        .from('coaching_sessions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'conducting_conversation')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (activeCoaching) {
        // a slash command ENDS the conversation and falls through.
        //
        // conducting_conversation was the only waiting state with no way out.
        // The bot's own escape-path map tells teachers to "type /menu" to leave
        // AWAITING_MENU_CHOICE / VIDEO_TOPIC / LESSON_PLAN / CLASSROOM_AUDIO —
        // but CONDUCTING_CONVERSATION was never added to it, and this block
        // swallowed the very command that map recommends. One teacher was held
        // for 269 hours.
        //
        // Exempting the command is NOT enough on its own: the session would
        // stay open and recapture the next free-text message, so the teacher
        // escapes and is immediately caught again. The session has to end.
        //
        // Answers already given are preserved — they live in
        // conversation_state.questions and are written as each one arrives, so
        // ending the session discards nothing the teacher said.
        if (trimmedMessage.startsWith('/')) {
          logToFile('🎓 Slash command during coaching — ending the session and continuing', {
            coachingSessionId: activeCoaching.id,
            command: trimmedMessage.split(/\s+/)[0],
          });
          await supabase
            .from('coaching_sessions')
            .update({ status: 'abandoned', updated_at: new Date().toISOString() })
            .eq('id', activeCoaching.id);
          // Deliberately no extra chat message: the command's own reply lands
          // immediately after this and a preamble in front of it is noise.
          // Fall through — do NOT return — so the command runs normally.
        } else {

        // Check if session is stuck (no update in last hour)
        const lastUpdate = new Date(activeCoaching.updated_at);
        const now = new Date();
        const hoursSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60);

        if (hoursSinceUpdate > 1) {
          logToFile('⚠️  Stuck coaching session detected', {
            coachingSessionId: activeCoaching.id,
            lastUpdate: activeCoaching.updated_at,
            hoursSinceUpdate: hoursSinceUpdate.toFixed(2),
            conversationState: activeCoaching.conversation_state?.current_state
          });

          // Offer recovery options
          typingController.stop();
          await WhatsAppService.sendMessage(
            from,
            "⚠️ I noticed your previous coaching session didn't complete properly.\n\n" +
            "Would you like to:\n" +
            "1️⃣ *Try again* - I'll re-analyze your lesson\n" +
            "2️⃣ *Start fresh* - Begin a new coaching session\n\n" +
            "Reply with *1* or *2*"
          );
          return;
        }

        logToFile('🎓 Active coaching session detected - routing as reflective response', {
          coachingSessionId: activeCoaching.id
        });

        // Stop typing indicator
        typingController.stop();

        // Route to coaching service
        await CoachingService.handleReflectiveResponse(
          activeCoaching.id,
          from,
          messageBody,
          'text',
          responseLanguage
        );

        return; // Exit early - coaching flow handled
        }
      }
    } catch (error) {
      // If no active coaching or error, continue with normal flow
      logToFile('No active coaching session or error checking', {
        error: error.code === 'PGRST116' ? 'No rows found' : error.message
      });
    }
  }

  // ============================================================
  // PAUSE-AND-RESUME: Stuck Session Detection (Non-Blocking)
  // ============================================================

  // Detect stuck sessions but DON'T block user - store reminder for later
  if (user) {
    try {
      const { data: stuckSession } = await supabase
        .from('coaching_sessions')
        .select('id, status, updated_at, conversation_state')
        .eq('user_id', user.id)
        .in('status', ['conducting_conversation', 'analyzing'])
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      if (stuckSession) {
        const lastUpdate = new Date(stuckSession.updated_at);
        const minutesSinceUpdate = (new Date() - lastUpdate) / (1000 * 60);

        if (minutesSinceUpdate > 60) {
          // Store context in Redis for later reminder (don't block user NOW)
          const reminderKey = `user:${user.id}:stuck:reminder`;
          const reminderData = JSON.stringify({
            sessionId: stuckSession.id,
            status: stuckSession.status,
            state: stuckSession.conversation_state?.current_state,
            detectedAt: new Date().toISOString()
          });

          // was a raw `setex` at 604800s (7 days), reaching straight past
          // the 24h ceiling that setexWithCeiling exists to enforce. A reminder that
          // can outlive the session it describes by a week is a stale-prompt
          // generator; the reminder itself is only shown if under 24h old anyway
          // (showStuckSessionReminder), so the extra six days were dead weight.
          await redisService.setexWithCeiling(reminderKey, 86400, reminderData);

          logToFile('📌 Stuck session detected but user not blocked', {
            sessionId: stuckSession.id,
            status: stuckSession.status,
            minutesSinceUpdate: minutesSinceUpdate.toFixed(1)
          });

          // DON'T RETURN - let user continue with current request
        }
      }
    } catch (error) {
      if (error.code !== 'PGRST116') { // Ignore "no rows found"
        logToFile('Error checking for stuck sessions', { error: error.message });
      }
    }
  }

  // Check if user is responding to a stuck session recovery prompt
  if (user) {
    try {
      const expectingRecoveryKey = `user:${user.id}:expecting:recovery`;
      const stuckSessionId = await redis.get(expectingRecoveryKey);

      if (stuckSessionId) {
        // User is responding to recovery prompt
        logToFile('🔍 User responding to stuck session recovery', {
          sessionId: stuckSessionId,
          response: messageBody
        });

        // Fetch the stuck session
        const { data: stuckSession } = await supabase
          .from('coaching_sessions')
          .select('*')
          .eq('id', stuckSessionId)
          .single();

        if (stuckSession) {
          const choice = messageBody.trim();

          if (choice === '1') {
            // Retry analysis
            typingController.stop();
            await redis.del(expectingRecoveryKey);

            logToFile('♻️ User chose to retry stuck session', { sessionId: stuckSessionId });
            await WhatsAppService.sendMessage(from, "⏳ Retrying your lesson analysis...");

            try {
              await CoachingService.retryAnalysis(stuckSessionId, from);
            } catch (error) {
              logToFile('❌ Failed to retry analysis', { error: error.message });
              await WhatsAppService.sendMessage(
                from,
                "❌ Sorry, I couldn't retry the analysis. Please try starting a new session."
              );
            }
            return;
          } else if (choice === '2') {
            // Start fresh
            typingController.stop();
            await redis.del(expectingRecoveryKey);

            logToFile('🆕 User chose to start fresh', { oldSessionId: stuckSessionId });

            await supabase
              .from('coaching_sessions')
              .update({ status: 'failed', updated_at: new Date().toISOString() })
              .eq('id', stuckSessionId);

            const freshMessages = {
              en: "✅ Okay! Starting fresh.\n\nTo begin a new coaching session, please send me:\n1️⃣ Your classroom audio or video\n2️⃣ Your lesson plan (PDF or text)",
              ur: "✅ ٹھیک ہے! نیا آغاز کرتے ہیں۔\n\nنیا کوچنگ سیشن شروع کرنے کے لیے، براہ کرم بھیجیں:\n1️⃣ اپنی کلاس روم آڈیو یا ویڈیو\n2️⃣ اپنا لیسن پلان (PDF یا ٹیکسٹ)",
              ar: "✅ حسناً! نبدأ من جديد.\n\nلبدء جلسة تدريب جديدة، يرجى إرسال:\n1️⃣ صوت أو فيديو الفصل الدراسي\n2️⃣ خطة الدرس (PDF أو نص)",
              es: "✅ ¡De acuerdo! Empecemos de nuevo.\n\nPara comenzar una nueva sesión de coaching, envíame:\n1️⃣ Tu audio o video del aula\n2️⃣ Tu plan de lección (PDF o texto)"
            };

            await WhatsAppService.sendMessage(from, freshMessages[responseLanguage] || freshMessages.en);
            return;
          } else if (choice === '3') {
            // Ignore/archive
            typingController.stop();
            await redis.del(expectingRecoveryKey);

            logToFile('📦 User chose to ignore/archive stuck session', { sessionId: stuckSessionId });

            await supabase
              .from('coaching_sessions')
              .update({ status: 'failed', updated_at: new Date().toISOString() })
              .eq('id', stuckSessionId);

            const ignoreMessages = {
              en: "✅ Got it! I've archived that session. What would you like to do now?",
              ur: "✅ سمجھ گئی! میں نے اس سیشن کو آرکائیو کر دیا۔ اب آپ کیا کرنا چاہتے ہیں؟",
              ar: "✅ فهمت! لقد أرشفت تلك الجلسة. ماذا تريد أن تفعل الآن؟",
              es: "✅ ¡Entendido! He archivado esa sesión. ¿Qué te gustaría hacer ahora?"
            };

            await WhatsAppService.sendMessage(from, ignoreMessages[responseLanguage] || ignoreMessages.en);
            return;
          } else {
            // Invalid choice - ask again
            typingController.stop();
            const clarificationMessages = {
              en: "I didn't quite understand. Please reply with *1*, *2*, or *3*:",
              ur: "میں سمجھ نہیں پائی۔ براہ کرم *1*، *2*، یا *3* سے جواب دیں:",
              ar: "لم أفهم تماماً. يرجى الرد بـ *1* أو *2* أو *3*:",
              es: "No entendí bien. Por favor responde con *1*, *2* o *3*:"
            };

            await WhatsAppService.sendMessage(from, clarificationMessages[responseLanguage] || clarificationMessages.en);
            return;
          }
        }
      }
    } catch (error) {
      logToFile('Error checking recovery prompt response', { error: error.message });
    }
  }

  // ============================================================
  // MENU SYSTEM INTEGRATION
  // ============================================================

  // Check for /menu command
  if (messageBody === '/menu' || messageBody.toLowerCase() === '/menu') {
    logToFile('📋 Menu command detected');
    typingController.stop();

    if (user && sessionId) {
      // no second store. The generic path above already stored this
      // message; storing it again put every `/menu` into history twice. In
      // production 2,302 of 3,253 consecutive `/menu` pairs landed under 2s apart
      // (~460ms), which also duplicated the turn in the AI's context window.
      await MenuService.sendMenu(from, user.id, sessionId);
    } else {
      const fallbackMsg = "Please complete registration first. Type /register to get started.";
      await WhatsAppService.sendMessage(from, fallbackMsg);
    }
    return; // Exit early
  }

  // Check for /register command
  if (messageBody === '/register' || messageBody.toLowerCase() === '/register') {
    logToFile('📝 Register command detected');
    typingController.stop();

    // Check if user is already registered (has first_name)
    if (user?.first_name) {
      await WhatsAppService.sendMessage(from, `✅ You're already registered, ${user.first_name}! What would you like to do next?`);
      return;
    }

    // bd-2447: conversational/deferred registration is DEPRECATED (matches the
    // main Rumi bot). /register ALWAYS opens the registration Flow when one is
    // configured — regardless of feature count, registration_pending_name, or
    // any onboarding gate, and even when the users row doesn't exist yet.
    // The legacy recovery/guide paths below only remain as fallbacks for
    // deployments with no REGISTRATION_FLOW_ID (or a failed Flow send).
    const REGISTRATION_FLOW_ID = process.env.REGISTRATION_FLOW_ID || '';
    if (REGISTRATION_FLOW_ID) {
      try {
        await WhatsAppService.sendFlow(from, {
          flowId: REGISTRATION_FLOW_ID,
          flowToken: user?.id || from,
          header: 'Welcome',
          body: 'Quick setup — tell us a little about you.',
          footer: 'Powered by NIETE',
          buttonText: 'Get started',
        });
        logToFile('📝 Registration flow sent from /register command', { userId: user?.id, phoneNumber: from });
        return;
      } catch (error) {
        logToFile('⚠️ Registration flow send failed from /register — falling back to legacy paths', {
          userId: user?.id,
          error: error.message,
        });
        // fall through to the legacy recovery/guide paths below
      }
    }

    // Check if user has features but missed registration (recovery path)
    // This handles users who used features but never got asked for name
    if (user?.id) {
      const featureCount = await FeatureRegistrationService.countUserFeatures(user.id);
      logToFile('📝 Checking feature count for recovery registration', {
        userId: user.id,
        featureCount,
        phoneNumber: from
      });

      if (featureCount > 0) {
        // User has features but never got registered - trigger recovery registration
        logToFile('📝 Triggering recovery registration for user with features', {
          userId: user.id,
          featureCount,
          phoneNumber: from
        });

        await FeatureRegistrationService.sendNameQuestion(
          user.id,
          from,
          responseLanguage,
          'text'
        );
        return;
      }
    }

    // New registration happens after first feature completion
    // Guide user to use a feature instead (only for users with 0 features)
    const guideMessages = {
      en: "I'll ask for your name after you try one of my features! You can:\n\n• Request a *lesson plan* - just tell me a topic\n• Start a *reading assessment* - type /reading test\n• Get *coaching feedback* - send me your classroom audio\n• Create a *video* - type /video\n\nWhat would you like to try?",
      ur: "میں آپ کا نام پوچھوں گی جب آپ میری کوئی feature استعمال کریں گے!\n\n• *لیسن پلان* کی درخواست کریں - بس موضوع بتائیں\n• *ریڈنگ ٹیسٹ* شروع کریں - /reading test ٹائپ کریں\n• *کوچنگ فیڈبیک* حاصل کریں - اپنی کلاس کی آڈیو بھیجیں\n• *ویڈیو* بنائیں - /video ٹائپ کریں\n\nآپ کیا آزمانا چاہیں گے؟"
    };

    await WhatsAppService.sendMessage(from, guideMessages[responseLanguage] || guideMessages.en);
    return; // Exit early
  }

  // Check for /language command (December 2025 - Language Expansion)
  if (messageBody === '/language' || messageBody.toLowerCase() === '/language') {
    logToFile('🌐 Language command detected');
    typingController.stop();

    // Check if user is in an active coaching session
    if (sessionId && user?.id) {
      const sessionType = await redisService.get(`session:${sessionId}:type`);
      if (sessionType === 'coaching' || sessionType === 'coaching_active') {
        // Block language change during coaching session
        const blockMessage = responseLanguage === 'ur'
          ? '⚠️ آپ ابھی کوچنگ سیشن میں ہیں۔ سیشن ختم ہونے کے بعد زبان تبدیل کر سکتے ہیں۔'
          : 'You can change language after the coaching session completes.';
        await WhatsAppService.sendMessage(from, blockMessage);
        return;
      }
    }

    // Send language selection interactive list
    await WhatsAppService.sendLanguageSelectionList(from, responseLanguage);
    return; // Exit early
  }

  // ============================================================
  // /settings COMMAND: Open the settings flow (language + observation framework)
  // ============================================================
  if (messageBody === '/settings' || messageBody.toLowerCase() === '/settings') {
    logToFile('⚙️ Settings command detected', { userId: user?.id, phoneNumber: from });
    typingController.stop();

    // Block settings change during an active coaching session
    if (sessionId && user?.id) {
      const sessionType = await redisService.get(`session:${sessionId}:type`);
      if (sessionType === 'coaching' || sessionType === 'coaching_active') {
        const blockMessage = ({
          ur: '⚠️ آپ ابھی کوچنگ سیشن میں ہیں۔ سیشن ختم ہونے کے بعد سیٹنگز تبدیل کر سکتے ہیں۔',
          sw: '⚠️ Uko katika kipindi cha kufundisha sasa. Unaweza kubadilisha mipangilio baada ya kipindi kukamilika.',
        })[responseLanguage] || 'You can change settings after the coaching session completes.';
        await WhatsAppService.sendMessage(from, blockMessage);
        return;
      }
    }

    const SETTINGS_FLOW_ID = process.env.SETTINGS_FLOW_ID || '';
    if (!SETTINGS_FLOW_ID) {
      await WhatsAppService.sendMessage(from, ({
        ur: 'سیٹنگز ابھی دستیاب نہیں ہیں۔ بعد میں دوبارہ کوشش کریں۔',
        sw: 'Mipangilio bado haijapatikana. Tafadhali jaribu tena baadaye.',
      })[responseLanguage] || 'Settings are not available yet. Please try again later.');
      return;
    }

    const flowToken = `${user?.id}:settings:${Date.now()}`;
    await WhatsAppService.sendFlow(from, {
      flowId: SETTINGS_FLOW_ID,
      header: 'NIETE Settings',
      body: ({
        ur: 'اپنی زبان اور آبزرویشن ٹول کی ترجیحات اپ ڈیٹ کریں۔',
        sw: 'Sasisha mapendeleo yako ya lugha na zana ya uchunguzi.',
      })[responseLanguage] || 'Update your language and observation tool preferences.',
      buttonText: ({
        ur: 'سیٹنگز کھولیں',
        sw: 'Fungua Mipangilio',
      })[responseLanguage] || 'Open Settings',
      flowToken
    });
    return;
  }

  // ============================================================
  // /classes COMMAND: view the classes you teach, and add a new one
  // ============================================================
  // The rule and its near misses live in class-command.js, with tests. Reported
  // from staging: `/classes` opened it and `/class` did not, which is the kind of
  // gap an inline regex accretes one alternative at a time.
  if (isClassesCommand(trimmedMessage)) {
    logToFile('🏫 /classes command detected', { userId: user?.id, phoneNumber: from });

    if (!user) {
      await WhatsAppService.sendMessage(from,
        'Sorry, I could not find your account. Please send me a message first.');
      typingController.stop();
      return;
    }

    if (!CLASS_MANAGER_FLOW_ID) {
      await WhatsAppService.sendMessage(from,
        'Classes are not available on this number yet. Please try again later.');
      typingController.stop();
      return;
    }

    // A class needs a school (classes.school_id is NOT NULL), and roughly one in
    // eight teachers has none on file. Opening a Flow that cannot succeed is the
    // dead-end pattern that has already cost this deployment once — so answer in
    // chat instead, and say what would fix it.
    const { data: schoolRow } = await supabase
      .from('users')
      .select('school_id')
      .eq('id', user.id)
      .maybeSingle();

    if (!schoolRow || !schoolRow.school_id) {
      logToFile('🏫 /classes: no school on file — answering in chat, not opening the Flow', {
        userId: user.id,
      });
      await WhatsAppService.sendMessage(from, resolveUx('classNoSchool', { user }));
      typingController.stop();
      return;
    }

    await WhatsAppService.sendFlow(from, {
      flowId: CLASS_MANAGER_FLOW_ID,
      header: resolveUx('classFlowHeader', { user }),
      body: resolveUx('classFlowBody', { user }),
      buttonText: resolveUx('classFlowButton', { user }),
      // The endpoint reads flow_token AS the user id — same convention as the
      // attendance Flows. Do not make this a composite token.
      flowToken: user.id,
    });
    typingController.stop();
    return;
  }

  // ============================================================
  // /status COMMAND: cross-feature snapshot of what's running + cancel
  // ============================================================
  if (/^\/status\b/i.test(trimmedMessage)) {
    logToFile('📋 /status command detected', { userId: user?.id, phoneNumber: from });
    if (!user) {
      await WhatsAppService.sendMessage(from,
        'Sorry, I could not find your account. Please send me a message first.');
      typingController.stop();
      return;
    }
    try {
      typingController.stop();
      const STATUS_FLOW_ID = process.env.STATUS_FLOW_ID || '';
      if (STATUS_FLOW_ID) {
        await WhatsAppService.sendFlow(from, {
          flowId: STATUS_FLOW_ID,
          flowToken: user.id,
          header: "What's running",
          body: "See everything you have in flight — and stop any of it.",
          footer: 'Powered by NIETE',
          buttonText: 'Open status'
        });
        logToFile('✅ Status flow sent', { userId: user.id });
      } else {
        // Fallback before STATUS_FLOW_ID is published — render a plain-text
        // summary inline so the command at least answers the question.
        const TeacherStateService = require('../services/teacher-state.service');
        const items = await TeacherStateService.listActiveResources(user.id);
        const summary = items.length === 0
          ? "Nothing's running right now."
          : `Running for you:\n${items.map(it => `• ${it.title}`).join('\n')}`;
        await WhatsAppService.sendMessage(from, summary);
      }
    } catch (error) {
      logToFile('❌ Error starting /status', { userId: user?.id, error: error.message });
    }
    return;
  }

  // ============================================================
  // HOMEWORK hot trigger — "homework" / "home work" / "hw" / "/homework".
  // Anchored so it never collides with the LP trigger. Presence-gated on
  // HOMEWORK_FLOW_ID; offers the homework request flow.
  // ============================================================
  {
    const HOMEWORK_FLOW_ID = process.env.HOMEWORK_FLOW_ID || '';
    const hwDecision = evaluateHomeworkTrigger({ messageBody, user, homeworkFlowId: HOMEWORK_FLOW_ID });
    if (hwDecision.match) {
      typingController.stop();
      if (hwDecision.action === 'send_flow' && user) {
        const flowToken = `${user.id}:homework:${Date.now()}`;
        await WhatsAppService.sendFlow(from, {
          flowId: HOMEWORK_FLOW_ID,
          header: 'Homework',
          body: ({
            ur: 'اپنی جماعت، مضمون اور وہ ابواب منتخب کریں جو آپ پڑھا چکے ہیں۔',
          })[responseLanguage] || 'Pick your class, subject and the chapters you have already taught.',
          buttonText: ({
            ur: 'ہوم ورک حاصل کریں',
          })[responseLanguage] || 'Get Homework',
          flowToken,
        });
        logToFile('📚 Homework flow offered (hot trigger)', { userId: user.id });
        return;
      }
      // Guard: unregistered user or flow id not configured.
      await WhatsAppService.sendMessage(from, ({
        ur: 'ہوم ورک فی الحال دستیاب نہیں ہے۔ براہ کرم بعد میں دوبارہ کوشش کریں۔',
      })[responseLanguage] || 'Homework is not available right now. Please try again later.');
      return;
    }
  }

  // ============================================================
  // ATTENDANCE — one keyword, routed by role.
  //
  // A principal marks teachers, a teacher marks students, and a principal who
  // also runs a class is ASKED. Everything the teacher sees is a Flow screen;
  // there is no typed-number step anywhere in this path.
  // ============================================================
  if (user?.id && AttendanceRouter.detect(messageBody).detected) {
    typingController.stop();
    try {
      const decision = await AttendanceRouter.route(user.id);
      logToFile('📋 Attendance routed', { userId: user.id, action: decision.action });

      switch (decision.action) {
        // bd-2726: one Flow, opened with the bare user id; it picks class, date
        // and method. MARK_* remain for taps on buttons already delivered.
        case 'OPEN_REGISTER':
        case 'MARK_TEACHERS':
        case 'MARK_STUDENTS':
          if (!ATTENDANCE_MARKING_FLOW_ID) {
            await WhatsAppService.sendMessage(from, 'Attendance is not available on this number yet. Please try again later.');
            break;
          }
          await WhatsAppService.sendFlow(from, {
            flowId: ATTENDANCE_MARKING_FLOW_ID,
            header: '📋 Attendance',
            body: decision.action === 'MARK_TEACHERS'
              ? "Mark your school's teachers for today."
              : 'Mark your class for today.',
            buttonText: 'Mark attendance',
            flowToken: decision.flowToken,
          });
          break;

        // /class owns class creation now (bd-2724). Same flowToken convention as
        // the /class command itself: the bare user id.
        case 'SEND_CLASS_MANAGER':
          if (!CLASS_MANAGER_FLOW_ID) {
            await WhatsAppService.sendMessage(from, `${decision.message} Send /class to set one up.`);
            break;
          }
          await WhatsAppService.sendFlow(from, {
            flowId: CLASS_MANAGER_FLOW_ID,
            header: '🏫 Your classes',
            body: decision.message,
            buttonText: 'Manage classes',
            flowToken: user.id,
          });
          break;

        case 'EMPTY_CLASS':
          if (!EDIT_CLASS_FLOW_ID) {
            await WhatsAppService.sendMessage(from, decision.message);
            break;
          }
          await WhatsAppService.sendFlow(from, {
            flowId: EDIT_CLASS_FLOW_ID,
            header: '📋 Add students',
            body: decision.message,
            buttonText: 'Add students',
            flowToken: `${user.id}:${decision.listId}`,
          });
          break;

        case 'ASK_SUBJECT':
        case 'ASK_CLASS_BUTTONS':
          await WhatsAppService.sendInteractiveButtons(from, {
            body: decision.message,
            buttons: decision.buttons,
          });
          break;

        case 'ASK_CLASS_LIST':
          await WhatsAppService.sendInteractiveMessage(from, {
            body: { text: decision.message },
            action: { button: 'Choose class', sections: [{ title: 'Your classes', rows: decision.rows }] },
          });
          if (decision.truncated) {
            await WhatsAppService.sendMessage(from, 'Showing your first 10 classes.');
          }
          break;

        case 'NO_SCHOOL':
        case 'ERROR':
        default:
          await WhatsAppService.sendMessage(from, decision.message || 'Sorry, something went wrong.');
          break;
      }
      return;
    } catch (error) {
      logToFile('Error routing attendance', { error: error.message, userId: user?.id });
      await WhatsAppService.sendMessage(from, 'Sorry, something went wrong with attendance. Please try again.');
      return;
    }
  }

  // ============================================================
  // REGISTRATION KEYWORD DETECTION
  // ============================================================
  const registrationKeywords = ['register', 'registration', 'sign up', 'رجسٹر', 'تسجيل', 'registrar'];
  const registrationRequested = registrationKeywords.some(kw =>
    messageBody.toLowerCase().includes(kw.toLowerCase())
  );

  if (registrationRequested) {
    typingController.stop();

    // Check if user is already registered
    if (user?.first_name) {
      // User already registered - confirm and guide to menu
      await WhatsAppService.sendMessage(from, `✅ You're already registered, ${user.first_name}! Type /menu to see what I can help you with.`);
      return;
    }

    // Check if user has features but missed registration (recovery path)
    if (user?.id) {
      const featureCount = await FeatureRegistrationService.countUserFeatures(user.id);

      if (featureCount > 0) {
        // User has features but never got registered - trigger recovery registration
        logToFile('📝 Recovery registration for user with features', {
          userId: user.id,
          featureCount,
          phoneNumber: from
        });

        await FeatureRegistrationService.sendNameQuestion(
          user.id,
          from,
          responseLanguage,
          'text'
        );
        return;
      }
    }

    // User has no features - guide them to use a feature first
    logToFile('🔐 User requested registration via keyword - guiding to features', { userId: user?.id, keyword: messageBody });

    const guideMessages = {
      en: "I'll ask for your name after you try one of my features! You can:\n\n• Request a *lesson plan* - just tell me a topic\n• Start a *reading assessment* - type /reading test\n• Get *coaching feedback* - send me your classroom audio\n• Create a *video* - type /video\n\nWhat would you like to try?",
      ur: "میں آپ کا نام پوچھوں گی جب آپ میری کوئی feature استعمال کریں گے!\n\n• *لیسن پلان* کی درخواست کریں - بس موضوع بتائیں\n• *ریڈنگ ٹیسٹ* شروع کریں - /reading test ٹائپ کریں\n• *کوچنگ فیڈبیک* حاصل کریں - اپنی کلاس کی آڈیو بھیجیں\n• *ویڈیو* بنائیں - /video ٹائپ کریں\n\nآپ کیا آزمانا چاہیں گے؟"
    };

    await WhatsAppService.sendMessage(from, guideMessages[responseLanguage] || guideMessages.en);
    return;
  }

  // ============================================================
  // CAPABILITY INQUIRY DETECTION
  // ⚠️ ADDING A NEW FEATURE? Update shared/config/capabilities.config.js
  // ============================================================
  try {
    const capabilityCheck = await HelperAgentService.detectCapabilityInquiry(
      messageBody,
      responseLanguage
    );

    if (capabilityCheck.detected) {
      typingController.stop();

      // Send capability guidance
      logToFile('💬 Capability inquiry detected, sending guidance', {
        userMessage: messageBody,
        language: responseLanguage
      });

      // store only the REPLY here. The inbound message was already stored
      // by the generic path above; storing it again is what put messages into
      // history (and the AI's context) twice.
      if (user && sessionId) {
        await WhatsAppService.sendMessage(from, capabilityCheck.guidanceMessage);
        await storeConversation(user.id, 'assistant', capabilityCheck.guidanceMessage, 'text', sessionId);
      } else {
        await WhatsAppService.sendMessage(from, capabilityCheck.guidanceMessage);
      }
      return; // Exit early
    }
  } catch (error) {
    logToFile('⚠️ Error in capability detection', {
      error: error.message,
      userMessage: messageBody
    });
    // Continue to normal flow if capability detection fails
  }

  // where is this teacher in a flow? ONE reader, shared with the voice
  // handler and the interactive-list router, so the three can no longer disagree.
  //
  // What this replaces: a read of `conversations.current_state` — the newest row of
  // the append-only MESSAGE LOG for this session. That read could never work, because
  // the incoming message is inserted into `conversations` further up this same
  // function, so "newest row" was always that message, whose current_state is null.
  // Production over 30 days: this read ran 10,127 times and every branch below it
  // fired exactly 0 times. It was dead code from the day it was written.
  //
  // It was also scoped by session_id, and chat_sessions rotate after 30 minutes
  // idle — so even with the ordering fixed it would have lost any teacher who
  // stepped away. The store is keyed on the teacher alone.
  let activeState = null;
  if (user) {
    activeState = await ConversationState.getState(user.id);
    logToFile('Conversation state retrieved', {
      flow: activeState?.flow || null,
      step: activeState?.step || null,
    });
  }
  const conversationState = activeState?.step || null;

  // Handle menu choice (1-4)
  if (conversationState === 'AWAITING_MENU_CHOICE' && user && sessionId) {
    const choice = messageBody.trim();
    if (['1', '2', '3', '4'].includes(choice)) {
      logToFile('📋 Menu choice detected', { choice });
      typingController.stop();

      await MenuService.handleMenuChoice(
        choice,
        user.id,
        sessionId,
        from,
        'text', // messageFormat
        responseLanguage
      );
      return; // Exit early
    } else {
      // Invalid menu choice - use Helper Agent to guide user
      logToFile('⚠️  Invalid menu choice', { choice: messageBody });
      typingController.stop();

      const escapeMessage = HelperAgentService.getEscapePathMessage('AWAITING_MENU_CHOICE', responseLanguage);
      await WhatsAppService.sendMessage(from, escapeMessage);
      return; // Don't fall through to intent detection
    }
  }

  // Handle AWAITING_CLASSROOM_AUDIO state (user sent text instead of audio)
  if (conversationState === 'AWAITING_CLASSROOM_AUDIO' && user && sessionId) {
    // Check for /menu escape command
    if (messageBody.toLowerCase() === '/menu') {
      logToFile('📋 User requesting menu from classroom audio state');
      typingController.stop();
      await MenuService.sendMenu(from, user.id, sessionId);
      return;
    }

    // User sent text when we're expecting audio - provide helpful guidance
    logToFile('⚠️  User sent text while awaiting classroom audio');
    typingController.stop();

    const escapeMessage = HelperAgentService.getEscapePathMessage('AWAITING_CLASSROOM_AUDIO', responseLanguage);
    await WhatsAppService.sendMessage(from, escapeMessage);
    return; // Don't process text as general conversation
  }

  // Handle video topic request (Issue #28: Route to AI Video Generation)
  // Support both old state name (AWAITING_MEDIA_LIBRARY_QUERY) and new (AWAITING_VIDEO_TOPIC) for transition
  if ((conversationState === 'AWAITING_VIDEO_TOPIC' || conversationState === 'AWAITING_MEDIA_LIBRARY_QUERY') && user && sessionId) {
    // Check for /menu escape command
    if (messageBody.toLowerCase() === '/menu') {
      logToFile('📋 User requesting menu from video topic state');
      typingController.stop();
      await MenuService.sendMenu(from, user.id, sessionId);
      return;
    }

    logToFile('🎬 Video topic received - routing to AI video generation');
    typingController.stop();

    // Route to AI video generation with user's topic
    await VideoOrchestrator.initiateVideoRequest(user, from, sessionId, responseLanguage, messageBody.trim());

    // clear the state we actually read.
    // This used to write `chat_sessions.conversation_state`, while the read above
    // came from `conversations.current_state` — a different table entirely. The
    // clear was therefore a no-op, and state was never really cleared: it only
    // stopped being visible once the next row landed in the message log.
    // Flow-scoped, so finishing video cannot wipe a coaching session.
    await ConversationState.clearState(user.id, { flow: 'video' });

    return; // Exit early
  }

  // ============================================================
  // INTEGRATION POINT 3: KEYWORD DETECTION FOR FEATURE VIDEOS
  // Check if message contains feature keywords and offer intro video
  // This happens BEFORE intent detection to catch general questions
  // ============================================================
  if (user) {
    try {
      const FeatureKeywordDetectorService = require('../services/feature-keyword-detector.service');
      const keywordHandled = await FeatureKeywordDetectorService.detectAndOfferVideo(
        messageBody,
        user.id,
        from,
        responseLanguage
      );

      if (keywordHandled) {
        logToFile('🎯 Keyword detection handled - stopping normal flow', { userId: user.id });
        return; // Stop processing - consent buttons were sent
      }
    } catch (error) {
      logToFile('⚠️ Error in keyword detection (non-blocking)', { error: error.message });
      // Continue with normal flow on error
    }
  }

  // ============================================================
  // VIDEO GENERATION NATURAL LANGUAGE DETECTION (All 9 Languages)
  // Detects "make me a video", "create video", etc. in supported languages
  // MUST come BEFORE intent detection to differentiate from video search
  // ============================================================
  if (user) {
    const videoGenerationKeywords = [
      // English
      'make me a video', 'create a video', 'generate video', 'generate a video',
      'make video about', 'make a video about', 'create video about',
      // Urdu
      'ویڈیو بناؤ', 'ویڈیو بنا دو', 'mujhe video', 'ویڈیو چاہیے', 'video bana do',
      'video banao', 'mujhe video bana do', 'meri video bana do',
      // Arabic
      'أنشئ فيديو', 'اصنع فيديو', 'اعمل فيديو', 'فيديو عن',
      // Spanish
      'hacer un video', 'crear video', 'generar video', 'hazme un video',
      'crea un video', 'haz un video sobre',
      // Punjabi
      'ویڈیو بنا', 'ویڈیو بناؤ جی', 'video bana ji',
      // Sindhi
      'وڊيو ٺاھيو', 'وڊيو بڻايو',
      // Pashto
      'ویډیو جوړه کړه', 'ویډیو جوړ کړه',
      // Balochi
      'ویڈیو بناء',
      // Tamil
      'வீடியோ உருவாக்கு', 'வீடியோ செய்'
    ];

    const messageBodyLower = messageBody.toLowerCase();
    const videoGenerationRequested = videoGenerationKeywords.some(kw =>
      messageBodyLower.includes(kw.toLowerCase())
    );

    if (videoGenerationRequested) {
      logToFile('🎬 Video GENERATION request detected via natural language', {
        userId: user.id,
        message: messageBody.substring(0, 100)
      });

      typingController.stop();

      // Extract topic from message using GPT
      const topic = await VideoOrchestrator.extractTopicFromMessage(messageBody, responseLanguage);

      await VideoOrchestrator.initiateVideoRequest(user, from, sessionId, responseLanguage, topic);
      return; // Stop further processing
    }
  }

  // ============================================================
  // Issue #57 FIX: CHECK LESSON PLAN STATE FROM MENU
  // If user clicked "Lesson Planning" from menu, their next message
  // is the topic - route directly to lesson plan, skip intent detection
  // ============================================================
  if (user) {
    const MenuService = require('../services/menu.service');
    const lessonPlanState = await MenuService.checkAwaitingLessonPlanTopic(user.id);

    if (lessonPlanState) {
      logToFile('📚 User provided lesson plan topic from menu', {
        userId: user.id,
        topic: messageBody,
        sessionId: lessonPlanState.sessionId
      });

      typingController.stop();

      // Clear the state
      await MenuService.clearAwaitingLessonPlanTopic(user.id);

      // Curriculum pre-gen intercept (no-op unless the region enables it)
      if (await tryCurriculumLessonPlanServe(from, messageBody, user, lessonPlanState.language)) {
        return; // curriculum pre-generated LP served instantly
      }

      // Route directly to lesson plan handler (skip intent detection)
      await handleLessonPlanRequest(from, messageBody, user, lessonPlanState.sessionId, lessonPlanState.language, typingController);
      return; // Stop further processing
    }
  }

  // ============================================================
  // CURRICULUM LP EARLY INTERCEPT
  // If the message parses as a curriculum-LP request (grade + subject + topic
  // that resolves to an AST row) we serve it BEFORE the intent classifier.
  // Rationale: the classifier is a semantic-meaning LLM that sometimes tags
  // "grade 1 math number buddies" (a bare topic string with no verb) as
  // `general` — bypassing the LP handler and letting the generic AI helper
  // hallucinate an inline plaintext LP. High-confidence keyword-based
  // intercept + AST match is much more reliable than the LLM's judgment on
  // short topic strings. False-positive risk is bounded — tryCurriculumLessonPlanServe
  // returns false unless grade AND subject AND findByTopic all resolve.
  // Language: passed as null so the intercept picks up the message's actual
  // language (via detectRequestedLanguage), not user.preferred_language.
  // ============================================================
  if (user) {
    try {
      typingController.stop();
      if (await tryCurriculumLessonPlanServe(from, messageBody, user, null)) {
        return; // AST-based LP served (or queued); handled.
      }
    } catch (interceptErr) {
      logToFile('Curriculum LP early intercept threw (non-fatal)', { error: interceptErr.message });
    }
  }

  // Detect intent (lesson plan, presentation, or general)
  const intent = await OpenAIService.detectIntent(messageBody);
  logToFile('Intent detected', { intent: intent.type });

  // Update session type based on intent
  if (sessionId && intent.type !== 'general') {
    try {
      await updateSessionType(sessionId, intent.type);
      logToFile('✅ Session type updated', { sessionType: intent.type });
    } catch (error) {
      logToFile('⚠️ Failed to update session type', { error: error.message });
    }
  }

  if (intent.type === 'lesson_plan') {
    // Curriculum pre-gen intercept (no-op unless the region enables it)
    if (await tryCurriculumLessonPlanServe(from, messageBody, user, responseLanguage)) {
      return; // curriculum pre-generated LP served instantly
    }
    await handleLessonPlanRequest(from, messageBody, user, sessionId, responseLanguage, typingController);
  } else if (intent.type === 'presentation') {
    await handlePresentationRequest(from, messageBody, user, sessionId, responseLanguage, typingController);
  } else if (intent.type === 'video') {
    // Route to AI video generation (same as /video command) - Issue #28
    typingController.stop();
    const topic = await VideoOrchestrator.extractTopicFromMessage(messageBody, responseLanguage);
    await VideoOrchestrator.initiateVideoRequest(user, from, sessionId, responseLanguage, topic);
  } else {
    await handleGeneralConversation(from, messageBody, user, sessionId, responseLanguage, typingController);
  }
  } finally {
    // CRITICAL: Always stop typing indicator, even if function exits early or throws
    typingController.stop();
  }
}

/**
 * Handle lesson plan request
 * @param {string} from - Sender phone number
 * @param {string} messageBody - Message text
 * @param {Object|null} user - User object from database
 * @param {string|null} sessionId - Session ID
 * @param {string} responseLanguage - User's preferred language ('en', 'ur', 'ar', 'es')
 * @param {Object} typingController - Typing indicator controller
 * @returns {Promise<void>}
 */
async function handleLessonPlanRequest(from, messageBody, user, sessionId, responseLanguage, typingController) {
  // bd-2540 (Option A partial Gamma strip): freeform LP generation is retired.
  // A teacher who reaches this handler either (a) typed an LP request that did
  // not match any AST catalog row, or (b) came via the Oxbridge-picker "Generate
  // NIETE LP" tap for a chapter the picker did not resolve to a catalog row.
  // Both cases now reply "not in catalog" instead of enqueuing a Gamma render.
  typingController.stop();
  const notInCatalogMessages = {
    en: "We don't have that lesson plan in the catalog yet. Send \"menu\" to see what's available.",
    ur: '\u06CC\u06C1 \u0633\u0628\u0642 \u0627\u0628\u06BE\u06CC \u06C1\u0645\u0627\u0631\u06D2 \u0646\u0635\u0627\u0628\u06CC \u0645\u062C\u0645\u0648\u0639\u06D2 \u0645\u06CC\u06BA \u062F\u0633\u062A\u06CC\u0627\u0628 \u0646\u06C1\u06CC\u06BA\u06D4 \u062F\u0633\u062A\u06CC\u0627\u0628 \u0633\u0628\u0642 \u062F\u06CC\u06A9\u06BE\u0646\u06D2 \u06A9\u06D2 \u0644\u06CC\u06D2 "menu" \u0644\u06A9\u06BE\u06CC\u06BA\u06D4',
    ar: "\u0644\u064A\u0633 \u0644\u062F\u064A\u0646\u0627 \u0647\u0630\u0647 \u0627\u0644\u062E\u0637\u0629 \u0641\u064A \u0627\u0644\u0641\u0647\u0631\u0633 \u0628\u0639\u062F. \u0623\u0631\u0633\u0644 \"menu\" \u0644\u0631\u0624\u064A\u0629 \u0645\u0627 \u0647\u0648 \u0645\u062A\u0627\u062D.",
    es: 'No tenemos ese plan de lecci\u00F3n en el cat\u00E1logo todav\u00EDa. Env\u00EDa "menu" para ver lo que est\u00E1 disponible.',
  };
  const msg = notInCatalogMessages[responseLanguage] || notInCatalogMessages.en;
  await WhatsAppService.sendMessage(from, msg);
  if (user) {
    try {
      await storeConversation(user.id, 'assistant', msg, 'text', sessionId);
    } catch (error) {
      logToFile('\u26A0\uFE0F Failed to store not-in-catalog reply', { error: error.message });
    }
  }
  logToFile('\ud83d\udcd6 Freeform LP request \u2192 replied not-in-catalog (bd-2540)', {
    from, userId: user?.id, topicHint: (messageBody || '').substring(0, 60),
  });
}

/**
 * Handle presentation request
 * @param {string} from - Sender phone number
 * @param {string} messageBody - Message text
 * @param {Object|null} user - User object from database
 * @param {string|null} sessionId - Session ID
 * @param {string} responseLanguage - User's preferred language ('en', 'ur', 'ar', 'es')
 * @param {Object} typingController - Typing indicator controller
 * @returns {Promise<void>}
 */
async function handlePresentationRequest(from, messageBody, user, sessionId, responseLanguage, typingController) {
  // bd-2540: freeform presentation generation via Gamma is retired.
  typingController.stop();
  const notSupportedMessages = {
    en: 'Presentation generation is currently unavailable. For lesson plans, send "menu" to see what\'s in the catalog.',
    ur: '\u067E\u0631\u06CC\u0632\u0646\u0679\u06CC\u0634\u0646 \u0641\u06CC \u0627\u0644\u062D\u0627\u0644 \u062F\u0633\u062A\u06CC\u0627\u0628 \u0646\u06C1\u06CC\u06BA \u06C1\u06CC\u06BA\u06D4 \u0633\u0628\u0642 \u062F\u06CC\u06A9\u06BE\u0646\u06D2 \u06A9\u06D2 \u0644\u06CC\u06D2 "menu" \u0644\u06A9\u06BE\u06CC\u06BA\u06D4',
    ar: '\u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0639\u0631\u0648\u0636 \u0627\u0644\u062A\u0642\u062F\u064A\u0645\u064A\u0629 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u062D\u0627\u0644\u064A\u064B\u0627. \u0623\u0631\u0633\u0644 \"menu\" \u0644\u0644\u062E\u0637\u0637.',
    es: 'La generaci\u00F3n de presentaciones no est\u00E1 disponible por ahora. Para planes de lecci\u00F3n, env\u00EDa "menu".',
  };
  const msg = notSupportedMessages[responseLanguage] || notSupportedMessages.en;
  await WhatsAppService.sendMessage(from, msg);
  if (user) {
    try {
      await storeConversation(user.id, 'assistant', msg, 'text', sessionId);
    } catch (error) {
      logToFile('\u26A0\uFE0F Failed to store not-supported reply', { error: error.message });
    }
  }
  logToFile('\ud83d\udcca Freeform presentation request \u2192 replied not-supported (bd-2540)', {
    from, userId: user?.id,
  });
}

/**
 * Handle general conversation
 * @param {string} from - Sender phone number
 * @param {string} messageBody - Message text
 * @param {Object|null} user - User object from database
 * @param {string|null} sessionId - Session ID
 * @param {string} responseLanguage - User's preferred language ('en', 'ur', 'ar', 'es')
 * @param {Object} typingController - Typing indicator controller
 * @returns {Promise<void>}
 */
async function handleGeneralConversation(from, messageBody, user, sessionId, responseLanguage, typingController) {
  // Get firstName from user if registered
  const firstName = user?.first_name || null;

  // Phase 2: Conditional Feature Context Injection
  let featureContext = null;
  if (user) {
    const contextCheck = ContextService.shouldInjectContext(messageBody);
    if (contextCheck.shouldInject) {
      logToFile('Phase 2: Context injection triggered', { featureType: contextCheck.featureType, mode: contextCheck.mode });
      featureContext = await ContextService.getUserFeatureContext(user.id, messageBody, contextCheck.mode);
      if (featureContext) {
        logToFile('Phase 2: Feature context retrieved', { contextLength: featureContext.length });
      }
    }
  }

  // Get AI response with format-aware prompting (text format, detected language)
  const aiResponse = await OpenAIService.getResponseWithFormat(
    messageBody,
    user.id, // Use UUID, not phone number - for DB conversation history
    'text', // outputFormat: always text for text messages
    responseLanguage, // outputLanguage: use user's preferred language
    firstName, // firstName: for personalization
    featureContext // Phase 2: Feature context for past work references
  );
  logToFile('AI response generated (format-aware)', { response: aiResponse, language: responseLanguage, firstName });

  // Did the model answer in the language we asked for? Checked BEFORE the send, so
  // drift is a counted event rather than a teacher's screenshot. Advisory only —
  // we still deliver, because a checker that suppresses a reply is worse than the
  // drift it was added to catch.
  const langCheck = verifyOutputLanguage(aiResponse, responseLanguage);
  if (!langCheck.ok) {
    logToFile('🈯 language_drift: chat reply', {
      surface: 'chat_text',
      expected: langCheck.expected,
      detected: langCheck.detected,
      reason: langCheck.reason,
      userId: user?.id,
      level: 'error'
    });
  }

  // Stop typing indicator before sending reply
  typingController.stop();

  // Send reply
  await WhatsAppService.sendMessage(from, aiResponse);
  logToFile('Text response sent successfully');

  // Store bot response in database with session
  if (user && sessionId) {
    try {
      await storeConversation(
        user.id,
        'assistant',
        aiResponse,
        'text',
        sessionId,
        null, // inputFormat (not applicable for assistant messages)
        null, // inputLanguage (not applicable for assistant messages)
        'text', // outputFormat
        responseLanguage // outputLanguage
      );
      logToFile('✅ Bot response stored in database with session and language');
    } catch (error) {
      logToFile('⚠️ Failed to store bot response', { error: error.message });
    }

    // Show stuck session reminder (non-blocking) if applicable
    await showStuckSessionReminder(from, user.id, responseLanguage);
  }
}

// handleVideoRequest() REMOVED - Issue #28: AI Video Generation replaces Media Library
// Video requests now route to VideoOrchestrator.initiateVideoRequest() in intent handling

// checkAndTriggerRegistration() REMOVED - Feature-based registration replaces turn-based
// Registration now triggers after first feature completion via FeatureRegistrationService

/**
 * Show non-blocking stuck session reminder AFTER user's current request completes
 * Part of pause-and-resume architecture
 *
 * @param {string} from - Sender phone number
 * @param {string} userId - User ID
 * @param {string} language - User's language preference
 * @returns {Promise<void>}
 */
async function showStuckSessionReminder(from, userId, language) {
  try {
    const reminderKey = `user:${userId}:stuck:reminder`;
    const reminderData = await redis.get(reminderKey);

    if (reminderData) {
      const reminder = JSON.parse(reminderData);
      const reminderAge = (new Date() - new Date(reminder.detectedAt)) / (1000 * 60);

      // Only show reminder once, and only if detected within last 24 hours
      if (reminderAge < 1440) { // 24 hours
        await redis.del(reminderKey); // Show once only

        const reminderMessages = {
          en: "📝 By the way, you have an unfinished coaching session from earlier. Would you like to:\n" +
              "1️⃣ Complete it\n" +
              "2️⃣ Start fresh\n" +
              "3️⃣ Ignore (I'll archive it)\n\n" +
              "Reply with 1, 2, or 3",
          ur: "📝 ویسے، آپ کا ایک نامکمل کوچنگ سیشن ہے۔ کیا آپ:\n" +
              "1️⃣ اسے مکمل کرنا چاہتے ہیں\n" +
              "2️⃣ نیا شروع کرنا چاہتے ہیں\n" +
              "3️⃣ نظر انداز کریں (میں اسے آرکائیو کر دوں گی)\n\n" +
              "1، 2، یا 3 سے جواب دیں",
          ar: "📝 بالمناسبة، لديك جلسة تدريب غير مكتملة من وقت سابق. هل تريد:\n" +
              "1️⃣ إكمالها\n" +
              "2️⃣ البدء من جديد\n" +
              "3️⃣ تجاهلها (سأقوم بأرشفتها)\n\n" +
              "رد بـ 1 أو 2 أو 3",
          es: "📝 Por cierto, tienes una sesión de coaching sin terminar. ¿Te gustaría:\n" +
              "1️⃣ Completarla\n" +
              "2️⃣ Empezar de nuevo\n" +
              "3️⃣ Ignorarla (la archivaré)\n\n" +
              "Responde con 1, 2 o 3"
        };

        await WhatsAppService.sendMessage(from, reminderMessages[language] || reminderMessages.en);

        // Set a flag to expect recovery response on NEXT message
        await redis.setex(`user:${userId}:expecting:recovery`, 300, reminder.sessionId); // 5 min expiry

        logToFile('📬 Stuck session reminder sent', {
          userId,
          sessionId: reminder.sessionId,
          language
        });
      }
    }
  } catch (error) {
    logToFile('⚠️ Error showing stuck session reminder', {
      userId,
      error: error.message
    });
  }
}

/**
 * Parse style from carousel button ID
 * Issue #35: Video Style Selection
 * @param {string} buttonId - Button ID like "style_photorealistic"
 * @returns {string} Style name (photorealistic, infographic, cartoon, sketch)
 */
function parseStyleFromButtonId(buttonId) {
  if (!buttonId || typeof buttonId !== 'string') {
    return 'infographic'; // Default
  }

  const validStyles = ['photorealistic', 'infographic', 'cartoon', 'sketch'];
  const stylePart = buttonId.replace('style_', '').toLowerCase();

  if (validStyles.includes(stylePart)) {
    return stylePart;
  }

  return 'infographic'; // Default for invalid IDs
}

module.exports = {
  handleTextMessage,
  parseStyleFromButtonId,
  evaluateHomeworkTrigger, // exported for trigger unit tests
  tryCurriculumLessonPlanServe, // exported for intercept unit tests
  handleLessonPlanRequest, // exported for the Oxbridge-picker "Generate NIETE LP" tap
  isSelectVideoButton, // video-library broadcast "Select Video" button
  isVideoCommand, // exported for unit tests
  tryChildVideoMenu, // exported for unit tests
};
