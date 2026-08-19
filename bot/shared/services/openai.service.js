const { CONVERSATION_HISTORY_LIMIT } = require('../utils/constants');
const { logToFile } = require('../utils/logger');
const { buildLanguagePrompt, hasEnhancedPrompt } = require('../config/language-prompts');
const { voiceLanguageRules } = require('../config/voice-language-rules'); // bd-2651
const { getConversationHistory: getDbConversationHistory } = require('../database/bot-helpers');
const { getClient } = require('./llm-client');

/**
 * OpenAI Service
 * Handles all LLM interactions (chat, intent detection, topic extraction)
 * Uses llm-client.js for provider-agnostic OpenAI/OpenRouter routing.
 */
class OpenAIService {
  constructor() {
    this.openai = getClient();

    // In-memory cache for conversation history (loads from DB on cache miss)
    // Phase 1: DB-backed conversation history - survives server restarts
    this.conversationHistory = new Map();
  }

  /**
   * Get or initialize conversation history for a user
   * Loads from database if not in memory cache (survives server restarts)
   * @param {string} userId - User identifier
   * @returns {Promise<Array>} Conversation history
   */
  async getConversationHistory(userId) {
    // Try in-memory cache first
    if (this.conversationHistory.has(userId)) {
      return this.conversationHistory.get(userId);
    }

    // Load from database (Phase 1: DB-backed history)
    try {
      const dbHistory = await getDbConversationHistory(userId, 10);

      logToFile('Loading conversation history from DB', {
        userId,
        messagesLoaded: dbHistory.length
      });

      // NO system message is seeded here.
      //
      // This used to prepend a system prompt hardcoded to "Always respond in Urdu"
      // regardless of the teacher's actual language. It was survivable only
      // because the one live caller stripped it again with .slice(1) — safety
      // resting on a convention, and one new caller away from a hardcoded-Urdu
      // instruction reaching a model on behalf of an English-preferring teacher.
      //
      // History is now just history. The system prompt is the caller's job, built
      // per request from the resolved language in buildFormatAwarePrompt().
      const history = [];

      // Add DB history messages
      for (const msg of dbHistory) {
        history.push({
          role: msg.role,
          content: msg.content
        });
      }

      // Cache in memory
      this.conversationHistory.set(userId, history);

      return history;
    } catch (error) {
      logToFile('Error loading conversation history from DB, using empty history', {
        userId,
        error: error.message
      });

      // Same as above: no seeded system message, so a DB failure cannot
      // silently install a hardcoded-language instruction either.
      const fallbackHistory = [];
      this.conversationHistory.set(userId, fallbackHistory);
      return fallbackHistory;
    }
  }

  /*
   * getResponse(userMessage, userId) was here, and is deleted.
   *
   * It took NO language argument and fed the conversation history straight to the
   * model — which, while getConversationHistory seeded a system message hardcoded
   * to "Always respond in Urdu", made it the one path where that instruction
   * actually reached a model. It had ZERO callers; both live handlers use
   * getResponseWithFormat, which builds its prompt from the resolved language.
   *
   * Deleted rather than left exported, because a language-blind response method
   * sitting beside a language-aware one is an invitation, and this audit is full
   * of paths that were correct at every site and drifted anyway.
   */

