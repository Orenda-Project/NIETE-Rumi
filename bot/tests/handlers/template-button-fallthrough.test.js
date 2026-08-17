/**
 * bd-kggts — a template QUICK_REPLY must not dead-end.
 *
 * Meta delivers a template quick-reply as messageType:'button' with
 * message.button.{text,payload} — NOT as 'text'. whatsapp-bot.js has a branch for
 * that, but it only recognised two payload families (style_* from the video
 * carousel, and the bd-2482 "Select Video" CTA). Anything else logged
 * "Unknown carousel button payload" and stopped.
 *
 * That is how the K-5 lesson-plan broadcast button failed on 2026-08-17: the label
 * "Lesson Plans & Assessment" matches the LP intent matcher at STRONG tier, but the
 * text never reached the matcher because the button branch never falls through to
 * handleTextMessage.
 *
 * A quick reply IS the user saying that phrase. Routing its text through the normal
 * text path is the general fix — it makes every future template button work without
 * another special case in this file.
 *
 * Asserted against the source because the router lives inside whatsapp-bot.js's
 * webhook closure and cannot be imported in isolation; this mirrors the existing
 * "handler dispatches to these functions" tests in this suite.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'whatsapp-bot.js'), 'utf8');

/** The body of the `messageType === 'button'` branch. */
function buttonBranch() {
  const start = SRC.indexOf("messageType === 'button' && message.button");
  expect(start).toBeGreaterThan(-1);
  const end = SRC.indexOf("messageType === 'interactive' && message.interactive?.type === 'nfm_reply'", start);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe('template QUICK_REPLY buttons (bd-kggts)', () => {
  test('an unrecognised template button falls through to the text handler', () => {
    const branch = buttonBranch();
    // The terminal else must DO something, not just log.
    expect(branch).toMatch(/handleTextMessage\s*\(/);
  });

  test('it routes the button TEXT, since Meta strips the payload on some registrations', () => {
    const branch = buttonBranch();
    // bd-2482 already learned this the hard way for the video CTA.
    const call = branch.slice(branch.indexOf('handleTextMessage'));
    expect(call).toMatch(/buttonText/);
  });

  test('the fallthrough is the LAST resort — the known payloads still win', () => {
    const branch = buttonBranch();
    const styleIdx = branch.indexOf("startsWith('style_')");
    const selectIdx = branch.indexOf('isSelectVideoButton');
    const fallIdx = branch.indexOf('handleTextMessage');
    expect(styleIdx).toBeGreaterThan(-1);
    expect(selectIdx).toBeGreaterThan(-1);
    // both specific handlers are matched before the generic fallthrough
    expect(fallIdx).toBeGreaterThan(styleIdx);
    expect(fallIdx).toBeGreaterThan(selectIdx);
  });

  test('the broadcast button label still matches the LP intent at strong tier', () => {
    // If this ever stops matching, the button silently stops opening the menu again.
    const { matchDetail } = require('../../shared/utils/lp-intent');
    const r = matchDetail('Lesson Plans & Assessment');
    expect(r.matched).toBe(true);
    expect(r.tier).toBe('strong');
    expect('Lesson Plans & Assessment'.length).toBeLessThanOrEqual(25); // Meta's cap
  });
});
