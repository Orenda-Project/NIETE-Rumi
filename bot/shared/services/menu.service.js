const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const WhatsAppService = require('./whatsapp.service');
const { getClient } = require('./llm-client');
const { OPENAI_API_KEY } = require('../utils/constants');
const { storeConversation, getOrCreateSession } = require('../database/bot-helpers');
const ConversationState = require('./conversation-state.service');
const redisService = require('./cache/railway-redis.service');
// CoachingService not used in this file - removed legacy import
// MediaLibraryService removed - Issue #28: AI Video Generation replaces Media Library
const LessonPlanningService = require('./lesson-planning.service');

const openai = getClient();

// Menu selection state TTL (5 minutes)
const MENU_STATE_TTL = 300;

/**
 * Menu Service
 * Handles the /menu command and routes to appropriate services
 */
class MenuService {
  /**
   * Send menu to user using feature carousel with intro videos
   * Falls back to interactive list if carousel template not approved
   * @param {string} from - User's WhatsApp phone number
   * @param {string} userId - User's UUID
   * @param {string} sessionId - Current session ID
   * @param {string} language - User's language code (default: 'en')
   */
  static async sendMenu(from, userId, sessionId, language = 'en') {
    try {
      logToFile('Sending feature menu carousel', { from, userId, language });

      // Store state in Redis for button handling
      const stateKey = `user:${userId}:awaiting_menu_selection`;
      const stateData = {
        sessionId,
        from,
        language,
        askedAt: new Date().toISOString()
      };
      await redisService.set(stateKey, stateData, MENU_STATE_TTL);

      // Send carousel (falls back to list if template not approved)
      const success = await WhatsAppService.sendFeatureMenuCarousel(from);

      if (success) {
        // Store bot response in conversation history
        await storeConversation(userId, 'assistant', '[Feature Menu Sent]', 'interactive', sessionId);

        // Update conversation state to await menu choice
        await this._updateConversationState(userId, sessionId, {
          current_state: 'AWAITING_MENU_CHOICE',
          menu_sent_at: new Date().toISOString()
        });

        logToFile('✅ Feature menu sent successfully', { from });
      } else {
        // If both carousel and fallback failed, send simple text
        await this._sendTextMenuFallback(from, userId, sessionId, language);
      }
    } catch (error) {
      logToFile('❌ Error sending menu', {
        error: error.message,
        from
      });
      // Ultimate fallback to simple text menu
      await this._sendTextMenuFallback(from, userId, sessionId, language);
    }
  }