  /**
   * Get core capabilities section for system prompts
   * @param {string} language - Language code
   * @param {boolean} useEmotionTags - Whether to include emotion tag instructions
   * @returns {string} Capabilities section
   * @private
   */
  _getCapabilitiesSection(language, useEmotionTags = false) {
    const emotionTagInstruction = useEmotionTags ? `
EMOTION TAGS (use naturally in your speech):
- [warmly] for greetings and encouragement
- [thoughtfully] for explanations
- [enthusiastically] for excitement
- [gently] for suggestions
- [encouragingly] for motivation
` : '';

    // Language-specific capability responses
    const capabilityResponses = {
      'ur': {
        lessonPlan: '"میں آپ کے لیے [topic] پر ایک تفصیلی پانچ مرحلہ سبق کا منصوبہ تیار کر رہی ہوں۔ براہ کرم تھوڑا انتظار کریں..."',
        presentation: '"میں آپ کے لیے [topic] پر ایک تعلیمی پریزنٹیشن تیار کر رہی ہوں۔ براہ کرم تھوڑا انتظار کریں..."',
        coaching: '"میں آپ کی کلاس روم ریکارڈنگ سن کر فیڈ بیک دے سکتی ہوں۔ بس آڈیو یا ویڈیو بھیج دیں!"',
        reading: '"میں ریڈنگ ٹیسٹ کر سکتی ہوں! /reading test ٹائپ کریں۔"'
      },
      'bal-PK': {
        lessonPlan: '"من شما ءِ واستہ [topic] ءِ سرا ایک سبق ءِ منصوبہ جوڑ کنگ ءَ ہان۔ لطفاً انتظار کنیت..."',
        presentation: '"من شما ءِ واستہ [topic] ءِ سرا ایک پریزنٹیشن تیار کنگ ءَ ہان۔ لطفاً انتظار کنیت..."',
        coaching: '"من شما ءِ کلاس روم ریکارڈنگ گوش کنگ ءَ ہان، فیڈبیک دءِ۔ آڈیو یا ویڈیو روان کنیت!"',
        reading: '"من ریڈنگ ٹیسٹ کن اَنت! /reading test ٹائپ کنیت۔"'
      },
      'sd-PK': {
        lessonPlan: '"مان توهان لاءِ [topic] تي هڪ تفصيلي سبق جو منصوبو ٺاهي رهي آهيان۔ مهرباني ڪري ٿوري دير انتظار ڪريو..."',
        presentation: '"مان توهان لاءِ [topic] تي هڪ تعليمي پريزنٽيشن تيار ڪري رهي آهيان۔ مهرباني ڪري ٿوري دير انتظار ڪريو..."',
        coaching: '"مان توهان جي ڪلاس روم جي ريڪارڊنگ ٻڌي ڪري فيڊبيڪ ڏيان ٿي۔ آڊيو يا ويڊيو موڪليو!"',
        reading: '"مان ريڊنگ ٽيسٽ وٺي سگهان ٿي! /reading test ٽائيپ ڪريو۔"'
      },
      'ps-PK': {
        lessonPlan: '"زه ستاسو لپاره د [topic] په اړه یو تفصیلي سبق پلان جوړوم۔ مهرباني وکړئ لږ انتظار وکړئ..."',
        presentation: '"زه ستاسو لپاره د [topic] په اړه یوه تعلیمي پریزنټیشن چمتو کوم۔ مهرباني وکړئ لږ انتظار وکړئ..."',
        coaching: '"زه ستاسو د ټولګي ریکارډنګ اورم او فیډبیک درکوم۔ آډیو یا ویډیو راولیږئ!"',
        reading: '"زه ریډنګ ټیسټ کولی شم! /reading test ولیکئ۔"'
      },
      'pa-PK': {
        lessonPlan: '"میں تہاڈے لئی [topic] تے اک تفصیلی سبق دا منصوبہ بنا رہی ہاں۔ مہربانی کرکے تھوڑا انتظار کرو..."',
        presentation: '"میں تہاڈے لئی [topic] تے اک تعلیمی پریزنٹیشن تیار کر رہی ہاں۔ مہربانی کرکے تھوڑا انتظار کرو..."',
        coaching: '"میں تہاڈی کلاس روم ریکارڈنگ سن کے فیڈبیک دے سکدی ہاں۔ آڈیو یا ویڈیو بھیج دیو!"',
        reading: '"میں ریڈنگ ٹیسٹ کر سکدی ہاں! /reading test ٹائپ کرو۔"'
      },
      'ta-LK': {
        lessonPlan: '"நான் உங்களுக்காக [topic] பற்றிய விரிவான பாட திட்டத்தை உருவாக்குகிறேன். தயவுசெய்து சிறிது நேரம் காத்திருங்கள்..."',
        presentation: '"நான் உங்களுக்காக [topic] பற்றிய கல்வி விளக்கக்காட்சியை தயாரிக்கிறேன். தயவுசெய்து சிறிது நேரம் காத்திருங்கள்..."',
        coaching: '"உங்கள் வகுப்பறை பதிவை கேட்டு பின்னூட்டம் தர முடியும். ஒலி அல்லது வீடியோ அனுப்புங்கள்!"',
        reading: '"நான் வாசிப்பு மதிப்பீடு செய்யலாம்! /reading test என்று தட்டச்சு செய்யுங்கள்."'
      }
    };

    const responses = capabilityResponses[language] || capabilityResponses['ur'];
    const warmly = useEmotionTags ? '[warmly] ' : '';
    const enthusiastically = useEmotionTags ? '[enthusiastically] ' : '';
    const encouragingly = useEmotionTags ? '[encouragingly] ' : '';

    return `
## YOUR CAPABILITIES (NEVER deny these):
1. CREATE lesson plans - Comprehensive 5-step lesson plans with activities. Just ask for topic + grade.
2. CREATE presentations - Visual slides on any educational topic.
3. ANALYZE classroom recordings - Upload audio/video of your class for personalized teaching feedback.
4. PERFORM reading assessments - Test student fluency, pronunciation. Type "/reading test" to start.
${emotionTagInstruction}
RESPONSE TEMPLATES:
- LESSON PLAN: ${enthusiastically}${responses.lessonPlan}
- PRESENTATION: ${enthusiastically}${responses.presentation}
- COACHING: ${warmly}${responses.coaching}
- READING: ${encouragingly}${responses.reading}

CRITICAL: NEVER say "I can't do that" or "I'm unable to" for any of the 4 capabilities above.

ANTI-FALSE-PROMISE RULE (CRITICAL - applies to ALL languages):
- ONLY say "I'm creating/preparing a lesson plan/presentation" if the user EXPLICITLY asked you to CREATE one
- Explicit requests: "create a lesson plan", "make me a presentation", "بنا دو", "تیار کرو", "lesson plan چاہیے"
- If user asks "how to teach X", discusses teaching methods, or mentions a topic casually → provide helpful ADVICE and GUIDANCE
- NEVER claim you are creating documents unless they specifically requested it
- If unsure, ask: "Would you like me to create a lesson plan on this topic?"
- False promises destroy user trust - this is a critical rule`;
  }

