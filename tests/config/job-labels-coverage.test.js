/**
 * Every model call in the coaching cluster says WHICH FEATURE spent the money. bd-jntcx.
 *
 * The first production spend data (2026-09-21, the day the job labels went live) showed
 * $85.76 of $173.97 -- 49% -- arriving with no `job` at all, and $54.35 of that was
 * `openai/gpt-5-mini` alone. Every one of those calls comes from this cluster: the
 * GPT5MiniService statics and the four coaching services that share its client.
 *
 * THE LABEL IS TELEMETRY ONLY AND MUST STAY THAT WAY IN THIS CHANGE. Passing `job` in the
 * create params of a PLAIN getClient() client sets `fallbackModel = null` in the chokepoint,
 * so the fallback ladder is not armed and the failure path is byte-for-byte what it is today
 * (llm-client.js: `const to = fallbackDisabled() ? null : fallbackModel;` then
 * `if (!to || ...) throw primaryErr`). Arming fallbacks for these jobs is a SEPARATE change
 * with its own risk, deliberately not made here.
 *
 * Two guards, and the second is the one that will actually catch a regression:
 *   1. the names are exactly right (a typo splits one feature's spend across two buckets,
 *      and nothing in Axiom would ever tell you -- you would just see two small lines);
 *   2. every create() site in these files carries one, so a call added later cannot quietly
 *      go back to spending anonymously.
 */
const fs = require('fs');
const path = require('path');

const BOT = path.join(__dirname, '..', '..', 'bot');
const read = (rel) => fs.readFileSync(path.join(BOT, rel), 'utf8');

