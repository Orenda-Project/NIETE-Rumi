/**
 * bd-2469 — stand in for the portal→bot HTTP hop with an in-process call to
 * the REAL bot functions.
 *
 * The portal no longer decides anything about training: it asks the bot over
 * /api/internal/training/*. Portal suites that used to drive the portal's own
 * copy of the rules would otherwise all fail closed with 503, because the
 * client (correctly) denies when it cannot reach a bot.
 *
 * Stubbing the client would throw away every rule assertion those suites
 * carry. Instead this wires the client's five methods straight to the bot's
 * exported domain functions, backed by the SAME supabase fixture the portal
 * test already seeds. Consequences:
 *
 *   - every existing rule assertion still exercises the genuine rules;
 *   - the suite now also proves the portal DELEGATES rather than duplicating;
 *   - the wire itself is covered separately, in
 *     tests/portal/training-rules-client.test.js (transport + fail-closed) and
 *     tests/routes/internal-training-api.test.js (auth + passthrough).
 *
 * Call from inside beforeEach, AFTER `supabaseFrom` is assigned:
 *
 *     installTrainingDelegation(() => supabaseFrom);
 *
 * A getter is required because `supabaseFrom` is reassigned per test and
 * jest.doMock factories are evaluated lazily on require.
 *
 * The fixture must seed the tables the bot reads: teacher_training_assignments,
 * training_program_scopes, training_vendors, training_levels, training_courses,
 * training_modules, teacher_training_progress, training_assessment_attempts,
 * training_grand_quizzes.
 *
 * NOTE ON FIXTURE REALISM: the portal mock harnesses honour `.in()` filters but
 * treat `.eq()` as a no-op. The bot filters exam attempts with
 * `.in('quiz_kind', ['grand','capstone'])`, which IS honoured — so an attempt
 * row must carry a real `quiz_kind`. Production rows always do; older portal
 * fixtures omitted it because `.eq('quiz_kind','grand')` never actually ran.
 */

/**
 * @param {() => Function} getSupabaseFrom returns the test's supabase `from` mock
 */
function installTrainingDelegation(getSupabaseFrom) {
  // The bot reads its own supabase client, not the dashboard's. Point both at
  // the one fixture so the two surfaces genuinely see identical data.
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: (...args) => getSupabaseFrom()(...args),
    rpc: jest.fn(),
  }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(),
    getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  }));

  // bd-2673 — the capstone grader is an LLM call. Without this mock a suite that
  // exercises the written-exam submit reaches OpenRouter for real: it hangs
  // until the request times out, which reads as "the test is broken" rather than
  // "the test is dialling the internet". Deterministic score so a suite can
  // assert a total.
  jest.doMock('../../bot/shared/services/llm-client', () => ({
    getClient: () => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: '{"score": 4, "feedback": "Clear and specific."}' } }],
          }),
        },
      },
    }),
    getDefaultModel: () => 'test-model',
  }));

  // Bot-tree deps. Root `npm test` runs before `bot/ npm ci`, so these must be
  // virtual (see CLAUDE.md).
  jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
  jest.doMock('pdfkit', () => jest.fn(), { virtual: true });
  jest.doMock('bullmq', () => ({ Queue: jest.fn(), Worker: jest.fn() }), { virtual: true });
  jest.doMock('aws-sdk', () => ({ SQS: jest.fn() }), { virtual: true });
  jest.doMock('exceljs', () => ({ Workbook: jest.fn() }), { virtual: true });
  jest.doMock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }), { virtual: true });
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

  jest.doMock('../../dashboard/services/training-rules.service', () => {
    const bot = require('../../bot/shared/routes/teacher-training-endpoint');
    return {
      getLevelStates: (uid) => bot.loadVisibleLevelsWithProgress(uid),
      checkLevelUnlocked: (uid, levelId) => bot.checkLevelUnlocked(uid, levelId),
      checkModuleUnlocked: (uid, moduleId) => bot.checkModuleUnlocked(uid, moduleId),
      checkExamGate: (uid, order, vendorKey) => bot.assertCanStartGrandQuiz(uid, order, vendorKey),
      checkExamGateByLevel: async (uid, levelId) => {
        const gate = await bot.assertCanStartExamForLevel(uid, levelId);
        const qd = require('../../bot/shared/services/training/quiz-delivery.service');
        return { pass_pct: await qd.getVendorPassingPctByLevel(levelId, 'exam'), ...gate };
      },
      getGrandQuizState: (uid, levelId) => bot.loadGrandQuizState(uid, levelId),
      getModuleQuizVerdict: (moduleId, score, total) =>
        require('../../bot/shared/services/training/quiz-delivery.service')
          .decideModuleQuizPass(moduleId, score, total),
      // bd-2673 — marking and the exam verdict moved to the bot too. Wired to
      // the real functions for the same reason as the rest of this fixture:
      // stubbing them would throw away the msq set-equality and vendor-pass-bar
      // assertions the portal suites exist to make.
      getExamVerdict: (levelId, score, total) =>
        require('../../bot/shared/services/training/quiz-delivery.service')
          .decideExamPass(levelId, score, total),
      markPaper: async (questions, answers) =>
        require('../../bot/shared/services/training/paper-marking.service')
          .markPaper({ questions, answers }),
      servePaper: async (questions, opts) => {
        const Serving = require('../../bot/shared/services/training/quiz-serving.service');
        const config = Serving.normalizeServingConfig((opts && opts.vendor) || null);
        const served = Serving.selectServedQuestions(questions, {
          attemptId: opts && opts.attemptId,
          isModuleQuiz: !!(opts && opts.isModuleQuiz),
          config,
        });
        return {
          questions: served.map((q) => ({
            id: q.id,
            display_order: Serving.buildOptionDisplayOrder({
              optionCount: Array.isArray(q.options) ? q.options.length : 0,
              correctOption: q.correct_option,
              attemptId: opts && opts.attemptId,
              questionId: q.id,
              shuffle: config.shuffle_options,
            }),
          })),
          total_served: served.length,
        };
      },
    };
  });
}

