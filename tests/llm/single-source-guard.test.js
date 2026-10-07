/**
 * bd-gr4fy.8 — every model in the Anthropic swap's scope lives in ONE place.
 *
 * The per-job override already moves any labelled job from one settings row, with the kill switch
 * over all of them. But each job's own model was still written at its call site (a literal, a
 * module constant, or an env read repeated beside the registry's), in twenty files. Changing one
 * meant finding it. Now each job's model is an entry in `bot/shared/config/model-registry.js`, and
 * the call site asks the registry for the job it labels:
 *
 *   model-registry.js JOBS      the model each job runs (its env var, where it already had one)
 *   app_settings.llm_per_job    moves any job, no deploy, with its registry model behind it
 *   LLM_JOB_MODELS              the same map, for an environment with no settings table
 *   app_settings.llm_kill_switch every job back on its registry model within about a minute
 *
 * These checks keep it that way: a model written back into a call site fails here.
 */
const fs = require('fs');
const path = require('path');

const BOT = path.join(__dirname, '..', '..', 'bot');

/** Every job in the swap's scope, and the file(s) whose call sites run it. */
const SITES = {
  'chat.respond': ['shared/services/openai.service.js'],
  'chat.intent': ['shared/services/openai.service.js'],
  'chat.topic': ['shared/services/openai.service.js'],
  'chat.completion': ['shared/services/openai.service.js',
    'shared/services/video/video-script.service.js', 'shared/services/video/video-orchestrator.service.js'],
  'lang.detect': ['shared/services/language-detector.service.js'],
  'lp.editIntent': ['shared/services/lp612-edit-intent.service.js'],
  'lp.extractText': ['workers/lesson-plan-extraction.worker.js'],
  'attendance.voiceExtract': ['shared/services/voice-attendance.service.js'],
  'training.capstoneScore': ['shared/services/training/capstone-delivery.service.js'],
  'helper.capabilityDetect': ['shared/services/helper-agent.service.js'],
  'helper.capabilityGuidance': ['shared/services/helper-agent.service.js'],
  'helper.capabilityDefault': ['shared/services/helper-agent.service.js'],
  'helper.guidance': ['shared/services/helper-agent.service.js'],
  'helper.stuckRecovery': ['shared/services/helper-agent.service.js'],
  'coaching.pedagogy': ['shared/services/gpt5-mini.service.js'],
  'coaching.completeJson': ['shared/services/gpt5-mini.service.js'],
  // bd-gr4fy.15: named by observe-debrief.service.js through completeJson's `job` option; the helper asks the
  // registry for it, so the helper is the file that must write no model of its own.
  'coaching.observeDebrief': ['shared/services/gpt5-mini.service.js'],
  'coaching.fidelityFallback': ['shared/services/gpt5-mini.service.js'],
  'coaching.enhance': ['shared/services/gpt5-mini.service.js'],
  'coaching.reflectiveQuestion': ['shared/services/gpt5-mini.service.js'],
  'coaching.inferTopic': ['shared/services/gpt5-mini.service.js'],
  'coaching.inferSubject': ['shared/services/gpt5-mini.service.js'],
  'coaching.priorFeedback': ['shared/services/gpt5-mini.service.js'],
  'coaching.voiceDebrief': ['shared/services/gpt5-mini.service.js'],
  'coaching.acknowledgement': ['shared/services/coaching/reflective-conversation.service.js'],
  'coaching.narrative': ['shared/services/coaching/report-v2/narrative.service.js'],
  'coaching.commitmentCard': ['shared/services/coaching/coaching-card/commitment-card.service.js'],
  'coaching.cardLocalise': ['shared/services/coaching/coaching-card/commitment-card.service.js'],
  'coaching.questionRouter': ['shared/services/coaching/reflective-questions/llm-router.service.js'],
  'coaching.reflectiveCorpus': ['shared/services/coaching/reflective-questions/llm-router.service.js'],
  'lp.extractUpload': ['shared/services/coaching/fidelity/lp-upload-extractor.js'],
  'lp.fidelity': ['shared/services/coaching/fidelity/fidelity-analyzer.js'],
  'lp.extractVision': ['shared/services/lp-vision-ocr.service.js'],
  'roster.extract': ['shared/services/roster/roster-extraction.service.js'],
  'quiz.transcript': ['shared/services/quiz/transcript-quiz-llm.js'],
  'quiz.keyVerify': ['shared/services/quiz/transcript-quiz-key-verify.service.js'],
  'quiz.generate': ['shared/services/quiz/quiz-generation.service.js'],
  'quiz.insight': ['shared/services/quiz/quiz-report.service.js'],
  'quiz.session': ['shared/services/quiz/quiz-session.service.js'],
  'quiz.videoReport': ['shared/services/quiz/video-quiz-report.service.js'],
  'lp.author': ['shared/config/lp612-flags.js'],
  'vision.analyse': ['shared/services/vision.service.js'],
  'assessment.generate': ['shared/services/assessment/assessment-generation.service.js'],
};

