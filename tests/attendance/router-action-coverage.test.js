/**
 * Every action the router can emit must be HANDLED by both consumers.
 *
 * This is the "verified at one layer, broken at the join" failure, for the third
 * time in this feature's history, and the second time this week:
 *
 *   - The bd-2529 port was reverted because a state machine returned an action the
 *     message handler had no branch for.
 *   - bd-2718's fix made resolveSubjectChoice() return ASK_CLASS_BUTTONS. The
 *     text handler had a case for it; handleAttendanceTap() in whatsapp-bot.js did
 *     not. So a principal tapping "My students" got "Which class?" as PLAIN TEXT
 *     with no buttons — announced, never offered. Staging 2026-08-14 10:50:14Z:
 *     "Interactive button clicked" and then nothing sent at all.
 *
 * Unit tests passed both times, because the router's return value was correct.
 * The defect lived in the gap between the router and the two things that consume
 * it, and only a real handset showed it.
 *
 * The rule: an action that carries `buttons`, `rows`, or a `flowToken` cannot be
 * delivered by a bare sendMessage() — the payload would be silently dropped. Such
 * an action MUST be named explicitly in both consumers. Actions that are purely
 * informational (ERROR, NO_SCHOOL) are correctly served by the generic message
 * fallthrough and are listed as such below, deliberately, so the exemption is a
 * decision rather than an oversight.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const ROUTER = path.join(ROOT, 'bot/shared/services/attendance-router.service.js');

/** The two places router output is turned into WhatsApp messages. */
const CONSUMERS = [
  ['bot/whatsapp-bot.js', 'handleAttendanceTap'],
  ['bot/shared/handlers/text-message.handler.js', 'attendance switch'],
];

/**
 * Informational actions: a plain text message IS the correct rendering, so the
 * generic fallthrough handles them. Anything carrying interactive payload must
 * not be in here.
 */
const PLAIN_MESSAGE_IS_CORRECT = new Set(['ERROR', 'NO_SCHOOL']);

function emittedActions(src) {
  return [...new Set([...src.matchAll(/action:\s*'([A-Z_]+)'/g)].map((m) => m[1]))].sort();
}

describe('attendance router action coverage', () => {
  const routerSrc = fs.readFileSync(ROUTER, 'utf8');
  const actions = emittedActions(routerSrc);

  it('finds the router action vocabulary', () => {
    // Sanity: if this drops to a handful the regex has drifted and the whole
    // suite becomes vacuous.
    expect(actions.length).toBeGreaterThanOrEqual(7);
    expect(actions).toContain('MARK_STUDENTS');
    expect(actions).toContain('ASK_CLASS_BUTTONS');
  });

  it('every interactive action carries payload the generic fallthrough would drop', () => {
    // Guards the exemption list: if someone adds an interactive action to
    // PLAIN_MESSAGE_IS_CORRECT, this fails.
    PLAIN_MESSAGE_IS_CORRECT.forEach((a) => {
      const block = routerSrc.slice(Math.max(0, routerSrc.indexOf(`action: '${a}'`) - 200));
      const head = block.slice(0, 400);
      expect(head).not.toMatch(/buttons:|rows:|flowToken:/);
    });
  });

  CONSUMERS.forEach(([relPath, label]) => {
    describe(`${label} (${path.basename(relPath)})`, () => {
      const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');

      it('names every interactive router action explicitly', () => {
        const missing = actions
          .filter((a) => !PLAIN_MESSAGE_IS_CORRECT.has(a))
          .filter((a) => !src.includes(`'${a}'`));

        expect(missing).toEqual([]);
      });
    });
  });
});
