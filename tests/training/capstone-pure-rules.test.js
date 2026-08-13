/**
 * bd-2673 — the capstone's rules, usable by a surface that is not WhatsApp.
 *
 * The capstone is why assessments were WhatsApp-only at all (bd-2490): the
 * portal renders a quiz as one radio per option, and a capstone paper is free
 * text with no options, so a Beacon House teacher opening the level exam saw
 * eight questions, no inputs, a counter stuck on 0/8 and a dead Submit button.
 *
 * Fixing that means the portal runs the capstone — which means it needs the same
 * rubric and pass rule WhatsApp uses. finalizeAttempt cannot be reused (it takes
 * a phone number and sends messages mid-scoring), so the RULES are extracted and
 * pinned here.
 */

// The functions under test are pure, but they live in a module that also holds
// the WhatsApp delivery path — so requiring it pulls in supabase, the WhatsApp
// service and the LLM client. Mock those away. CI runs root `npm test` before
// `bot/ npm ci`, so bot-only deps must be virtual (see CLAUDE.md).
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: jest.fn(),
  getCurrentCorrelationId: () => null,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(),
  sendInteractiveButtons: jest.fn(),
}));
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: jest.fn(),
  getDefaultModel: () => 'test-model',
}));
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
jest.mock('pdfkit', () => jest.fn(), { virtual: true });

const {
  decideCapstonePass,
  meetsAnswerFloor,
  MIN_ANSWER_CHARS,
  CAPSTONE_PASS_PCT,
} = require('../../bot/shared/services/training/capstone-delivery.service');

describe('bd-2673 — capstone answer floor', () => {
  it('rejects an answer under the floor', () => {
    expect(meetsAnswerFloor('too short')).toBe(false);
  });

  it('accepts an answer at the floor', () => {
    expect(meetsAnswerFloor('x'.repeat(MIN_ANSWER_CHARS))).toBe(true);
  });

  it('ignores surrounding whitespace so padding cannot fake the floor', () => {
    expect(meetsAnswerFloor(`   ${'x'.repeat(MIN_ANSWER_CHARS - 1)}   `)).toBe(false);
  });

  it('treats empty and nullish as failing rather than throwing', () => {
    expect(meetsAnswerFloor('')).toBe(false);
    expect(meetsAnswerFloor(null)).toBe(false);
    expect(meetsAnswerFloor(undefined)).toBe(false);
  });
});

describe('bd-2673 — capstone verdict', () => {
  it('sums the per-answer scores and passes at the 70% bar', () => {
    // 8 questions x 5 points = 40; bar = ceil(40 * 0.7) = 28.
    const out = decideCapstonePass({
      answerScores: [4, 4, 4, 4, 4, 4, 4, 4], // 32
      totalQuestions: 8,
      totalScore: 40,
    });
    expect(out.ok).toBe(true);
    expect(out.score).toBe(32);
    expect(out.pass_bar).toBe(28);
    expect(out.is_passed).toBe(true);
  });

  it('fails just under the bar', () => {
    const out = decideCapstonePass({
      answerScores: [3, 3, 3, 3, 3, 3, 3, 4], // 25 < 28
      totalQuestions: 8,
      totalScore: 40,
    });
    expect(out.is_passed).toBe(false);
  });

  it('passes exactly ON the bar — >= not >', () => {
    const out = decideCapstonePass({
      answerScores: [4, 4, 4, 4, 4, 4, 2, 2], // 28 === bar
      totalQuestions: 8,
      totalScore: 40,
    });
    expect(out.is_passed).toBe(true);
  });

  it('reports the pass percentage from the constant, never a literal', () => {
    const out = decideCapstonePass({ answerScores: [5], totalQuestions: 1, totalScore: 5 });
    expect(out.pass_pct).toBe(Math.round(CAPSTONE_PASS_PCT * 100));
  });

  it('bd-2478 — REFUSES to score when answer rows are missing', () => {
    // The bug: a teacher answered 8 questions well, the rows had not persisted,
    // the sum ran over what was readable and reported 2/40. A short answer set
    // is a fault, not a low score.
    const out = decideCapstonePass({
      answerScores: [5, 5], // only 2 of 8 came back
      totalQuestions: 8,
      totalScore: 40,
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('answers_missing');
    expect(out.is_passed).toBeUndefined();
    expect(out.score).toBeUndefined();
  });
});
