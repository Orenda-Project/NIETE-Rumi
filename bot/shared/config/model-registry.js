/**
 * One place to choose a model, for this deployment. bd-isn68.
 *
 * WHY. Choosing a model here is already a settings change rather than a deploy, which puts
 * this fork ahead of the main bot. But it got invented TWELVE times: `LP_AUTHOR_MODEL`,
 * `LP_AUTHOR_MODEL_MATHS_PHYSICS`, `LP_FIDELITY_MODEL`, `LP_EXTRACTION_VISION_MODEL`,
 * `VISION_MODEL`, `ROSTER_VISION_MODEL`, `TRANSCRIPT_QUIZ_MODEL`, `HCP_FEEDBACK_MODEL`,
 * `CALLS_TRANSCRIBE_MODEL`, `OPENAI_REALTIME_MODEL`, `LLM_MODEL` and
 * `LLM_DIRECT_FALLBACK_MODEL`, with four different idioms for the fallback: a literal, a
 * file constant, another function's return value, and an empty string plus logic elsewhere.
 * Nothing is wrong with any one of them. Together they mean there is no answer to "which
 * models are we running", no way to move one job for a slice of teachers, and no single
 * switch to put everything back.
 *
 * This table is that answer. Every job keeps its OWN env var and its OWN default, so with no
 * new settings written nothing changes: there is a test per job asserting the resolved model
 * equals today's expression exactly.
 *
 * HOW TO CHANGE A MODEL (bd-gr4fy.8). Every job in the Anthropic swap's scope is in JOBS below, and
 * its call site asks for `modelFor(job)` instead of writing a model of its own, so:
 *
 *   for good, in code     edit the job's `default` here, one line; its call site follows
 *   now, with no deploy   app_settings `llm_per_job` = {"<job>": "<model id>"}: tried first, with
 *                         this table's model behind it on any failure (llm-client.js)
 *   every job back        app_settings `llm_kill_switch` = true, within about a minute, no restart
 *   no settings table     env LLM_JOB_MODELS = '{"<job>": "<model id>"}', same behaviour
 *
 * A job's own env var, where it already had one, still sits between its default and the settings.
 *
 * WHAT IS ALREADY TRUE AND WORTH SAYING OUT LOUD. This deployment is already multi-vendor.
 * Lesson-plan authoring defaults to `anthropic/claude-sonnet-5`; vision, roster extraction
 * and transcript quizzes default to Google models; fidelity to an OpenAI one. The first
 * Claude swap did not need doing here, it already happened.
 */

/**
 * job -> { env, default, note, settingsAtSite }
 *   env      the variable that already overrides this job, kept for compatibility
 *   default  what it falls back to today, read out of the shipping code
 *   settingsAtSite  the call site resolves its model through `resolveModelForJob` WITH the
 *            settings, so the whole chain (per job, per language, rollout, kill switch) has been
 *            applied by the time the request reaches llm-client. The per-job override there must
 *            not apply the row a second time, over a finer choice; it only stands the job's own
 *            model behind whatever the site chose (bd-gr4fy.6).
 *
 * Verified against develop on 9 Sep 2026, file and line in `site`.
 */