/** file -> the job names its call sites must carry, and how many create() sites it has. */
const EXPECTED = {
  'shared/services/gpt5-mini.service.js': {
    sites: 10,
    jobs: [
      'coaching.pedagogy',          // analyzePedagogy: scoring call + the photo-less retry (2 sites)
      'coaching.completeJson',      // generic JSON helper: observe debrief/feedback, remark narrative
      'coaching.fidelityFallback',  // _generateFidelityAssessment
      'coaching.enhance',           // enhanceAnalysisWithReflections
      'coaching.reflectiveQuestion',
      'coaching.inferTopic',
      'coaching.inferSubject',
      'coaching.priorFeedback',
      'coaching.voiceDebrief',
    ],
  },
  'shared/services/coaching/reflective-conversation.service.js': {
    sites: 1, jobs: ['coaching.acknowledgement'],
  },
  'shared/services/coaching/report-v2/narrative.service.js': {
    sites: 1, jobs: ['coaching.narrative'],
  },
  'shared/services/coaching/coaching-card/commitment-card.service.js': {
    sites: 2, jobs: ['coaching.commitmentCard', 'coaching.cardLocalise'],
  },
  // The ninth call site. It shares LP_FIDELITY_MODEL with fidelity-analyzer.js, which DID get
  // labelled, so it read as covered and was not. 176 calls/day found only by querying spend by
  // model and grepping back to the source.
  'shared/services/coaching/fidelity/lp-upload-extractor.js': {
    sites: 1, jobs: ['lp.extractUpload'],
  },

  // ---- phase 2 (bd-8xmp9): the remaining LIVE call sites -------------------------------
  // Scoped by reachability from the three Procfile entry points (whatsapp-bot.js,
  // workers/sqs-worker.js, dashboard/index.js). Four files that also hold model calls are
  // deliberately ABSENT because nothing requires them at all in NIETE -- transcript-enhancer,
  // name-extractor, and both pic-to-lp extractors. Labelling dead code buys nothing.
  'shared/services/helper-agent.service.js': {
    sites: 5,
    jobs: ['helper.guidance', 'helper.stuckRecovery', 'helper.capabilityDetect',
           'helper.capabilityGuidance', 'helper.capabilityDefault'],
  },
  'shared/services/exam-checker/grading.service.js': { sites: 1, jobs: ['exam.grade'] },
  'shared/services/coaching/reflective-questions/llm-router.service.js': {
    sites: 1, jobs: ['coaching.questionRouter'],
  },
  'shared/services/reading/analysis.service.js': {
    sites: 7,
    jobs: ['reading.analyse', 'reading.diagnosticSummary', 'reading.report',
           'reading.reportEnhance', 'reading.sendResults', 'reading.comprehensionStart',
           'reading.combinedReport'],
  },
  'shared/services/reading/comprehension.service.js': {
    sites: 5,
    jobs: ['reading.comprehensionQuestions', 'reading.evaluateText', 'reading.evaluateAnswer',
           'reading.comprehensionGuidance', 'reading.wordCategories'],
  },
  'shared/services/reading/auto-level-orchestrator.service.js': {
    sites: 5,
    jobs: ['reading.levelWelcome', 'reading.levelPassed', 'reading.levelRetry',
           'reading.levelTransition', 'reading.levelLowest'],
  },
  // two sites, one job: both are the same send, on two branches of the same method.
  'shared/services/reading/passage-generation.service.js': {
    sites: 3, jobs: ['reading.passageSend', 'reading.passageText'],
  },
  'shared/services/reading/fluency.service.js': { sites: 1, jobs: ['reading.fluencyMatch'] },
  'shared/services/reading/voice-feedback.service.js': { sites: 1, jobs: ['reading.voiceFeedback'] },
  'shared/services/reading/report.service.js': { sites: 1, jobs: ['reading.translate'] },
  'shared/services/reading-assessment.service.js': {
    sites: 3, jobs: ['reading.assessLanguage', 'reading.assessGrade', 'reading.assessAudio'],
  },
  'shared/services/quiz/quiz-generation.service.js': { sites: 1, jobs: ['quiz.generate'] },
  'shared/services/quiz/quiz-report.service.js': { sites: 1, jobs: ['quiz.insight'] },
  'shared/services/quiz/quiz-session.service.js': { sites: 1, jobs: ['quiz.session'] },
  'shared/services/quiz/video-quiz-report.service.js': { sites: 1, jobs: ['quiz.videoReport'] },
  // createChatCompletion is a pure passthrough (`create(options)`), so its label is a DEFAULT a
  // caller can override -- same seam as coaching.completeJson.
  'shared/services/openai.service.js': {
    sites: 4, jobs: ['chat.respond', 'chat.intent', 'chat.topic', 'chat.completion'],
  },
  'shared/services/lp612-edit-intent.service.js': { sites: 1, jobs: ['lp.editIntent'] },
  'shared/services/language-detector.service.js': { sites: 1, jobs: ['lang.detect'] },
  'shared/services/training/capstone-delivery.service.js': { sites: 1, jobs: ['training.capstoneScore'] },
  'shared/services/voice-attendance.service.js': { sites: 1, jobs: ['attendance.voiceExtract'] },
  'shared/utils/word-grid-generator.js': { sites: 1, jobs: ['reading.wordGrid'] },
  'workers/lesson-plan-extraction.worker.js': { sites: 1, jobs: ['lp.extractText'] },
};

// Accepts both `job: 'x'` and an override seam like `job: options.job || 'x'`, where the
// literal is the default rather than the whole expression.
const jobLiterals = (src) =>
  [...src.matchAll(/\bjob:\s*(?:[^,\n]*?\|\|\s*)?['"]([\w.]+)['"]/g)].map((m) => m[1]);

/** balanced {...} starting at or after `from` */
function block(src, from) {
  const open = src.indexOf('{', from);
  if (open < 0) return null;
  let d = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}' && --d === 0) return src.slice(open, i + 1);
  }
  return null;
}

/** the object literal a create() is actually given: inline, or the named const it is handed */
function requestFor(src, afterCreate) {
  const arg = src.slice(afterCreate, afterCreate + 400).replace(/^\s*/, '');
  if (arg.startsWith('{')) return block(src, afterCreate);
  const id = (/^([A-Za-z_$][\w$]*)\s*\)/.exec(arg) || [])[1];
  if (!id) return null;
  const def = new RegExp(`(?:const|let|var)\\s+${id}\\s*=\\s*\\{`).exec(src);
  return def ? block(src, def.index) : null;
}

