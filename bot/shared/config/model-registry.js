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
 * WHAT IS ALREADY TRUE AND WORTH SAYING OUT LOUD. This deployment is already multi-vendor.
 * Lesson-plan authoring defaults to `anthropic/claude-sonnet-5`; vision, roster extraction
 * and transcript quizzes default to Google models; fidelity to an OpenAI one. The first
 * Claude swap did not need doing here, it already happened.
 */

/**
 * job -> { env, default, note }
 *   env      the variable that already overrides this job, kept for compatibility
 *   default  what it falls back to today, read out of the shipping code
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
  },
  'roster.extract': {
    env: 'ROSTER_VISION_MODEL', default: 'google/gemini-3.1-flash-lite-preview',
    site: 'shared/services/roster/roster-extraction.service.js:35',
  },
  'quiz.transcript': {
    env: 'TRANSCRIPT_QUIZ_MODEL', default: 'google/gemini-2.5-flash',
    site: 'shared/services/quiz/transcript-quiz-llm.js:22',
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
  },
  'hcp.feedback': {
    // falls through to the platform default today, which is why it has no literal of its own
    env: 'HCP_FEEDBACK_MODEL', default: null,
    site: 'dashboard/routes/hcp.routes.js',
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
  'assessment.generate': 'google/gemini-3.1-pro-preview',  // what it already runs
  'hcp.feedback':     null,  // falls through to the platform default, which is the floor
  'platform.default': null,  // the floor
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
  // GPT5MiniService statics -- the gpt-5-mini/gpt-4o cluster
  'coaching.pedagogy',           // analyzePedagogy, incl. the photo-less retry
  'coaching.completeJson',       // generic JSON helper: observe debrief/feedback, remark narrative
  'coaching.fidelityFallback',   // _generateFidelityAssessment
  'coaching.enhance',            // enhanceAnalysisWithReflections
  'coaching.reflectiveQuestion',
  'coaching.inferTopic',
  'coaching.inferSubject',
  'coaching.priorFeedback',
  'coaching.voiceDebrief',
  // services sharing GPT5MiniService's client
  'coaching.acknowledgement',    // reflective-conversation
  'coaching.narrative',          // report-v2/narrative
  'coaching.commitmentCard',     // commitment-card
  'coaching.cardLocalise',       // commitment-card, translation pass
  // the ninth call site, found from spend rather than from reading the code
  'lp.extractUpload',            // coaching/fidelity/lp-upload-extractor

  // ---- phase 2 (bd-8xmp9): the rest of the LIVE call sites --------------------------------
  // Scoped by reachability from the three Procfile entry points. Four other files hold model
  // calls and are deliberately NOT here: transcript-enhancer, name-extractor, and both
  // pic-to-lp extractors are required by nothing in NIETE. See bd-8xmp9.
  'chat.respond',                // openai.service getResponseWithFormat -- the main reply
  'chat.intent',                 // openai.service detectIntent
  'chat.topic',                  // openai.service extractTopic
  'chat.completion',             // openai.service createChatCompletion -- a DEFAULT, callers override
  'helper.guidance',
  'helper.stuckRecovery',
  'helper.capabilityDetect',
  'helper.capabilityGuidance',
  'helper.capabilityDefault',
  'exam.grade',                  // exam-checker/grading
  'coaching.questionRouter',     // coaching/reflective-questions/llm-router
  'quiz.generate',
  'quiz.insight',                // quiz-report
  'quiz.session',
  'quiz.videoReport',
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
  'lp.editIntent',               // lp612-edit-intent
  'lp.extractText',              // workers/lesson-plan-extraction
  'lang.detect',                 // language-detector
  'training.capstoneScore',
  'attendance.voiceExtract',
]);

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
  const own = (process.env[spec.env] || '').trim();
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

module.exports = { JOBS, FALLBACK, TELEMETRY_ONLY_JOBS, fallbackForJob, resolveModelForJob, todaysModel, bucketOf, isModel };
