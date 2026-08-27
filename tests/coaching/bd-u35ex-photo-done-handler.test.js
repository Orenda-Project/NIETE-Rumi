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
  it('photo_done_ advances the session to the lesson-plan step (status awaiting_lesson_plan + LP selection)', () => {
    const idx = bot.indexOf("startsWith('photo_done_')");
    expect(idx).toBeGreaterThan(-1);
    const body = bot.slice(idx, idx + 2600);
    expect(body).toMatch(/awaiting_lesson_plan/);
    expect(body).toMatch(/buildLPSelectionList/);
  });
  it('photo_done_ preserves the uploaded classroom_photos (does not overwrite conversation_state)', () => {
    const idx = bot.indexOf("startsWith('photo_done_')");
    const body = bot.slice(idx, idx + 2600);
    expect(body).toMatch(/\.\.\.\(?\s*doneSession/);
  });
});

/**
 * bd-zrlcp — the photo handlers moved the session to awaiting_lesson_plan and
 * THEN sent the prompt, ignoring whether it went out. sendInteractiveMessage
 * returns false (it does not throw) when it refuses a payload, so an
 * undeliverable list left the session parked at a step the user was never
 * shown, with no sweeper to recover it. The send must come first and the commit
 * must be conditional on it.
 */
describe('bd-zrlcp — the LP step is committed only after the prompt lands', () => {
  for (const handler of ['photo_done_', 'photo_no_']) {
    it(`${handler} sends the LP prompt BEFORE writing status awaiting_lesson_plan`, () => {
      const idx = bot.indexOf(`startsWith('${handler}')`);
      expect(idx).toBeGreaterThan(-1);
      const body = bot.slice(idx, idx + 2600);
      const send = body.indexOf('__sendLpPrompt');
      const commit = body.indexOf("status: 'awaiting_lesson_plan'");
      expect(send).toBeGreaterThan(-1);
      expect(commit).toBeGreaterThan(-1);
      expect(send).toBeLessThan(commit);
    });

    it(`${handler} guards the status write on the send result`, () => {
      const idx = bot.indexOf(`startsWith('${handler}')`);
      const body = bot.slice(idx, idx + 2600);
      // the send result is captured and gates the update
      expect(body).toMatch(/const\s+\w*[sS]ent\w*\s*=\s*await\s+__sendLpPrompt/);
      expect(body).toMatch(/if\s*\(\s*\w*[sS]ent\w*\s*\)/);
    });
  }
});

