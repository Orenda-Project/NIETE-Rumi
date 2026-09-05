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
const ConversationState = require('../services/conversation-state.service');
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

    // the teacher now owes us a recording of her student reading.
    //
    // This used to stamp `current_state` onto her newest `conversations` row, which
    // put the state on a message-log entry with a lifetime of "until the next
    // message". It also used `.update().eq().order().limit()`, which PostgREST does
    // not support as a bounded update — the order/limit are ignored, so this was
    // rewriting EVERY conversation row for the user.
    //
    // 6 hours: she has to get to the child and record them, which may be the next
    // lesson or after school.
    await ConversationState.setState(userId, {
      flow: 'reading',
      step: 'AWAITING_READING_AUDIO',
      payload: { assessmentId: assessment.id },
      ttlSeconds: 21600,
    });

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
    let firstName = fullName.split(/\s+/)[0] || fullName;

    // The terminal Flow payload loses the earlier screens' values (name/country come
    // back empty — bd-2480). registration-endpoint.js now persists each screen to the
    // user row as it is submitted, so here we must NOT overwrite those columns with the
    // payload's empties: write a field only when the payload actually carries it, and
    // read the persisted first_name back for the greeting when the payload dropped it.
    if (!firstName) {
      try {
        const { data: existing } = await supabase.from('users').select('first_name, name, country').eq('id', userId).single();
        if (existing) {
          firstName = existing.first_name || firstName;
        }
      } catch (_) { /* greeting falls back to the payload value */ }
    }
    const setIf = (v) => (v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === ''));

    // Generate portal token
    const { v4: uuidv4 } = require('uuid');
    const portalToken = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Update user record
    const { error: updateError } = await supabase
      .from('users')
      .update({
        ...(setIf(firstName) ? { first_name: firstName } : {}),
        ...(setIf(fullName) ? { name: fullName } : {}),
        ...(setIf(country) ? { country } : {}),
        ...(setIf(region) ? { region } : {}),
        ...(setIf(resolvedOrg) ? { organization: resolvedOrg } : {}),
        ...(submittedRole ? { role: submittedRole } : {}), // FEAT-102 bd-2132; per-screen write is the primary source now
        ...(setIf(schoolName) ? { school_name: schoolName } : {}),
        ...(setIf(grade) ? { grades_taught: grade } : {}),
        ...((Array.isArray(subjects) ? subjects.length : subjects) ? { subjects_taught: Array.isArray(subjects) ? subjects : [subjects] } : {}),
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
  // a refusal used to land here and fall through to `return true`,
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
  const { buildVisitCapturePrompt, buildScheduleDoneAck, observeLang, buildVisitCancelledAck, buildVisitRescheduledAck } = require('../services/observe/observe-strings');
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

    // bd-6cnaj — a debrief that is DONE but whose report never reached the
    // teacher. Must return before the fall-through below, which ends in
    // buildVisitCapturePrompt; the same ordering trap that had a cancelled
    // visit still asking the coach to record a lesson.
    if (visitAction === 'send_report') {
      const ObserveSend = require('../services/observe/observe-send.service');
      await ObserveSend.startSendFlow(responseJson.session_id, phoneNumber, user);
      return true;
    }

    if (visitAction === 'resume') {
      // bd-tju8f: a stage-A row tapped inside the visit Flow re-enters the
      // observation at its own step (photo/LP prompt, form re-send, retry).
      const ObserveResume = require('../services/observe/observe-resume.service');
      await ObserveResume.resume(responseJson.session_id, phoneNumber, user);
      return true;
    }

    if (visitAction === 'debrief') {
      const ObserveDebrief = require('../services/observe/observe-debrief.service');
      await ObserveDebrief.startDebrief(responseJson.session_id, phoneNumber, user);
      return true;
    }

    // bd-88krt — cancel and reschedule MUST return before the fall-through
    // below, which ends in buildVisitCapturePrompt. The operator cancelled a
    // visit on staging and was still told to "record and send me the audio",
    // because only 'debrief' and 'done' were special-cased and everything else
    // dropped into the capture path.
    // bd-k3w4l / bd-ve7kd — adding or removing a school ends here. Without
    // this branch 'roster' fell through to buildVisitCapturePrompt and told the
    // coach to record a lesson after she'd added a school; and a Flow closed
    // with no params landed on the generic "Thanks for your response". The
    // in-Flow screen already confirmed what happened, so the only thing left to
    // do is continue the loop she picked.
    // Teacher-level roster changes emit their own action: the "what next?"
    // options differ from the school screen's, and an unhandled action falls
    // through to the capture prompt below — answering a roster tap with
    // "tell me about the lesson you observed".
    if (visitAction === 'roster_teacher') {
      const { rosterTeacherNextTarget } = require('../services/observe/observe-teacher-admin.service');
      await _continueObserveLoop(rosterTeacherNextTarget(responseJson.roster_next), user, phoneNumber, userId);
      return;
    }

    if (visitAction === 'roster') {
      const { rosterNextTarget } = require('../services/observe/observe-school-admin.service');
      await _continueObserveLoop(rosterNextTarget(responseJson.roster_next), user, phoneNumber, userId);
      return true;
    }

    if (visitAction === 'cancelled') {
      const ObserveState = require('../services/observe/observe-state.service');
      // Clear any armed capture state too, so a stray voice note can't start an
      // observation for a visit she just cancelled.
      try { await ObserveState.clearState(userId); } catch (_) { /* best effort */ }
      await WhatsAppService.sendMessage(phoneNumber, buildVisitCancelledAck(observeLang(user || {}), {
        teacherName: responseJson.teacher_name,
      }));
      await _continueObserveLoop(_visitNextTarget(responseJson.visit_next), user, phoneNumber, userId);
      return true;
    }

    if (visitAction === 'rescheduled') {
      await WhatsAppService.sendMessage(phoneNumber, buildVisitRescheduledAck(observeLang(user || {}), {
        teacherName: responseJson.teacher_name,
        date: responseJson.sched_date || responseJson.date,
        slot: responseJson.sched_slot || responseJson.slot,
      }));
      await _continueObserveLoop(_visitNextTarget(responseJson.visit_next), user, phoneNumber, userId);
      return true;
    }

    if (visitAction === 'done') {
      await WhatsAppService.sendMessage(phoneNumber, buildScheduleDoneAck(observeLang(user || {}), {
        teacherName: responseJson.teacher_name,
        date: responseJson.sched_date,
        slot: responseJson.sched_slot,
      }));
      await _continueObserveLoop(_visitNextTarget(responseJson.visit_next), user, phoneNumber, userId);
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

/** Where the schedule-side loop choices go. 'schedule' reopens on the coach's
 *  own upcoming list, which is where she picks the next teacher from. */
function _visitNextTarget(next) {
  if (next === 'schedule') return { reopen: true, screen: null };
  if (next === 'menu') return { reopen: true, screen: null };
  return { reopen: false, screen: null };
}

/**
 * Reopen the picker for the next turn of the loop. Best-effort by design: if
 * the reopen fails the coach has still had her action confirmed on-screen, and
 * /observe always gets her back in. Never throws into the caller.
 */
async function _continueObserveLoop(target, user, phoneNumber, userId) {
  if (!target || !target.reopen || !user) return;
  try {
    const { reopenObserveVisitFlow } = require('./observe-command.handler');
    let screenData;
    if (target.screen === 'MANAGE_SCHOOLS') {
      // MANAGE_SCHOOLS declares `options`; opening straight onto it in navigate
      // mode means WE supply them — there is no endpoint round-trip to do it.
      const admin = require('../services/observe/observe-school-admin.service');
      const mine = await admin.listMySchools(userId).catch(() => []);
      if (!mine.length) return reopenObserveVisitFlow(user, phoneNumber, null);
      // EVERY key the screen declares, or the screen fails to render and the
      // coach's tap does nothing — the payload-schema-error class again. In
      // navigate mode there is no endpoint round-trip to fill these in, so the
      // shape must match what the endpoint's own `manage` step would return.
      screenData = {
        options: mine.slice(0, admin.RESULT_CAP).map((m) => ({
          id: String(m.school_ext_id),
          title: String(m.school_name || m.school_ext_id).slice(0, 30),
          description: m.emis ? `EMIS ${m.emis}` : '',
          metadata: '',
        })),
      };
    }
    const sent = await reopenObserveVisitFlow(user, phoneNumber, target.screen, screenData);
    // Never strand her: if opening straight onto the screen was rejected, put
    // the menu back in front of her rather than leaving the tap looking dead.
    if (sent === false && target.screen) {
      await reopenObserveVisitFlow(user, phoneNumber, null);
    }
  } catch (err) {
    logToFile('observe loop reopen failed — coach can still use /observe', { userId, error: err.message });
  }
}

/**
 * Acknowledge a /status Flow completion in the CHAT.
 *
 * The endpoint already did every write before the Flow closed, so this only
 * acknowledges — it must not re-persist or re-clear anything. Without it the
 * completion fell to whatsapp-bot.js's "Unknown flow type" arm and answered
 * "Thanks for your response! Type /menu…", which told a teacher who had just
 * stopped a task nothing about it. Same failure the `remark` and `observe_visit`
 * branches exist to prevent.
 *
 * Only the STOP gets a chat line, and that is deliberate:
 *
 *  · cancelled — a state change she may want to look back on tomorrow, after the
 *    Flow's SUCCESS screen is long gone. The chat is the only persistent record.
 *  · resumed   — the SUCCESS screen already told her to reply here to pick up, and
 *    the state is untouched, so a chat line would say the same thing twice. The
 *    remark branch calls this out explicitly: "ONE message, not two."
 *  · done/idle/noop — she closed a menu. Nothing happened; saying so is noise.
 *
 * Reuses `resumeDiscarded`, which is already the bilingual copy for "that one is
 * closed" — no new string, so no language-registry surface added (root CLAUDE.md
 * Rule 20).
 *
 * @returns {Promise<boolean>} always true — the completion was recognised and
 *   handled, whatever the action was. The caller uses this only to know it should
 *   not fall through to the generic ack.
 */
async function handleStatusFlowCompletion(responseJson, from, user) {
  const action = (responseJson && responseJson.status_action) || 'done';

  logToFile('📋 Status flow completion', {
    from,
    action,
    resourceKind: (responseJson && responseJson.resource_kind) || null,
  });

  if (action === 'cancelled') {
    try {
      const { resolveUx } = require('../config/ux-strings');
      await WhatsAppService.sendMessage(from, resolveUx('resumeDiscarded', { user }));
    } catch (err) {
      // The cancel itself already succeeded inside the Flow; a failed ack must not
      // read as a failed cancel, so this is logged and swallowed.
      logToFile('⚠️ status cancel ack failed (the stop itself already applied)', {
        from, error: err.message,
      });
    }
  }

  return true;
}


/**
 * What she reads instead of a closing screen.
 *
 * The Flow used to end on a SUBMITTED screen whose whole content was one
 * sentence and a Close button — a message ABOUT the chat, shown anywhere but
 * the chat, costing a tap to dismiss. The Flow now closes on submit and the
 * sentence arrives here.
 *
 * Every branch says what happens next, because that is the only thing she can
 * act on: wait, or send /assessment again.
 */
async function handleAssessmentFlowCompletion(responseJson, from, user) {
  // The tag when we get one — but Meta DROPS `extension_message_response` from
  // a completion, so the usual case is that it is absent and the token is all
  // we have. Routing on the token without deriving the ACTION from it too would
  // just move the silence one step later: the handler would fall to its
  // unrecognised branch and say nothing, which is identical from her side.
  const token = String(responseJson?.flow_token || '');
  const fromToken = token.includes(':assessment-review:') ? 'rebuilt'
    : token.includes(':assessment-gen:') ? 'queued'
      : '';
  let action = String(responseJson?.assessment_action || fromToken);
  let summary = String(responseJson?.summary || '').trim();

  // A NEW paper is submitted HERE, not on the screen. CONFIRM is terminal, so
  // its Footer closes the Flow instead of calling the endpoint — the request
  // row and the queued job would never exist otherwise, and the message below
  // would promise a paper nobody was making.
  //
  // Done BEFORE the acknowledgement so a failure changes what she is told,
  // rather than following a cheerful "about a minute" with silence.
  if (action === 'queued') {
    let result;
    try {
      const { submitFromCompletion } = require('../routes/assessment-gen-endpoint');
      result = await submitFromCompletion({
        flowToken: token,
        userId: user?.id,
        outputFormat: responseJson?.output_format,
        answerKey: responseJson?.answer_key,
        answerLines: responseJson?.answer_lines,
      });
    } catch (err) {
      logToFile('[assessment] submit from completion threw', { error: err?.message });
    }
    if (result?.status !== 'queued') {
      action = 'queue_failed';
    } else if (!summary) {
      summary = result.summary || '';
    }
  }

  const MESSAGES = {
    queued: summary
      ? `📝 Making your paper — about a minute.\n\n${summary}`
      : '📝 Making your paper — about a minute.',
    rebuilt: summary
      ? `📝 Making your paper again — a few seconds.\n\n${summary}`
      : '📝 Making your paper again — a few seconds.',
    queue_failed: "Something went wrong starting your paper, so nothing is being made. "
      + 'Send /assessment to try again.',
    rebuild_failed: "Sorry — we couldn't rebuild that paper. "
      + 'Send /assessment to make a new one.',
  };

  const text = MESSAGES[action];
  if (!text) {
    // An unrecognised tag is ours to notice, not hers to puzzle over: stay
    // silent rather than send something that does not fit what she just did.
    logToFile('[assessment] unrecognised completion tag — no ack sent', { from, action });
    return;
  }

  await WhatsAppService.sendMessage(from, text);
  logToFile('[assessment] completion acknowledged in chat', { userId: user?.id, action });
}

module.exports = {
  handleAssessmentFlowCompletion,
  handleFlowResponse,
  handleReadingAssessmentFlow,
  handleRegistrationFlow,
  handleTeacherTrainingFlow,
  handleObserveVisitFlow,
  handleStatusFlowCompletion,
  mapLevelToPassageType,
  READING_ASSESSMENT_FLOW_ID,
  REGISTRATION_FLOW_ID
};