  /**
   * Handle carousel/list button response
   * Called from whatsapp-bot.js when user taps a menu button
   * @param {Object} user - User object with id
   * @param {string} from - User's phone number
   * @param {string} buttonId - Button ID (menu_lesson_plan, menu_coaching, etc.)
   * @param {string} language - User's language
   */
  static async handleMenuButtonResponse(user, from, buttonId, language = 'en') {
    try {
      // the tap IS the intent. `menu_lesson_plan` says exactly what she
      // wants, so this method must never refuse to act for want of stored state.
      //
      // It used to: a 5-minute Redis key held {sessionId, from, language, askedAt}
      // — every field recomputable — and when it had expired the handler replied
      // "That menu selection has expired. Type /menu to see options again." and
      // returned, discarding the intent to enforce a gate that guarded nothing.
      // Production, 14 days: 1,146 taps dead-ended that way across 745 teachers,
      // 20% of all 5,677 menu taps.
      //
      // State is now CONTEXT, never PERMISSION. The only thing it carried that the
      // handler genuinely needs is a session id, and that is derivable.
      const stateKey = `user:${user.id}:awaiting_menu_selection`;
      const state = await redisService.get(stateKey);

      if (state) {
        await redisService.delete(stateKey); // consume it; a tap is answered once
      }

      // Recompute rather than refuse. getOrCreateSession returns the teacher's
      // current session, creating one if the old one has rotated — which is the
      // normal case for a teacher returning after a break.
      const sessionId = state?.sessionId || (await getOrCreateSession(user.id));

      logToFile('Handling menu button response', {
        userId: user.id,
        buttonId,
        sessionId,
        hadStoredState: Boolean(state), // watch this ratio; it is the old dead-end rate
      });

      // Route to appropriate handler based on button ID
      switch (buttonId) {
        // the training menu entry. Delegates to the same Flow the
        // /training command opens, so there is one entry point, not two.
        case 'menu_training': {
          const TrainingEntry = require('./training/training-entry.service');
          await TrainingEntry.openTrainingFlow(user, from, language);
          break;
        }

        case 'menu_lesson_plan':
          await this._handleLessonPlanningChoice(user.id, sessionId, from, language);
          break;

        case 'menu_coaching':
          await this._handleClassroomCoachingChoice(user.id, sessionId, from, language);
          break;

        case 'menu_reading':
          // /009 FIX: Use WhatsApp Flow (same as /reading test command)
          // Old ReadingAssessmentService.initiateAssessment() didn't ask for student name
          // WhatsApp Flow collects all info in proper multi-screen form
          const FeatureIntroService = require('./feature-intro.service');

          // Send intro video if first use
          await FeatureIntroService.sendFirstUseIntroIfNeeded(
            user.id,
            from,
            'reading',
            language
          );

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
            logToFile('✅ Reading assessment flow sent from menu', { userId: user.id });
            await FeatureIntroService.markFeatureUsed(user.id, 'reading');
          } else {
            throw new Error('Failed to send WhatsApp Flow from menu');
          }
          break;

        case 'menu_video':
          // Trigger video generation flow
          await this._handleMediaLibraryChoice(user.id, sessionId, from, language);
          break;

        case 'menu_other':
          await this._handleOtherChoice(user.id, sessionId, from, language);
          break;

        default:
          logToFile('Unknown menu button ID', { buttonId });
          await WhatsAppService.sendMessage(from, "I didn't recognize that option. Type /menu to try again.");
      }
    } catch (error) {
      logToFile('❌ Error handling menu button response', {
        error: error.message,
        buttonId,
        userId: user?.id
      });
      await WhatsAppService.sendMessage(from, "Something went wrong. Please type /menu to try again.");
    }
  }

  /**
   * Check if user is awaiting menu selection
   * @param {string} userId - User's UUID
   * @returns {Promise<Object|null>} State data or null
   */
  static async checkAwaitingMenuSelection(userId) {
    const stateKey = `user:${userId}:awaiting_menu_selection`;
    return await redisService.get(stateKey);
  }

  /**
   * Ultimate fallback: Simple text menu (9 languages)
   * @private
   */
  static async _sendTextMenuFallback(from, userId, sessionId, language) {
    // Menu messages in all 9 supported languages
    const menuMessages = {
      en: "Hi! I'm your NIETE Teaching Assistant!\n\nI can help you with:\n📚 Lesson Plans & Presentations\n🎓 Classroom Coaching\n📖 Reading Assessments\n🎬 AI Video Creation\n\nJust tell me what you need!",
      ur: "السلام علیکم! میں NIETE ہوں، آپ کی ٹیچنگ اسسٹنٹ!\n\nمیں آپ کی مدد کر سکتی ہوں:\n📚 لیسن پلانز اور پریزنٹیشنز\n🎓 کلاس روم کوچنگ\n📖 ریڈنگ ٹیسٹ\n🎬 AI ویڈیوز\n\nبتائیں، کیا چاہیے؟",
      ar: "مرحباً! أنا رومي، مساعدتك التعليمية!\n\nيمكنني مساعدتك في:\n📚 خطط الدروس والعروض التقديمية\n🎓 التدريب الصفي\n📖 تقييم القراءة\n🎬 إنشاء فيديو بالذكاء الاصطناعي\n\nأخبرني بما تحتاج!",
      es: "¡Hola! Soy tu Asistente de Enseñanza de NIETE.\n\nPuedo ayudarte con:\n📚 Planes de Lección y Presentaciones\n🎓 Coaching de Aula\n📖 Evaluación de Lectura\n🎬 Creación de Videos con IA\n\n¡Dime qué necesitas!",
      'bal-PK': "سلام! من NIETE آں، شما ءِ تدریسی معاون!\n\nمن شما ءِ کمک کن کیا:\n📚 سبق ءِ منصوبہ\n🎓 کلاس روم کوچنگ\n📖 پڑھائی ءِ ٹیسٹ\n🎬 AI ویڈیو\n\nبگوشیت چہ چیز چاہیت؟",
      'sd-PK': "سلام! مان رومي آهيان، توهان جي تدريسي معاون!\n\nمان توهان جي مدد ڪري سگهان ٿي:\n📚 سبق جو منصوبو\n🎓 ڪلاس روم ڪوچنگ\n📖 پڙهائي جو ٽيسٽ\n🎬 AI ويڊيو\n\nٻڌايو، ڇا گهرجي؟",
      'ps-PK': "سلام! زه رومي یم، ستاسو د تدریس معاون!\n\nزه تاسو سره مرسته کولی شم:\n📚 د درس پلان\n🎓 صنفي کوچنګ\n📖 د لوستلو ازموینه\n🎬 AI ویډیو\n\nراته ووایئ څه غواړئ!",
      'pa-PK': "سلام! میں NIETE آں، تہاڈی ٹیچنگ اسسٹنٹ!\n\nمیں تہاڈی مدد کر سکدی آں:\n📚 سبق دے منصوبے\n🎓 کلاس روم کوچنگ\n📖 پڑھائی دا ٹیسٹ\n🎬 AI ویڈیو\n\nدسو، کی چاہیدا اے؟",
      'ta-LK': "வணக்கம்! நான் ரூமி, உங்கள் கற்பித்தல் உதவியாளர்!\n\nநான் உங்களுக்கு உதவ முடியும்:\n📚 பாட திட்டங்கள்\n🎓 வகுப்பறை பயிற்சி\n📖 வாசிப்பு மதிப்பீடு\n🎬 AI வீடியோ\n\nஎன்ன வேண்டும் என்று சொல்லுங்கள்!"
    };

    // Get message in user's language, fallback to English
    const fallbackMenu = menuMessages[language] || menuMessages.en;

    await WhatsAppService.sendMessage(from, fallbackMenu);
    await storeConversation(userId, 'assistant', fallbackMenu, 'text', sessionId);
    logToFile('Sent text menu fallback', { from, language });
  }

  /**
   * Handle user's menu choice (1-4)
   * @param {string} choice - User's choice (1, 2, 3, or 4)
   * @param {string} userId - User's UUID
   * @param {string} sessionId - Current session ID
   * @param {string} from - User's WhatsApp phone number
   * @param {string} messageFormat - 'text' or 'voice'
   * @param {string} language - User's language
   */
  static async handleMenuChoice(choice, userId, sessionId, from, messageFormat, language) {
    try {
      logToFile('Handling menu choice', { choice, userId, from });

      const choiceNum = parseInt(choice);

      if (![1, 2, 3, 4].includes(choiceNum)) {
        await WhatsAppService.sendMessage(from, "Please choose a valid option (1-4).");
        return;
      }

      switch (choiceNum) {
        case 1:
          // Classroom Coaching
          await this._handleClassroomCoachingChoice(userId, sessionId, from, language);
          break;

        case 2:
          // Lesson Planning/Presentation
          await this._handleLessonPlanningChoice(userId, sessionId, from, language);
          break;

        case 3:
          // Media Library
          await this._handleMediaLibraryChoice(userId, sessionId, from, language);
          break;

        case 4:
          // Other - General AI assistance
          await this._handleOtherChoice(userId, sessionId, from, language);
          break;
      }

      logToFile('✅ Menu choice handled successfully', { choice, from });
    } catch (error) {
      logToFile('❌ Error handling menu choice', {
        error: error.message,
        choice,
        from
      });
      throw error;
    }
  }

  /**
   * Handle Classroom Coaching choice
   * @private
   */
  static async _handleClassroomCoachingChoice(userId, sessionId, from, language) {
    const message = language === 'ur'
      ? 'بہترین! اپنے کلاس روم کی آڈیو ریکارڈنگ بھیجیں تاکہ میں تدریسی تجزیہ شروع کر سکوں۔\n\nآڈیو فائل 15 منٹ سے زیادہ ہونی چاہیے۔'
      : "Great! Please upload your classroom recording audio to get started with pedagogical analysis.\n\nThe audio should be at least 15 minutes long.";

    await WhatsAppService.sendMessage(from, message);

    // Update state to await classroom audio
    await this._updateConversationState(userId, sessionId, {
      current_state: 'AWAITING_CLASSROOM_AUDIO',
      menu_choice: 'classroom_coaching',
      awaiting_audio_since: new Date().toISOString()
    });
  }

  /**
   * Handle Lesson Planning choice
   *
   * FEAT-109 (2026-07-31): When PAKISTAN_LP_FLOW_ID is configured, send the
   * Grade→Subject→Chapter→Topic Flow instead of asking for a free-text topic.
   * This routes teachers to pre-generated LPs (served from R2) and bypasses
   * the Gamma generation path. Fall back to the old topic-prompt only if the
   * Flow env var is absent — presence-based gating per NIETE architecture.
   *
   * @private
   */
  static async _handleLessonPlanningChoice(userId, sessionId, from, language) {
    const PAKISTAN_LP_FLOW_ID = process.env.PAKISTAN_LP_FLOW_ID || '';

    if (PAKISTAN_LP_FLOW_ID) {
      const flowSent = await WhatsAppService.sendFlow(from, {
        flowId: PAKISTAN_LP_FLOW_ID,
        header: '📘 Lesson Plans',
        body: 'Pick your class, subject, chapter and topic — the lesson plan lands in your chat.',
        buttonText: 'Pick Class',
        flowToken: `${userId}:pakistan-lp:${Date.now()}`,
      });
      if (flowSent) {
        logToFile('LP menu → Pakistan LP Flow sent (FEAT-109)', { userId, sessionId });
        return;
      }
      logToFile('LP menu → Pakistan LP Flow send failed, falling back to topic prompt', { userId, sessionId });
    }

    // Fallback (Gamma path) — only when Flow not configured or send failed.
    const redis = redisService.redis;
    const message = language === 'ur'
      ? 'بہترین! آپ کس موضوع پر لیسن پلان یا پریزنٹیشن چاہتے ہیں؟\n\nمثال کے طور پر: "گریڈ 5 کے لیے فوٹو سنتھیسس"'
      : "What topic would you like a lesson plan or presentation on?\n\nFor example: 'Photosynthesis for Grade 5'";
    await WhatsAppService.sendMessage(from, message);
    const stateKey = `user:${userId}:awaiting_lesson_plan_topic`;
    const stateData = JSON.stringify({
      sessionId, language, from, askedAt: new Date().toISOString(),
    });
    await redis.setex(stateKey, 300, stateData);
    logToFile('Stored awaiting_lesson_plan_topic state (fallback)', { userId, sessionId, language });
  }

  /**
   * Check if user is awaiting lesson plan topic input
   * Issue #57: Used by text-message.handler.js before intent detection
   * @param {string} userId - User ID
   * @returns {Object|null} State data or null
   */
  static async checkAwaitingLessonPlanTopic(userId) {
    const redis = redisService.redis;
    const stateKey = `user:${userId}:awaiting_lesson_plan_topic`;
    const stateData = await redis.get(stateKey);

    if (stateData) {
      return JSON.parse(stateData);
    }
    return null;
  }

  /**
   * Clear awaiting lesson plan topic state
   * Issue #57: Called after topic is processed
   * @param {string} userId - User ID
   */
  static async clearAwaitingLessonPlanTopic(userId) {
    const redis = redisService.redis;
    const stateKey = `user:${userId}:awaiting_lesson_plan_topic`;
    await redis.del(stateKey);
    logToFile('Cleared awaiting_lesson_plan_topic state', { userId });
  }

  /**
   * Handle AI Video Generation choice (Issue #28: Replaces Media Library)
   * Issue #40 FIX: Delegate to VideoOrchestrator instead of managing state separately
   * This ensures Redis state is used (same as /video command) for consistent flow
   * @private
   */
  static async _handleMediaLibraryChoice(userId, sessionId, from, language) {
    // Issue #40: Delegate to VideoOrchestrator - single source of truth for video state
    const VideoOrchestrator = require('./video/video-orchestrator.service');

    // Clear the AWAITING_MENU_CHOICE state from DB to prevent clash
    // (VideoOrchestrator uses Redis, but DB state would persist and cause issues)
    await this._updateConversationState(userId, sessionId, {
      current_state: null  // Clear DB state - video flow uses Redis
    });

    // VideoOrchestrator.initiateVideoRequest handles:
    // 1. Feature flag check
    // 2. Rate limit check
    // 3. Asking for topic (stores state in Redis)
    // 4. Language selection
    // 5. Customization
    // 6. Style selection
    // 7. Starting generation
    await VideoOrchestrator.initiateVideoRequest(
      { id: userId },  // User object with id
      from,
      sessionId,
      language,
      null  // No topic yet - will ask user
    );

    logToFile('✅ Video generation initiated from menu', { userId, sessionId, language });
  }

  /**
   * Handle Other (general assistance) choice
   * @private
   */
  static async _handleOtherChoice(userId, sessionId, from, language) {
    const message = language === 'ur'
      ? 'بہترین! میں آپ کی کیسے مدد کر سکتا ہوں؟'
      : "How can I help you today?";

    await WhatsAppService.sendMessage(from, message);

    // Update state to general conversation
    await this._updateConversationState(userId, sessionId, {
      current_state: 'GENERAL_CONVERSATION',
      menu_choice: 'other',
      conversation_started_at: new Date().toISOString()
    });
  }

  /**
   * Record what the teacher is now waiting on.
   *
   * this used to stamp `current_state` onto the newest row of the
   * `conversations` MESSAGE LOG. Two things were wrong with that. The state's
   * lifetime became "until the next row is appended" — a window nobody chose. And
   * the read side looked up the newest row *after* the incoming message had already
   * been inserted, so it always read that message's null instead. 5,128 writes and
   * 10,127 reads in 30 days of production, and not one match.
   *
   * Now it writes the one store, keyed on the teacher, with a deadline chosen per
   * step rather than a single blanket TTL.
   *
   * @param {string} userId
   * @param {string} sessionId  kept for call-site compatibility; state is NOT scoped
   *                            to a session — chat_sessions rotate after 30 min idle,
   *                            which is one of the ways state was being lost.
   * @param {{current_state: string|null}} stateUpdates
   * @private
   */
  static async _updateConversationState(userId, sessionId, stateUpdates) {
    // Which flow each waiting step belongs to, and how long it is reasonable to keep
    // waiting. These are deliberately not all the same number: a teacher choosing
    // from a menu and a teacher going away to record a lesson are different waits.
    const STEP_CONTRACT = {
      AWAITING_MENU_CHOICE:     { flow: 'menu',     ttlSeconds: 3600 },  // 1h — the old 5 min was the bug
      AWAITING_CLASSROOM_AUDIO: { flow: 'coaching', ttlSeconds: 21600 }, // 6h — she has to teach the lesson first
      AWAITING_VIDEO_TOPIC:     { flow: 'video',    ttlSeconds: 3600 },
      AWAITING_LESSON_PLAN:     { flow: 'coaching', ttlSeconds: 21600 },
    };

    try {
      const step = stateUpdates.current_state;

      // null clears. GENERAL_CONVERSATION is not a wait — it means nothing is
      // pending — so it clears too rather than parking a meaningless state.
      if (step === null || step === 'GENERAL_CONVERSATION') {
        await ConversationState.clearState(userId);
        return;
      }

      const contract = STEP_CONTRACT[step];
      if (!contract) {
        // Loud on purpose: an unmapped step means a new wait was added without
        // deciding how long it may last, which is how blanket TTLs crept in before.
        logToFile('⚠️ menu: unmapped conversation step, not storing', { userId, step }, 'warn');
        return;
      }

      await ConversationState.setState(userId, {
        flow: contract.flow,
        step,
        payload: { sessionId },
        ttlSeconds: contract.ttlSeconds,
      });
      logToFile('Conversation state updated', { userId, flow: contract.flow, step });
    } catch (error) {
      // Non-fatal: a failed state write must not stop the teacher's request. The
      // read side treats missing state as "no wait pending" and still routes.
      logToFile('⚠️  Warning: Could not update conversation state', { error: error.message });
    }
  }
}

module.exports = MenuService;