const JOBS = {
  'lp.author': {
    env: 'LP_AUTHOR_MODEL', default: 'anthropic/claude-sonnet-5',
    site: 'shared/config/lp612-flags.js:79',
    note: 'a maths request checks LP_AUTHOR_MODEL_MATHS_PHYSICS first; see familyEnv',
    familyEnv: { maths: 'LP_AUTHOR_MODEL_MATHS_PHYSICS' },
  },
  'lp.fidelity': {
    env: 'LP_FIDELITY_MODEL', default: 'openai/gpt-5.6-luna',
    site: 'shared/services/coaching/fidelity/fidelity-analyzer.js',
  },
  'lp.extractVision': {
    env: 'LP_EXTRACTION_VISION_MODEL', default: 'google/gemini-2.5-flash',
    site: 'shared/services/lp-vision-ocr.service.js:21',
  },
  'vision.analyse': {
    env: 'VISION_MODEL', default: 'gpt-4.1-mini',
    site: 'shared/services/vision.service.js',
    settingsAtSite: true,
  },
  'roster.extract': {
    env: 'ROSTER_VISION_MODEL', default: 'google/gemini-3.1-flash-lite-preview',
    site: 'shared/services/roster/roster-extraction.service.js:35',
  },
  'quiz.transcript': {
    env: 'TRANSCRIPT_QUIZ_MODEL', default: 'google/gemini-2.5-flash',
    site: 'shared/services/quiz/transcript-quiz-llm.js:22',
  },
  'quiz.keyVerify': {
    // The blind solve: every lesson quiz (transcript and lp_v8) is answered once by a model
    // that is NOT shown the keys, before a row is stored. It checks the author's work, so it
    // runs on a DIFFERENT and stronger model than quiz.transcript by default -- a solver that
    // shares the author's blind spots agrees with the author's mistakes. Claude Sonnet 5 is
    // already served to this deployment through the same OpenRouter client (lp.author).
    env: 'TRANSCRIPT_QUIZ_VERIFY_MODEL', default: 'anthropic/claude-sonnet-5',
    site: 'shared/services/quiz/transcript-quiz-key-verify.service.js',
  },
  'assessment.generate': {
    // bd-jntcx. Found from the first production spend data, not by reading the code: at
    // $11.34/day this is the second largest line in NIETE, behind only lp.author — and it was
    // not in this table at all. Picked the way vision.analyse used to be, from a constant
    // evaluated once at import, so no settings row, changed variable or incident could move it.
    //
    // BOTH language variables live in familyEnv, and `env` is a THIRD name that nothing sets
    // today. The service reads ASSESSMENT_GEN_MODEL_ENG for English and
    // ASSESSMENT_GEN_MODEL_URDU for Urdu, each falling back to the literal and NEVER to each
    // other. Naming one of them as `env` would make it the other's fallback, so setting
    // English alone would silently move Urdu too. Pointing `env` at a new, unset name keeps
    // that exactness and earns a useful level: ASSESSMENT_GEN_MODEL moves BOTH languages at
    // once, while either family variable still overrides it.
    env: 'ASSESSMENT_GEN_MODEL', default: 'google/gemini-3.1-pro-preview',
    site: 'shared/services/assessment/assessment-generation.service.js:29',
    familyEnv: { eng: 'ASSESSMENT_GEN_MODEL_ENG', urdu: 'ASSESSMENT_GEN_MODEL_URDU' },
    settingsAtSite: true,
  },
  'hcp.feedback': {
    // falls through to the platform default today, which is why it has no literal of its own
    env: 'HCP_FEEDBACK_MODEL', default: null,
    site: 'dashboard/routes/hcp.routes.js',
  },
  // bd-s1oo0.5 — the child test's AI marking (EGRA/EGMA, ICT). The May 2026 study stack,
  // HARNESS_RESULTS §8: every default here is the model that study measured for that job.
  'childTest.counts': {
    env: 'CHILD_TEST_MODEL_COUNTS', default: 'google/gemini-3.8-flash',
    site: 'shared/services/child-test/scoring/story.js',
  },
  'childTest.labeller': {
    env: 'CHILD_TEST_MODEL_LABELLER', default: 'google/gemini-3-flash-preview',
    site: 'shared/services/child-test/scoring/labeller.js',
  },
  'childTest.comprehension': {
    env: 'CHILD_TEST_MODEL_COMPREHENSION', default: 'google/gemini-3-flash-preview',
    site: 'shared/services/child-test/scoring/comprehension.js',
  },
  'childTest.phonics': {
    env: 'CHILD_TEST_MODEL_PHONICS', default: 'google/gemini-3.8-flash',
    site: 'shared/services/child-test/scoring/phonics.js',
  },
  'childTest.wordProblem': {
    env: 'CHILD_TEST_MODEL_WORD_PROBLEM', default: 'google/gemini-3-flash-preview',
    site: 'shared/services/child-test/scoring/maths.js',
  },
  'childTest.vision': {
    env: 'CHILD_TEST_MODEL_VISION', default: 'google/gemini-3.1-pro-preview',
    site: 'shared/services/child-test/scoring/maths-photo.js',
  },
  // bd-s1oo0.38 (L20): the child number off a strip photo, read at receipt (bounded, one attempt).
  'childTest.childNo': {
    env: 'CHILD_TEST_MODEL_CHILD_NO', default: 'google/gemini-3.8-flash',
    site: 'shared/services/child-test/scoring/child-no.js',
  },

  // ---- bd-gr4fy.8: every other job in the Anthropic swap's scope, promoted from TELEMETRY_ONLY_JOBS.
  // Each default is EXACTLY what its call site sent before (pinned in tests/llm/single-source-guard),
  // and the call site now asks for it with modelFor(job), so this table is the one place a job's own
  // model is written. `env: null` = the job never had a variable of its own, and none is invented:
  // the `llm_per_job` settings row (or LLM_JOB_MODELS) moves it with no deploy, with this model
  // behind it, and `llm_kill_switch` puts it back.
  'chat.respond': { env: null, default: 'gpt-4.1-mini', site: 'shared/services/openai.service.js' },
  'chat.intent': { env: null, default: 'gpt-4.1-mini', site: 'shared/services/openai.service.js' },
  'chat.topic': { env: null, default: 'gpt-4.1-mini', site: 'shared/services/openai.service.js' },
  // createChatCompletion's default: video slides and the two video topic prompts.
  'chat.completion': { env: null, default: 'gpt-4o-mini', site: 'shared/services/openai.service.js' },
  'lang.detect': { env: null, default: 'gpt-4o-mini', site: 'shared/services/language-detector.service.js' },
  'lp.editIntent': {
    env: 'LP612_EDIT_INTENT_MODEL', default: 'openai/gpt-4.1-mini',
    site: 'shared/services/lp612-edit-intent.service.js',
  },
  'lp.extractText': { env: null, default: 'gpt-4o-mini', site: 'workers/lesson-plan-extraction.worker.js' },
  // These two ran getDefaultModel(), i.e. the platform default: `default: null` keeps exactly that.
  'attendance.voiceExtract': { env: null, default: null, site: 'shared/services/voice-attendance.service.js' },
  'training.capstoneScore': { env: null, default: null, site: 'shared/services/training/capstone-delivery.service.js' },
  'helper.capabilityDetect': { env: null, default: 'gpt-4o-mini', site: 'shared/services/helper-agent.service.js' },
  'helper.capabilityGuidance': { env: null, default: 'gpt-4o-mini', site: 'shared/services/helper-agent.service.js' },
  'helper.capabilityDefault': { env: null, default: 'gpt-4o-mini', site: 'shared/services/helper-agent.service.js' },
  'helper.guidance': { env: null, default: 'gpt-4o', site: 'shared/services/helper-agent.service.js' },
  'helper.stuckRecovery': { env: null, default: 'gpt-4o-mini', site: 'shared/services/helper-agent.service.js' },
  'coaching.pedagogy': { env: null, default: 'gpt-5-mini-2025-08-07', site: 'shared/services/gpt5-mini.service.js' },
  'coaching.completeJson': { env: null, default: 'gpt-5-mini-2025-08-07', site: 'shared/services/gpt5-mini.service.js' },
  // bd-gr4fy.15: the coach's /observe debrief guide and feedback card (and its repair), through completeJson's
  // `job` option under their own name, so they and its other consumers can run on different models.
  'coaching.observeDebrief': {
    env: null, default: 'gpt-5-mini-2025-08-07', site: 'shared/services/observe/observe-debrief.service.js',
  },
  'coaching.fidelityFallback': { env: null, default: 'gpt-4o-mini', site: 'shared/services/gpt5-mini.service.js' },
  'coaching.enhance': { env: null, default: 'gpt-5-mini-2025-08-07', site: 'shared/services/gpt5-mini.service.js' },
  'coaching.reflectiveQuestion': { env: null, default: 'gpt-4o', site: 'shared/services/gpt5-mini.service.js' },
  'coaching.inferTopic': { env: null, default: 'gpt-4o-mini', site: 'shared/services/gpt5-mini.service.js' },
  'coaching.inferSubject': { env: null, default: 'gpt-4o-mini', site: 'shared/services/gpt5-mini.service.js' },
  'coaching.priorFeedback': { env: null, default: 'gpt-4o-mini', site: 'shared/services/gpt5-mini.service.js' },
  'coaching.voiceDebrief': { env: null, default: 'gpt-4o', site: 'shared/services/gpt5-mini.service.js' },
  'coaching.acknowledgement': {
    env: null, default: 'gpt-5-mini-2025-08-07', site: 'shared/services/coaching/reflective-conversation.service.js',
  },
  'coaching.narrative': {
    env: null, default: 'gpt-5-mini-2025-08-07', site: 'shared/services/coaching/report-v2/narrative.service.js',
  },
  'coaching.commitmentCard': {
    env: null, default: 'gpt-5-mini-2025-08-07', site: 'shared/services/coaching/coaching-card/commitment-card.service.js',
  },
  'coaching.cardLocalise': {
    env: null, default: 'gpt-5-mini-2025-08-07', site: 'shared/services/coaching/coaching-card/commitment-card.service.js',
  },
  // Its own OpenRouter client and ladder: this model twice, then FALLBACK['coaching.questionRouter'].
  'coaching.questionRouter': {
    env: null, default: 'deepseek/deepseek-v3.2', site: 'shared/services/coaching/reflective-questions/llm-router.service.js',
  },
  // bd-gr4fy.12: the corpus of moments the reflective question is built from, on the same ladder (this
  // model twice, then its FALLBACK) under its own name, so it and the question can run on different models.
  'coaching.reflectiveCorpus': {
    env: null, default: 'deepseek/deepseek-v3.2', site: 'shared/services/coaching/reflective-questions/llm-router.service.js',
  },
  // Shares lp.fidelity's variable, exactly as the extractor always did.
  'lp.extractUpload': {
    env: 'LP_FIDELITY_MODEL', default: 'openai/gpt-5.6-luna', site: 'shared/services/coaching/fidelity/lp-upload-extractor.js',
  },
  // These four call api.openai.com directly on their own client, so their model must be one it serves:
  // a bare OpenAI id and no env var. Only the per-job override (which routes it) moves them elsewhere.
  'quiz.generate': { env: null, default: 'gpt-4o', lane: 'openai-direct', site: 'shared/services/quiz/quiz-generation.service.js' },
  'quiz.insight': { env: null, default: 'gpt-4o-mini', lane: 'openai-direct', site: 'shared/services/quiz/quiz-report.service.js' },
  'quiz.session': { env: null, default: 'gpt-4o-mini', lane: 'openai-direct', site: 'shared/services/quiz/quiz-session.service.js' },
  'quiz.videoReport': {
    env: null, default: 'gpt-5.4-mini', lane: 'openai-direct', site: 'shared/services/quiz/video-quiz-report.service.js',
  },

  'platform.default': {
    env: 'LLM_MODEL', default: 'openai/gpt-4o',
    site: 'shared/services/llm-client.js:34',
  },
};


