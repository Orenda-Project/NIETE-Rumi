/**
 * bd-u35ex (NIETE DC) — classroom-photo path dead-end.
 *
 * The photo-collection branch (image-message.handler.js Phase 3) sends "Add another"
 * / "Done" buttons after each classroom photo — id prefixes `photo_more_` and
 * `photo_done_`. But whatsapp-bot.js only handled `photo_yes_` / `photo_no_`, so
 * tapping "Done" was a DEAD END: the session stayed at `awaiting_classroom_photo`,
 * analysis was never queued, and no report was produced (teachers got only the early
 * generic voice ack). Reported repeatedly on 12–17 Aug (R26/49/52/53 + the downstream
 * no-report reports). Both buttons must be handled, and `photo_done_` must advance to
 * the lesson-plan step exactly like the working skip-photo path (`photo_no_`).
 */

const fs = require('fs');
const path = require('path');
const bot = fs.readFileSync(path.join(__dirname, '../../bot/whatsapp-bot.js'), 'utf8');

describe('bd-u35ex — photo_done_ / photo_more_ are handled (source guard)', () => {
  it('has a photo_done_ handler', () => {
    expect(bot).toMatch(/startsWith\('photo_done_'\)/);
  });
  it('has a photo_more_ handler', () => {
    expect(bot).toMatch(/startsWith\('photo_more_'\)/);
  });
  // Since bd-87p7s / bd-n9832 (2026-09-16) the three photo/LP taps no longer carry
  // the step logic inline: photo_done_, photo_no_ and lp_none_-style paths all call
  // ONE owner, advanceToLessonPlanStep in lp-step.service.js, which is where the
  // properties below now live. This guard asserts the wiring in whatsapp-bot.js AND
  // the properties in the owner — the behaviour itself is executed end-to-end by
  // bot/tests/observe/bd-n9832-cancelled-stays-cancelled-taps.test.js and
  // bot/tests/coaching/bd-n9832-terminal-guard-owners.test.js.
  const owner = fs.readFileSync(
    path.join(__dirname, '../../bot/shared/services/coaching/lp-coaching/lp-step.service.js'), 'utf8');

  for (const handler of ['photo_done_', 'photo_no_']) {
    it(`${handler} hands the session to the single lesson-plan-step owner`, () => {
      const idx = bot.indexOf(`startsWith('${handler}')`);
      expect(idx).toBeGreaterThan(-1);
      const body = bot.slice(idx, idx + 1200);
      expect(body).toMatch(/advanceToLessonPlanStep\s*\(/);
      expect(body).toMatch(/lp-step\.service/);
    });
  }

  it('the owner advances the session to awaiting_lesson_plan', () => {
    expect(owner).toMatch(/status:\s*'awaiting_lesson_plan'/);
  });

  it('the owner preserves the uploaded classroom_photos (conversation_state is MERGED, not replaced)', () => {
    expect(owner).toMatch(/\.\.\.\(\(session\s*&&\s*session\.conversation_state\)\s*\|\|\s*\{\}\)/);
  });
});

/**
 * bd-zrlcp — the photo handlers moved the session to awaiting_lesson_plan and
 * THEN sent the prompt, ignoring whether it went out. sendInteractiveMessage
 * returns false (it does not throw) when it refuses a payload, so an
 * undeliverable list left the session parked at a step the user was never
 * shown, with no sweeper to recover it. The send must come first and the commit
 * must be conditional on it. Both properties now live in the owner (see above).
 */
describe('bd-zrlcp — the LP step is committed only after the prompt lands', () => {
  const owner = fs.readFileSync(
    path.join(__dirname, '../../bot/shared/services/coaching/lp-coaching/lp-step.service.js'), 'utf8');

  it('the owner sends the LP prompt BEFORE writing status awaiting_lesson_plan', () => {
    const send = owner.indexOf('await sendLpPrompt(');
    const commit = owner.indexOf("status: 'awaiting_lesson_plan'");
    expect(send).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(-1);
    expect(send).toBeLessThan(commit);
  });

  it('the owner guards the status write on the send result', () => {
    expect(owner).toMatch(/const\s+sent\s*=\s*await\s+sendLpPrompt/);
    expect(owner).toMatch(/if\s*\(\s*!sent\s*\)/);
  });
});
