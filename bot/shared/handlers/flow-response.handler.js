/**
 * WhatsApp Flow Response Handler
 *
 * Routes the WhatsApp NFM_REPLY payload (the message Meta sends to the bot
 * when a teacher submits a Flow) to the right per-flow processor — or,
 * for endpoint-data-exchange flows, recognises the completion and logs it
 * for telemetry. Flow IDs are read from env vars; the canonical mapping
 * lives in `bot/scripts/setup/flow-configs.js`.
 *
 * ─── Endpoint flows vs navigate flows ───────────────────────────────
 * Endpoint flows (data_exchange) — the teacher's screen-by-screen input
 *   round-trips through a server endpoint mounted under `/api/flows/...`
 *   (registered in `bot/shared/routes/flow-endpoint.routes.js`). By the
 *   time Meta sends the NFM_REPLY, the data has ALREADY been persisted
 *   by the endpoint; the NFM_REPLY is a delivery acknowledgement, not a
 *   data carrier. Examples: Settings, Status, Homework Request, Edit
 *   Class, Student Videos, Pic-to-LP Confirm, Quiz Manager, Registration.
 *   The attendance flows are the exception (see below).
 *
 * Navigate flows — no server endpoint; the entire form is rendered
 *   client-side and the data arrives ONLY in the NFM_REPLY response_json.
 *   The handler must parse it and do the work. Example: Reading
 *   Assessment.
 *
 * Attendance Setup / Marking are endpoint flows whose NFM_REPLY ALSO
 *   carries the final committed state because some downstream actions
 *   (success ack message, class-roster delivery) live on the NFM side
 *   rather than in the endpoint route. They are routed explicitly below.
 *
 * For the remaining endpoint flows, this handler logs the completion
 * (so a debugger trying to confirm a teacher actually submitted has a
 * trail) but does NOT re-process the payload — that would double-write
 * the data the endpoint already saved.
 *
 * Flow Response Structure:
 * {
 *   "type": "interactive",
 *   "interactive": {
 *     "type": "nfm_reply",
 *     "nfm_reply": {
 *       "response_json": "{...field data...}",
 *       "name": "flow_{flowId}",
 *       "body": "Submitted"
 *     }
 *   }
 * }
 */

const supabase = require('../config/supabase');
const PassageGenerationService = require('../services/reading/passage-generation.service');
const AutoLevelOrchestratorService = require('../services/reading/auto-level-orchestrator.service');
const WhatsAppService = require('../services/whatsapp.service');
const { logToFile } = require('../utils/logger');
const { setUserLanguage } = require('../utils/language-cache');
const { offerDefaultLanguage } = require('../config/languages');
const { clampLanguage } = require('../config/ux-strings');

// Flow IDs - configure via environment variables. Canonical list lives in
// `bot/scripts/setup/flow-configs.js`; this file only reads the IDs that
// either dispatch to a NFM-handler function or warrant explicit completion
// logging.

// Navigate flow (no server endpoint — NFM_REPLY carries the entire payload).
const READING_ASSESSMENT_FLOW_ID = process.env.READING_ASSESSMENT_FLOW_ID || '';

// Endpoint flows whose NFM_REPLY drives downstream side effects (ack message,
// roster delivery). The endpoint route persists the data; this handler
// continues from there.

