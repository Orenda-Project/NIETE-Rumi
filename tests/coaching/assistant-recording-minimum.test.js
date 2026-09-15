/**
 * The assistant is told the recording minimum, in every prompt variant, derived
 * from the same constant the routing branch uses.
 *
 * It was told nothing. Its capability block said only "ANALYZE classroom
 * recordings - Upload audio/video of your class", and the nearest number
 * anywhere near the model was an UPPER bound in a different service. With no
 * lower bound stated, the model answered from whatever was in the conversation —
 * and on 4 September that was the teacher's own sentence about fifteen to twenty
 * SECONDS, repeated back to her as the rule.
 *
 * Asserted on the built prompts, not on the file, so a comment mentioning the
 * number cannot satisfy it. Mutation-checked: the expected number is computed
 * from the constant, so moving the threshold moves the assertion.
 */

jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));

const OpenAIService = require('../../bot/shared/services/openai.service');
const { CLASSROOM_AUDIO_THRESHOLD } = require('../../bot/shared/config/classroom-audio.config');

const MIN_MINUTES = Math.round(CLASSROOM_AUDIO_THRESHOLD / 60);

/** Every prompt variant a teacher's turn can land on. */
const VARIANTS = [
  { name: 'text / en', format: 'text', language: 'en' },
  { name: 'voice / en', format: 'voice', language: 'en' },
  { name: 'text / ur', format: 'text', language: 'ur' },
  { name: 'voice / ur', format: 'voice', language: 'ur' },
];

function promptFor({ format, language }) {
  // The real builder every conversational turn goes through. Asserting on its
  // OUTPUT rather than on the file means a comment naming the number cannot
  // satisfy the test, and it covers the enhanced-prompt path (Urdu) and the
  // per-branch path (English) without knowing which is which.
  return String(OpenAIService._getFormatAwareSystemPrompt(format, language, 'Ayesha'));
}

describe('the recording minimum is in every prompt variant', () => {
  for (const v of VARIANTS) {
    test(`${v.name} states the minimum`, () => {
      const prompt = promptFor(v);
      // The digits, or the Urdu word for fifteen — the Urdu prompt spells it.
      const pattern = new RegExp(`(^|\\D)${MIN_MINUTES}(\\D|$)|پندرہ`);
      expect(prompt).toMatch(pattern);
    });

    test(`${v.name} forbids inventing a different one`, () => {
      const prompt = promptFor(v);
      expect(prompt).toMatch(/never state any other|کوئی اور دورانیہ کبھی نہ/i);
    });
  }

  test('the number comes from the routing constant, not a literal', () => {
    // If someone moves the threshold, the copy moves with it. The previous
    // arrangement had the branch in one file and no number anywhere near the
    // model, which is how the two could not even disagree.
    expect(MIN_MINUTES).toBe(15);
    expect(CLASSROOM_AUDIO_THRESHOLD).toBe(900);
    const prompt = promptFor(VARIANTS[0]);
    expect(prompt).toContain(String(MIN_MINUTES));
  });
});