/**
 * Make a portal fixture visible to the bot's PROGRAM-SCOPED catalogue.
 *
 * The portal's old local gate read every active level and ignored program
 * scope entirely — that was bd-2468. The bot resolves a teacher's levels
 * through teacher_training_assignments → training_program_scopes → vendor, so
 * a fixture that seeds only training_levels is invisible to it and every gate
 * answers "Level not found".
 *
 * Idempotent and derived: whatever the fixture already seeds is left alone,
 * and anything missing is generated to be consistent with it. Call at the end
 * of a seed function, after training_levels exists.
 */
function seedProgramScope(tableStates, { userId = 'user-1', programId = 'prog-1' } = {}) {
  const DEFAULT_VENDOR = 'vendor-niete';

  if (!tableStates.training_vendors) {
    tableStates.training_vendors = {
      rows: [{
        id: DEFAULT_VENDOR, key: 'NIETE', name: 'NIETE',
        unlock_logic: 'chain', has_grand_quiz: true,
        passing_pct: 80, module_passing_pct: 100,
      }],
    };
  }
  const vendors = tableStates.training_vendors.rows || [];
  const firstVendorId = vendors.length ? vendors[0].id : DEFAULT_VENDOR;

  // Levels seeded without a vendor adopt the fixture's first vendor, so the
  // bot's `.in('vendor_id', …)` lookup can find them.
  for (const lvl of (tableStates.training_levels && tableStates.training_levels.rows) || []) {
    if (!lvl.vendor_id) lvl.vendor_id = firstVendorId;
  }

  if (!tableStates.teacher_training_assignments) {
    tableStates.teacher_training_assignments = {
      rows: [{ user_id: userId, program_id: programId, is_active: true }],
    };
  }
  const assignments = tableStates.teacher_training_assignments.rows || [];
  const activeProgram = assignments.length ? assignments[0].program_id : programId;

  if (!tableStates.training_program_scopes) {
    // level_ids: null == "the whole vendor", so scoping never masks the
    // behaviour a suite is actually testing.
    tableStates.training_program_scopes = {
      rows: vendors.map(v => ({ program_id: activeProgram, vendor_id: v.id, level_ids: null })),
    };
  }
}

module.exports = { installTrainingDelegation, seedProgramScope };