// Endpoint flows whose NFM_REPLY is purely a delivery acknowledgement —
// data is already persisted by the corresponding `/api/flows/<path>` route.
// Tracked here so completion is observable in logs (vs the previous
// "Unknown flow ID" warning that read like a routing bug).
const ENDPOINT_ONLY_FLOWS = [
  { name: 'Registration',      envVar: 'REGISTRATION_FLOW_ID',      endpoint: '/api/flows/registration' },
  { name: 'Settings',          envVar: 'SETTINGS_FLOW_ID',          endpoint: '/api/flows/settings' },
  { name: 'Status',            envVar: 'STATUS_FLOW_ID',            endpoint: '/api/flows/status' },
  { name: 'Homework Request',  envVar: 'HOMEWORK_FLOW_ID',          endpoint: '/api/flows/homework-request' },
  { name: 'Edit Class',        envVar: 'EDIT_CLASS_FLOW_ID',        endpoint: '/api/flows/edit-class' },
  { name: 'Student Videos',    envVar: 'STUDENT_VIDEOS_FLOW_ID',    endpoint: '/api/flows/student-videos' },
  { name: 'Pic-to-LP Confirm', envVar: 'PIC_LP_FLOW_ID',            endpoint: '/api/flows/pic-lp' },
  { name: 'Quiz Manager',      envVar: 'QUIZ_FLOW_ID',              endpoint: '/api/flows/quiz' },
  // Training multi-answer question. Listed here so a submission that reaches
  // handleFlowResponse (rather than the flowType switch in whatsapp-bot.js,
  // which owns the real handling) is acknowledged instead of warning "Unknown
  // flow ID". The answer itself is recorded by that switch — this is a no-op.
  { name: 'Training MSQ',      envVar: 'TRAINING_MSQ_FLOW_ID',      endpoint: '/api/flows/training-msq' },
];

// Legacy reference — keep the symbol exported so any downstream import
// of this module continues to resolve. The endpoint-only routing block
// below handles the lookup.
const REGISTRATION_FLOW_ID = process.env.REGISTRATION_FLOW_ID || '';

/**
 * Route flow responses to appropriate handlers
 * @param {object} message - WhatsApp message object with interactive.nfm_reply
 * @param {string} phoneNumber - User's phone number
 * @param {string} userId - User's database ID
 * @returns {Promise<boolean>} Success status
 */
async function handleFlowResponse(message, phoneNumber, userId) {
  try {
    // Extract flow ID from response
    const flowName = message.interactive?.nfm_reply?.name || '';
    const flowId = flowName.replace('flow_', '');

    logToFile('📋 Processing flow response', {
      phoneNumber,
      userId,
      flowName,
      flowId
    });

    // Navigate flow — Reading Assessment carries the entire submission in
    // NFM_REPLY; we extract + persist here.
    if (flowId && flowId === READING_ASSESSMENT_FLOW_ID) {
      return await handleReadingAssessmentFlow(message, phoneNumber, userId);
    }

    // Exam-checker "confirm students" — an endpoint flow whose NFM completion
    // must DRIVE the orchestrator forward (confirm → detect questions → grade),
    // not just ack. The endpoint put the confirmed student objects into the
    // completion payload; parse them and hand to the exam handler.
    const EXAM_CONFIRM_FLOW_ID = process.env.EXAM_CHECKER_STUDENTS_FLOW_ID || '';
    if (flowId && EXAM_CONFIRM_FLOW_ID && flowId === EXAM_CONFIRM_FLOW_ID) {
      const ExamCheckerHandler = require('./exam-checker.handler');
      let flowResponse = {};
      try {
        flowResponse = JSON.parse(message.interactive?.nfm_reply?.response_json || '{}');
      } catch (parseErr) {
        logToFile('⚠️ exam-confirm response_json parse failed', { flowId, error: parseErr.message });
      }
      // handleExamFlow only reads user.id, so a minimal shape avoids a DB round-trip.
      const result = await ExamCheckerHandler.handleExamFlow(flowId, flowResponse, phoneNumber, { id: userId });
      return result?.handled !== false;
    }

    // Teacher Training — endpoint flow whose NFM_REPLY drives content
    // delivery. When the teacher selects a course/module in the Flow, the
    // endpoint routes to a SUCCESS screen carrying trainingAction + courseId
    // in extension_message_response; here we parse it and deliver content.
    const TEACHER_TRAINING_FLOW_ID = process.env.TEACHER_TRAINING_FLOW_ID || '';
    if (flowId && TEACHER_TRAINING_FLOW_ID && flowId === TEACHER_TRAINING_FLOW_ID) {
      return await handleTeacherTrainingFlow(message, phoneNumber, userId);
    }

    // Endpoint-only flows: the corresponding `/api/flows/<path>` route has
    // ALREADY persisted the teacher's input by the time we see NFM_REPLY.
    // We log completion (useful when debugging "did the teacher actually
    // submit?") and return true — re-processing the payload here would
    // double-write the data.
    for (const flow of ENDPOINT_ONLY_FLOWS) {
      const configuredId = process.env[flow.envVar] || '';
      if (configuredId && flowId === configuredId) {
        logToFile('📋 Endpoint-flow NFM completion received', {
          flowName: flow.name,
          flowId,
          endpoint: flow.endpoint,
          phoneNumber,
          userId,
          note: 'Data was persisted by the endpoint route; NFM is delivery ack only',
        });
        return true;
      }
    }

    logToFile('⚠️ Unknown flow ID', { flowId, flowName });
    return false;
  } catch (error) {
    logToFile('❌ Error handling flow response', {
      error: error.message,
      stack: error.stack
    });
    return false;
  }
}