/**
 * WHAT EACH JOB FALLS BACK TO, frozen at what it runs today. bd-4uw7n.
 *
 * The fallback is the model the job ALREADY WORKS WITH. Move a job to Anthropic later and this
 * still names what it used to run, which is the only model anybody has validated for it.
 *
 * An earlier cut of this sent every non-OpenAI model to a blanket `openai/gpt-4o`, on the
 * reasoning that a fallback answers "this supplier cannot serve us", a fact about the supplier
 * rather than the job. Half right. WHETHER to fall back is about the supplier; WHAT to fall
 * back to is entirely about the job. Concretely, that blanket would have failed roster
 * extraction over from a model chosen for being cheap to one around 17x the price, swapped the
 * model the transcript-quiz pipeline was validated against, and pointed lesson-plan authoring
 * at something no rubric has ever been run against. One of them only worked by luck, because
 * gpt-4o happens to do vision.
 *
 * FROZEN, NOT DERIVED. Reading it off the current primary would mean that setting
 * LP_AUTHOR_MODEL=anthropic/claude-opus-5 makes the "fallback" resolve to claude-sonnet-5:
 * still Anthropic, and useless when Anthropic is the thing that is down.
 *
 * `null` means no fallback, and that is a real answer, not a gap to fill later:
 *   - the job already runs OpenAI, so it IS the floor and has nothing behind it
 *   - or it already runs Anthropic with no OpenAI predecessor anybody validated. Naming one
 *     would be a guess dressed as a decision.
 */
