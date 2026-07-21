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
 *      └─ Unseen/Both → OBJ_SUBJ CheckboxGroup: Objective and/or Subjective
 *                        (FEAT-092 rev3: was a mutually-exclusive Radio; Alishba
 *                        asked for both to be independently selectable so a
 *                        single paper can mix objective + subjective types.)
 *                        └─ QUESTION_TYPES (union of types for the picked
 *                            categories) with per-type counts
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
const WhatsAppService = require('../services/whatsapp.service');
const supabase = require('../config/supabase');

const SESSION_TTL_SECONDS = 15 * 60;

// Output formats the teacher can pick on the SPEC screen. PDF is the legacy
// default (what the callback renders via Chromium); DOCX routes the same
// HTML through the html-to-docx converter and ships a Word-editable file.
const VALID_OUTPUT_FORMATS = ['pdf', 'docx'];
const DEFAULT_OUTPUT_FORMAT = 'pdf';

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

const GRADE_OPTIONS = [
  { id: '1', title: 'Grade 1' },
  { id: '2', title: 'Grade 2' },
  { id: '3', title: 'Grade 3' },
  { id: '4', title: 'Grade 4' },
  { id: '5', title: 'Grade 5' },
];

// bd-2246 (Umama, 2026-07-20): the subject list is per-grade, not global. The
// primary grades and the middle grades teach different subject sets, and the
// SAME subject is named differently across them ("Maths" in 1-3 vs
// "Mathematics" in 4-5; "Science" vs "General Science"), so the titles are part
// of the spec — not cosmetic. Ids stay stable so downstream generation and any
// stored request is unaffected by the relabelling.
const SUBJECTS_BY_GRADE = {
  1: [
    { id: 'Eng', title: 'English' },
    { id: 'Urdu', title: 'Urdu' },
    { id: 'Maths', title: 'Maths' },
    { id: 'Islamiat', title: 'Islamiyat' },
    { id: 'GenK', title: 'General Knowledge (Waqfiyat-e-Aama)' },
  ],
  4: [
    { id: 'Eng', title: 'English' },
    { id: 'Maths', title: 'Mathematics' },
    { id: 'Urdu', title: 'Urdu' },
    { id: 'Islamiat', title: 'Islamiyat' },
    { id: 'SST', title: 'Social Studies' },
    { id: 'Science', title: 'General Science' },
  ],
};
SUBJECTS_BY_GRADE[2] = SUBJECTS_BY_GRADE[1];
SUBJECTS_BY_GRADE[3] = SUBJECTS_BY_GRADE[1];
SUBJECTS_BY_GRADE[5] = SUBJECTS_BY_GRADE[4];

/**
 * Subjects offered for a grade. Unknown/blank grade → the union, so the very
 * first render (before a grade is picked) still shows a usable list rather than
 * an empty dropdown.
 */
function subjectsForGrade(grade) {
  const g = parseInt(String(grade || '').trim(), 10);
  if (SUBJECTS_BY_GRADE[g]) return SUBJECTS_BY_GRADE[g];
  const seen = new Set();
  const union = [];
  for (const list of [SUBJECTS_BY_GRADE[1], SUBJECTS_BY_GRADE[4]]) {
    for (const s of list) {
      if (!seen.has(s.id)) { seen.add(s.id); union.push(s); }
    }
  }
  return union;
}

/** bd-2246: server-side gate. The Flow filters the dropdown, but a replayed or
 *  hand-crafted payload must not be able to generate a paper for a subject the
 *  grade doesn't teach — the team asked for this explicitly, not frontend-only. */
function isSubjectValidForGrade(subject, grade) {
  const g = parseInt(String(grade || '').trim(), 10);
  const list = SUBJECTS_BY_GRADE[g];
  if (!list) return true; // unknown grade — don't block; upstream validates grade
  return list.some((s) => s.id === String(subject || '').trim());
}

