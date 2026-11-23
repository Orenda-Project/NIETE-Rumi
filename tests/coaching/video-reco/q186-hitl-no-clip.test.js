'use strict';
/**
 * Queue #186 (the operator, 19 Nov 2026: "For all HITLs ... there are training modules attached everywhere. We dont need
 * that. We only need that in the Weekly Report that gets sent to coaches."): the teacher's report from a HITL visit (a
 * leader observation: coach or principal, every HITL rubric) carries no recommended training clip. None is picked — no
 * read, no LLM call, no row — and a clip picked before this change is not shown on the app's report page or the /cr page.
 * The teacher's own recorded lessons (observation_type 'self') keep theirs.
 */

describe('per visit: the teacher\'s HITL report carries no recommended training clip', () => {
  const SID = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
  const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';
  const ENV = { ...process.env };
  let E;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
    E = require('../../../bot/shared/services/coaching/video-reco/engine');
  });
  afterEach(() => { process.env = { ...ENV }; });

  const store = () => ({
    readForSession: jest.fn().mockResolvedValue(null),
    recentHistory: jest.fn().mockResolvedValue({ segments: [], modules: [] }),
    ladderProgress: jest.fn().mockResolvedValue({ level: 2, completedModules: [] }),
    trainingBands: jest.fn().mockResolvedValue([]),
    write: jest.fn(async (row) => ({ id: 'rec-1', ...row })),
  });
  const args = (session, extra = {}) => ({
    session: { id: SID, user_id: UID, ...session },
    analysis: { framework: 'fico', domains: {} },
    coachingSessionId: SID,
    ...extra,
  });

  test('a visit an observer recorded: no pick, no read, no row — whether the caller says so or only the session does', async () => {
    for (const a of [args({ observer_user_id: 'coach-1' }), args({}, { observationType: 'leader_observation' })]) {
      const st = store();
      const completeJson = jest.fn();
      const row = await E.recommendForReport({ ...a, deps: { env: { VIDEO_RECO_ENABLED: 'true' }, store: st, completeJson, v10GroupFor: jest.fn() } });
      expect(row).toBeNull();
      expect(st.readForSession).not.toHaveBeenCalled();
      expect(st.write).not.toHaveBeenCalled();
      expect(completeJson).not.toHaveBeenCalled();
      expect(E.prefetchReads({ ...a, deps: { env: { VIDEO_RECO_ENABLED: 'true' }, store: st, v10GroupFor: jest.fn() } })).toBe(false);
    }
  });

  test('the teacher\'s own recorded lesson still gets its pick (the reads start)', async () => {
    const st = store();
    expect(E.prefetchReads({ ...args({}), deps: { env: { VIDEO_RECO_ENABLED: 'true' }, store: st, v10GroupFor: jest.fn().mockResolvedValue(null) } })).toBe(true);
    await Promise.resolve();
    expect(st.readForSession).toHaveBeenCalledWith(SID);
  });

  const db = (row) => {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: row, error: null }) };
    return { from: () => chain };
  };
  const ROW = { id: '3b1cfab2-b5f6-4e20-923e-5b250b308291', module_id: 'm1', seg_id: '10-s1', start_s: 10, end_s: 70, reason_en: 'Why', reason_ur: 'کیوں' };

  test('a clip already picked for a HITL visit is not shown on the app\'s report page or the /cr page', async () => {
    process.env.VIDEO_RECO_ENABLED = 'true';
    process.env.INTERNAL_API_KEY = 'test-internal-key-q186';
    const portal = require('../../../dashboard/services/video-reco-portal');
    const cr = require('../../../dashboard/services/video-reco-events');
    const hitl = { ...ROW, observation_type: 'leader_observation' };
    expect(await portal.fieldFor(db(hitl), SID, UID, 'en')).toBeNull();
    expect(await cr.cardFor(db(hitl), SID, UID, 'en', null)).toBeNull();
  });
});