const FALLBACK = {
  'lp.author':        null,  // already Anthropic; no validated OpenAI predecessor
  'lp.fidelity':      null,  // already OpenAI, the floor
  'lp.extractVision': 'google/gemini-2.5-flash',
  'vision.analyse':   'openai/gpt-4.1-mini',
  'roster.extract':   'google/gemini-3.1-flash-lite-preview',
  'quiz.transcript':  'google/gemini-2.5-flash',
  // New job, no validated predecessor: a supplier outage fails the solve, and the solve
  // FAILS OPEN (the quiz ships as authored, recorded as meta.key_verify.status 'error').
  // Falling back to the author's own model would verify the author with itself.
  'quiz.keyVerify':   null,
  'assessment.generate': 'google/gemini-3.1-pro-preview',  // what it already runs
  'hcp.feedback':     null,  // falls through to the platform default, which is the floor
  // bd-s1oo0.5: no validated alternative for any child-test job. A supplier outage leaves that
  // section's marks empty with confidence 0 (ai_status 'partial') and the coach marks it.
  'childTest.counts':        null,
  'childTest.labeller':      null,
  'childTest.comprehension': null,
  'childTest.phonics':       null,
  'childTest.wordProblem':   null,
  'childTest.vision':        null,
  'platform.default': null,  // the floor
  // bd-gr4fy.8: the question router's own ladder already retried on this model; it now reads it here.
  'coaching.questionRouter': 'openai/gpt-5.4',
  // bd-gr4fy.12: the corpus step shares that ladder, so the same retry model.
  'coaching.reflectiveCorpus': 'openai/gpt-5.4',
};

