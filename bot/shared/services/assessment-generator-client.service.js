'use strict';
/**
 * Assessment Generator Service client.
 *
 * Talks to the Orenda-Project/UG_EG (EG_Pipeline) HTTP service. The service
 * takes a curriculum spec (grade, subject, page ranges, question types, counts)
 * and returns a structured exam paper (HTML + JSON).
 *
 * We use the ASYNC endpoint by default:
 *   POST /api/v2/generate-exam  {..., callback_url} → 202 + {job_id}
 *   ↳ UG_EG posts the completed result to callback_url when ready (~45–60s).
 *   ↳ Polling fallback: GET /api/v2/webhook-status/{job_id}
 *
 * Auth: single header `api-key: <ASSESSMENT_GEN_API_KEY>` on every request.
 *
 * Docs: https://github.com/Orenda-Project/UG_EG/blob/main/docs/integration-guide.md
 *
 * IMPORTANT: never log the api-key. All logs go through the redactor below.
 */

const axios = require('axios');
const { logToFile } = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// Config (env-driven, all fetched fresh each call so runtime overrides work)
// ─────────────────────────────────────────────────────────────────────────────

function getConfig() {
  return {
    baseUrl: (process.env.ASSESSMENT_GEN_BASE_URL || '').replace(/\/+$/, ''),
    apiKey: process.env.ASSESSMENT_GEN_API_KEY || '',
    callbackUrl: process.env.ASSESSMENT_GEN_CALLBACK_URL || '',
  };
}

function isConfigured() {
  const { baseUrl, apiKey } = getConfig();
  return Boolean(baseUrl && apiKey);
}

