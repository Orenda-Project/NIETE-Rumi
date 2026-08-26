/**
 * bd-9rrd5 — HITL observations never reached status='completed': the flow's
 * terminal state was observer_review_complete, so EVERY surface that counts
 * "completed" (observability dashboard filter, portal teacher-performance
 * bd-2671, M&E tallies) read a pure-HITL coach as ZERO — forever. Live proof:
 * Meerab (923268124160), 12 observations since 20-Aug, all debriefs done,
 * count shown to her: 0 ("since the beginning", HITL rows 81/95/105/130).
 *
 * Contract: once the debrief is done AND the teacher report is sent, the
 * session becomes status='completed'. The transition is CAS-guarded (only
 * from observer_review_complete) and fires from BOTH orders (sent-then-done,
 * done-then-sent). Consumers audited 26-Aug: pending-debriefs list filters
 * debrief='pending' (unaffected), Send-reports list filters delivery unsent
 * (unaffected), portal isCompleted already includes 'completed'.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const fs = require('fs');
const path = require('path');

describe('bd-9rrd5 · shouldComplete truth table', () => {
  let Completion;
  beforeEach(() => { jest.resetModules(); Completion = require('../../shared/services/observe/observe-completion'); });

  const base = {
    status: 'observer_review_complete',
    debrief_status: 'done',
    teacher_delivery: { status: 'sent' },
  };

  it('review complete + debrief done + report sent → complete', () => {
    expect(Completion.shouldComplete(base)).toBe(true);
  });
  it('debrief pending → not yet', () => {
    expect(Completion.shouldComplete({ ...base, debrief_status: 'pending' })).toBe(false);
  });
  it('report not sent (awaiting tap / none) → not yet', () => {
    expect(Completion.shouldComplete({ ...base, teacher_delivery: { status: 'awaiting_teacher_tap' } })).toBe(false);
    expect(Completion.shouldComplete({ ...base, teacher_delivery: null })).toBe(false);
  });
  it('already completed or any other status → no-op', () => {
    expect(Completion.shouldComplete({ ...base, status: 'completed' })).toBe(false);
    expect(Completion.shouldComplete({ ...base, status: 'awaiting_observer_review' })).toBe(false);
  });
});

describe('bd-9rrd5 · maybeCompleteObservation (CAS write)', () => {
  const writes = [];
  beforeEach(() => {
    jest.resetModules(); writes.length = 0;
    jest.doMock('../../shared/config/supabase', () => ({
      from: () => {
        const b = {
          select: () => b, or: () => b, order: () => b, limit: () => b,
          eq: (col, val) => { b._eqs = (b._eqs || []).concat([[col, val]]); return b; },
          maybeSingle: async () => ({
            data: {
              id: 's1', status: 'observer_review_complete', debrief_status: 'done',
              teacher_delivery: { status: 'sent' },
            },
            error: null,
          }),
          update: (payload) => { const w = { payload, chain: b }; writes.push(w); return b; },
          then: (res) => res({ data: null, error: null }),
        };
        return b;
      },
    }));
  });
  afterEach(() => jest.resetModules());

  it('flips to completed, guarded on the current status (CAS)', async () => {
    const { maybeCompleteObservation } = require('../../shared/services/observe/observe-completion');
    const did = await maybeCompleteObservation('s1');
    expect(did).toBe(true);
    expect(writes.length).toBe(1);
    expect(writes[0].payload.status).toBe('completed');
    // eqs land on the chain AFTER update() in the builder — read them post-await
    const eqCols = (writes[0].chain._eqs || []).map((e) => `${e[0]}=${e[1]}`);
    expect(eqCols).toContain('status=observer_review_complete');
  });
});

describe('bd-9rrd5 · wiring contracts (source)', () => {
  it('the sent-merge path calls maybeCompleteObservation', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../shared/services/observe/observe-send.service.js'), 'utf8');
    expect(src).toMatch(/maybeCompleteObservation/);
  });
  it('the debrief done-flip path calls maybeCompleteObservation', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../shared/services/observe/observe-debrief.service.js'), 'utf8');
    expect(src).toMatch(/maybeCompleteObservation/);
  });
});