/**
 * Jobs that are LABELLED BUT NOT ROUTED. bd-jntcx.
 *
 * These names exist so spend can be attributed; they are deliberately NOT in `JOBS`, and that
 * distinction is the whole point. A name in `JOBS` is a promise that setting its env var or a
 * settings row changes which model runs. These call sites still carry their own model literal
 * and do not consult the registry, so making that promise here would be exactly the
 * "defined is not working" trap: an operator sets COACHING_PEDAGOGY_MODEL, nothing happens,
 * and nothing says why.
 *
 * What they DO buy, today: the first production day showed $85.76 of $173.97 spent with no
 * `job` at all, $54.35 of it on gpt-5-mini from this one cluster. A name turns that into a
 * line you can read.
 *
 * Promoting one is a separate, deliberate change: move the call site onto
 * getClientForModel(model, { job }) or resolveModelForJob(), add it to JOBS with its current
 * model as the default and to FALLBACK with that same model frozen, and drop it from here.
 * Until then the label is telemetry and nothing else -- `fallbackForJob` still rejects these
 * names, which is correct: an unrouted job has no fallback to arm.
 */
const TELEMETRY_ONLY_JOBS = Object.freeze([
  // bd-gr4fy.8 promoted every job in the Anthropic swap's scope out of this list and into JOBS
  // (the coaching cluster, chat, helper, the quiz services, the router, language detection, LP
  // extraction and edit intent, attendance, capstone scoring). What is left was outside that scope:
  // no NIETE production traffic in the week before (6 Oct 2026), and each call site still writes
  // its own model. Promote one the same way when it needs to move.
  'exam.grade',                  // exam-checker/grading
  'reading.analyse',
  'reading.diagnosticSummary',
  'reading.report',
  'reading.reportEnhance',       // the second pass inside generateReport
  'reading.sendResults',
  'reading.comprehensionStart',
  'reading.combinedReport',
  'reading.comprehensionQuestions',
  'reading.evaluateText',
  'reading.evaluateAnswer',
  'reading.comprehensionGuidance',
  'reading.wordCategories',
  'reading.levelWelcome',
  'reading.levelPassed',
  'reading.levelRetry',
  'reading.levelTransition',
  'reading.levelLowest',
  'reading.passageSend',         // two sites, one job: same send on two branches
  'reading.passageText',
  'reading.fluencyMatch',
  'reading.voiceFeedback',
  'reading.translate',           // reading/report _translateToEnglish
  'reading.assessLanguage',
  'reading.assessGrade',
  'reading.assessAudio',
  'reading.wordGrid',            // utils/word-grid-generator
]);