/**
 * Sites that SEND a job, counting one inherited through a spread. The retry inside
 * analyzePedagogy is `{ ...scoringRequest, messages }` -- it carries the label because the
 * request it spreads carries it, and duplicating the literal there would be worse code, not
 * safer code. What matters is that no call reaches a vendor unattributed.
 */
function labelledSites(src) {
  let n = 0;
  for (const m of src.matchAll(/completions\s*\.\s*create\s*\(/g)) {
    const req = requestFor(src, m.index + m[0].length);
    if (!req) continue;
    if (/\bjob:/.test(req)) { n++; continue; }
    const spread = (/\.\.\.([A-Za-z_$][\w$]*)/.exec(req) || [])[1];
    if (spread) {
      const def = new RegExp(`(?:const|let|var)\\s+${spread}\\s*=\\s*\\{`).exec(src);
      const parent = def ? block(src, def.index) : null;
      if (parent && /\bjob:/.test(parent)) n++;
    }
  }
  return n;
}
const createSites = (src) =>
  [...src.matchAll(/completions\s*\.\s*create\s*\(/g)].length;

describe('the coaching cluster attributes its spend (bd-jntcx)', () => {
  test('the registry publishes the telemetry-only job names', () => {
    const reg = require('../../bot/shared/config/model-registry');
    expect(Array.isArray(reg.TELEMETRY_ONLY_JOBS)).toBe(true);

    const every = Object.values(EXPECTED).flatMap((e) => e.jobs);
    for (const job of every) expect(reg.TELEMETRY_ONLY_JOBS).toContain(job);
  });

  test.each(Object.entries(EXPECTED))('%s labels every create() site', (rel, expected) => {
    const src = read(rel);
    const found = jobLiterals(src);

    // Right names, no typos, nothing extra.
    expect([...new Set(found)].sort()).toEqual([...expected.jobs].sort());

    // Every call site sends a job. Catches a create() added later without one.
    expect(createSites(src)).toBe(expected.sites);
    expect(labelledSites(src)).toBe(expected.sites);
  });

  test('no job name is invented outside the registry', () => {
    const reg = require('../../bot/shared/config/model-registry');
    const known = new Set([...Object.keys(reg.JOBS || {}), ...(reg.TELEMETRY_ONLY_JOBS || [])]);
    const all = Object.keys(EXPECTED).flatMap((rel) => jobLiterals(read(rel)));
    // Guard the guard: this test passes trivially while nothing is labelled at all.
    expect(new Set(all).size).toBe(new Set(Object.values(EXPECTED).flatMap((e) => e.jobs)).size);
    for (const job of all) expect(known.has(job)).toBe(true);
  });
});

describe('the label reaches the client, and arms nothing (bd-jntcx)', () => {
  test('lp-upload-extractor hands its job down to the request', async () => {
    const seen = [];
    const client = { chat: { completions: { create: async (params) => {
      seen.push(params);
      return { choices: [{ message: { content: JSON.stringify({ moves: [{ text: 'Teacher models the strategy' }] }) } }] };
    } } } };

    const { extractUploadedLp } = require('../../bot/shared/services/coaching/fidelity/lp-upload-extractor');
    await extractUploadedLp('a'.repeat(120), { client });

    expect(seen).toHaveLength(1);
    expect(seen[0].job).toBe('lp.extractUpload');
    // Telemetry only: no fallback is armed by this change.
    expect(seen[0].fallbackModel).toBeUndefined();
  });
});