/** These four talk to api.openai.com directly on their own client: their model must stay one it serves. */
const OPENAI_DIRECT = ['quiz.generate', 'quiz.insight', 'quiz.session', 'quiz.videoReport'];

const FILES = [...new Set(Object.values(SITES).flat())];
const read = (rel) => fs.readFileSync(path.join(BOT, rel), 'utf8');
/** Source with comments removed, so a model named in a comment is not a model written in code. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const { JOBS, TELEMETRY_ONLY_JOBS } = require('../../bot/shared/config/model-registry');

describe('one place holds every in-scope model', () => {
  test('every job in the swap scope is a routed job in the registry', () => {
    const missing = Object.keys(SITES).filter((job) => !JOBS[job]);
    expect(missing).toEqual([]);
  });

  test('and none of them is still listed as labelled-but-not-routed', () => {
    expect(Object.keys(SITES).filter((job) => TELEMETRY_ONLY_JOBS.includes(job))).toEqual([]);
  });

  test.each(FILES)('%s writes no model of its own', (rel) => {
    const src = code(rel);
    const found = [
      ...[...src.matchAll(/\bmodel\s*:\s*['"`][^'"`]+['"`]/g)].map((m) => m[0]),                 // model: 'gpt-4o'
      ...[...src.matchAll(/\b[A-Z_]*MODEL\s*=\s*['"`][^'"`]+['"`]/g)].map((m) => m[0]),          // const MODEL = '...'
      ...[...src.matchAll(/process\.env\.[A-Z_]*MODEL[A-Z_]*\b/g)].map((m) => m[0]),             // its own env read
      ...[...src.matchAll(/\bgetDefaultModel\s*\(/g)].map((m) => m[0]),                          // the platform default
    ];
    expect(found).toEqual([]);
  });

  test.each(FILES)('%s asks the registry for the very job it labels', (rel) => {
    const src = code(rel);
    const asked = new Set([...src.matchAll(/\b(?:modelFor|todaysModel|resolveModelForJob)\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]));
    for (const job of asked) expect(JOBS[job] ? job : `unknown job ${job}`).toBe(job);
    const labelled = new Set([...src.matchAll(/\bjob\s*:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]));
    const inScope = Object.keys(SITES).filter((job) => SITES[job].includes(rel));
    for (const job of [...labelled].filter((j) => inScope.includes(j))) {
      expect(asked.has(job) ? job : `${job} is labelled here but its model is not asked of the registry`).toBe(job);
    }
  });

  test('a client that talks to api.openai.com directly keeps a model it serves, and no env var', () => {
    for (const job of OPENAI_DIRECT) {
      expect(JOBS[job]).toBeDefined();
      expect(JOBS[job].default).toMatch(/^gpt-[a-z0-9.-]+$/);
      expect(JOBS[job].env).toBeFalsy();
    }
  });
});

/**
 * THE NO-OP CONTRACT for the jobs this moved. With nothing set, every job resolves to exactly the
 * model its call site sent before, reproduced here from the shipping code by hand rather than read
 * from the registry: a test that imports the thing it checks proves only that it agrees with itself.
 * (bot/tests/model-registry-noop.test.js holds the same contract for the first ten jobs, but nothing
 * runs bot/tests in CI, so the in-scope jobs are pinned here, where the gate runs.)
 */