/**
 * Jobs whose caller parses JSON out of the reply WITHOUT asking for JSON mode. bd-gr4fy.6.
 *
 * The prompt asks for JSON and the code parses it, but the request sets no `response_format`, so
 * nothing on the wire says JSON is wanted. llm-client reads this when a job is moved to another
 * model: an answer with no complete value of this shape is a failure, and the job's own model
 * answers instead. Without it, several of these substitute a default on a parse failure and say
 * nothing: a capstone answer scores 0, a voice register finds "no names", a pedagogy reply that
 * is not an object scores 0%.
 *
 * Found by reading every moved job's call site (6 Oct 2026), with the parse named per job. A job
 * that sets `response_format` is NOT listed: the request already says so.
 */
const JSON_REPLY_JOBS = Object.freeze({
  'coaching.pedagogy': 'object',          // gpt5-mini.service.js _safeJsonParse; an array scores 0%
  'coaching.fidelityFallback': 'object',  // gpt5-mini.service.js: {..} span, then _safeJsonParse
  'lp.editIntent': 'object',              // lp612-edit-intent.service.js parseKind: {..} span
  'lp.extractText': 'object',             // workers/lesson-plan-extraction.worker.js: {..} span
  'attendance.voiceExtract': 'object',    // voice-attendance.service.js parseExtraction: {..} span
  'roster.extract': 'object',             // roster-extraction.service.js parseModelJson
  'quiz.videoReport': 'object',           // quiz/video-quiz-report.service.js parseGuidanceJson
  'training.capstoneScore': 'object',     // training/capstone-delivery.service.js: JSON.parse
});

/**
 * Jobs whose caller REPAIRS the JSON it parses (jsonrepair), and what it repairs. bd-gr4fy.7.
 *
 * Such a caller reads an answer a strict parse would refuse (a trailing comma, a raw newline in a
 * string), so a moved job's answer is checked the way its caller parses it: an answer the caller
 * would turn into an object is accepted, untouched; one it would turn into anything else (prose
 * becomes a string, two objects an array) still puts the job back on its own model.
 *
 *   whole  JSON.parse(reply), then jsonrepair(reply)
 *   span   the first `{` to the last `}` of the reply, then the same
 */
const JSON_REPAIRED_BY_CALLER = Object.freeze({
  'coaching.pedagogy': 'whole',          // gpt5-mini.service.js _safeJsonParse(rawContent)
  'coaching.completeJson': 'whole',      // gpt5-mini.service.js _safeJsonParse(content)
  'coaching.observeDebrief': 'whole',    // gpt5-mini.service.js completeJson: _safeJsonParse(content)
  'coaching.questionRouter': 'whole',    // gpt5-mini.service.js _generateReflectiveQuestionV12: _safeJsonParse(content)
  'coaching.reflectiveCorpus': 'whole',  // gpt5-mini.service.js extractReflectiveCorpus: _safeJsonParse(content)
  'lp.extractUpload': 'whole',           // coaching/fidelity/lp-upload-extractor.js safeJsonParse
  'lp.fidelity': 'whole',                // coaching/fidelity/fidelity-analyzer.js safeJsonParse
  'vision.analyse': 'whole',             // classroom-photo/photo-analysis.service.js parseJsonObject: JSON.parse, then jsonrepair (bd-gr4fy.5.7)
  'coaching.fidelityFallback': 'span',   // gpt5-mini.service.js: /\{[\s\S]*\}/, then _safeJsonParse
  'lp.extractText': 'span',              // workers/lesson-plan-extraction.worker.js: same span, then repair
});

/** The model this job is known to work with, or null when it has nothing behind it. */
function fallbackForJob(job) {
  if (!JOBS[job]) throw new Error(`unknown job: ${job}`);
  const fb = FALLBACK[job];
  if (!fb) return null;
  // The client prefixes a bare id before sending, so record what would actually go out.
  return fb.includes('/') ? fb : `openai/${fb}`;
}


