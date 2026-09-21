/**
 * bd-60161 — a CRQ is marked against ITS OWN rubric.
 *
 * I-SAPS writes a different rubric for every constructed-response question:
 * 36 in Level 1, each with three criteria and its own band descriptions. The
 * seeder stored only the question text, so scoreAnswer() graded every answer
 * with one generic "is this practical classroom writing?" prompt that had
 * never seen a rubric.
 *
 * Measured against 46 hand-graded answers, that marker sat at 0.80 mean
 * absolute error with 0.26 run-to-run drift, and passed a fluent but off-task
 * answer in two runs of three. The same model handed the real rubric reached
 * 0.22 and 0.02. The partner's §4.3 also permits AI marking only against the
 * rubric and notes, so the generic path was out of policy as well as loose.
 *
 * What these tests hold in place:
 *  1. the rubric reaches the model, with its band text, when the question has one;
 *  2. an unreachable band (the source prints "-") is declared unreachable —
 *     a marker that invents an Exemplary band awards marks the rubric cannot give;
 *  3. the rubric's own total wins over the vendor scale, or a 10-mark CRQ gets
 *     silently reported out of 5;
 *  4. a question with NO rubric still grades, on the old prompt. Beacon House
 *     has no rubrics; refusing to mark would strand it.
 */

const MODULE = '../../bot/shared/services/training/capstone-delivery.service';

/**
 * Capture what the service actually sends to the LLM.
 *
 * Mocks are registered at MODULE scope with jest.mock, not inside a helper
 * with jest.doMock. A sibling suite (capstone-delivery.test.js) calls
 * jest.resetModules() in its own beforeEach, which wipes doMock registrations
 * made here — the service then loaded the REAL llm-client and died on a
 * missing @anthropic-ai/sdk. jest.mock is hoisted and survives that.
 *
 * A jest.mock factory may not close over this file's variables, so the capture
 * state lives in a sibling module that both it and the tests require.
 *
 * Nothing is `virtual`: these paths exist, and declaring them virtual shadows
 * the real modules for every later suite in the worker.
 */
const state = require('./bd-60161-crq-rubric-marking.helpers');

jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({
    chat: {
      completions: {
        create: async (payload) => {
          // eslint-disable-next-line global-require
          const st = require('./bd-60161-crq-rubric-marking.helpers');
          st.__sent.push(payload);
          return { choices: [{ message: { content: JSON.stringify(st.__reply()) } }] };
        },
      },
    },
  }),
  getDefaultModel: () => 'openai/gpt-4o',
}));

function loadWithCapture(reply) {
  state.__sent.length = 0;
  state.__setReply(reply);
  // eslint-disable-next-line global-require
  const mod = require(MODULE);
  return { mod, sent: state.__sent };
}

const RUBRIC = {
  total_marks: 10,
  criteria: [
    { name: 'Explains the Two Dimensions', marks: 4,
      bands: { '4': 'Names all six processes and four knowledge types.',
               '3': 'Explains both but one is vague.',
               '2': 'Confuses or conflates them.',
               '1': 'Uses the original 1956 taxonomy.' } },
    // Exemplary is "-" in the source: this criterion tops out at 3.
    { name: 'Critiques the Current Unit Plan', marks: 3,
      bands: { '3': 'Specific critique using the framework.',
               '2': 'Mentions the taxonomy but general.',
               '1': 'Says it is too basic without linking to the taxonomy.' } },
    { name: 'Proposes a New Objective', marks: 3,
      bands: { '3': 'Specific objective naming process and knowledge type.',
               '2': 'Higher-level but the link is implied.',
               '1': 'Only a slight variation of the existing ones.' } },
  ],
};

const CRQ = { question_text: 'Explain the two dimensions...', rubric: RUBRIC };
const NO_RUBRIC = { question_text: 'Describe one classroom routine.' };

describe('bd-60161 — rubric-grounded CRQ marking', () => {
  test('sends the rubric, with every band description, when the question has one', async () => {
    const { mod, sent } = loadWithCapture({ criteria: [{ n: 1, marks: 4 }], total: 9, feedback: 'ok' });
    await mod.scoreAnswer(CRQ, 'an answer', 10);

    const prompt = sent[0].messages.map(m => m.content).join('\n');
    expect(prompt).toContain('Explains the Two Dimensions');
    expect(prompt).toContain('Names all six processes and four knowledge types.');
    expect(prompt).toContain('Uses the original 1956 taxonomy.');
    // and it must tell the model to mark against it, not to freestyle
    expect(prompt).toMatch(/follow the rubric exactly/i);
  });

  test('declares a band unreachable when the rubric omits it', async () => {
    const { mod, sent } = loadWithCapture({ total: 7, feedback: 'ok' });
    await mod.scoreAnswer(CRQ, 'an answer', 10);
    const prompt = sent[0].messages.map(m => m.content).join('\n');
    // criterion 2 has no "4" band — the model must be told so explicitly
    expect(prompt).toMatch(/No band below 1 exists/);
    expect(prompt).toMatch(/not listed for a criterion is unavailable/i);
  });

  test("the rubric's total wins over the vendor scale", async () => {
    // vendor scale 5, rubric total 10, model returns 9 -> must NOT clamp to 5
    const { mod } = loadWithCapture({ total: 9, feedback: 'ok' });
    const { score } = await mod.scoreAnswer(CRQ, 'an answer', 5);
    expect(score).toBe(9);
  });

  test('reads `total` from the rubric reply, not `score`', async () => {
    const { mod } = loadWithCapture({ criteria: [{ n: 1, marks: 4 }], total: 8, feedback: 'ok' });
    const { score } = await mod.scoreAnswer(CRQ, 'an answer', 10);
    expect(score).toBe(8);
  });

  test('falls back to the generic prompt when the question has no rubric', async () => {
    const { mod, sent } = loadWithCapture({ score: 4, feedback: 'ok' });
    const { score } = await mod.scoreAnswer(NO_RUBRIC, 'an answer', 5);
    const prompt = sent[0].messages.map(m => m.content).join('\n');
    expect(prompt).not.toMatch(/follow the rubric exactly/i);
    expect(prompt).toContain('Describe one classroom routine.');
    expect(score).toBe(4);   // still marked, on the old scale
  });

  test('a malformed rubric degrades to the generic prompt rather than throwing', async () => {
    const { mod, sent } = loadWithCapture({ score: 3, feedback: 'ok' });
    const broken = { question_text: 'q', rubric: { total_marks: 10, criteria: [] } };
    const { score } = await mod.scoreAnswer(broken, 'an answer', 5);
    const prompt = sent[0].messages.map(m => m.content).join('\n');
    expect(prompt).not.toMatch(/follow the rubric exactly/i);
    expect(score).toBe(3);
  });

  test('renderRubric returns null for an unusable rubric', () => {
    const { mod } = loadWithCapture({});
    expect(mod.renderRubric(null)).toBeNull();
    expect(mod.renderRubric({ criteria: [] })).toBeNull();
    expect(mod.renderRubric({ criteria: [{ name: 'x', marks: 3, bands: {} }] })).toBeNull();
  });
});
