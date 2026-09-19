/**
 * bd-gc1ge — "Transcription complete, null!"
 *
 * `transcription-processor.service.js` passes `session.users.name` RAW, and
 * 6,282 of 15,552 prod users have `name IS NULL`, so a nameless teacher was
 * greeted as "null" — both in the copy she received and in the prompt the model
 * was given ("Teacher's name: null"), which it then echoed back at her.
 *
 * UPDATED by bd-di5ap (DC row 129). The model call this test was written around
 * is gone: it was handed only a name and a duration, told to be "specific", and
 * duly invented a verdict on a lesson nothing had analysed yet. The message is
 * now a fixed, translated catalog string.
 *
 * That makes the second half of this file STRONGER, not obsolete. The original
 * "the model is never asked to greet a teacher called null" case has been
 * replaced by "no model is consulted at all" — the same defect, closed at the
 * source instead of sanitised on the way in. The name-safety assertions below
 * are unchanged and still guard the copy a teacher actually receives.
 */

'use strict';

// Kept as a TRIPWIRE, not a stub: nothing should reach it any more. If someone
// reintroduces a model call here, these tests fail rather than quietly pass.
const mockCreate = jest.fn(async () => ({
  choices: [{ message: { content: 'some generated praise' } }],
}));
const MockOpenAI = jest.fn().mockImplementation(() => ({
  chat: { completions: { create: mockCreate } },
}));
jest.mock('openai', () => MockOpenAI);

const CoachingHelpersService = require('../../shared/services/coaching/coaching-helpers.service');

describe('bd-gc1ge — the transcription acknowledgement for a nameless teacher', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a null name does not become the word "null"', async () => {
    const msg = await CoachingHelpersService.generateEncouragingMessage(null, 600);

    expect(msg).not.toMatch(/\bnull\b/);
    expect(msg).not.toMatch(/\bundefined\b/);
    // It must still be a real message, and still carry the duration.
    expect(msg).toContain('10');
    expect(msg.trim().length).toBeGreaterThan(10);
  });

  test('an empty name does not leave a dangling comma', async () => {
    const msg = await CoachingHelpersService.generateEncouragingMessage('', 600);

    expect(msg).not.toMatch(/\bnull\b/);
    // "complete, !" — the empty-gap shape a bare helper swap would leave.
    expect(msg).not.toMatch(/,\s*!/);
    // and the placeholder itself must not survive into the send
    expect(msg).not.toContain('{{name}}');
  });

  test('a named teacher is still addressed by name', async () => {
    const msg = await CoachingHelpersService.generateEncouragingMessage('Ayesha', 600);

    expect(msg).toContain('Ayesha');
    expect(msg).not.toMatch(/\bnull\b/);
  });

  test('no model is consulted, so there is no prompt to leak a name into (bd-di5ap)', async () => {
    await CoachingHelpersService.generateEncouragingMessage(null, 600);
    await CoachingHelpersService.generateEncouragingMessage('Ayesha', 600);

    expect(MockOpenAI).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
