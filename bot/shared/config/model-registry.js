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
 *   5  per job       the job's own env var, which already exists
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

module.exports = { JOBS, resolveModelForJob, todaysModel, bucketOf, isModel };