function specScreen(grade) {
  return {
    screen: 'SPEC',
    data: {
      grade_options: GRADE_OPTIONS,
      subject_options: subjectsForGrade(grade),
      output_format_options: [
        { id: 'pdf',  title: 'PDF',  description: 'Print-ready. Best for printing straight to a class set.' },
        { id: 'docx', title: 'Word', description: 'Editable. Tweak questions or scoring before printing.' },
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

// bd-2247 — the QUESTION_TYPES screen used to carry the checkbox list AND a
// static stack of ~34 count inputs, one per possible type. Ticking 3 types left
// the 3 fields you needed buried among 30 you didn't. Umama asked four times for
// the split we ourselves proposed: pick the types, THEN name counts for only
// those types, in the order picked.
//
// WhatsApp Flows have no in-screen reactivity, so "only those types" is done
// with a fixed bank of slots whose label + visibility are data-bound and
// resolved server-side. Same technique already in production on the
// teacher-training Flow at this schema version.
const MAX_TYPE_SLOTS = 10;

function pickTypesScreen(specSummary, typeOptions) {
  return {
    screen: 'PICK_TYPES',
    data: {
      spec_summary: specSummary || '',
      type_options: typeOptions || [],
    },
  };
}

/**
 * Count fields for exactly the picked types, in pick order.
 * Slots beyond the pick count are hidden (`show_N: false`) and carry an empty
 * label so a hidden field can never render a stale name from a prior pass.
 */
function setCountsScreen(specSummary, pickedTypes) {
  const picked = (pickedTypes || []).slice(0, MAX_TYPE_SLOTS);
  const data = {
    spec_summary: specSummary || '',
    default_count: String(QuestionConfig.DEFAULT_COUNT_PER_TYPE),
    picked_summary: picked.length
      ? `${picked.length} type${picked.length === 1 ? '' : 's'}: ${picked.join(', ')}`
      : '',
  };
  for (let i = 1; i <= MAX_TYPE_SLOTS; i += 1) {
    const title = picked[i - 1];
    data[`show_${i}`] = !!title;
    data[`label_${i}`] = title ? `${title} — how many?` : '';
  }
  return { screen: 'SET_COUNTS', data };
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

  // Format picked on SPEC (Alishba ask 3). Default preserves legacy PDF path.
  const outputFormat = VALID_OUTPUT_FORMATS.includes(state.output_format)
    ? state.output_format
    : DEFAULT_OUTPUT_FORMAT;

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
      outputFormat,
    });
  } catch (err) {
    logToFile('[assessment-gen-flow] persist job link failed', { err: err.message });
  }

  // Immediate WhatsApp ack (Alishba ask 4). Fire-and-forget so the Flow
  // SUCCESS screen returns without waiting on network. We don't fail the
  // flow if the ack can't be sent — the SUCCESS screen already tells the
  // teacher we've queued the paper, and the callback will deliver either
  // way.
  setImmediate(() => {
    _sendGenerationStartedAck(userId).catch((err) => {
      logToFile('[assessment-gen-flow] ack send failed', { err: err.message, userId });
    });
  });

  await clearSession(flowToken);

  const typeLabel = state.generation_type === 'class_assessment'
    ? 'classroom practice'
    : 'exam';
  const fileLabel = outputFormat === 'docx' ? 'Word file' : 'PDF';
  return successScreen(
    `Making your Grade ${state.grade} ${_subjectLabel(state.subject)} ${typeLabel} on pages ${state.page_ranges}. We'll send the ${fileLabel} when it's ready.`,
    flowToken,
  );
}

/**
 * Send the "generation started" text to the teacher (Alishba ask 4). Kept as
 * a separate function so the Flow SUCCESS return doesn't wait on it and so
 * tests can spy on it. Looks up the teacher's phone from Supabase using the
 * userId that Meta passes into the Flow endpoint.
 */
async function _sendGenerationStartedAck(userId) {
  if (!userId) return;
  const { data: user, error } = await supabase
    .from('users')
    .select('phone_number')
    .eq('id', userId)
    .single();
  if (error || !user || !user.phone_number) {
    logToFile('[assessment-gen-flow] ack: user lookup failed', {
      userId, err: error?.message,
    });
    return;
  }
  await WhatsAppService.sendMessage(
    user.phone_number,
    "Your exam is being generated. This may take a few moments. We'll send it here as soon as it's ready.",
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
    // bd-2246: the grade Dropdown fires data_exchange on select, so the subject
    // list can be re-rendered for that grade. WhatsApp Flows have no in-screen
    // reactivity — a screen re-render from the server is the only way to make
    // one field depend on another.
    if (screenData._action === 'grade_changed') {
      return specScreen(screenData.grade);
    }
    if (screenData._action !== 'spec_submit') return specScreen(screenData?.grade);
    state.generation_type = screenData.generation_type === 'class_assessment'
      ? 'class_assessment'
      : 'exam';
    state.grade = String(screenData.grade || '').trim();
    state.subject = String(screenData.subject || '').trim();
    state.chapter = String(screenData.chapter || '').trim();
    state.page_ranges = String(screenData.page_ranges || '').trim();

    // Output format (Alishba ask 3). Default 'pdf' preserves legacy behaviour
    // for any client that doesn't send the field (old Flow JSON, tests, curl).
    const rawFormat = String(screenData.output_format || '').trim().toLowerCase();
    state.output_format = VALID_OUTPUT_FORMATS.includes(rawFormat)
      ? rawFormat
      : DEFAULT_OUTPUT_FORMAT;

    if (!state.grade || !state.subject || !state.page_ranges) {
      return specScreen(state.grade);
    }

    // bd-2246: server-side gate (acceptance criterion — "do not rely solely on
    // frontend validation"). Re-render the SPEC screen with the correct list
    // rather than generating a paper for a subject this grade doesn't teach.
    if (!isSubjectValidForGrade(state.subject, state.grade)) {
      logToFile('[assessment-gen-flow] subject not offered for grade — re-rendering SPEC', {
        userId, grade: state.grade, subject: state.subject,
      });
      return specScreen(state.grade);
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
  //
  // FEAT-092 rev3 (Alishba fix #1 + #2): OBJ_SUBJ is now a CheckboxGroup so
  // Objective and Subjective can be picked independently OR together. The
  // Flow submits `categories` as an array (WhatsApp Flows sends it as either
  // ['objective','subjective'] or the comma-separated string form). We also
  // accept the legacy scalar `category` field for backward-compat with the
  // currently-published Flow (radio version) during rollout.
  if (screen === 'OBJ_SUBJ') {
    if (screenData._action !== 'pick_category') return objSubjScreen(_summaryFromState(state));
    if (!state.grade || !state.subject) return specScreen();

    const categories = _parseCategories(screenData);
    state.categories = categories;
    // Legacy mirror: keep `state.category` for old code paths / tests that
    // read it. When only one category is picked it's that one; when both,
    // default to 'objective' so any pre-rev3 QUESTION_TYPES handler still
    // sees a sensible scalar.
    state.category = categories.length === 1 ? categories[0] : 'objective';
    await writeSession(flowToken, state);

    const typeOptions = _unionTypeOptions({
      subject: state.subject,
      grade: state.grade,
      categories,
    });
    if (typeOptions.length === 0) {
      // Config-level failure — surface a friendly error rather than crash.
      logToFile('[assessment-gen-flow] no question types for combo', {
        subject: state.subject, grade: state.grade, categories,
      });
      return successScreen(
        "We couldn't find any question types for that combination right now. Please try a different subject.",
        flowToken,
      );
    }
    // Also stash the per-id → category map on session so the QUESTION_TYPES
    // handler can stamp the right category on each picked type at submit
    // time (needed for ids like 'Brief Answers' that are OBJECTIVE for
    // Eng/Urdu but SUBJECTIVE for Science, when both categories are picked).
    state._id_to_category = _idCategoryMap({
      subject: state.subject,
      grade: state.grade,
      categories,
    });
    await writeSession(flowToken, state);
    return pickTypesScreen(_summaryFromState(state), typeOptions);
  }

  // ─────────────── PICK_TYPES → SET_COUNTS ───────────────
  // bd-2247: the picker no longer submits. It records the picks (ORDER MATTERS —
  // the counts screen labels its slots in the order the teacher ticked) and
  // hands over to SET_COUNTS.
  if (screen === 'PICK_TYPES') {
    const categories = _categoriesFromState(state);
    const reRender = () => pickTypesScreen(
      _summaryFromState(state),
      _unionTypeOptions({ subject: state.subject, grade: state.grade, categories }),
    );
    if (screenData._action !== 'pick_types') return reRender();
    if (!state.grade || !state.subject || !state.page_ranges) return specScreen(state.grade);

    let picked = screenData.question_types;
    if (typeof picked === 'string') picked = picked.split(',').map((s) => s.trim()).filter(Boolean);
    if (!Array.isArray(picked)) picked = [];
    picked = picked.filter((id) => QuestionConfig.isSupported(id)).slice(0, MAX_TYPE_SLOTS);

    if (picked.length === 0) return reRender();

    state.picked_types = picked;
    await writeSession(flowToken, state);
    return setCountsScreen(_summaryFromState(state), picked);
  }

  // ─────────────── SET_COUNTS → SUCCESS (submit) ───────────────
  // QUESTION_TYPES is accepted as an alias so a Flow client still on the
  // pre-split published version keeps working through the republish window.
  if (screen === 'SET_COUNTS' || screen === 'QUESTION_TYPES') {
    const categories = _categoriesFromState(state);
    const idCatMap = state._id_to_category && typeof state._id_to_category === 'object'
      ? state._id_to_category
      : _idCategoryMap({
          subject: state.subject,
          grade: state.grade,
          categories,
        });

    if (screenData._action !== 'generate') {
      // Non-submit ping — re-render whichever screen the client is on.
      if (screen === 'SET_COUNTS') {
        return setCountsScreen(_summaryFromState(state), state.picked_types || []);
      }
      const typeOptions = _unionTypeOptions({
        subject: state.subject,
        grade: state.grade,
        categories,
      });
      return pickTypesScreen(_summaryFromState(state), typeOptions);
    }
    if (!state.grade || !state.subject || !state.page_ranges) return specScreen(state.grade);

    // Picks come from the session on the split path (SET_COUNTS carries only
    // counts). The legacy path still submits question_types on the payload.
    let picked = Array.isArray(state.picked_types) && state.picked_types.length
      ? state.picked_types
      : screenData.question_types;
    if (typeof picked === 'string') {
      picked = picked.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (!Array.isArray(picked)) picked = [];

    // Per-type counts. Payload uses `count_<slug>` keys where <slug> is the
    // type id lowercased with non-alphanum → underscore.
    //
    // Category stamping (FEAT-092 rev3): when both categories were picked at
    // OBJ_SUBJ, each id gets its correct category from the union map. When
    // only one category was picked (or we're on the legacy Flow that sends
    // scalar `category`), fall back to that.
    const legacyCategory = state.category === 'subjective' ? 'subjective' : 'objective';
    const questionTypes = picked
      .filter((id) => QuestionConfig.isSupported(id))
      .map((id, idx) => {
        // bd-2247: SET_COUNTS submits positional slots (count_1..count_N) in the
        // order the types were picked. Fall back to the legacy per-slug key so a
        // client still on the pre-split Flow submits correctly.
        const slug = _slugForCountKey(id);
        const raw = screenData[`count_${idx + 1}`] !== undefined
          ? screenData[`count_${idx + 1}`]
          : screenData[`count_${slug}`];
        const parsed = _parseCount(raw);
        const capped = Math.min(parsed || QuestionConfig.DEFAULT_COUNT_PER_TYPE, QuestionConfig.MAX_COUNT_PER_TYPE);
        const category = idCatMap[id] || legacyCategory;
        return { id, count: capped, category };
      })
      .filter((qt) => qt.count > 0);

    if (questionTypes.length === 0) {
      const typeOptions = _unionTypeOptions({
        subject: state.subject,
        grade: state.grade,
        categories,
      });
      const out = pickTypesScreen(_summaryFromState(state) + '  ·  Please pick a question type.', typeOptions);
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
 * Parse the OBJ_SUBJ screen submission's category selection.
 *
 * The FEAT-092 rev3 Flow sends `categories` (array or CSV string) because the
 * screen is now a CheckboxGroup allowing objective, subjective, or both.
 * The rev2 Flow sent `category` (scalar) from a RadioButtonsGroup — we still
 * accept that shape so the endpoint works against either published version
 * during rollout.
 *
 * Returns a de-duped array of at least one of ['objective', 'subjective'].
 * Defaults to ['objective'] on anything unparseable rather than throwing.
 */
function _parseCategories(screenData) {
  let raw = screenData && (screenData.categories !== undefined ? screenData.categories : screenData.category);
  if (raw === undefined || raw === null) return ['objective'];
  if (typeof raw === 'string') {
    raw = raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (!Array.isArray(raw)) raw = [raw];
  const valid = raw
    .map((v) => String(v || '').trim().toLowerCase())
    .filter((v) => v === 'objective' || v === 'subjective');
  const uniq = [...new Set(valid)];
  return uniq.length > 0 ? uniq : ['objective'];
}

/**
 * Session-shape accessor. Prefers the new `categories` array; falls back to
 * the legacy scalar `category`. Always returns a non-empty array.
 */
function _categoriesFromState(state) {
  if (Array.isArray(state && state.categories) && state.categories.length > 0) {
    return state.categories;
  }
  const legacy = state && state.category === 'subjective' ? 'subjective' : 'objective';
  return [legacy];
}

/**
 * Build the ordered union of `{id, title}` question-type options across all
 * picked categories. Preserves category ordering (Objective first, then
 * Subjective) so the WhatsApp checkbox list reads objective-then-subjective.
 * De-dupes by id (an id can only appear once in a CheckboxGroup); when a type
 * exists in both categories for the {subject, grade} the objective category
 * wins the display slot — the per-id → category map recorded separately
 * still lets us round-trip the *correct* category at submit time.
 */
function _unionTypeOptions({ subject, grade, categories }) {
  const cats = Array.isArray(categories) && categories.length > 0
    ? categories
    : ['objective'];
  const seen = new Set();
  const out = [];
  const ordered = ['objective', 'subjective'].filter((c) => cats.includes(c));
  for (const cat of ordered) {
    const opts = QuestionConfig.getQuestionTypes({ subject, grade, category: cat });
    for (const o of opts) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      out.push(o);
    }
  }
  return out;
}

/**
 * Map every type id in the union → the category we should stamp on it when it
 * survives the QUESTION_TYPES submit. For any id that exists in only one of
 * the picked categories, use that. For an id that exists in both, prefer the
 * one the teacher expects for that subject — mirrors UG_EG's
 * question-types-ict.md placement (e.g. 'Brief Answers' → OBJECTIVE for
 * Eng/Urdu/Islamiat, SUBJECTIVE for Science).
 */
function _idCategoryMap({ subject, grade, categories }) {
  const cats = Array.isArray(categories) && categories.length > 0
    ? categories
    : ['objective'];
  const map = {};
  // Fill objective first, then subjective — later writes only happen for ids
  // that aren't already tagged, so first-write-wins matches the display order
  // in _unionTypeOptions.
  const ordered = ['objective', 'subjective'].filter((c) => cats.includes(c));
  for (const cat of ordered) {
    const opts = QuestionConfig.getQuestionTypes({ subject, grade, category: cat });
    for (const o of opts) {
      if (!map[o.id]) map[o.id] = cat;
    }
  }
  return map;
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
  _parseCategories,
  _categoriesFromState,
  _unionTypeOptions,
  _idCategoryMap,
  _slugForCountKey,
  _sendGenerationStartedAck,
};
