/**
 * bd-59840 — the residue of DC sheet row 129 (Quratulain/FSB, 18/9).
 *
 * bd-di5ap removed the two messages the teacher complained about: the
 * "Long Lesson Detected" engineering guard and the GPT-4o verdict on a lesson
 * nothing had read. Its own design note observed that the warning "contradicts
 * the 30-60s promise made one message earlier" — and then left that promise
 * standing. Removing the warning made it WORSE: the only thing that ever walked
 * the promise back is now gone.
 *
 * The promise is not a rounding error. `CLASSROOM_AUDIO_THRESHOLD = 900` means
 * nothing under 15 minutes is routed into this job at all, so "30-60 seconds" is
 * told to a population whose MINIMUM input is a 15-minute recording. The repo
 * measured the reality itself: sqs-worker.js records 28 transcription jobs
 * redelivered in the 880-990s band over the nine days to 15 Sep, which is why
 * the visibility extension is now unconditional at 1200s. The Urdu copy makes
 * the same claim ("تقریباً ایک منٹ" — about one minute).
 *
 * Second half: operator decision, 2026-09-20. bd-di5ap replaced the verdict with
 * a factual catalog acknowledgement ("Transcription complete, {name}! You taught
 * for N minutes."). The operator chose to drop that too, so transcription runs
 * straight into the photo prompt. That also retires the last caller of
 * generateEncouragingMessage — with no message there is no language defect left
 * on this line either.
 *
 * ASSERTION STYLE: every test below EXECUTES the code it judges — the catalog
 * lookup really runs, the service module is really loaded. None of them read the
 * source and pattern-match it, because a readFileSync+regex test goes green
 * while the line it grepped is a runtime ReferenceError.
 */

'use strict';

const {
  getCoachingMessage,
  COACHING_MESSAGES,
  SUPPORTED_LANGUAGES,
  TODO,
} = require('../../bot/shared/config/coaching-messages');

const CoachingHelpersService = require('../../bot/shared/services/coaching/coaching-helpers.service');
const CoachingOrchestrator = require('../../bot/shared/services/coaching-orchestrator.service');

// WhatsApp body cap. Measured in CODE POINTS — `.length` diverges from what Meta
// counts on Urdu and emoji, and an off-by-a-surrogate count is how a string
// passes locally and is rejected at the Graph API.
const BODY_CAP = 1024;
const codePoints = (s) => [...s].length;

describe('bd-59840 — Step 1/5 states a wait the flow can actually keep', () => {
  test('the English copy does not promise seconds for a >=15-minute recording', () => {
    const msg = getCoachingMessage('step1_transcribing', 'en');

    // Positive control first: a zero-match assertion proves nothing unless we
    // know we are looking at the right string.
    expect(msg).toContain('Step 1/5');

    expect(msg).not.toMatch(/\d+\s*-\s*\d+\s*seconds/i);
    expect(msg).not.toMatch(/seconds/i);
  });

  test('the English copy sets the expectation in minutes instead', () => {
    const msg = getCoachingMessage('step1_transcribing', 'en');
    expect(msg).toMatch(/minute/i);
  });

  test('the Urdu copy does not promise about-one-minute either', () => {
    const msg = getCoachingMessage('step1_transcribing', 'ur');

    // Positive control: this really is the Urdu entry, not an English fallback.
    expect(msg).toContain('مرحلہ');
    expect(msg).not.toBe(getCoachingMessage('step1_transcribing', 'en'));

    expect(msg).not.toContain('ایک منٹ');   // "one minute"
    expect(msg).not.toContain('سیکنڈ');      // "seconds"
  });

  test('both variants are real copy, not the TODO sentinel, and fit the body cap', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const msg = COACHING_MESSAGES.step1_transcribing[lang];
      expect(msg).toBeDefined();
      expect(msg).not.toBe(TODO);
      expect(codePoints(msg)).toBeLessThanOrEqual(BODY_CAP);
    }
  });
});

describe('bd-59840 — the post-transcription acknowledgement is gone entirely', () => {
  test('the helper no longer exists, so nothing can call it', () => {
    expect(CoachingHelpersService.generateEncouragingMessage).toBeUndefined();
  });

  test('the orchestrator pass-through went with it', () => {
    expect(CoachingOrchestrator.generateEncouragingMessage).toBeUndefined();
  });

  test('both catalog keys are retired rather than left dangling', () => {
    for (const key of ['transcriptionComplete', 'transcriptionComplete_noName']) {
      expect(COACHING_MESSAGES[key]).toBeUndefined();
      expect(() => getCoachingMessage(key, 'en')).toThrow(/Unknown coaching message key/);
    }
  });
});

describe('bd-59840 — what bd-di5ap fixed stays fixed', () => {
  test('the Long Lesson warning is still retired from the catalog', () => {
    expect(() => getCoachingMessage('longLessonDetected', 'en'))
      .toThrow(/Unknown coaching message key/);
  });
});
