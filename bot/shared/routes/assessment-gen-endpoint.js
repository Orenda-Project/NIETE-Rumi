'use strict';
/**
 * Assessment Generator Flow endpoint.
 *
 * WhatsApp Flow that collects the spec for an assessment (exam OR classroom
 * practice), then submits it to the external UG_EG service (Orenda-Project/UG_EG)
 * via assessment-generator-client.service. Result comes back on the callback
 * endpoint (POST /webhooks/assessment-generator) and is rendered + delivered.
 *
 * Screens (see docs/flows/assessment-gen-flow.json) — dynamic state machine:
 *
 *   SPEC              → generation_type, grade, subject, chapter (opt), page_ranges
 *   SEEN_UNSEEN       → radio: Seen / Unseen / Both
 *      ├─ Seen        → submit straight to UG_EG with full default type coverage,
 *      │                land on SUCCESS
 *      └─ Unseen/Both → OBJ_SUBJ radio: Objective / Subjective
 *                        └─ QUESTION_TYPES (dynamic list per {subject, obj/subj})
 *                            with per-type counts
 *                            → submit, land on SUCCESS
 *
 * State between screens is stored in Redis keyed by flow_token.
 * The next-screen decision is made server-side in this endpoint — Meta's
 * `data_exchange` action lets us return `{ screen, data }` dynamically.
 */

const { logToFile } = require('../utils/logger');
const redis = require('../services/cache/railway-redis.service');
const AssessmentGenClient = require('../services/assessment-generator-client.service');
const QuestionConfig = require('../services/assessment-question-config.service');

const SESSION_TTL_SECONDS = 15 * 60;

// Default question-type coverage for the SEEN fast-path (Umama's spec:
// "if Seen, show the Generate Exam option directly" — no type picker).
// We default to a small, universally-safe subset (each type is available for
// every subject in UG_EG's doc). Categories are stamped explicitly so the
// client doesn't have to guess.
const SEEN_FAST_PATH_DEFAULT_TYPES = () => ([
  { id: 'MCQs',                 count: QuestionConfig.DEFAULT_COUNT_PER_TYPE, category: 'objective' },
  { id: 'Fill in the Blanks',   count: QuestionConfig.DEFAULT_COUNT_PER_TYPE, category: 'objective' },
  { id: 'True/False',           count: QuestionConfig.DEFAULT_COUNT_PER_TYPE, category: 'objective' },
]);

function sessionKey(flowToken) {
  return `assessment_gen_flow:${flowToken || 'no-token'}`;
}