  /**
   * Get format-aware system prompt based on output format and language
   * @param {string} format - Output format ('text' or 'voice')
   * @param {string} language - Output language ('en' or 'ur')
   * @param {string|null} firstName - User's first name (optional)
   * @returns {string} System prompt
   * @private
   */
  _getFormatAwareSystemPrompt(format, language, firstName = null) {
    // Check if we have enhanced prompts for this language
    if (hasEnhancedPrompt(language)) {
      const basePrompt = buildLanguagePrompt(language, firstName || 'Teacher');

      // Whether emotion tags are usable is read from VOICE_MODELS — the SAME table
      // that actually routes the audio in audio.service.js — rather than inferred
      // from a provider name in a second registry.
      //
      // It used to read getTtsProvider() from config/tts-voices.js and infer
      // "provider !== 'uplift' means tags are supported". Those two registries
      // DISAGREE: tts-voices still says Urdu is Uplift, while VOICE_MODELS moved
      // Urdu to ElevenLabs. The outcome happened to match — both paths
      // ended up omitting tags for Urdu, for different reasons — so nothing broke,
      // but the next person to enable tags for Urdu on the audio side would find
      // the prompt still stripping them, with no error anywhere to explain it.
      //
      // tts-voices.js keeps its real job: script guidance and pronunciation notes,
      // which is why it needs no English entry — English needs no Nastaliq advice.
      const { VOICE_MODELS } = require('../utils/constants');
      const voiceModel = VOICE_MODELS[language];
      const useEmotionTags = format === 'voice' && voiceModel?.supportsEmotionTags === true;

      const capabilities = this._getCapabilitiesSection(language, useEmotionTags);

      const formatNote = format === 'voice'
        ? `\n\nVOICE FORMAT: Keep responses SHORT (max 60 seconds). Complete thoughts, never end mid-sentence.\n${voiceLanguageRules(language)}` // bd-2651: spoken aloud — enforce Nastaliq/anti-Hindi (ur) or pure English
        : '\n\nTEXT FORMAT: Keep responses concise for WhatsApp. Be warm and supportive.';

      logToFile('Using enhanced language prompt', { language, format, ttsProvider: voiceModel?.provider ?? null, useEmotionTags });

      return basePrompt + capabilities + formatNote;
    }

    // Fall back to original prompts for languages without enhanced versions
    // Voice response in English with emotion tags
    if (format === 'voice' && language === 'en') {
      return `You are the NIETE Teaching Assistant, a warm and supportive teaching companion for teachers. You're responding via voice message, so be conversational and naturally expressive.
${firstName ? `\nThe teacher's name is ${firstName}. Use their name naturally when appropriate to make the conversation more personal, but don't overuse it.` : ''}

## YOUR CAPABILITIES (NEVER deny these):
You CAN and SHOULD offer these features when relevant:
1. CREATE lesson plans - Comprehensive 5-step lesson plans with activities. Just ask for topic + grade.
2. CREATE presentations - Visual slides on any educational topic.
3. ANALYZE classroom recordings - Upload audio/video of your class for personalized teaching feedback.
4. PERFORM reading assessments - Test student fluency, pronunciation. Type "/reading test" to start.

IMPORTANT: Add emotion tags to express your tone. Use these tags naturally in your speech:
- [warmly] for greetings and encouragement
- [thoughtfully] for explanations and teaching moments
- [enthusiastically] for excitement about topics
- [gently] for suggestions and corrections
- [encouragingly] for motivation
- [empathetically] for understanding challenges

LESSON PLAN REQUESTS: "[enthusiastically] I'm creating a detailed five-step lesson plan for you on [topic]. [warmly] Give me just a moment..."

PRESENTATION REQUESTS: "[enthusiastically] I'm preparing an educational presentation for you on [topic]. [warmly] Just a moment please..."

COACHING REQUESTS: If they mention improving teaching or classroom observation: "[warmly] I can analyze your classroom recording and give you personalized feedback! [encouragingly] Just send me an audio or video of your class."

READING ASSESSMENT: If they ask about testing reading or fluency: "[enthusiastically] I can do a reading assessment! [warmly] Just type /reading test to get started."

CRITICAL: NEVER say "I can't do that" or "I'm unable to" for any of the 4 capabilities above.

ANTI-FALSE-PROMISE RULE: Only say "I'm creating a lesson plan/presentation" if the user EXPLICITLY asked you to create one (e.g., "create a lesson plan", "make me a presentation"). If they just mention a topic or ask a question (e.g., "Mathematics for grade 2", "How do I teach fractions?"), provide helpful educational guidance - but NEVER claim you are creating documents unless they specifically requested it. False promises destroy trust.

Keep responses conversational and concise. MAXIMUM 60 seconds of speech (150-180 words). Be supportive, pedagogically sound, and speak like a caring friend who happens to be an expert educator.
${voiceLanguageRules('en')}`;
    }

    // Voice response in Urdu (no emotion tags, Uplift doesn't support them)
    if (format === 'voice' && language === 'ur') {
      return `You are the NIETE Teaching Assistant, a warm and supportive teaching companion for teachers. You're responding via voice message in Urdu. Always respond in Urdu (اردو). Be friendly, warm, supportive, professional, and pedagogically sound. Use female verb forms in Urdu.
${firstName ? `\nاستاد کا نام ${firstName} ہے۔ مناسب مواقع پر ان کا نام استعمال کریں تاکہ بات چیت زیادہ ذاتی ہو، لیکن زیادہ استعمال نہ کریں۔` : ''}

## آپ کی صلاحیتیں (ان کو کبھی نہ انکار کریں):
1. سبق کے منصوبے بنائیں - پانچ مرحلہ سبق کے منصوبے۔ بس موضوع + گریڈ بتائیں۔
2. پریزنٹیشنز بنائیں - کسی بھی تعلیمی موضوع پر سلائیڈز۔
3. کلاس روم ریکارڈنگز کا تجزیہ کریں - آڈیو/ویڈیو بھیجیں، فیڈبیک حاصل کریں۔
4. ریڈنگ ٹیسٹ کریں - /reading test ٹائپ کریں۔

## جوابات کے اصول:

1. **سبق کا منصوبہ**: "میں آپ کے لیے [topic] پر ایک تفصیلی پانچ مرحلہ سبق کا منصوبہ تیار کر رہی ہوں۔ براہ کرم تھوڑا انتظار کریں..."

2. **پریزنٹیشن**: "میں آپ کے لیے [topic] پر ایک تعلیمی پریزنٹیشن تیار کر رہی ہوں۔ براہ کرم تھوڑا انتظار کریں..."

3. **کوچنگ**: اگر تدریس بہتر کرنا چاہیں: "میں آپ کی کلاس روم ریکارڈنگ سن کر فیڈ بیک دے سکتی ہوں۔ بس آڈیو یا ویڈیو بھیج دیں!"

4. **ریڈنگ ٹیسٹ**: "میں ریڈنگ ٹیسٹ کر سکتی ہوں! /reading test ٹائپ کریں۔"

اہم: اوپر کی 4 صلاحیتوں کے لیے کبھی نہ کہیں "میں یہ نہیں کر سکتی"۔

جھوٹے وعدے سے بچیں: صرف "میں بنا رہی ہوں" کہیں اگر انہوں نے واضح طور پر کہا ہو (جیسے "لیسن پلان بنا دو")۔ اگر وہ صرف موضوع بتائیں یا سوال پوچھیں، تو تعلیمی مشورہ دیں - دستاویز بنانے کا وعدہ نہ کریں۔

Keep your responses short as they will be converted to voice. MAXIMUM 60 seconds.
IMPORTANT: Always complete your thoughts - never end mid-sentence.
${voiceLanguageRules('ur')}`;
    }

    // Voice response in Arabic with emotion tags
    // The voice branches for Arabic and Spanish were here. Deleted, not disabled:
    // this deployment has no Arabic or Spanish copy, TTS voice or document font, so
    // a branch for either advertised capability that does not exist. They were
    // REACHABLE — getConfirmedLanguage can return them, and for the 99.6% of
    // teachers who are unlocked that value flowed straight into this prompt. The
    // caller now clamps to the offer before this is reached.

    if (format === 'text' && language === 'en') {
      return `You are the NIETE Teaching Assistant, a supportive teaching companion for teachers. Respond in clear, professional English.
${firstName ? `\nThe teacher's name is ${firstName}. Use their name naturally when appropriate.` : ''}

## YOUR CAPABILITIES (NEVER deny these):
1. CREATE lesson plans - 5-step plans with activities. Ask for topic + grade.
2. CREATE presentations - Visual slides on any topic.
3. ANALYZE classroom recordings - Send audio/video for personalized feedback.
4. PERFORM reading assessments - Type /reading test to start.

LESSON PLAN: "I'm creating a detailed five-step lesson plan for you on [topic]. Please give me a moment..."
PRESENTATION: "I'm preparing an educational presentation for you on [topic]. Just a moment please..."
COACHING: "I can analyze your classroom recording and give you personalized feedback! Just send me an audio or video of your class."
READING: "I can do a reading assessment! Type /reading test to get started."

CRITICAL: NEVER say "I can't do that" or "I'm unable to" for any of the 4 capabilities above.

ANTI-FALSE-PROMISE RULE: Only say "I'm creating a lesson plan/presentation" if the user EXPLICITLY asked you to create one (e.g., "create a lesson plan", "make me a presentation"). If they just mention a topic or ask a question, provide helpful guidance - but NEVER claim you are creating documents unless they specifically requested it.

For general questions, provide concise advice. Be warm and supportive. Keep responses brief for WhatsApp.`;
    }

    // Text response in Arabic
    // The text branches for Arabic and Spanish, and the voice branches for
    // Balochi, Sindhi, Pashto, Punjabi and Tamil, were here — nine branches in
    // total across both ranges. Every one was live: an unlocked teacher whose
    // voice note was detected as Balochi received a Balochi system prompt, which
    // is the mechanism behind the off-market output_language rows the audit
    // measured. The reply language is clamped to the offer before this point now,
    // so re-adding a branch here would not make that language reachable either —
    // it would need a registry entry, reviewed copy and a TTS voice first.

    // Text response in Urdu — now an EXPLICIT branch, not the fall-through.
    //
    // It was reached by falling off the end of every other test, which meant it
    // also served as the catch-all: any language without a branch got an Urdu
    // prompt. Correct for Urdu by accident, and the "fallbacks disagree" defect
    // for everything else — an English-preferring teacher whose language somehow
    // arrived unmatched would have been answered in Urdu.
    if (language === 'ur') {
      return `You are the NIETE Teaching Assistant, a warm and supportive teaching companion for teachers. You're chatting via WhatsApp in Urdu. Always respond in Urdu (اردو). Be friendly, warm, supportive, professional, and pedagogically sound. Use female verb forms in Urdu.
${firstName ? `\nاستاد کا نام ${firstName} ہے۔ مناسب مواقع پر ان کا نام استعمال کریں تاکہ بات چیت زیادہ ذاتی ہو، لیکن زیادہ استعمال نہ کریں۔` : ''}

IMPORTANT: When a teacher asks you to create educational materials, follow these rules:

1. **Lesson Plan Requests**: If they ask for a "lesson plan" (سبق کا منصوبہ), "teaching plan", or "lesson" on any topic, respond with:
   "میں آپ کے لیے [topic] پر ایک تفصیلی پانچ مرحلہ سبق کا منصوبہ تیار کر رہی ہوں۔ براہ کرم تھوڑا انتظار کریں..."

2. **Presentation Requests**: If they ask for a "presentation" (پریزنٹیشن), "slides" (سلائیڈز), or "PowerPoint" on any topic, respond with:
   "میں آپ کے لیے [topic] پر ایک تعلیمی پریزنٹیشن تیار کر رہی ہوں۔ براہ کرم تھوڑا انتظار کریں..."

3. **General Questions**: For other educational questions, provide concise, pedagogically sound advice in Urdu using female verb forms.

Keep your responses relatively short as they will be sent via WhatsApp messages.`;
    }

    // The real fall-through: English, the same floor every other surface uses.
    //
    // Unreachable in practice — the caller clamps to the offer, and both offered
    // languages have branches above. It exists so that if a future caller does
    // pass something unexpected, the answer is the deployment's floor rather than
    // whichever branch happened to be written last.
    return this._getFormatAwareSystemPrompt('text', 'en', firstName);
  }

  /**
   * Get AI response with format-aware prompting
   * @param {string} userMessage - User's message
   * @param {string} userId - User identifier
   * @param {string} format - Output format ('text' or 'voice')
   * @param {string} language - Output language ('en' or 'ur')
   * @param {string|null} firstName - User's first name (optional)
   * @param {string|null} featureContext - Phase 2: Conditional feature context (optional)
   * @returns {Promise<string>} AI response
   */
  async getResponseWithFormat(userMessage, userId, format, language, firstName = null, featureContext = null) {
    try {
      logToFile('Getting format-aware response', {
        format,
        language,
        firstName,
        hasFeatureContext: !!featureContext
      });

      // Create a temporary conversation history with format-specific system prompt
      let systemPrompt = this._getFormatAwareSystemPrompt(format, language, firstName);

      // Phase 2: Inject feature context if provided (conditional injection)
      if (featureContext) {
        systemPrompt = systemPrompt + '\n\n' + featureContext;
        logToFile('Feature context injected into system prompt', {
          userId,
          contextLength: featureContext.length
        });
      }

      // Get existing conversation history (without system message)
      // No .slice(1): getConversationHistory no longer seeds a system message, so
      // there is nothing to strip. The slice was the load-bearing half of that
      // convention — remove the seed and the slice must go with it, or the first
      // real history message would be silently dropped.
      const existingHistory = await this.getConversationHistory(userId);

      // Build new history with format-specific system prompt
      const messages = [
        { role: 'system', content: systemPrompt },
        ...existingHistory,
        { role: 'user', content: userMessage }
      ];

      // Get response from OpenAI
      // Reduce max_tokens for voice to enforce 60-second limit
      // RTL languages (Arabic script) use more tokens per word, so allow 400 tokens
      const RTL_LANGUAGES = ['ur', 'ar', 'bal-PK', 'sd-PK', 'ps-PK', 'pa-PK'];
      const isRTL = RTL_LANGUAGES.includes(language);
      const voiceMaxTokens = isRTL ? 400 : 250;

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: messages,
        max_tokens: format === 'voice' ? voiceMaxTokens : 500,
        temperature: 0.7,
      });

      const aiResponse = completion.choices[0].message.content;

      // Update conversation history with new system prompt and messages
      const newHistory = [
        { role: 'system', content: systemPrompt },
        ...existingHistory,
        { role: 'user', content: userMessage },
        { role: 'assistant', content: aiResponse }
      ];

      // Keep only last N messages to manage memory
      if (newHistory.length > CONVERSATION_HISTORY_LIMIT) {
        newHistory.splice(1, 2); // Keep system message, remove oldest user-assistant pair
      }

      this.conversationHistory.set(userId, newHistory);

      return aiResponse;
    } catch (error) {
      logToFile('Error getting format-aware AI response', { error: error.message });

      // Fallback error messages based on language
      if (language === 'en') {
        return 'Sorry, I encountered an error processing your message. Please try again.';
      } else {
        return 'معذرت، آپ کے پیغام کو پروسیس کرتے وقت خرابی آ گئی۔ براہ کرم دوبارہ کوشش کریں۔';
      }
    }
  }

  /**
   * Detect user intent using LLM
   * @param {string} message - User's message
   * @returns {Promise<Object>} Intent object {type: string, message: string}
   */
  async detectIntent(message) {
    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: `You are an intent classifier. Analyze the user's message and determine if they are requesting:

1. "lesson_plan" - if they:
   - Explicitly ask to CREATE, GENERATE, or MAKE a lesson plan document
   - OR provide a topic with a grade level that sounds like a lesson request (e.g., "Math for grade 3", "Photosynthesis grade 5")
   - OR mention a subject + grade in a way that suggests they want teaching materials
2. "presentation" - ONLY if they explicitly ask to CREATE, GENERATE, or MAKE a presentation/slides
3. "video" - if they ask for a video, educational video, or want to watch/see a video on a topic (for any grade or subject)
4. "general" - for questions, advice, guidance, or any other conversation (including "how to teach X")

IMPORTANT: Distinguish carefully:
- "Create a lesson plan about X" → lesson_plan
- "Make me a lesson plan for X" → lesson_plan
- "Mathematics for grade 2" → lesson_plan (topic + grade = likely wants a lesson plan)
- "Addition and subtraction grade 3" → lesson_plan (topic + grade = likely wants a lesson plan)
- "Photosynthesis for grade 5" → lesson_plan (topic + grade = likely wants a lesson plan)
- "Show me a video about X" → video
- "Do you have a video on fractions?" → video
- "I want to watch a video about photosynthesis" → video
- "Video dikhao on multiplication" → video
- "How do I teach X?" → general (they want advice, not a document)
- "Help me figure out how to teach X" → general (they want guidance)
- "What's the best way to teach X?" → general (they want advice)
- "What is photosynthesis?" → general (they want information, not a document)

The message may be in English, Urdu, or Roman Urdu. Look for semantic meaning, not just keywords.

Examples:
- "لیسن پلان بنا دو" (make a lesson plan) → lesson_plan
- "سبق کا منصوبہ چاہیے" (need a lesson plan) → lesson_plan
- "Mathematics addition and subtraction for grade 2" → lesson_plan
- "Fractions for class 4" → lesson_plan
- "presentation banao" (make a presentation) → presentation
- "پریزنٹیشن کی ضرورت ہے" (need a presentation) → presentation
- "video dikhao" (show video) → video
- "ویڈیو چاہیے" (need video) → video
- "Show me a grade 3 maths video" → video
- "Do you have videos on science?" → video
- "یہ کیسے کام کرتا ہے؟" (how does this work?) → general
- "How do I teach photosynthesis?" → general
- "Figure out how to teach X" → general
- "What's a good way to explain X?" → general

Return ONLY one word: lesson_plan, presentation, video, or general`
          },
          {
            role: 'user',
            content: message
          }
        ],
        max_tokens: 10,
        temperature: 0.1,
      });

      const intent = completion.choices[0].message.content.trim().toLowerCase();

      // Validate the response
      if (intent === 'lesson_plan' || intent === 'lesson plan') {
        return { type: 'lesson_plan', message };
      } else if (intent === 'presentation') {
        return { type: 'presentation', message };
      } else if (intent === 'video') {
        return { type: 'video', message };
      } else {
        return { type: 'general', message };
      }
    } catch (error) {
      logToFile('Error detecting intent with LLM', { error: error.message });
      // Fallback to keyword-based detection
      return this._fallbackIntentDetection(message);
    }
  }

  /**
   * Fallback intent detection using keywords
   * @param {string} message - User's message
   * @returns {Object} Intent object
   * @private
   */
  _fallbackIntentDetection(message) {
    const lowerMessage = message.toLowerCase();

    const lessonPlanKeywords = [
      'lesson plan', 'teaching plan', 'lesson', 'سبق کا منصوبہ', 'سبق', 'منصوبہ',
      'درس', 'تدریسی منصوبہ', 'پڑھانے کا طریقہ', 'لیسن پلان'
    ];

    const presentationKeywords = [
      'presentation', 'slides', 'powerpoint', 'ppt', 'پریزنٹیشن',
      'سلائیڈز', 'پاور پوائنٹ', 'پاورپوائنٹ'
    ];

    const videoKeywords = [
      'video', 'videos', 'watch', 'ویڈیو', 'ویڈیوز',
      'dikhao', 'dekho', 'دکھاؤ', 'دیکھو'
    ];

    for (const keyword of lessonPlanKeywords) {
      if (lowerMessage.includes(keyword.toLowerCase())) {
        return { type: 'lesson_plan', message };
      }
    }

    for (const keyword of presentationKeywords) {
      if (lowerMessage.includes(keyword.toLowerCase())) {
        return { type: 'presentation', message };
      }
    }

    for (const keyword of videoKeywords) {
      if (lowerMessage.includes(keyword.toLowerCase())) {
        return { type: 'video', message };
      }
    }

    return { type: 'general', message };
  }

  /**
   * Extract topic from message
   * @param {string} message - User's message
   * @returns {Promise<string>} Extracted topic
   */
  async extractTopic(message) {
    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: 'Extract the main topic from the user message. Return ONLY the topic, nothing else. If the message is in Urdu, return the topic in English for API use.'
          },
          {
            role: 'user',
            content: message
          }
        ],
        max_tokens: 50,
        temperature: 0.3,
      });

      return completion.choices[0].message.content.trim();
    } catch (error) {
      logToFile('Error extracting topic', { error: error.message });
      return 'General Education Topic';
    }
  }

  /**
   * Direct access to chat completions API
   * Used by video generation and other services that need custom prompts
   * @param {Object} options - OpenAI chat completion options
   * @returns {Promise<Object>} OpenAI completion response
   */
  async createChatCompletion(options) {
    return await this.openai.chat.completions.create(options);
  }

  /**
   * Clear conversation history for a user
   * @param {string} userId - User identifier
   */
  clearHistory(userId) {
    this.conversationHistory.delete(userId);
  }
}

// Export singleton instance
module.exports = new OpenAIService();
