/**
 * bd-0c80s — "I'm still analysing your previous recording" blocked a teacher's
 * FIRST-EVER recording (Shabana 923225374902, session cbcecc5e).
 *
 * Root cause: since the observe binding wall, a coach's observation of teacher
 * X is a coaching_sessions row with user_id = X (the TEACHER owns the row;
 * observation_type='leader_observation', observer_user_id=the coach). The
 * in-flight guard's lookup filters by user_id alone, so the coach's mid-flight
 * observation reads as the teacher's own in-flight analysis — and her genuine
 * first recording bounces.
 *
 * Second defect: the deferral ack said "no need to resend", but nothing ever
 * re-queues a deferred recording — after the 30-minute mid-flight window the
 * ONLY path to a report is the teacher resending. The ack must say so.
 */

const {
  shouldDeferNewClassroomAudio,
} = require('../../bot/shared/services/coaching/coaching-inflight-guard');

const fs = require('fs');
const path = require('path');

const NOW = 1_700_000_000_000;
const recent = () => new Date(NOW - 60_000).toISOString();

describe('bd-0c80s — the guard is about HER pipeline, not observations OF her', () => {
  it("a coach's mid-flight observation of the teacher does NOT defer her own recording", () => {
    const observeRow = {
      status: 'transcribing',
      observation_type: 'leader_observation',
      observer_user_id: 'coach-uuid',
      created_at: recent(),
    };
    expect(shouldDeferNewClassroomAudio(observeRow, NOW)).toBe(false);
  });

  it('her own mid-flight teacher session still defers (regression guard)', () => {
    const ownRow = { status: 'transcribing', observation_type: null, created_at: recent() };
    expect(shouldDeferNewClassroomAudio(ownRow, NOW)).toBe(true);
    // and rows written before the column existed
    expect(shouldDeferNewClassroomAudio({ status: 'analyzing', created_at: recent() }, NOW)).toBe(true);
  });

  it('the handler lookup excludes observe rows at the QUERY, so an older own-session is still seen', () => {
    // limit(1) returns only the newest row; if an observe row is merely
    // filtered post-hoc, it SHADOWS the teacher's own slightly-older mid-flight
    // session and a duplicate analysis starts. The exclusion must live in the
    // query itself. (.neq alone would also drop observation_type IS NULL rows —
    // PostgREST null semantics — hence the or() form.)
    const src = fs.readFileSync(
      path.join(__dirname, '../../bot/shared/handlers/voice-message.handler.js'), 'utf8'
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const guardQuery = src.match(/from\('coaching_sessions'\)[\s\S]{0,400}?maybeSingle\(\)/g) || [];
    const lookup = guardQuery.find((q) => q.includes('shouldDefer') || q.includes('observation_type'))
      || guardQuery[0];
    expect(lookup).toBeDefined();
    expect(lookup).toContain("observation_type.is.null,observation_type.neq.leader_observation");
  });
});

describe('bd-0c80s — the deferral ack is honest about resending', () => {
  const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');

  it('no longer promises "no need to resend" (nothing re-queues a deferred recording)', () => {
    const msg = getCoachingMessage('coaching_stillAnalysing', 'en');
    expect(msg.toLowerCase()).not.toContain('no need to resend');
    expect(msg).toMatch(/30 minutes/);
    expect(msg.toLowerCase()).toContain('send');
  });

  it('carries a real Urdu translation, not the English fallback', () => {
    const ur = getCoachingMessage('coaching_stillAnalysing', 'ur');
    expect(ur).not.toEqual(getCoachingMessage('coaching_stillAnalysing', 'en'));
    expect(ur).toMatch(/[؀-ۿ]/);
  });
});
