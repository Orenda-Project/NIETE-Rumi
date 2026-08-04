/**
 * bd-2508 — any slash command ends a coaching conversation and runs.
 *
 * `conducting_conversation` was the only waiting state with no way out. The
 * interceptor in text-message.handler grabbed EVERY message and returned early,
 * so:
 *   - free text went to the coach (correct — that is the whole point), but
 *   - `/menu`, `/training`, everything else went to the coach too.
 *
 * The bot's own escape-path map tells teachers to "type /menu" to get out of
 * AWAITING_MENU_CHOICE, AWAITING_VIDEO_TOPIC, AWAITING_LESSON_PLAN and
 * AWAITING_CLASSROOM_AUDIO. CONDUCTING_CONVERSATION was never added to that
 * map — so the one escape the product teaches was the one that did not work,
 * in the one state with no alternative.
 *
 * Exempting commands is not enough on its own: the session would stay open and
 * swallow the next free-text message, so the teacher escapes and is
 * immediately recaptured. The first fix therefore ENDED the session.
 *
 * Found live: one teacher held for 269 hours.
 *
 * UPDATED 2026-08-04 (bd-2508 follow-up). Ending the session closed the trap but
 * destroyed the reflection silently — escaping and losing your remaining
 * questions became the same action. The block now has three outcomes:
 *   /menu, /help    -> exempt, session LEFT RUNNING (plus a menu-digit deferral,
 *                      which is what finally makes the exemption workable)
 *   service command -> ask first, then PAUSE (recoverable, evening nudge)
 *   free text       -> unchanged, straight to the coach
 * The `status: 'abandoned'` assertion below was inverted accordingly.
 *
 * NOTE ON TEST SHAPE. text-message.handler requires ~40 services at module load
 * and cannot be booted in this suite, so these are source contracts, not
 * behavioural tests. They pin ORDER and PRESENCE, which is exactly what broke.
 * A behavioural test needs the handler decomposed first — out of scope here.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '../../bot/shared/handlers/text-message.handler.js'), 'utf8');

/** The coaching interceptor block. */
function interceptor() {
  const anchor = SRC.indexOf('CHECK FOR ACTIVE COACHING SESSION');
  expect(anchor).toBeGreaterThan(-1);
  return SRC.slice(anchor, SRC.indexOf('PAUSE-AND-RESUME', anchor));
}

describe('bd-2508 — a slash command escapes coaching', () => {
  it('the interceptor checks for a slash command', () => {
    expect(interceptor()).toMatch(/startsWith\('\/'\)/);
  });

  it('it checks BEFORE routing the message to the coach', () => {
    const b = interceptor();
    const guard = b.indexOf("startsWith('/')");
    const route = b.indexOf('handleReflectiveResponse');
    // Both must EXIST first — indexOf returns -1 when absent, and -1 is less
    // than any real index, so a naive ordering assertion passes vacuously.
    expect(guard).toBeGreaterThan(-1);
    expect(route).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(route);
  });

  // SUPERSEDED by the bd-2508 FOLLOW-UP (2026-08-04). The original assertion
  // pinned `status: 'abandoned'` in this block, because at the time ending the
  // session was the only way to stop it recapturing the next free-text message.
  //
  // That is no longer true, and the old assertion now pins the exact bug we
  // fixed: escaping the trap and DESTROYING the reflection were the same action,
  // with no warning to the teacher.
  //
  // The recapture problem is now solved two other ways, both of which this suite
  // asserts below: a service command PAUSES (recoverable) rather than abandoning,
  // and /menu is exempted plus its follow-up digit is deferred to the menu
  // handler. See tests/coaching/bd2508-confirm-before-abandon.test.js for the
  // behavioural coverage.
  it('a service command no longer abandons the session — it pauses it', () => {
    const b = interceptor();
    // The destructive write is gone from this block...
    expect(b).not.toMatch(/status:\s*'abandoned'/);
    // ...replaced by an explicit, recoverable pause.
    expect(b).toMatch(/pauseSession/);
  });

  it('the teacher is asked before her reflection is interrupted', () => {
    // The silent kill is what made the old behaviour a bug rather than a fix.
    expect(interceptor()).toMatch(/askToConfirmSwitch/);
  });

  it('/menu and /help stay exempt — the 269-hour trap must not reopen', () => {
    expect(interceptor()).toMatch(/isAlwaysAllowed/);
  });

  it('a pending menu digit is deferred, so /menu is genuinely usable', () => {
    // Without this the session eats the "1".."4" that /menu waits for, and the
    // teacher escapes only to be recaptured — the original failure mode.
    const b = interceptor();
    expect(b).toMatch(/isMenuDigit/);
    expect(b).toMatch(/AWAITING_MENU_CHOICE/);
  });

  it('free text still reaches the coach — the flow itself is untouched', () => {
    expect(interceptor()).toMatch(/handleReflectiveResponse/);
  });
});

describe('bd-2508 — the escape is discoverable', () => {
  it('CONDUCTING_CONVERSATION has an escape-path message like every other waiting state', () => {
    const helper = fs.readFileSync(
      path.join(__dirname, '../../bot/shared/services/helper-agent.service.js'), 'utf8');
    expect(helper).toMatch(/CONDUCTING_CONVERSATION/);
  });
});