/**
 * Handle Reading Assessment Flow submission
 * @param {object} message - Flow response message
 * @param {string} phoneNumber - User's phone number
 * @param {string} userId - User's database ID
 * @returns {Promise<boolean>} Success status
 */
async function handleReadingAssessmentFlow(message, phoneNumber, userId) {
  try {
    logToFile('📚 Processing reading assessment flow submission', { phoneNumber, userId });

    // Parse response JSON
    const responseJson = JSON.parse(message.interactive?.nfm_reply?.response_json || '{}');

    logToFile('📋 Full flow response_json:', { responseJson });

    // Extract fields using actual field names from flow
    // Support BOTH v1 (screen_0_Field_0) and v2 (Field) formats
    //
    // v1 field names (confirmed from submission 2025-11-17T18:42:57Z):
    // - screen_0_Student_Full_Name_0: "Saadat Manto"
    // - screen_0_Language_1: "0_English"
    // - screen_0_Select_the_reading_level_2: "2_Sentences_(Grade_1-2)"
    // - screen_0_Scope_of_Assessment__3: "1_Fluency_+_Comprehension"
    //
    // v2 field names (Flow v2):
    // - Student_Full_Name: "Test Student"
    // - Language: "0_English"
    // - Assessment_Mode: "0_Auto" or "1_Manual"
    // - Select_the_reading_level: "2_Sentences_(Grade_1-2)"
    // - Scope_of_Assessment_: "0_Fluency_Only"

    // 1. Extract student name (direct string) - check both v1 and v2
    const studentName = responseJson.screen_0_Student_Full_Name_0 ||
                        responseJson.Student_Full_Name || '';

    // 2. Extract language (parse "index_label" format) - check both v1 and v2
    const languageRaw = responseJson.screen_0_Language_1 ||
                        responseJson.Language || '';
    const languageParts = languageRaw.split('_'); // ["0", "English"] or ["1", "Urdu"]
    const languageLabel = languageParts.length > 1 ? languageParts.slice(1).join('_') : languageRaw;
    const language = languageLabel.toLowerCase() === 'english' ? 'en' : 'ur';

    // 3. Extract reading level (parse "index_label_details" format) - check both v1 and v2
    const levelRaw = responseJson.screen_0_Select_the_reading_level_2 ||
                     responseJson.Select_the_reading_level || '';
    const levelMatch = levelRaw.match(/^(\d+)_/); // Extract first number: "2_Sentences..." → "2"
    const levelIndex = levelMatch ? levelMatch[1] : '0';
    // Map indices: 0→letters, 1→words, 2→sentences, 3→paragraph

    // 4. Extract comprehension scope (parse "index_label" format) - check both v1 and v2
    const scopeRaw = responseJson.screen_0_Scope_of_Assessment__3 ||
                     responseJson.Scope_of_Assessment_ || '';
    const comprehensionRequired = scopeRaw.includes('Comprehension');

    // 5. Extract assessment mode (Auto/Manual) - check both v1 and v2
    // v1: screen_0_Assessment_Mode_4, v2: Assessment_Mode
    // Values: "0_Auto" or "1_Manual"
    const assessmentModeRaw = responseJson.screen_0_Assessment_Mode_4 ||
                              responseJson.screen_0_Assessment_Type_4 ||
                              responseJson.Assessment_Mode ||
                              responseJson.assessment_mode || '';
    const isAutoMode = assessmentModeRaw.toLowerCase().includes('auto');

    logToFile('📋 Extracted values:', {
      studentName,
      languageRaw,
      language,
      levelRaw,
      levelIndex,
      scopeRaw,
      comprehensionRequired,
      assessmentModeRaw,
      isAutoMode,
      allFields: Object.keys(responseJson).filter(k => k !== 'flow_token')
    });

    // VALIDATION: Check for required fields
    if (!studentName || studentName.trim() === '') {
      throw new Error('Missing required field: Student Name');
    }

    if (!language || !['en', 'ur'].includes(language.toLowerCase())) {
      throw new Error(`Invalid or missing language: ${language}`);
    }

    // For manual mode, level is required; for auto mode, we start at story
    if (!isAutoMode && (!levelIndex || levelIndex.trim() === '')) {
      throw new Error('Missing required field: Level/Grade');
    }

    // Map level index to passage type
    // levelIndex: 0→letters, 1→words, 2→sentences, 3→paragraph
    // For auto mode: always start at story
    let passageType, gradeNumeric;

    if (isAutoMode) {
      // Auto mode: Start at story level (highest complexity)
      passageType = 'story';
      gradeNumeric = 4; // Story level
    } else {
      // Manual mode: Use selected level
      const levelMapping = {
        '0': { passageType: 'letters', gradeNumeric: 0 },    // Kindergarten
        '1': { passageType: 'words', gradeNumeric: 1 },      // Grade 1
        '2': { passageType: 'sentences', gradeNumeric: 2 },  // Grade 1-2
        '3': { passageType: 'paragraph', gradeNumeric: 3 }   // Grade 3-5
      };

      const mapped = levelMapping[levelIndex] || { passageType: 'paragraph', gradeNumeric: 2 };
      passageType = mapped.passageType;
      gradeNumeric = mapped.gradeNumeric;
    }

    logToFile('✅ Validated and mapped:', {
      studentName,
      language,
      levelIndex,
      levelRaw,
      passageType,
      gradeNumeric,
      comprehensionRequired,
      isAutoMode
    });

    // Map passage type to word count (based on existing gradeMap)
    const wordCountMap = {
      'letters': 14,
      'words': 14,
      'sentences': 40,
      'paragraph': 60,
      'story': 100
    };

    const wordCount = wordCountMap[passageType] || 50;

    // Create passageConfig for passage generation service
    const passageConfig = {
      type: passageType,
      wordCount: wordCount,
      grade: gradeNumeric
    };

    // Create assessment record FIRST (required for passage generation)
    const { data: assessment, error: insertError } = await supabase
      .from('reading_assessments')
      .insert({
        user_id: userId,
        student_identifier: studentName,
        grade_level: gradeNumeric,
        language: language,
        passage_type: passageType,
        passage_word_count: wordCount,
        passage_text: '', // Empty string (will be updated by generateAndSendPassage)
        comprehension_requested: comprehensionRequired,
        assessment_mode: isAutoMode ? 'auto' : 'manual',
        starting_level: isAutoMode ? 'story' : passageType,
        status: 'initiated',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) {
      logToFile('❌ Error creating assessment record', {
        error: insertError.message
      });
      throw insertError;
    }

    logToFile('✅ Assessment record created', {
      assessmentId: assessment.id,
      studentName,
      passageConfig,
      isAutoMode
    });

    // For auto mode, use the auto-level orchestrator
    if (isAutoMode) {
      // Start auto-level assessment (sends welcome message and first passage)
      const autoConfig = await AutoLevelOrchestratorService.startAutoAssessment(
        assessment.id,
        userId,
        phoneNumber,
        language,
        gradeNumeric,
        language // userLanguage
      );

      // Generate and send first passage (story level)
      await PassageGenerationService.generateAndSendPassage(
        assessment.id,
        userId,
        phoneNumber,
        language,
        { type: autoConfig.passageType, wordCount: autoConfig.wordCount, grade: autoConfig.gradeLevel },
        language
      );
    } else {
      // Manual mode: Generate and send passage directly
      await PassageGenerationService.generateAndSendPassage(
        assessment.id,
        userId,
        phoneNumber,
        language,
        passageConfig,
        language // userLanguage for instructions
      );
    }

    logToFile('✅ Passage generation and delivery complete', {
      assessmentId: assessment.id
    });

    // Update conversation state. Comprehension/assessment context lives in Redis
    // (see redis-comprehension.service), not a conversations column — writing a
    // non-existent context_data column here previously failed the whole update,
    // so current_state never persisted.
    const { error: updateError } = await supabase
      .from('conversations')
      .update({
        current_state: 'AWAITING_READING_AUDIO'
      })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (updateError) {
      logToFile('⚠️ Warning: Could not update conversation state', {
        error: updateError.message
      });
    }

    return true;

  } catch (error) {
    logToFile('❌ Error processing reading assessment flow', {
      phoneNumber,
      userId,
      error: error.message,
      stack: error.stack,
      rawFlowResponse: {
        hasInteractive: !!message?.interactive,
        hasNfmReply: !!message?.interactive?.nfm_reply,
        hasResponseJson: !!message?.interactive?.nfm_reply?.response_json,
        responseJsonRaw: message?.interactive?.nfm_reply?.response_json || null
      }
    });

    // Send error message to user
    await WhatsAppService.sendMessage(
      phoneNumber,
      'Sorry, something went wrong setting up the reading assessment. Please try typing "/reading test" again.'
    );

    return false;
  }
}

/**
 * Extract field from response JSON with multiple possible naming patterns
 * @param {object} responseJson - Parsed flow response
 * @param {string[]} possibleNames - Possible field name variations
 * @returns {string|null} Field value or null
 */
function extractField(responseJson, possibleNames) {
  for (const key of Object.keys(responseJson)) {
    // Skip flow_token
    if (key === 'flow_token') continue;

    // Check if key contains any of the possible names
    for (const name of possibleNames) {
      if (key.toLowerCase().includes(name.toLowerCase())) {
        return responseJson[key];
      }
    }
  }
  return null;
}

/**
 * Map level to passage type based on grade-dependent rules
 * User specified: ONE passage type per level
 *
 * @param {string} level - Level from flow (kg, 1, 2, 3, 4, 5)
 * @returns {{passageType: string, gradeNumeric: number}}
 */
function mapLevelToPassageType(level) {
  const levelStr = level.toString().toLowerCase();

  // Grade-to-passage-type mapping (ONE type per level)
  const mapping = {
    'kg': { passageType: 'letters', gradeNumeric: 0 },
    'kindergarten': { passageType: 'letters', gradeNumeric: 0 },
    '0': { passageType: 'letters', gradeNumeric: 0 },

    '1': { passageType: 'words', gradeNumeric: 1 }, // Grade 1 defaults to words
    'grade1': { passageType: 'words', gradeNumeric: 1 },

    '2': { passageType: 'paragraph', gradeNumeric: 2 }, // Grade 2+ defaults to paragraphs
    'grade2': { passageType: 'paragraph', gradeNumeric: 2 },

    '3': { passageType: 'paragraph', gradeNumeric: 3 },
    'grade3': { passageType: 'paragraph', gradeNumeric: 3 },

    '4': { passageType: 'paragraph', gradeNumeric: 4 },
    'grade4': { passageType: 'paragraph', gradeNumeric: 4 },

    '5': { passageType: 'paragraph', gradeNumeric: 5 },
    'grade5': { passageType: 'paragraph', gradeNumeric: 5 }
  };

  const result = mapping[levelStr];

  if (!result) {
    // Default to paragraph for unknown grades
    logToFile('⚠️ Unknown level, defaulting to paragraph', { level });
    return { passageType: 'paragraph', gradeNumeric: 2 };
  }

  return result;
}

/**
 * Handle Registration Flow submission
 * Extracts form data and updates user record with full registration info
 *
 * @param {object} message - Flow response message
 * @param {string} phoneNumber - User's phone number
 * @param {string} userId - User's database ID
 * @returns {Promise<boolean>} Success status
 */
async function handleRegistrationFlow(message, phoneNumber, userId) {
  try {
    logToFile('📝 Processing registration flow submission', { phoneNumber, userId });

    const responseJson = JSON.parse(message.interactive?.nfm_reply?.response_json || '{}');

    logToFile('📋 Registration flow response:', { responseJson: Object.keys(responseJson) });

    // Extract fields from flow response
    const fullName = responseJson.full_name || '';
    const country = responseJson.country || '';
    const region = responseJson.region || null;
    const organization = responseJson.organization || null;
    const organizationOther = responseJson.organization_other || null;
    const schoolName = responseJson.school_name || null;
    const grade = responseJson.grade || '';
    const subjects = responseJson.subjects || [];

    // FEAT-102 bd-2132: self-onboarding role. Only WRITE when a valid role is
    // picked (Teacher/Coach/Principal/AEO) — never downgrade an existing leader
    // to teacher on a re-registration that omitted the field.
    const submittedRole = ['teacher', 'coach', 'principal', 'aeo']
      .includes(String(responseJson.role || '').toLowerCase())
      ? String(responseJson.role).toLowerCase() : null;

    // Resolve organization: if "other", use organization_other
    const resolvedOrg = organization === 'other' ? organizationOther : organization;

    // Extract first name from full name
    const firstName = fullName.split(/\s+/)[0] || fullName;

    // Generate portal token
    const { v4: uuidv4 } = require('uuid');
    const portalToken = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Update user record
    const { error: updateError } = await supabase
      .from('users')
      .update({
        first_name: firstName,
        name: fullName,
        country: country,
        region: region,
        organization: resolvedOrg,
        ...(submittedRole ? { role: submittedRole } : {}), // FEAT-102 bd-2132
        school_name: schoolName,
        grades_taught: grade,
        subjects_taught: Array.isArray(subjects) ? subjects : [subjects],
        registration_completed: true,
        registration_completed_at: new Date().toISOString(),
        registration_pending_name: false,
        portal_invite_token: portalToken,
        portal_invite_expires_at: expiresAt.toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      logToFile('❌ Error updating user with registration data', { userId, error: updateError.message });
      throw updateError;
    }

    // Send portal link as WhatsApp message (clickable). Degrades gracefully:
    // if PORTAL_URL is unset, the message omits the link rather than shipping
    // a broken placeholder. See bot/shared/config/branding.js.
    const portalBase = require('../config/branding').portalUrl();
    const portalUrl = portalBase ? `${portalBase}/portal/setup/${portalToken}` : null;

    // Greet her in the language SHE chose on the first screen.
    //
    // This used to read `country === 'PK' ? 'ur' : 'en'`. The country dropdown
    // supplies ISO codes and every ICT teacher picks PK, so the greeting was
    // always Urdu — while registration never wrote preferred_language, leaving
    // her on the schema default of English. She was greeted in Urdu and then
    // silently answered in English forever. The main bot logged the same pattern
    // as BUG-071; the fix here is to stop inferring from country at all.
    const registrationLanguage = clampLanguage(
      responseJson.language || offerDefaultLanguage()
    );
    const userLang = registrationLanguage;

    // Persist it through the ONE writer, LOCKED — she chose this explicitly, and
    // the lock is what stops a later classroom recording overwriting it. This is
    // the step that grows the genuinely-chosen population beyond today's 38.
    const languageStored = await setUserLanguage(userId, registrationLanguage, true);
    logToFile(
      languageStored
        ? '✅ registration: language chosen and locked'
        : '⚠️ registration: language write rejected — greeting still uses the choice',
      { userId, language: registrationLanguage, rule: 'registration-asked' }
    );

    const confirmMessagesWithPortal = {
      en: `Thank you for registering, ${firstName}! You're all set to use NIETE.\n\n🔗 *Set up your NIETE Portal:*\n${portalUrl}\n\nThis link expires in 7 days. What would you like to work on?`,
      ur: `رجسٹریشن کا شکریہ، ${firstName}! آپ اب NIETE استعمال کر سکتے ہیں۔\n\n🔗 *اپنا NIETE پورٹل سیٹ اپ کریں:*\n${portalUrl}\n\nیہ لنک 7 دنوں میں ختم ہو جائے گی۔ آپ کس پر کام کرنا چاہیں گے؟`
    };
    const confirmMessagesNoPortal = {
      en: `Thank you for registering, ${firstName}! You're all set. What would you like to work on?`,
      ur: `رجسٹریشن کا شکریہ، ${firstName}! آپ اب تیار ہیں۔ آپ کس پر کام کرنا چاہیں گے؟`
    };
    const confirmMessages = portalUrl ? confirmMessagesWithPortal : confirmMessagesNoPortal;

    await WhatsAppService.sendMessage(phoneNumber, confirmMessages[userLang] || confirmMessages.en);

    logToFile('✅ Registration completed via flow', {
      userId,
      firstName,
      country,
      region,
      organization: resolvedOrg,
      portalUrl: portalUrl ? portalUrl.substring(0, 50) + '...' : '(PORTAL_URL not configured)'
    });

    return true;
  } catch (error) {
    logToFile('❌ Error handling registration flow', {
      phoneNumber,
      userId,
      error: error.message,
      stack: error.stack
    });

    await WhatsAppService.sendMessage(
      phoneNumber,
      'Sorry, something went wrong with your registration. Please try typing /register to try again.'
    );

    return false;
  }
}

/**
 * Handle Teacher Training Flow closure — deliver the requested content.
 *
 * The Flow endpoint returns a SUCCESS screen with extension_message_response
 * carrying { trainingAction, courseId | levelOrder } based on what the
 * teacher tapped. Here we parse it and drive the next step:
 *   - open_course       → deliver the first pending module of that course
 *   - start_grand_quiz  → kick off the inline Q-by-Q grand quiz state machine
 *   - error             → confirm nothing to do (endpoint already showed error text)
 */
async function handleTeacherTrainingFlow(message, phoneNumber, userId) {
  let payload = {};
  try {
    payload = JSON.parse(message.interactive?.nfm_reply?.response_json || '{}');
  } catch (err) {
    logToFile('⚠️ Training NFM parse failed', { error: err.message });
  }
  // Meta preserves the exact param names the endpoint sends; buildSuccessScreen
  // uses snake_case (training_action, course_id, level_order).
  const trainingAction = payload.training_action;
  const courseId = payload.course_id;
  const moduleId = payload.module_id;
  const levelOrder = payload.level_order;

  logToFile('🎓 Training flow closure', { phoneNumber, userId, trainingAction, courseId, moduleId, levelOrder });

  if (trainingAction === 'open_module' && moduleId) {
    const ContentDelivery = require('../services/training/content-delivery.service');
    return await ContentDelivery.deliverModuleById(moduleId, phoneNumber, { userId });
  }
  if (trainingAction === 'open_course' && courseId) {
    // Legacy — kept in case a stale client cache still emits course_id
    const ContentDelivery = require('../services/training/content-delivery.service');
    return await ContentDelivery.deliverNextModule(userId, courseId, phoneNumber);
  }
  if (trainingAction === 'start_grand_quiz') {
    const QuizDelivery = require('../services/training/quiz-delivery.service');
    return await QuizDelivery.startGrandQuiz(userId, levelOrder, phoneNumber);
  }
  // bd-2451 — a refusal used to land here and fall through to `return true`,
  // so the bot said nothing at all. The Flow's SUCCESS screen is terminal, so
  // from the teacher's side the Flow just closed and the chat stayed silent —
  // reported as "I tapped the locked one and it never replied to me". The
  // endpoint now sends the reason out with the closure; relay it.
  if (trainingAction === 'error') {
    const reason = payload.error_message;
    if (reason) {
      await WhatsAppService.sendMessage(phoneNumber, String(reason));
    } else {
      logToFile('⚠️ Training flow closed on error with no error_message', { phoneNumber, userId });
    }
    return true;
  }
  // Default: teacher just closed the flow.
  return true;
}

/**
 * bd-2432 (port of main-bot FEAT-116 bd-2301) — the observe-visit picker
 * completion. The "Start observation" tap arrives here via the nfm_reply
 * webhook (flowType 'observe_visit' from the detector). Binds the picked
 * teacher (VisitHandler 'complete') and sends the capture prompt naming her
 * and the live framework. Degrades to a plain English prompt on ANY error —
 * a coach is never dead-ended mid-visit.
 */
async function handleObserveVisitFlow(message, phoneNumber, userId) {
  const { buildVisitCapturePrompt, buildScheduleDoneAck, observeLang } = require('../services/observe/observe-strings');
  const { getObservePack } = require('../services/observe/observe-framework');
  const VisitHandler = require('./observe-visit-flow.handler');
  const WhatsAppService = require('../services/whatsapp.service');
  try {
    const responseJson = JSON.parse(message.interactive.nfm_reply.response_json || '{}');
    const flowToken = responseJson.flow_token || userId;
    // bd-2444: three exits — 'start' (bind + capture prompt, the legacy path),
    // 'debrief' (hand off to the chat debrief), 'done' (localized schedule ack).
    const visitAction = responseJson.observe_visit_action
      || ((responseJson.step || 'start') === 'start' ? 'start' : null);
    if (!visitAction) return true; // non-terminal steps are endpoint-side no-ops

    let user = null;
    try {
      const { data } = await supabase
        .from('users')
        .select('id, role, preferences, preferred_language, region')
        .eq('id', userId)
        .single();
      user = data || null;
    } catch (_) { /* arm falls back inside the handler */ }

    if (visitAction === 'debrief') {
      const ObserveDebrief = require('../services/observe/observe-debrief.service');
      await ObserveDebrief.startDebrief(responseJson.session_id, phoneNumber, user);
      return true;
    }

    if (visitAction === 'done') {
      await WhatsAppService.sendMessage(phoneNumber, buildScheduleDoneAck(observeLang(user || {}), {
        teacherName: responseJson.teacher_name,
        date: responseJson.sched_date,
        slot: responseJson.sched_slot,
      }));
      return true;
    }

    const result = await VisitHandler.handle(userId, 'complete', 'BRIEF', responseJson, flowToken, user);

    const framework = ((getObservePack().key) || 'fico').toUpperCase();
    const teacherName = result && result.boundTeacher && result.boundTeacher.teacher_name;
    await WhatsAppService.sendMessage(
      phoneNumber,
      buildVisitCapturePrompt(observeLang(user || {}), { teacherName, framework })
    );
    return true;
  } catch (error) {
    logToFile('❌ observe-visit completion failed — degrading to plain capture prompt', {
      userId, error: error.message,
    });
    try {
      await WhatsAppService.sendMessage(
        phoneNumber,
        '🎙️ When the lesson starts, record it and send me the audio — I\'ll draft the observation form for you.'
      );
    } catch (_) { /* nothing left to degrade to */ }
    return true;
  }
}

module.exports = {
  handleFlowResponse,
  handleReadingAssessmentFlow,
  handleRegistrationFlow,
  handleTeacherTrainingFlow,
  handleObserveVisitFlow,
  mapLevelToPassageType,
  READING_ASSESSMENT_FLOW_ID,
  REGISTRATION_FLOW_ID
};
