'use strict';
/**
 * Assessment Generator Flow endpoint.
 *
 * WhatsApp Flow that collects the spec for an assessment (exam OR classroom
 * practice), then submits it to the external UG_EG service (Orenda-Project/UG_EG)
 * via assessment-generator-client.service. Result comes back on the callback
 * endpoint (POST /webhooks/assessment-generator) and is rendered + delivered.
 *
 * Screens (see docs/flows/assessment-gen-flow.json):
 *   SPEC        → generation_type, grade, subject, chapter (optional), page_ranges
 *   QUESTIONS   → content_source (seen|unseen), question_types multi, per-type counts
 *   SUCCESS     → terminal
 *
 * State between screens is stored in Redis keyed by flow_token so the second
 * screen can carry forward the first screen's picks + we can echo a summary.
 */

const { logToFile } = require('../utils/logger');
const redis = require('../services/cache/railway-redis.service');
const AssessmentGenClient = require('../services/assessment-generator-client.service');

const SESSION_TTL_SECONDS = 15 * 60;

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

function questionsScreen(specSummary) {
  return {
    screen: 'QUESTIONS',
    data: {
      spec_summary: specSummary || '',
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
      // Any missing → send them back to SPEC. The Flow marks required so
      // this branch is defensive.
      return specScreen();
    }

    await writeSession(flowToken, state);

    const summary = [
      `Grade ${state.grade}`,
      _subjectLabel(state.subject),
      state.chapter ? state.chapter : null,
      `Pages ${state.page_ranges}`,
    ].filter(Boolean).join(' · ');

    return questionsScreen(summary);
  }

  if (screen === 'QUESTIONS') {
    if (screenData._action !== 'generate') {
      return questionsScreen(_summaryFromState(state));
    }

    const contentSource = screenData.content_source === 'seen' ? 'seen' : 'unseen';

    // Parse question_types — may arrive as array OR comma-separated string.
    let picked = screenData.question_types;
    if (typeof picked === 'string') {
      picked = picked.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (!Array.isArray(picked)) picked = [];

    // Per-type counts — inputs default to '' when the teacher skips the field.
    const perTypeCounts = {
      'MCQs':                 _parseCount(screenData.count_mcqs),
      'Fill in the Blanks':   _parseCount(screenData.count_fill),
      'Brief Answers':        _parseCount(screenData.count_brief),
    };

    // Only submit types the teacher (a) checked AND (b) gave a count > 0 for.
    // Where a type is checked but no count given, default to 5.
    const questionTypes = picked
      .map((id) => ({ id, count: perTypeCounts[id] > 0 ? perTypeCounts[id] : 5 }))
      .filter((qt) => qt.count > 0);

    if (questionTypes.length === 0
        || !state.grade || !state.subject || !state.page_ranges) {
      return questionsScreen(_summaryFromState(state) + '  ·  Please pick a question type.');
    }

    // Submit to UG_EG asynchronously. On failure surface a friendly message
    // via the SUCCESS screen (the completion NFM lands in flow-response.handler,
    // but the message here also shows in-Flow).
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
        userId, jobId, generationType: state.generation_type,
      });
    } catch (err) {
      logToFile('[assessment-gen-flow] submitJob failed', { err: err.message });
      return successScreen(
        "Something went wrong queueing your assessment. Please try again in a minute.",
        flowToken,
      );
    }

    // Persist the job-id ↔ userId link so the callback endpoint knows who to
    // deliver to. Best-effort — if the write fails we still show success.
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
  const ttlSeconds = 24 * 60 * 60; // 24h, matches UG_EG job TTL
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
};