async function readSession(flowToken) {
  try {
    const parsed = await redis.get(sessionKey(flowToken));
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch (e) {
    logToFile('[assessment-gen-flow] session read failed', { err: e.message });
    return {};
  }
}

async function writeSession(flowToken, state) {
  try {
    await redis.set(sessionKey(flowToken), state, SESSION_TTL_SECONDS);
  } catch (e) {
    logToFile('[assessment-gen-flow] session write failed', { err: e.message });
  }
}

async function clearSession(flowToken) {
  try {
    await redis.delete(sessionKey(flowToken));
  } catch (_e) { /* not fatal */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen builders
// ─────────────────────────────────────────────────────────────────────────────

function specScreen() {
  return {
    screen: 'SPEC',
    data: {
      grade_options: [
        { id: '1', title: 'Grade 1' },
        { id: '2', title: 'Grade 2' },
        { id: '3', title: 'Grade 3' },
        { id: '4', title: 'Grade 4' },
        { id: '5', title: 'Grade 5' },
      ],
      subject_options: [
        { id: 'Eng', title: 'English' },
        { id: 'Maths', title: 'Maths' },
        { id: 'Urdu', title: 'Urdu' },
        { id: 'Science', title: 'Science' },
        { id: 'Islamiat', title: 'Islamiat' },
        { id: 'SST', title: 'Social Studies' },
        { id: 'GenK', title: 'General Knowledge' },
      ],
    },
  };
}

function seenUnseenScreen(specSummary) {
  return {
    screen: 'SEEN_UNSEEN',
    data: {
      spec_summary: specSummary || '',
    },
  };
}

function objSubjScreen(specSummary) {
  return {
    screen: 'OBJ_SUBJ',
    data: {
      spec_summary: specSummary || '',
    },
  };
}

function questionTypesScreen(specSummary, typeOptions) {
  return {
    screen: 'QUESTION_TYPES',
    data: {
      spec_summary: specSummary || '',
      type_options: typeOptions || [],
      default_count: String(QuestionConfig.DEFAULT_COUNT_PER_TYPE),
    },
  };
}

function successScreen(message, flowToken) {
  return {
    screen: 'SUCCESS',
    data: {
      extension_message_response: {
        params: { flow_token: flowToken || 'assessment-gen' },
      },
      message,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Submit helper (shared by SEEN fast-path and QUESTION_TYPES full path)
// ─────────────────────────────────────────────────────────────────────────────

async function _submitAndBuildSuccess({ state, userId, flowToken, contentSource, questionTypes }) {
  let jobId = null;
  try {
    const submit = await AssessmentGenClient.submitJob({
      generationType: state.generation_type,
      grade: state.grade,
      subject: state.subject,
      pageRanges: state.page_ranges,
      contentSource,
      questionTypes,
      curriculum: 'ICT',
    });
    jobId = submit.jobId;
    logToFile('[assessment-gen-flow] job submitted', {
      userId, jobId, generationType: state.generation_type, contentSource,
    });
  } catch (err) {
    logToFile('[assessment-gen-flow] submitJob failed', { err: err.message });
    return successScreen(
      "Something went wrong queueing your assessment. Please try again in a minute.",
      flowToken,
    );
  }

  try {
    await _persistJobLink({
      jobId,
      userId,
      generationType: state.generation_type,
      grade: state.grade,
      subject: state.subject,
      pageRanges: state.page_ranges,
      contentSource,
      questionTypes,
    });
  } catch (err) {
    logToFile('[assessment-gen-flow] persist job link failed', { err: err.message });
  }

  await clearSession(flowToken);

  const typeLabel = state.generation_type === 'class_assessment'
    ? 'classroom practice'
    : 'exam';
  return successScreen(
    `Making your Grade ${state.grade} ${_subjectLabel(state.subject)} ${typeLabel} on pages ${state.page_ranges}. We'll send the PDF when it's ready.`,
    flowToken,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleAssessmentGenInit(userId, flowToken) {
  logToFile('📝 Assessment Gen Flow INIT', { userId, flowToken });
  await clearSession(flowToken);
  return specScreen();
}

async function handleAssessmentGenDataExchange(userId, screen, screenData, flowToken) {
  logToFile('📝 Assessment Gen Flow data_exchange', {
    userId, screen, action: screenData?._action, flowToken,
  });
  const state = await readSession(flowToken);

  // ───────────────────────── SPEC → SEEN_UNSEEN ─────────────────────────
  if (screen === 'SPEC') {
    if (screenData._action !== 'spec_submit') return specScreen();
    state.generation_type = screenData.generation_type === 'class_assessment'
      ? 'class_assessment'
      : 'exam';
    state.grade = String(screenData.grade || '').trim();
    state.subject = String(screenData.subject || '').trim();
    state.chapter = String(screenData.chapter || '').trim();
    state.page_ranges = String(screenData.page_ranges || '').trim();

    if (!state.grade || !state.subject || !state.page_ranges) {
      return specScreen();
    }

    await writeSession(flowToken, state);
    return seenUnseenScreen(_summaryFromState(state));
  }

  // ─────────────── SEEN_UNSEEN → (SUCCESS | OBJ_SUBJ) ───────────────
  if (screen === 'SEEN_UNSEEN') {
    if (screenData._action !== 'pick_source') return seenUnseenScreen(_summaryFromState(state));

    // Guard: if state missing (session expired) — reset to SPEC.
    if (!state.grade || !state.subject || !state.page_ranges) return specScreen();

    const rawChoice = String(screenData.content_source || '').trim();
    const contentSource = ['seen', 'unseen', 'both'].includes(rawChoice) ? rawChoice : 'unseen';
    state.content_source = contentSource;
    await writeSession(flowToken, state);

    if (contentSource === 'seen') {
      // Fast-path per Umama's spec: go straight to submit with default type coverage.
      return _submitAndBuildSuccess({
        state,
        userId,
        flowToken,
        contentSource: 'seen',
        questionTypes: SEEN_FAST_PATH_DEFAULT_TYPES(),
      });
    }

    // 'unseen' or 'both' → collect objective/subjective next.
    // For 'both': UG_EG's client currently only accepts one contentSource per
    // job (`['seen']` OR `['unseen']`), so we treat 'both' as 'unseen' at
    // submit time and let the teacher pick from the full type list.
    return objSubjScreen(_summaryFromState(state));
  }

  // ─────────────── OBJ_SUBJ → QUESTION_TYPES (dynamic) ───────────────
  if (screen === 'OBJ_SUBJ') {
    if (screenData._action !== 'pick_category') return objSubjScreen(_summaryFromState(state));
    if (!state.grade || !state.subject) return specScreen();

    const rawCat = String(screenData.category || '').trim();
    const category = rawCat === 'subjective' ? 'subjective' : 'objective';
    state.category = category;
    await writeSession(flowToken, state);

    const typeOptions = QuestionConfig.getQuestionTypes({
      subject: state.subject,
      grade: state.grade,
      category,
    });
    if (typeOptions.length === 0) {
      // Config-level failure — surface a friendly error rather than crash.
      logToFile('[assessment-gen-flow] no question types for combo', {
        subject: state.subject, grade: state.grade, category,
      });
      return successScreen(
        "We couldn't find any question types for that combination right now. Please try a different subject.",
        flowToken,
      );
    }
    return questionTypesScreen(_summaryFromState(state), typeOptions);
  }

  // ─────────────── QUESTION_TYPES → SUCCESS (submit) ───────────────
  if (screen === 'QUESTION_TYPES') {
    if (screenData._action !== 'generate') {
      // Non-submit ping — re-render.
      const typeOptions = QuestionConfig.getQuestionTypes({
        subject: state.subject,
        grade: state.grade,
        category: state.category || 'objective',
      });
      return questionTypesScreen(_summaryFromState(state), typeOptions);
    }
    if (!state.grade || !state.subject || !state.page_ranges) return specScreen();

    // Parse question_types — may arrive as array OR comma-separated string.
    let picked = screenData.question_types;
    if (typeof picked === 'string') {
      picked = picked.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (!Array.isArray(picked)) picked = [];

    // Per-type counts. Payload uses `count_<slug>` keys where <slug> is the
    // type id lowercased with non-alphanum → underscore.
    // We also stamp `category` per-item from the OBJ_SUBJ pick so the client
    // can partition unambiguously (needed for ids that are OBJ in one subject
    // and SUBJ in another, e.g. Brief Answers).
    const pickedCategory = state.category === 'subjective' ? 'subjective' : 'objective';
    const questionTypes = picked
      .filter((id) => QuestionConfig.isSupported(id))
      .map((id) => {
        const slug = _slugForCountKey(id);
        const raw = screenData[`count_${slug}`];
        const parsed = _parseCount(raw);
        const capped = Math.min(parsed || QuestionConfig.DEFAULT_COUNT_PER_TYPE, QuestionConfig.MAX_COUNT_PER_TYPE);
        return { id, count: capped, category: pickedCategory };
      })
      .filter((qt) => qt.count > 0);

    if (questionTypes.length === 0) {
      const typeOptions = QuestionConfig.getQuestionTypes({
        subject: state.subject,
        grade: state.grade,
        category: state.category || 'objective',
      });
      const out = questionTypesScreen(_summaryFromState(state) + '  ·  Please pick a question type.', typeOptions);
      return out;
    }

    // 'both' → send as 'unseen' at UG_EG (single-source constraint).
    const contentSource = state.content_source === 'seen' ? 'seen' : 'unseen';

    return _submitAndBuildSuccess({
      state,
      userId,
      flowToken,
      contentSource,
      questionTypes,
    });
  }

  logToFile('⚠️ Unknown screen in assessment-gen flow', { screen });
  return specScreen();
}

async function handleAssessmentGenBack(userId, flowToken /*, screen */) {
  logToFile('📝 Assessment Gen Flow BACK', { userId, flowToken });
  return specScreen();
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

function _parseCount(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Turn a type id (e.g. 'Fill in the Blanks') into the count field slug
 * used in the Flow payload: 'fill_in_the_blanks'.
 * Kept in sync with the Flow JSON `on-click-action.payload` keys.
 */
function _slugForCountKey(id) {
  return String(id).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

const SUBJECT_LABELS = {
  Eng: 'English',
  Maths: 'Maths',
  Urdu: 'Urdu',
  Science: 'Science',
  Islamiat: 'Islamiat',
  SST: 'Social Studies',
  GenK: 'General Knowledge',
};
function _subjectLabel(id) {
  return SUBJECT_LABELS[id] || String(id || '');
}

function _summaryFromState(state) {
  return [
    state.grade ? `Grade ${state.grade}` : null,
    state.subject ? _subjectLabel(state.subject) : null,
    state.chapter || null,
    state.page_ranges ? `Pages ${state.page_ranges}` : null,
  ].filter(Boolean).join(' · ');
}

/**
 * Store the job → user link so the callback endpoint can deliver to the right
 * teacher. Uses Redis (same TTL as the UG_EG 24h job TTL).
 */
async function _persistJobLink(link) {
  const ttlSeconds = 24 * 60 * 60;
  await redis.set(`assessment_gen_job:${link.jobId}`, link, ttlSeconds);
}

module.exports = {
  handleAssessmentGenInit,
  handleAssessmentGenDataExchange,
  handleAssessmentGenBack,
  // exported for the callback endpoint
  _readJobLink: async (jobId) => redis.get(`assessment_gen_job:${jobId}`),
  _clearJobLink: async (jobId) => redis.delete(`assessment_gen_job:${jobId}`),
  // exported for tests
  _subjectLabel,
  _parseCount,
  _slugForCountKey,
};
