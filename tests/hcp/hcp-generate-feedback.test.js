/**
 * POST /api/portal/hcp/generate-feedback
 *
 * Generates the 6-box coaching-feedback JSON via the platform's LLM client
 * (OpenRouter/Claude by default). The 6 boxes match the HCP prototype's
 * output shape:
 *   Strengths (green) / Areas of Growth (orange) /
 *   Student Learning Priorities (purple) / Student Engagement (orange-red) /
 *   Action Items (yellow) / Coach's Note (blue)
 *
 * Body:
 *   {
 *     teacher_id: uuid,
 *     coaching_session_id: uuid | null,
 *     observation_data: { ... FICO/HOTs/COTs section scores ... },
 *     language: 'english' | 'urdu' | 'roman_urdu',    // default english
 *   }
 *
 * Behaviour:
 *   1. requirePortalAuth (401).
 *   2. 400 on missing teacher_id or observation_data.
 *   3. On success: calls the LLM, parses JSON out of the response, persists
 *      the result to hcp_feedback_deliveries, and returns the feedback with
 *      the new delivery id.
 *   4. On LLM failure (network error / malformed JSON): returns 502 with a
 *      diagnostic message; no row is written.
 *   5. Language is passed through to the prompt.
 */

let tableStates;
let llmCreate;
const { installSupabaseMock, invokeRoute, resetTableStates } = require('./_shared');

beforeEach(() => {
  jest.resetModules();
  tableStates = resetTableStates();
  installSupabaseMock(tableStates);

  llmCreate = jest.fn();
  jest.doMock('../../bot/shared/services/llm-client', () => ({
    getClient: () => ({
      chat: { completions: { create: llmCreate } },
    }),
    getDefaultModel: () => 'anthropic/claude-opus-4-7',
  }));
});
afterEach(() => jest.resetModules());

function sixBoxJson() {
  return {
    header: { teacher_name: 'Aisha Khan', observation_tool: 'FICO' },
    strengths_box: { title: 'Strengths', points: ['Clear opening.'] },
    areas_of_growth_box: { title: 'Areas of Growth', points: ['Ask more open questions.'] },
    student_learning_box: {
      title: 'Student Learning Priorities', summary: 'Priorities summary',
      key_learning_gaps: ['gap'], recommended_practices: ['practice'],
    },
    student_engagement_box: {
      title: 'Student Engagement & Participation', summary: 'Engagement summary',
      engagement_strengths: ['s'], engagement_gaps: ['g'], strategies_to_improve: ['st'],
    },
    action_items_box: { title: 'Action Items', points: ['Try one open Q per lesson.'] },
    encouragement_box: {
      title: "Coach's Note", message: 'Keep going.', signed_by: 'Coach',
    },
  };
}

describe('POST /api/portal/hcp/generate-feedback', () => {
  it('requires portal auth (401)', async () => {
    const { statusCode } = await invokeRoute({
      method: 'post', path: '/generate-feedback', userId: null,
      body: { teacher_id: 't-1', observation_data: {} },
    });
    expect(statusCode).toBe(401);
  });

  it('400 on missing teacher_id', async () => {
    const { statusCode } = await invokeRoute({
      method: 'post', path: '/generate-feedback',
      body: { observation_data: {} },
    });
    expect(statusCode).toBe(400);
  });

  it('400 on missing observation_data', async () => {
    const { statusCode } = await invokeRoute({
      method: 'post', path: '/generate-feedback',
      body: { teacher_id: 't-1' },
    });
    expect(statusCode).toBe(400);
  });

  it('generates feedback and persists a delivery row', async () => {
    tableStates.users = { rows: [{ id: 't-1', first_name: 'Aisha' }] };
    tableStates.hcp_feedback_deliveries = { rows: [] };
    llmCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(sixBoxJson()) } }],
    });

    const { statusCode, payload } = await invokeRoute({
      method: 'post', path: '/generate-feedback', userId: 'coach-42',
      body: {
        teacher_id: 't-1',
        observation_data: {
          teacher_name: 'Aisha Khan', observation_tool: 'FICO',
          sections: { B: { SI1: 1 }, C: { 'PIC-4': 0.5 } },
        },
        language: 'english',
      },
    });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.feedback.strengths_box).toBeDefined();
    expect(payload.delivery_id).toBeTruthy();
    expect(tableStates.hcp_feedback_deliveries.rows).toHaveLength(1);
    expect(tableStates.hcp_feedback_deliveries.rows[0].language).toBe('english');
    expect(llmCreate).toHaveBeenCalledTimes(1);
  });

  it('accepts urdu / roman_urdu languages', async () => {
    tableStates.users = { rows: [{ id: 't-1', first_name: 'Aisha' }] };
    tableStates.hcp_feedback_deliveries = { rows: [] };
    llmCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(sixBoxJson()) } }],
    });

    const { statusCode, payload } = await invokeRoute({
      method: 'post', path: '/generate-feedback',
      body: {
        teacher_id: 't-1',
        observation_data: { teacher_name: 'A', observation_tool: 'FICO' },
        language: 'roman_urdu',
      },
    });

    expect(statusCode).toBe(200);
    expect(tableStates.hcp_feedback_deliveries.rows[0].language).toBe('roman_urdu');
    const callArgs = llmCreate.mock.calls[0][0];
    const prompt = callArgs.messages[0].content;
    expect(prompt).toMatch(/roman urdu/i);
  });

  it('returns 502 when the LLM returns malformed JSON', async () => {
    tableStates.users = { rows: [{ id: 't-1', first_name: 'Aisha' }] };
    tableStates.hcp_feedback_deliveries = { rows: [] };
    llmCreate.mockResolvedValue({
      choices: [{ message: { content: 'this is not JSON at all' } }],
    });

    const { statusCode, payload } = await invokeRoute({
      method: 'post', path: '/generate-feedback',
      body: { teacher_id: 't-1', observation_data: { teacher_name: 'A' } },
    });

    expect(statusCode).toBe(502);
    expect(payload.success).toBe(false);
    expect(tableStates.hcp_feedback_deliveries.rows).toHaveLength(0);
  });

  it('returns 502 when the LLM call throws', async () => {
    tableStates.users = { rows: [{ id: 't-1', first_name: 'Aisha' }] };
    tableStates.hcp_feedback_deliveries = { rows: [] };
    llmCreate.mockRejectedValue(new Error('network down'));

    const { statusCode, payload } = await invokeRoute({
      method: 'post', path: '/generate-feedback',
      body: { teacher_id: 't-1', observation_data: { teacher_name: 'A' } },
    });

    expect(statusCode).toBe(502);
    expect(payload.success).toBe(false);
    expect(tableStates.hcp_feedback_deliveries.rows).toHaveLength(0);
  });
});