/** A model id, not arbitrary text: this is the only value from settings sent to a third party. */
const MODEL_RE = /^[a-z0-9]+(?:[/.-][a-z0-9]+)*$/;
const isModel = (v) => typeof v === 'string' && v.length <= 80 && MODEL_RE.test(v);

/**
 * A 32-bit hash, stable across processes and restarts, mixing the job in.
 *
 * Deterministic on purpose: a rollout keyed on anything random would give the same teacher a
 * different model on every message. Job-mixed on purpose: rolling every job out to the same
 * slice would make one group of teachers carry every risk at once.
 */
function bucketOf(userId, job) {
  let h = 2166136261;
  const key = `${job}:${userId}`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100;
}

/** What this job resolves to today, from its own env var and its own default. */
function todaysModel(job, ctx = {}) {
  const spec = JOBS[job];
  if (!spec) throw new Error(`unknown job: ${job}`);
  if (spec.familyEnv && ctx.family && spec.familyEnv[ctx.family]) {
    const pilot = (process.env[spec.familyEnv[ctx.family]] || '').trim();
    if (pilot) return pilot;
  }
  const own = spec.env ? (process.env[spec.env] || '').trim() : '';
  if (own) return own;
  if (spec.default) return spec.default;
  // hcp.feedback and anything else with no literal fall through to the platform default
  return (process.env[JOBS['platform.default'].env] || '').trim()
    || JOBS['platform.default'].default;
}

/**
 * THE CHAIN. Six levels, first match wins, because any one call needs one answer.
 *
 *   1  kill switch   everything back to today's model with no deploy
 *   2  rollout       a stable slice of teachers, per job
 *   3  per language  beats region, because it is the finer fact
 *   4  per region    this deployment is one region today, kept for symmetry with the main bot
 *   5  per job       a settings row, else the job's own env var, which already exists
 *   6  platform      LLM_MODEL, which already exists
 *
 * `cfg` is PASSED IN, never read here: this runs on every request and must stay synchronous,
 * so a settings round trip inside it would put latency on the conversation path.
 */
function resolveModelForJob(job, ctx = {}) {
  const cfg = ctx.cfg || {};
  let model = todaysModel(job, ctx);
  let source = 'today';

  const pick = (m, why) => { if (isModel(m)) { model = m; source = why; return true; } return false; };

  // 5: per job. The header calls the job's own env var this level, and on a laptop it is. On
  // Railway it is not: changing a variable there restarts the service, which is a deploy by
  // another name and is the thing this table exists to avoid. A settings row moves one job
  // now. The env var stays exactly as it is and still decides when no row is written.
  pick(cfg.perJob && cfg.perJob[job], 'per-job');

  if (ctx.region) pick(cfg.perRegion && cfg.perRegion[ctx.region], 'per-region');

  if (ctx.language && cfg.perLanguage) {
    const base = String(ctx.language).split('-')[0];
    for (const k of [`${job}:${ctx.language}`, `${job}:${base}`, ctx.language, base]) {
      if (cfg.perLanguage[k] && pick(cfg.perLanguage[k], 'per-language')) break;
    }
  }

  const ro = cfg.rollout;
  if (ro && ro.model && ctx.userId && Number(ro.pct) > 0
      && bucketOf(ctx.userId, job) < Number(ro.pct)) {
    pick(ro.model, 'rollout');
  }

  if (ctx.model) pick(ctx.model, 'explicit');

  // last, so nothing can beat it
  if (cfg.killSwitch) { model = todaysModel(job, ctx); source = 'kill-switch'; }

  return { job, model, source, env: JOBS[job].env, site: JOBS[job].site };
}

/**
 * The model a call site sends for its job (bd-gr4fy.8): the job's own env var where it has one,
 * else its default here. What a call site asks INSTEAD of writing a model of its own, so this
 * table is the one place a job's model is written. The per-job override (llm-client) and the kill
 * switch act on top of it, on the wire, with this model behind any override.
 */
function modelFor(job, ctx = {}) {
  return todaysModel(job, ctx);
}

module.exports = {
  modelFor,
  JOBS, FALLBACK, TELEMETRY_ONLY_JOBS, JSON_REPLY_JOBS, JSON_REPAIRED_BY_CALLER,
  fallbackForJob, resolveModelForJob, todaysModel, bucketOf, isModel,
};
