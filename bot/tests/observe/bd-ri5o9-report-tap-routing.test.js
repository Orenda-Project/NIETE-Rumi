'use strict';
/**
 * bd-ri5o9.1 — the teacher taps "Get Report" on the invite template and nothing
 * is ever delivered.
 *
 * When the teacher's 24h window is closed, observe-send.service.js sends an
 * approved UTILITY template whose QUICK_REPLY carries `observe_report_<sid>`
 * (line 372). NOTHING in the bot ever read that payload: `git grep
 * observe_report_` on origin/main returned the write site, the constant, its
 * export and one test asserting the write — no handler. So the worker phase
 * 'teacher_tap' (observe-send.service.js:713-800) was fully implemented and
 * UNREACHABLE, and the tap fell through the messageType==='button' chain into
 * the bd-kggts text fallthrough → the general LLM, which answered Sana Nawaz's
 * teachers "I don't have access to official FICO credit reports".
 *
 * Production evidence (2026-08-27): `tapped_at` set on 0 of 624 deliveries ever;
 * 120 reports stuck at awaiting_teacher_tap, 47 of them already given up on by
 * the bd-2675 planner — which is event-closed on the tap that was never wired.
 *
 * Matching is on payload OR button text: Meta strips the payload on some
 * template registrations (learned here on bd-2482), and a payload-only match
 * would leave exactly the same silence.
 */
const {
  matchObserveReportTap,
  OBSERVE_REPORT_TAP_TEXTS,
} = require('../../shared/services/observe/report-tap-routing');

const SID = '7bf657f7-1c2e-4a1b-9f3d-2b5c8d0e1a44';

describe('bd-ri5o9.1 · matchObserveReportTap', () => {
  test('extracts the session id from the template payload', () => {
    expect(matchObserveReportTap({ payload: `observe_report_${SID}` })).toBe(SID);
  });

  test('ignores every other button payload the bot already routes', () => {
    for (const p of ['menu_lp', 'style_photorealistic', 'VIEW_FDE_NOTIFICATION',
      'training_module_done_3', 'lp_used_abc', 'coaching_finish_xyz']) {
      expect(matchObserveReportTap({ payload: p })).toBeNull();
    }
  });

  test('returns null for junk rather than throwing', () => {
    for (const p of ['', null, undefined, 'observe_report_', 'observe_report', 42, {}]) {
      expect(matchObserveReportTap({ payload: p })).toBeNull();
    }
    expect(matchObserveReportTap(null)).toBeNull();
    expect(matchObserveReportTap(undefined)).toBeNull();
  });

  test('a session id is never invented from the button TEXT alone', () => {
    // Text tells us the intent, never WHICH report. Without a payload there is
    // nothing to deliver, and guessing a session would deliver the wrong one.
    for (const t of OBSERVE_REPORT_TAP_TEXTS) {
      expect(matchObserveReportTap({ text: t })).toBeNull();
    }
  });

  test('payload wins when both are present', () => {
    expect(matchObserveReportTap({ payload: `observe_report_${SID}`, text: 'Get Report' })).toBe(SID);
  });

  test('surrounding whitespace does not defeat the match', () => {
    expect(matchObserveReportTap({ payload: `  observe_report_${SID}  ` })).toBe(SID);
  });
});

describe('bd-ri5o9.1 · isObserveReportTapText — the payload-stripped fallback', () => {
  const { isObserveReportTapText } = require('../../shared/services/observe/report-tap-routing');

  test('recognises the template button label in English and Urdu', () => {
    expect(isObserveReportTapText('Get Report')).toBe(true);
    expect(isObserveReportTapText('  get report ')).toBe(true);   // case + padding
    expect(isObserveReportTapText('رپورٹ بھیجیں')).toBe(true);
  });

  test('does NOT swallow ordinary teacher messages', () => {
    for (const t of ['hi', 'report', 'my report card', 'Assalam o alaikum', '', null]) {
      expect(isObserveReportTapText(t)).toBe(false);
    }
  });
});

describe('bd-ri5o9.1 · the bot routes the tap before the text fallthrough', () => {
  const fs = require('fs');
  const path = require('path');
  const bot = fs.readFileSync(path.join(__dirname, '../../whatsapp-bot.js'), 'utf8');

  // Anchor INSIDE the template-button chain. Anchoring on the first mention of
  // the matcher finds the module require at the top of the file, which proves
  // nothing about where the branch actually sits.
  const chainStart = bot.indexOf("messageType === 'button' && message.button");
  const chain = bot.slice(chainStart);

  test('whatsapp-bot.js has an observe_report_ branch in the button chain', () => {
    expect(chainStart).toBeGreaterThan(-1);
    expect(chain).toMatch(/matchObserveReportTap/);
  });

  test('the branch sits ABOVE the bd-kggts text fallthrough', () => {
    // Ordering is the whole fix: below the fallthrough it can never be reached,
    // which is functionally identical to the bug.
    const tap = chain.indexOf('matchObserveReportTap');
    const fallthrough = chain.indexOf('Template button → text handler');
    expect(tap).toBeGreaterThan(-1);
    expect(fallthrough).toBeGreaterThan(-1);
    expect(tap).toBeLessThan(fallthrough);
  });

  test('the tap enqueues the existing teacher_tap phase, not a new code path', () => {
    const idx = chain.indexOf('matchObserveReportTap');
    const window = chain.slice(idx, idx + 2600);
    expect(window).toMatch(/queueObserveTeacherReport/);
    expect(window).toMatch(/teacher_tap/);
  });

  test('an unrouted template button is logged as a countable event', () => {
    // The alarm that would have caught this on day one: a payload that matched
    // no branch and silently became general chat.
    expect(bot).toMatch(/observe\.report\.tap_unrouted/);
  });
});
