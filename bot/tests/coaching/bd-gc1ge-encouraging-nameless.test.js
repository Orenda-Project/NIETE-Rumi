/**
 * bd-gc1ge — "Transcription complete, null!"
 *
 * Third site in the same defect class as the photo-gate greeting. When the
 * GPT-4o call that writes the post-transcription encouragement fails, the
 * hardcoded fallback copy is:
 *
 *     `✅ Transcription complete, ${firstName}! You taught for N minutes …`
 *
 * and transcription-processor.service.js passes `session.users.name` RAW. So a
 * nameless teacher (6,282 of 15,552 prod users have `name IS NULL`) was told
 * "Transcription complete, null!" — and the same raw value was also being fed
 * to the model as "Teacher's name: null", which is what the model then greets
 * her by on the SUCCESS path.
 *
 * The LLM branch is deliberately forced to throw here: the fallback is the
 * branch that carries the literal, and a test that reaches OpenAI would be
 * neither hermetic nor deterministic.
 */

'use strict';

// Force the GPT-4o call to fail so the fallback copy is what we assert on.
// Shape matches the call site: `new OpenAI({...}).chat.completions.create(...)`.
const mockCreate = jest.fn(async () => { throw new Error('openai unavailable (forced)'); });
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  chat: { completions: { create: mockCreate } },
})));

const CoachingHelpersService = require('../../shared/services/coaching/coaching-helpers.service');

describe('bd-gc1ge — the encouragement fallback for a nameless teacher', () => {
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
  });

  test('a named teacher is still addressed by name', async () => {
    const msg = await CoachingHelpersService.generateEncouragingMessage('Ayesha', 600);

    expect(msg).toContain('Ayesha');
    expect(msg).not.toMatch(/\bnull\b/);
  });

  test('the model is never asked to greet a teacher called "null"', async () => {
    // The SUCCESS path interpolates the same value into the prompt, so a raw
    // null reaches the model as "Teacher's name: null" and comes back in its
    // own greeting — the fallback is not the only victim.
    await CoachingHelpersService.generateEncouragingMessage(null, 600);

    expect(mockCreate).toHaveBeenCalled();
    const sent = JSON.stringify(mockCreate.mock.calls[0][0]);
    expect(sent).not.toMatch(/name: null/i);
    expect(sent).not.toMatch(/name: undefined/i);
  });
});