function authHeaders() {
  const { apiKey } = getConfig();
  return { 'api-key': apiKey, 'Content-Type': 'application/json' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Request-body builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map the WhatsApp-Flow spec to the UG_EG request body.
 *
 * Spec:
 *   generationType : 'exam' | 'class_assessment'
 *   grade          : 1..5
 *   subject        : 'Eng' | 'Maths' | 'Urdu' | 'Islamiat' | 'Science' | 'GenK' | 'SST'
 *   pageRanges     : e.g. '10-15' or '10-15, 20'
 *   contentSource  : 'seen' | 'unseen'
 *   questionTypes  : Array of {id, count} where id ∈ {'MCQs','Fill in the Blanks','Brief Answers'}
 *   curriculum     : default 'ICT'
 *   callbackUrl    : where UG_EG posts the async result
 *
 * Notes on UG_EG shape (from integration-guide.md):
 * - `question_types` at the top level is the seen/unseen partition
 *   (['seen'] | ['unseen'] | both).
 * - Objective-vs-subjective sub-partition + per-type counts live in
 *   `unseen_objective_types` / `unseen_subjective_types` +
 *   `unseen_objective_counts` / `unseen_subjective_counts` (mirrored on the
 *   `seen_*` variants).
 * - Locked scope: MCQs + Fill-in-the-Blanks are OBJECTIVE; Brief Answers is
 *   SUBJECTIVE. That mapping lives here (single source of truth).
 */
const OBJECTIVE_TYPES = new Set(['MCQs', 'Fill in the Blanks']);
const SUBJECTIVE_TYPES = new Set(['Brief Answers']);

function buildRequestBody(spec) {
  const {
    generationType = 'exam',
    grade,
    subject,
    pageRanges,
    contentSource,           // 'seen' | 'unseen'
    questionTypes = [],      // [{ id, count }]
    curriculum = 'ICT',
    callbackUrl,
  } = spec;

  if (!grade)          throw new Error('assessment-gen: grade is required');
  if (!subject)        throw new Error('assessment-gen: subject is required');
  if (!pageRanges)     throw new Error('assessment-gen: pageRanges is required');
  if (!contentSource || !['seen', 'unseen'].includes(contentSource)) {
    throw new Error('assessment-gen: contentSource must be "seen" or "unseen"');
  }
  if (!Array.isArray(questionTypes) || questionTypes.length === 0) {
    throw new Error('assessment-gen: at least one question type is required');
  }

  // Partition question types into objective / subjective + counts maps.
  const objectiveTypes = [];
  const subjectiveTypes = [];
  const objectiveCounts = {};
  const subjectiveCounts = {};
  for (const qt of questionTypes) {
    const id = String(qt.id || '').trim();
    const count = Math.max(1, parseInt(qt.count, 10) || 0);
    if (!id || count === 0) continue;
    if (OBJECTIVE_TYPES.has(id)) {
      objectiveTypes.push(id);
      objectiveCounts[id] = count;
    } else if (SUBJECTIVE_TYPES.has(id)) {
      subjectiveTypes.push(id);
      subjectiveCounts[id] = count;
    } else {
      // Unknown type — skip rather than fail the whole request. Log so we
      // notice if the Flow ever adds a new type we forgot to map here.
      logToFile('[assessment-gen] unknown question type — skipped', { id });
    }
  }

  if (objectiveTypes.length === 0 && subjectiveTypes.length === 0) {
    throw new Error('assessment-gen: no valid question types after mapping');
  }

  const body = {
    generation_type: generationType === 'class_assessment' ? 'class_assessment' : 'exam',
    curriculum,
    grade: Number(grade),
    subject: String(subject),
    page_ranges: String(pageRanges),
    question_types: [contentSource],   // ['seen'] or ['unseen']
    image_generation_enabled: false,
    include_answer_key: false,
    enable_review: false,
    generate_bilingual: false,
    bilingual_required: false,
  };

  // Seen vs unseen — same structure, different key prefixes.
  const prefix = contentSource;        // 'seen' | 'unseen'
  const partitions = [];
  if (objectiveTypes.length > 0)  partitions.push('objective');
  if (subjectiveTypes.length > 0) partitions.push('subjective');
  body[`${prefix}_categories`] = partitions;

  if (objectiveTypes.length > 0) {
    body[`${prefix}_objective_types`]  = objectiveTypes;
    body[`${prefix}_objective_counts`] = objectiveCounts;
  }
  if (subjectiveTypes.length > 0) {
    body[`${prefix}_subjective_types`]  = subjectiveTypes;
    body[`${prefix}_subjective_counts`] = subjectiveCounts;
  }

  if (callbackUrl) body.callback_url = callbackUrl;

  return body;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kick off an async generation. Returns { jobId } on success.
 * The teacher-facing progress ping / delivery happens off the callback later.
 *
 * @param {object} spec  see buildRequestBody
 * @param {object} [opts]
 * @param {string} [opts.callbackUrl] override ASSESSMENT_GEN_CALLBACK_URL
 * @param {number} [opts.timeoutMs=15000] axios timeout on the 202 handshake
 */
async function submitJob(spec, opts = {}) {
  if (!isConfigured()) {
    throw new Error('assessment-gen: not configured (ASSESSMENT_GEN_BASE_URL or ASSESSMENT_GEN_API_KEY missing)');
  }
  const { baseUrl, callbackUrl: envCb } = getConfig();
  const callbackUrl = opts.callbackUrl || envCb || undefined;
  const body = buildRequestBody({ ...spec, callbackUrl });
  const url = `${baseUrl}/api/v2/generate-exam`;
  const timeoutMs = opts.timeoutMs || 15000;

  logToFile('[assessment-gen] submitting async job', {
    url,
    hasCallbackUrl: Boolean(callbackUrl),
    generationType: body.generation_type,
    grade: body.grade,
    subject: body.subject,
    pageRanges: body.page_ranges,
    contentSource: spec.contentSource,
    questionTypes: (spec.questionTypes || []).map((q) => q.id),
  });

  try {
    const res = await axios.post(url, body, {
      headers: authHeaders(),
      timeout: timeoutMs,
      validateStatus: () => true, // handle non-2xx ourselves
    });

    if (res.status !== 202 && res.status !== 200) {
      const errMsg = _summarizeError(res);
      logToFile('[assessment-gen] submitJob non-2xx', { status: res.status, err: errMsg });
      const e = new Error(`assessment-gen submit failed (${res.status}): ${errMsg}`);
      e.status = res.status;
      throw e;
    }

    const jobId = res.data && (res.data.job_id || res.data.jobId);
    if (!jobId) {
      throw new Error(`assessment-gen: 2xx response but no job_id: ${JSON.stringify(res.data).slice(0, 200)}`);
    }
    logToFile('[assessment-gen] job accepted', { jobId });
    return { jobId };
  } catch (err) {
    if (err.status) throw err;
    // Redact axios's default error which may echo request headers with the key.
    const clean = new Error(`assessment-gen submit failed: ${err.message}`);
    clean.cause = err.code || err.name;
    throw clean;
  }
}

/**
 * Poll the job status. Returns:
 *   { status: 'pending'|'processing'|'completed'|'failed', data?: {...}, error?: string }
 *
 * On `completed` the exam result is at `data` (extracted from the polling
 * shape's `data.response`).
 */
async function pollStatus(jobId, opts = {}) {
  if (!isConfigured()) throw new Error('assessment-gen: not configured');
  if (!jobId) throw new Error('assessment-gen: jobId is required');
  const { baseUrl } = getConfig();
  const url = `${baseUrl}/api/v2/webhook-status/${encodeURIComponent(jobId)}`;
  const timeoutMs = opts.timeoutMs || 10000;

  const res = await axios.get(url, {
    headers: authHeaders(),
    timeout: timeoutMs,
    validateStatus: () => true,
  });
  if (res.status !== 200) {
    const errMsg = _summarizeError(res);
    logToFile('[assessment-gen] pollStatus non-2xx', { jobId, status: res.status, err: errMsg });
    throw new Error(`assessment-gen poll failed (${res.status}): ${errMsg}`);
  }
  // Polling shape (from api-responses.md): { status, job_id, job_status,
  // data: { status, response: {...exam...}, error? } }
  const outer = res.data || {};
  const inner = outer.data || {};
  const jobStatus = outer.job_status || inner.status;
  if (jobStatus === 'completed') {
    return { status: 'completed', data: inner.response || null };
  }
  if (jobStatus === 'failed') {
    return { status: 'failed', error: inner.error || 'unknown error' };
  }
  return { status: jobStatus || 'pending' };
}

/**
 * Normalise a callback body into a consistent shape.
 *
 * Callback shape (from api-responses.md):
 *   { status: 'completed', job_id, data: { exam_paper, exam_json, ..., metadata } }
 *   { status: 'failed',    job_id, error }
 */
function parseCallback(payload) {
  const status = payload && payload.status;
  const jobId = payload && (payload.job_id || payload.jobId);
  if (status === 'completed') {
    return { status: 'completed', jobId, data: payload.data || null };
  }
  if (status === 'failed') {
    return { status: 'failed', jobId, error: payload.error || 'unknown error' };
  }
  return { status: status || 'unknown', jobId, raw: payload };
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Summarise an axios response body without echoing headers (which include the
 * api-key). Prefer server-side error fields when present.
 */
function _summarizeError(res) {
  const d = res && res.data;
  if (!d) return '(no body)';
  if (typeof d === 'string') return d.slice(0, 200);
  if (d.error) return String(d.error).slice(0, 300);
  if (d.message) return String(d.message).slice(0, 300);
  if (d.detail) return typeof d.detail === 'string' ? d.detail.slice(0, 300) : JSON.stringify(d.detail).slice(0, 300);
  return JSON.stringify(d).slice(0, 300);
}

module.exports = {
  submitJob,
  pollStatus,
  parseCallback,
  buildRequestBody,
  isConfigured,
  // exposed for tests
  _internal: { OBJECTIVE_TYPES, SUBJECTIVE_TYPES },
};
