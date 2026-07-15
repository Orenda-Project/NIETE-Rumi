const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const WhatsAppService = require('./whatsapp.service');
const { getClient } = require('./llm-client');
const { OPENAI_API_KEY } = require('../utils/constants');
const { storeConversation } = require('../database/bot-helpers');
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
      // Check if user was awaiting menu selection
      const stateKey = `user:${user.id}:awaiting_menu_selection`;
      const state = await redisService.get(stateKey);

      if (!state) {
        logToFile('Menu button clicked but no state found (expired)', { userId: user.id, buttonId });
        await WhatsAppService.sendMessage(from, "That menu selection has expired. Type /menu to see options again.");
        return;
      }

      await redisService.delete(stateKey); // Clear state after handling

      logToFile('Handling menu button response', { userId: user.id, buttonId, sessionId: state.sessionId });

      // NIETE routing — each carousel button routes to the same code path as
      // the equivalent slash command, so /training and menu_teacher_training
      // deliver an identical experience. LP has no slash command (natural-
      // language triggers it), so the button sends a guided prompt.
      switch (buttonId) {
        case 'menu_lesson_plan':
          await this._sendLessonPlanPrompt(from, language);
          break;

        case 'menu_teacher_training':
          await this._sendTeacherTrainingFlow(from, user, language);
          break;

        case 'menu_coaching':
          await this._sendCoachingPrompt(from, language);
          break;

        case 'menu_assessment_generator':
          await this._sendExamGeneratorFlow(from, user, language);
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
      en: "Hi! I'm Rumi, your teaching assistant!\n\nI can help you with:\n📚 Lesson Plans & Presentations\n🎓 Classroom Coaching\n📖 Reading Assessments\n🎬 AI Video Creation\n\nJust tell me what you need!",
      ur: "السلام علیکم! میں رومی ہوں، آپ کی ٹیچنگ اسسٹنٹ!\n\nمیں آپ کی مدد کر سکتی ہوں:\n📚 لیسن پلانز اور پریزنٹیشنز\n🎓 کلاس روم کوچنگ\n📖 ریڈنگ ٹیسٹ\n🎬 AI ویڈیوز\n\nبتائیں، کیا چاہیے؟",
      ar: "مرحباً! أنا رومي، مساعدتك التعليمية!\n\nيمكنني مساعدتك في:\n📚 خطط الدروس والعروض التقديمية\n🎓 التدريب الصفي\n📖 تقييم القراءة\n🎬 إنشاء فيديو بالذكاء الاصطناعي\n\nأخبرني بما تحتاج!",
      es: "¡Hola! Soy Rumi, tu asistente de enseñanza.\n\nPuedo ayudarte con:\n📚 Planes de Lección y Presentaciones\n🎓 Coaching de Aula\n📖 Evaluación de Lectura\n🎬 Creación de Videos con IA\n\n¡Dime qué necesitas!",
      'bal-PK': "سلام! من رومی آں، شما ءِ تدریسی معاون!\n\nمن شما ءِ کمک کن کیا:\n📚 سبق ءِ منصوبہ\n🎓 کلاس روم کوچنگ\n📖 پڑھائی ءِ ٹیسٹ\n🎬 AI ویڈیو\n\nبگوشیت چہ چیز چاہیت؟",
      'sd-PK': "سلام! مان رومي آهيان، توهان جي تدريسي معاون!\n\nمان توهان جي مدد ڪري سگهان ٿي:\n📚 سبق جو منصوبو\n🎓 ڪلاس روم ڪوچنگ\n📖 پڙهائي جو ٽيسٽ\n🎬 AI ويڊيو\n\nٻڌايو، ڇا گهرجي؟",
      'ps-PK': "سلام! زه رومي یم، ستاسو د تدریس معاون!\n\nزه تاسو سره مرسته کولی شم:\n📚 د درس پلان\n🎓 صنفي کوچنګ\n📖 د لوستلو ازموینه\n🎬 AI ویډیو\n\nراته ووایئ څه غواړئ!",
      'pa-PK': "سلام! میں رومی آں، تہاڈی ٹیچنگ اسسٹنٹ!\n\nمیں تہاڈی مدد کر سکدی آں:\n📚 سبق دے منصوبے\n🎓 کلاس روم کوچنگ\n📖 پڑھائی دا ٹیسٹ\n🎬 AI ویڈیو\n\nدسو، کی چاہیدا اے؟",
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
   * Issue #57 FIX: Store state in Redis (like video flow) so handler can detect topic reply
   * @private
   */
  static async _handleLessonPlanningChoice(userId, sessionId, from, language) {
    const redis = redisService.redis;

    const message = language === 'ur'
      ? 'بہترین! آپ کس موضوع پر لیسن پلان یا پریزنٹیشن چاہتے ہیں؟\n\nمثال کے طور پر: "گریڈ 5 کے لیے فوٹو سنتھیسس"'
      : "What topic would you like a lesson plan or presentation on?\n\nFor example: 'Photosynthesis for Grade 5'";

    await WhatsAppService.sendMessage(from, message);

    // Issue #57 FIX: Store in Redis (like video flow does) so topic reply is processed correctly
    const stateKey = `user:${userId}:awaiting_lesson_plan_topic`;
    const stateData = JSON.stringify({
      sessionId,
      language,
      from,
      askedAt: new Date().toISOString()
    });
    await redis.setex(stateKey, 300, stateData); // 5 minute expiry

    logToFile('Stored awaiting_lesson_plan_topic state', { userId, sessionId, language });
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
   * Update conversation state in database
   * Issue #41/#42 FIX: Write to correct column with correct data type
   * Column is `current_state` (VARCHAR), not `conversation_state` (JSONB)
   * @private
   */
  static async _updateConversationState(userId, sessionId, stateUpdates) {
    try {
      // Issue #41 FIX: Extract just the state string (VARCHAR column, not JSONB)
      // Support null to clear state (used when transitioning to Redis-based video flow)
      const stateString = stateUpdates.current_state === null
        ? null
        : (stateUpdates.current_state || 'UNKNOWN');

      // Find the most recent conversation for this user/session
      const { data: existingConversation } = await supabase
        .from('conversations')
        .select('id')
        .eq('user_id', userId)
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (existingConversation) {
        // Update existing conversation
        const { error } = await supabase
          .from('conversations')
          .update({ current_state: stateString })
          .eq('id', existingConversation.id);

        if (error) {
          logToFile('⚠️  Warning: Could not update conversation state', { error: error.message });
        }
      } else {
        // No existing conversation - state will be set on next message
        logToFile('⚠️  No existing conversation to update state', { userId, sessionId, stateString });
      }
    } catch (error) {
      logToFile('⚠️  Warning: Error updating conversation state', {
        error: error.message
      });
      // Don't throw - this is non-critical
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FEAT-059 / carousel button handlers
  //
  // Each of the 4 carousel buttons routes to the same code path as the
  // equivalent slash command in text-message.handler.js — /training and
  // /exams open Meta Flows; LP + Coaching send a guiding prompt because
  // they have no slash-command entry point (LP triggers on natural
  // language, coaching triggers on voice upload).
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * LP has no slash command — a teacher just describes what they want.
   * Send an explicit prompt so tapping "Lesson Plans" isn't a dead end.
   */
  static async _sendLessonPlanPrompt(from, language) {
    const msg = ({
      ur: 'زبردست! مجھے گریڈ، مضمون اور موضوع بتائیں۔\n\nمثال:\n• گریڈ 1 میتھ Number Buddies\n• گریڈ 2 انگلش Get to Know Me',
    })[language] || (
      "Great! Tell me the grade, subject, and topic you need a lesson plan for.\n\n" +
      "For example:\n• Grade 1 Math Number Buddies\n• Grade 2 English Get to Know Me\n• Grade 1 Reading Hour English phonics"
    );
    await WhatsAppService.sendMessage(from, msg);
  }

  /**
   * Teacher Training — mirrors the /training slash command
   * (text-message.handler.js:590). Opens TEACHER_TRAINING_FLOW_ID.
   */
  static async _sendTeacherTrainingFlow(from, user, language) {
    const flowId = process.env.TEACHER_TRAINING_FLOW_ID || '';
    if (!flowId) {
      await WhatsAppService.sendMessage(
        from,
        "Teacher Training is being prepared for you. We'll notify you when it's live.\n\nاستاد کی تربیت آپ کے لیے تیار کی جا رہی ہے۔"
      );
      return;
    }
    const flowToken = `${user.id}:teacher-training:${Date.now()}`;
    await WhatsAppService.sendFlow(from, {
      flowId,
      header: '🎓 Teacher Training',
      body: ({
        ur: 'اپنی تربیت کی پیش رفت دیکھیں اور اگلا سبق شروع کریں۔',
      })[language] || 'View your training progress and start your next level.',
      buttonText: ({ ur: 'کھولیں' })[language] || 'Open',
      flowToken,
    });
    logToFile('🎓 Sent teacher-training flow (from menu)', { userId: user.id });
  }

  /**
   * Coaching is voice-first — send an instruction prompt.
   */
  static async _sendCoachingPrompt(from, language) {
    const msg = ({
      ur: 'کوچنگ کے لیے، اپنے کلاس روم کی 5-30 منٹ کی وائس ریکارڈنگ بھیجیں۔ میں اس کا تجزیہ کروں گی اور آپ کو ذاتی فیڈبیک دوں گی۔',
    })[language] || (
      "For coaching, record a short voice note of your classroom (5-30 min) " +
      "and send it here. I'll analyse it and share personalised teaching feedback."
    );
    await WhatsAppService.sendMessage(from, msg);
  }

  /**
   * Assessment Generator — mirrors the /exams slash command
   * (text-message.handler.js:679). Opens EXAM_GENERATOR_FLOW_ID.
   */
  static async _sendExamGeneratorFlow(from, user, language) {
    const flowId = process.env.EXAM_GENERATOR_FLOW_ID || '';
    if (!flowId) {
      await WhatsAppService.sendMessage(
        from,
        "The exam generator is being prepared for you. We'll notify you when it's live.\n\nامتحان جنریٹر تیار کیا جا رہا ہے۔"
      );
      return;
    }
    const flowToken = `${user.id}:exam-generator:${Date.now()}`;
    await WhatsAppService.sendFlow(from, {
      flowId,
      header: '📝 New exam',
      body: ({
        ur: 'اپنی کلاس کے لیے نیا امتحان بنائیں — گریڈ، مضمون اور چیپٹرز منتخب کریں۔',
      })[language] || 'Create a new exam for your class — pick grade, subject, and chapters.',
      buttonText: ({ ur: 'شروع کریں' })[language] || 'Start',
      flowToken,
    });
    logToFile('📝 Sent exam-generator flow (from menu)', { userId: user.id });
  }
}

module.exports = MenuService;