const TODAY = {
  'chat.respond': () => 'gpt-4.1-mini',
  'chat.intent': () => 'gpt-4.1-mini',
  'chat.topic': () => 'gpt-4.1-mini',
  'chat.completion': () => 'gpt-4o-mini',
  'lang.detect': () => 'gpt-4o-mini',
  'lp.editIntent': () => process.env.LP612_EDIT_INTENT_MODEL || 'openai/gpt-4.1-mini',
  'lp.extractText': () => 'gpt-4o-mini',
  'attendance.voiceExtract': () => process.env.LLM_MODEL || 'openai/gpt-4o',
  'training.capstoneScore': () => process.env.LLM_MODEL || 'openai/gpt-4o',
  'helper.capabilityDetect': () => 'gpt-4o-mini',
  'helper.capabilityGuidance': () => 'gpt-4o-mini',
  'helper.capabilityDefault': () => 'gpt-4o-mini',
  'helper.guidance': () => 'gpt-4o',
  'helper.stuckRecovery': () => 'gpt-4o-mini',
  'coaching.pedagogy': () => 'gpt-5-mini-2025-08-07',
  'coaching.completeJson': () => 'gpt-5-mini-2025-08-07',
  // bd-gr4fy.15: split out of completeJson's one label; until then it ran exactly completeJson's model.
  'coaching.observeDebrief': () => 'gpt-5-mini-2025-08-07',
  'coaching.fidelityFallback': () => 'gpt-4o-mini',
  'coaching.enhance': () => 'gpt-5-mini-2025-08-07',
  'coaching.reflectiveQuestion': () => 'gpt-4o',
  'coaching.inferTopic': () => 'gpt-4o-mini',
  'coaching.inferSubject': () => 'gpt-4o-mini',
  'coaching.priorFeedback': () => 'gpt-4o-mini',
  'coaching.voiceDebrief': () => 'gpt-4o',
  'coaching.acknowledgement': () => 'gpt-5-mini-2025-08-07',
  'coaching.narrative': () => 'gpt-5-mini-2025-08-07',
  'coaching.commitmentCard': () => 'gpt-5-mini-2025-08-07',
  'coaching.cardLocalise': () => 'gpt-5-mini-2025-08-07',
  'coaching.questionRouter': () => 'deepseek/deepseek-v3.2',
  // bd-gr4fy.12: split out of the router's one label; until then it ran exactly the router's model.
  'coaching.reflectiveCorpus': () => 'deepseek/deepseek-v3.2',
  'lp.extractUpload': () => process.env.LP_FIDELITY_MODEL || 'openai/gpt-5.6-luna',
  'lp.fidelity': () => process.env.LP_FIDELITY_MODEL || 'openai/gpt-5.6-luna',
  'lp.extractVision': () => process.env.LP_EXTRACTION_VISION_MODEL || 'google/gemini-2.5-flash',
  'roster.extract': () => process.env.ROSTER_VISION_MODEL || 'google/gemini-3.1-flash-lite-preview',
  'quiz.transcript': () => (process.env.TRANSCRIPT_QUIZ_MODEL || '').trim() || 'google/gemini-2.5-flash',
  'quiz.keyVerify': () => (process.env.TRANSCRIPT_QUIZ_VERIFY_MODEL || '').trim() || 'anthropic/claude-sonnet-5',
  'quiz.generate': () => 'gpt-4o',
  'quiz.insight': () => 'gpt-4o-mini',
  'quiz.session': () => 'gpt-4o-mini',
  'quiz.videoReport': () => 'gpt-5.4-mini',
  'lp.author': () => (process.env.LP_AUTHOR_MODEL || '').trim() || 'anthropic/claude-sonnet-5',
  'vision.analyse': () => process.env.VISION_MODEL || 'gpt-4.1-mini',
  'assessment.generate': () => process.env.ASSESSMENT_GEN_MODEL || 'google/gemini-3.1-pro-preview',
};
// The question router's own retry, after its primary model has failed twice.
const ROUTER_RETRY = 'openai/gpt-5.4';

const ENV_VARS = ['LP612_EDIT_INTENT_MODEL', 'LLM_MODEL', 'LP_FIDELITY_MODEL', 'LP_EXTRACTION_VISION_MODEL',
  'ROSTER_VISION_MODEL', 'TRANSCRIPT_QUIZ_MODEL', 'TRANSCRIPT_QUIZ_VERIFY_MODEL', 'LP_AUTHOR_MODEL',
  'LP_AUTHOR_MODEL_MATHS_PHYSICS', 'VISION_MODEL', 'ASSESSMENT_GEN_MODEL', 'ASSESSMENT_GEN_MODEL_ENG',
  'ASSESSMENT_GEN_MODEL_URDU'];

describe('with nothing set, every in-scope job runs exactly what its call site sent before', () => {
  let saved;
  beforeEach(() => { saved = {}; ENV_VARS.forEach((v) => { saved[v] = process.env[v]; delete process.env[v]; }); });
  afterEach(() => ENV_VARS.forEach((v) => { if (saved[v] === undefined) delete process.env[v]; else process.env[v] = saved[v]; }));

  test('the table covers the whole scope', () => {
    expect(Object.keys(TODAY).sort()).toEqual(Object.keys(SITES).sort());
  });

  test.each(Object.keys(TODAY))('%s', (job) => {
    // eslint-disable-next-line global-require
    const { modelFor } = require('../../bot/shared/config/model-registry');
    expect(modelFor(job)).toBe(TODAY[job]());
    if (JOBS[job] && JOBS[job].env) {
      process.env[JOBS[job].env] = 'anthropic/claude-opus-5';
      expect(modelFor(job)).toBe(TODAY[job]());
    }
  });

  test("the question router's retry model is the registry's too", () => {
    // eslint-disable-next-line global-require
    const { fallbackForJob } = require('../../bot/shared/config/model-registry');
    expect(fallbackForJob('coaching.questionRouter')).toBe(ROUTER_RETRY);
  });

  test('and so is the corpus step\'s, which shares that ladder (bd-gr4fy.12)', () => {
    // eslint-disable-next-line global-require
    const { fallbackForJob } = require('../../bot/shared/config/model-registry');
    expect(fallbackForJob('coaching.reflectiveCorpus')).toBe(ROUTER_RETRY);
  });
});
