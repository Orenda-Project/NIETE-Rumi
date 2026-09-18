/**
 * bd-di5ap — DC sheet row 129 (Quratulain/FSB, 18/9).
 *
 * After "Step 1/5 … 30-60 seconds" the teacher received two more messages
 * before anything had been analysed:
 *
 *   1. "⚠️ Long Lesson Detected — the analysis may take a bit longer"
 *   2. "Your 29-minute lesson was engaging and impactful"
 *
 * (1) is an ENGINEERING guard leaked to teachers: the 15,000-char gate was
 * picked against a model output limit (its own log says "May exceed GPT-5 mini
 * output token limit"), not against anything a teacher would recognise as a
 * long lesson — and it contradicts the 30-60s promise made one message earlier.
 * The telemetry is worth keeping; the send is not.
 *
 * (2) is a verdict on a lesson nothing has read yet. The system prompt asks
 * GPT-4o to be "authentic and specific" while handing it ONLY a name and a
 * duration — no transcript, no analysis. A model told to be specific with
 * nothing to be specific about invents the specificity. The fix removes the
 * model call rather than guarding its output: with no model there is no verdict
 * to leak, and the message becomes translatable for free (it never was — the
 * prompt carried no language instruction at all, which is the row-130 defect
 * the main bot already fixed in BUG-117 and never ported here).
 */

'use strict';

const fs = require('fs');
const path = require('path');

// If the implementation still reaches for the model, this records it. The test
// asserts it is NEVER constructed — that is the guarantee that no invented
// verdict can reach a teacher, and it is stronger than pattern-matching the copy.
const mockCreate = jest.fn(async () => ({
  choices: [{ message: { content: 'Your 29-minute lesson was engaging and impactful' } }],
}));
const MockOpenAI = jest.fn().mockImplementation(() => ({
  chat: { completions: { create: mockCreate } },
}));
jest.mock('openai', () => MockOpenAI);

const CoachingHelpersService = require('../../bot/shared/services/coaching/coaching-helpers.service');
const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');

const TWENTY_NINE_MINUTES = 1740;

const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('bd-di5ap — no premature verdict, no leaked engineering guard', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('the post-transcription acknowledgement', () => {
    test('is built without ever calling the model', async () => {
      await CoachingHelpersService.generateEncouragingMessage('Ayesha', TWENTY_NINE_MINUTES, 'en');

      expect(MockOpenAI).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test('acknowledges the recording and its length, and passes no judgement on it', async () => {
      const msg = await CoachingHelpersService.generateEncouragingMessage(
        'Ayesha', TWENTY_NINE_MINUTES, 'en',
      );

      expect(msg).toContain('Ayesha');
      expect(msg).toContain('29');
      // The teacher's own words for what went wrong: it read as feedback.
      expect(msg).not.toMatch(/engaging|impactful|excellent|wonderful|great|amazing|fantastic/i);
    });

    test('renders in Urdu for an Urdu teacher (never fixed before — no language was passed at all)', async () => {
      const msg = await CoachingHelpersService.generateEncouragingMessage(
        'Ayesha', TWENTY_NINE_MINUTES, 'ur',
      );

      expect(msg).toBe(
        getCoachingMessage('transcriptionComplete', 'ur')
          .replace('{{name}}', 'Ayesha')
          .replace('{{minutes}}', '29'),
      );
      // Urdu copy, but the COUNT stays in standard digits (the row-131 class).
      expect(msg).toContain('29');
      expect(msg).not.toMatch(/[۰-۹]/);
    });

    test('a nameless teacher is still addressed properly (bd-gc1ge regression)', async () => {
      for (const nameless of [null, undefined, '', '   ']) {
        const msg = await CoachingHelpersService.generateEncouragingMessage(
          nameless, TWENTY_NINE_MINUTES, 'en',
        );
        expect(msg).not.toMatch(/\bnull\b|\bundefined\b/);
        expect(msg).not.toMatch(/,\s*!/);        // "complete, !"
        expect(msg).not.toContain('{{name}}');   // an unsubstituted placeholder
        expect(msg).toContain('29');
      }
    });

    test('every offered language has real copy for both variants — no TODO sentinel', () => {
      const { COACHING_MESSAGES, SUPPORTED_LANGUAGES, TODO } = require('../../bot/shared/config/coaching-messages');
      for (const key of ['transcriptionComplete', 'transcriptionComplete_noName']) {
        for (const lang of SUPPORTED_LANGUAGES) {
          expect(COACHING_MESSAGES[key][lang]).toBeDefined();
          expect(COACHING_MESSAGES[key][lang]).not.toBe(TODO);
        }
      }
    });
  });

  describe('the "Long Lesson Detected" warning', () => {
    const processorSrc = () => stripComments(fs.readFileSync(
      path.join(__dirname, '../../bot/shared/services/coaching/transcription-processor.service.js'),
      'utf8',
    ));

    test('is no longer sent to the teacher', () => {
      expect(processorSrc()).not.toContain('longLessonDetected');
    });

    test('is retired from the catalog rather than left dangling', () => {
      expect(() => getCoachingMessage('longLessonDetected', 'en')).toThrow(/Unknown coaching message key/);
    });

    test('but the length telemetry survives — this was a real signal, just not a teacher-facing one', () => {
      const src = processorSrc();
      expect(src).toContain('15000');
      expect(src).toMatch(/logToFile\(\s*['"`][^'"`]*Long transcript detected/);
    });
  });
});
