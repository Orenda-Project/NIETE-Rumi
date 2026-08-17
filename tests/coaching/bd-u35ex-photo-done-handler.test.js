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
    const body = bot.slice(idx, idx + 1400);
    expect(body).toMatch(/awaiting_lesson_plan/);
    expect(body).toMatch(/buildLPSelectionList/);
  });
  it('photo_done_ preserves the uploaded classroom_photos (does not overwrite conversation_state)', () => {
    const idx = bot.indexOf("startsWith('photo_done_')");
    const body = bot.slice(idx, idx + 1400);
    expect(body).toMatch(/\.\.\.\(?\s*doneSession/);
  });
});
