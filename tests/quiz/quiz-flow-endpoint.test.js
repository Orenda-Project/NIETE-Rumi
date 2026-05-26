/**
 * quiz-flow-endpoint — smoke test.
 *
 * `node --check` only syntax-parses; it does not resolve require()s. This test
 * actually loads the module with bot-only infra deps mocked (the established
 * pattern — see status-flow.test.js), so a missing/renamed quiz dependency
 * surfaces here rather than at runtime, and confirms the three Flow handlers
 * the route dispatcher imports are present.
 */

describe('quiz-flow-endpoint module', () => {
  it('loads with infra mocked and exports the three flow handlers', () => {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));

    const mod = require('../../bot/shared/routes/quiz-flow-endpoint');
    expect(typeof mod.handleQuizFlowInit).toBe('function');
    expect(typeof mod.handleQuizFlowDataExchange).toBe('function');
    expect(typeof mod.handleQuizFlowBack).toBe('function');
  });

  it('is wired into flow-configs as the /api/flows/quiz endpoint flow', () => {
    const { FLOW_CONFIGS } = require('../../bot/scripts/setup/flow-configs');
    const quiz = FLOW_CONFIGS.find((f) => f.envVar === 'QUIZ_FLOW_ID');
    expect(quiz).toBeDefined();
    expect(quiz.type).toBe('endpoint');
    expect(quiz.endpointPath).toBe('/api/flows/quiz');
  });
});
