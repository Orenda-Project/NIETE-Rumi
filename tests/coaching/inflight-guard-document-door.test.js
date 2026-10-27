/**
 * A classroom recording sent as a FILE while an analysis is in flight is deferred, like a voice note (bd-1r3k2h).
 *
 * coaching.feature COA09: "A second recording sent mid-analysis is deferred, not started fresh." The voice
 * path (voice-message.handler) has had the bd-2376 guard since FEAT-106; the document path
 * (whatsapp-bot.js handleDocumentMessage → "🎓 CLASSROOM AUDIO DETECTED" → CoachingService.initiateCoachingSession)
 * never did — phone recorders share a 40-minute lesson as a file, so this is the common door. Mock run
 * 20261027-0955-coaching-s5: the second file, 2 s after the first and before the confirm tap, got a fresh
 * "I detected a 16-minute audio recording" card and its own session (bot.log: "Session created for classroom
 * coaching" → "Coaching session created", no guard line at all).
 *
 * The guard's query + decision + ack now live in one helper both doors call. Red-first: the helper does not
 * exist, and the document branch calls initiateCoachingSession unguarded.
 */
const fs = require('fs');
const path = require('path');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const guard = require('../../bot/shared/services/coaching/coaching-inflight-guard');

/** A supabase whose coaching_sessions query answers with `row`, recording the filters it was given. */
function fakeSupabase(row) {
  const calls = { or: [], order: [], eq: [] };
  const chain = {
    select: () => chain,
    eq: (...a) => { calls.eq.push(a); return chain; },
    or: (...a) => { calls.or.push(a); return chain; },
    order: (...a) => { calls.order.push(a); return chain; },
    limit: () => chain,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { from: (t) => { calls.table = t; return chain; }, calls };
}

const NOW = Date.parse('2026-10-27T05:00:00Z');
const midFlight = { id: 'cs-1', status: 'initiated', created_at: new Date(NOW - 60 * 1000).toISOString(), observation_type: null };

describe('deferNewClassroomAudioIfInFlight', () => {
  test('exists on the guard module', () => {
    expect(typeof guard.deferNewClassroomAudioIfInFlight).toBe('function');
  });

  test("her own mid-flight session: the ack is sent, nothing else starts (returns true)", async () => {
    const sb = fakeSupabase(midFlight);
    const sendAck = jest.fn(async () => true);
    const deferred = await guard.deferNewClassroomAudioIfInFlight({ userId: 'u-1', supabase: sb, sendAck, nowMs: NOW });
    expect(deferred).toBe(true);
    expect(sendAck).toHaveBeenCalledTimes(1);
    expect(sendAck.mock.calls[0][0]).toMatchObject({ existingSessionId: 'cs-1', status: 'initiated' });
    // the query is the voice door's: her sessions, observe captures excluded in the query, newest first
    expect(sb.calls.table).toBe('coaching_sessions');
    expect(sb.calls.eq).toEqual([['user_id', 'u-1']]);
    expect(sb.calls.or[0][0]).toMatch(/observation_type\.is\.null,observation_type\.neq\.leader_observation/);
  });

  test('a completed session, or none at all, lets the new recording through (returns false, no ack)', async () => {
    const sendAck = jest.fn();
    expect(await guard.deferNewClassroomAudioIfInFlight({ userId: 'u-1', supabase: fakeSupabase({ ...midFlight, status: 'completed' }), sendAck, nowMs: NOW })).toBe(false);
    expect(await guard.deferNewClassroomAudioIfInFlight({ userId: 'u-1', supabase: fakeSupabase(null), sendAck, nowMs: NOW })).toBe(false);
    expect(sendAck).not.toHaveBeenCalled();
  });

  test('a guard that throws never blocks a legitimate recording (returns false)', async () => {
    const sb = { from: () => { throw new Error('db down'); } };
    expect(await guard.deferNewClassroomAudioIfInFlight({ userId: 'u-1', supabase: sb, sendAck: jest.fn(), nowMs: NOW })).toBe(false);
  });
});

describe('the document door is wired to it', () => {
  test('handleDocumentMessage defers before initiateCoachingSession', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'bot', 'whatsapp-bot.js'), 'utf8');
    const i = src.indexOf("logToFile('🎓 CLASSROOM AUDIO DETECTED (15+ minutes)'");
    const j = src.indexOf('await CoachingService.initiateCoachingSession(', i);
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    const branch = src.slice(i, j);
    expect(branch).toMatch(/deferNewClassroomAudioIfInFlight\(/);
    expect(branch).toMatch(/coaching_stillAnalysing/);
  });
});
