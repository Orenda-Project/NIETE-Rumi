/**
 * FEAT-053 bd-29 — REGRESSION GUARD for the Sabeena bug.
 *
 * Both audio entry points must consult the observe router BEFORE routing to
 * teacher coaching. This test pins the CONTRACT at the source level so the two
 * handlers can never silently diverge again (the original bug was a missing
 * gate in exactly one of them).
 */

// FEAT-102: routeLeaderAudio is dark-safe (inert without OBSERVE_MEWAKA_FLOW_ID).
process.env.OBSERVE_MEWAKA_FLOW_ID = process.env.OBSERVE_MEWAKA_FLOW_ID || 'test-observe-flow-id';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const bot = fs.readFileSync(path.join(ROOT, 'whatsapp-bot.js'), 'utf8');
const voice = fs.readFileSync(path.join(ROOT, 'shared/handlers/voice-message.handler.js'), 'utf8');

describe('every audio entry point is gated by the observe router (bd-29)', () => {
  test('the audio-DOCUMENT path calls routeLeaderAudio before initiateCoachingSession', () => {
    const routerAt = bot.indexOf('routeLeaderAudio');
    const coachingAt = bot.indexOf('CoachingService.initiateCoachingSession');
    expect(routerAt).toBeGreaterThan(-1);          // the gate exists at all
    expect(coachingAt).toBeGreaterThan(-1);
    expect(routerAt).toBeLessThan(coachingAt);     // and it runs FIRST
  });

  test('the document path passes the document media id (not a stale voice id)', () => {
    const call = bot.slice(bot.indexOf('routeLeaderAudio'), bot.indexOf('routeLeaderAudio') + 400);
    expect(call).toMatch(/audioId:\s*documentId/);
  });

  test('the VOICE path also routes through the shared router', () => {
    expect(voice).toMatch(/routeLeaderAudio/);
  });

  test('neither handler still hand-rolls its own school_leader observe branch', () => {
    // the old duplicated logic is what drifted — it must be gone from both
    expect(voice).not.toMatch(/ObserveCapture\.startFromAudio/);
    expect(voice).not.toMatch(/ObserveDebrief\.startDebriefFromAudio/);
    expect(bot).not.toMatch(/ObserveCapture\.startFromAudio/);
  });
});
