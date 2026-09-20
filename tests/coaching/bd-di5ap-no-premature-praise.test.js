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
 * long lesson. It fired on 6,773 of 11,698 sessions (58%) in the month to
 * 18 Sep — the "exception" was the majority — and it contradicted the 30-60s
 * promise made one message earlier. The telemetry is worth keeping; the send
 * is not.
 *
 * (2) is a verdict on a lesson nothing has read yet. The system prompt asked
 * GPT-4o to be "authentic and specific" while handing it ONLY a name and a
 * duration — no transcript, no analysis. A model told to be specific with
 * nothing to be specific about invents the specificity.
 *
 * ── UPDATED BY bd-59840 ──────────────────────────────────────────────────────
 * bd-di5ap replaced (2) with a fixed, translated catalog acknowledgement. The
 * operator then decided on 2026-09-20 to remove that too: row 129 asked for NO
 * extra messages between Step 1/5 and the photo prompt, and an acknowledgement
 * is still an extra message. So the "the acknowledgement reads correctly" cases
 * that used to live here are gone — not weakened, SUPERSEDED. The thing they
 * guarded no longer exists, which is a stronger position than asserting it
 * behaves: `generateEncouragingMessage` is absent from both the helper service
 * and the orchestrator, and both catalog keys are retired. Those assertions,
 * plus the Step 1/5 wait-time fix that made the removal safe, live in
 * tests/coaching/bd-59840-honest-wait-no-ack.test.js.
 *
 * What remains here is bd-di5ap's own half: the Long Lesson warning must stay
 * gone from the teacher's chat while its telemetry stays in the logs.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');

// Comment-stripped before matching. A source assertion that lands on the comment
// ABOVE the code passes on code that does the opposite — good code names its own
// subject in its comment, which is exactly what makes the naive version vacuous.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const processorSrc = () => stripComments(fs.readFileSync(
  path.join(__dirname, '../../bot/shared/services/coaching/transcription-processor.service.js'),
  'utf8',
));

describe('bd-di5ap — the "Long Lesson Detected" warning', () => {
  test('is no longer sent to the teacher', () => {
    expect(processorSrc()).not.toContain('longLessonDetected');
  });

  test('is retired from the catalog rather than left dangling', () => {
    expect(() => getCoachingMessage('longLessonDetected', 'en'))
      .toThrow(/Unknown coaching message key/);
  });

  test('but the length telemetry survives — this was a real signal, just not a teacher-facing one', () => {
    const src = processorSrc();
    expect(src).toContain('15000');
    expect(src).toMatch(/logToFile\(\s*['"`][^'"`]*Long transcript detected/);
  });
});

describe('bd-di5ap — no model is consulted between transcription and the photo prompt', () => {
  test('the transcription processor reaches for no LLM on this stretch', () => {
    const src = processorSrc();

    // Positive control: we really are reading the processor, not an empty string.
    expect(src).toContain('processTranscription');

    // The verdict came from an OpenAI call reached through the helper service.
    // Neither the call nor its former entry point may reappear here.
    expect(src).not.toMatch(/generateEncouragingMessage/);
    expect(src).not.toMatch(/\bnew OpenAI\b/);
  });
});
