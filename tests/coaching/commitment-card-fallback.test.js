/**
 * Commitment Card — fallback paths.
 *
 * The commitment card has a single graceful-degrade ladder:
 *   Q3 missing OR LLM throws OR JSON malformed → generatePrioritizedAction
 *   (the legacy rule-based focus-area card), mapped into the commitment-card
 *   shape with _source === 'fallback'.
 *
 * These tests lock the ladder so a future change cannot silently drop the
 * fallback (which would mean teachers see no card on Q3-absent sessions).
 */

jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockOpenAI = { chat: { completions: { create: jest.fn() } } };
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({ openai: mockOpenAI }));

// generatePrioritizedAction is the rule-based fallback. Stub it to a known
// canned shape so the assertions can lock the field mapping.
const mockPrioritizedAction = jest.fn();
jest.mock('../../bot/shared/services/coaching/coaching-card/prioritized-action.service', () => ({
  generatePrioritizedAction: (...args) => mockPrioritizedAction(...args),
}));

const { generateCommitmentCard } = require('../../bot/shared/services/coaching/coaching-card/commitment-card.service');

const ANALYSIS = {
  framework: 'hots',
  strengths: [{ title: 'Calm presence' }],
  growth_opportunities: [{ area: 'Wait time', observation: 'rephrased before children finished' }],
};

const PA_CANNED = {
  action: 'Build pause time into your questioning rhythm',
  example: 'Count 3 silent beats before calling on anyone',
  indicator: 'HOTS A3 — Wait time',
};

describe('Commitment Card — fallback path', () => {
  beforeEach(() => {
    mockOpenAI.chat.completions.create.mockReset();
    mockPrioritizedAction.mockReset();
    mockPrioritizedAction.mockResolvedValue(PA_CANNED);
  });

  it('Q3 absent → rule-based fallback, _source === "fallback"', async () => {
    const out = await generateCommitmentCard(ANALYSIS, { questions: [] }, 'en', { teacherName: 'Asha' });
    expect(mockPrioritizedAction).toHaveBeenCalled();
    expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      commitment: PA_CANNED.action,   // PA.action is the headline
      action: PA_CANNED.example,      // PA.example becomes the action box
      indicator: PA_CANNED.indicator,
      language: 'en',
      _source: 'fallback',
    });
  });

  it('Q3 too short (< 3 chars) → fallback', async () => {
    const out = await generateCommitmentCard(
      ANALYSIS,
      { questions: [{ question_number: '3', answer: 'ok' }] },
      'en',
      { teacherName: 'Asha' },
    );
    expect(out._source).toBe('fallback');
  });

  it('LLM throws → fallback', async () => {
    mockOpenAI.chat.completions.create.mockRejectedValue(new Error('boom'));
    const out = await generateCommitmentCard(
      ANALYSIS,
      { questions: [{ question_number: '3', answer: 'A meaningful Q3 answer.' }] },
      'en',
      { teacherName: 'Asha' },
    );
    expect(out._source).toBe('fallback');
  });

  it('LLM returns JSON missing commitment OR action → fallback', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ commitment: '', action: '' }) } }],
    });
    const out = await generateCommitmentCard(
      ANALYSIS,
      { questions: [{ question_number: '3', answer: 'A meaningful Q3 answer.' }] },
      'en',
      { teacherName: 'Asha' },
    );
    expect(out._source).toBe('fallback');
  });

  it('analysis missing → returns null (no card)', async () => {
    const out = await generateCommitmentCard(null, { questions: [] }, 'en', { teacherName: 'Asha' });
    expect(out).toBeNull();
  });

  it('fallback returns null when generatePrioritizedAction returns null', async () => {
    mockPrioritizedAction.mockResolvedValue(null);
    const out = await generateCommitmentCard(ANALYSIS, { questions: [] }, 'en', { teacherName: 'Asha' });
    expect(out).toBeNull();
  });
});
