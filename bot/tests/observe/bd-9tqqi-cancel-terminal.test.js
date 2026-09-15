/**
 * A cancelled observation stays cancelled.
 *
 * The review Flow is already sitting in the coach's chat when she cancels, so
 * every cancelled observation whose form was already sent is armed. Three
 * independent lines carried that:
 *
 *   1. loadSessionFromToken validated id, observation_type and owner — never
 *      status.
 *   2. applyObserverEdits wrote {analysis_data, status:'observer_review_complete'}
 *      keyed on the id alone, with no status predicate, so it promoted a
 *      cancelled row.
 *   3. cancelObservationCore did a compare-and-set update and never read whether
 *      it matched a row, returning 'cancelled' either way — so the coach saw a
 *      SUCCESS screen for a cancel that had not happened.
 *
 * Prod, 15 Sep 2026: 113 leader observations at status 'cancelled', 103 of them
 * still debrief_status 'pending', and none of them reachable from the menu — so
 * a revival is invisible until the teacher receives the report. Proven on one
 * session: cancel 27 Aug 06:27:44Z with the SUCCESS screen shown, stale form
 * submitted 09:59:43Z, report delivered ~10:31Z, row now 'completed'.
 *
 * This guard is mandatory alongside the Cancel button. Without it, putting
 * Cancel on every recording ack makes the defect worse: many more coaches reach
 * the cancel, and every one whose Flow is already open gets a report they
 * explicitly cancelled.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OBSERVE_MEWAKA_FLOW_ID = process.env.OBSERVE_MEWAKA_FLOW_ID || 'test-observe-flow-id';

// One in-memory coaching_sessions row, plus a ledger of every update issued so
// a test can assert that NOTHING was written.
const DB = {
  row: null,
  updates: [],
  /** rows the last update's predicates would have matched */
  matched: 1,
  /** simulate a concurrent advance landing between the read and the write */
  advanceAfterRead: null,
};

jest.mock('../../shared/config/supabase', () => {
  // One fresh filter/op state per from() — a shared one leaks an earlier
  // statement's predicates into the next read.
  const settle = (st) => {
    if (st.op !== 'update') return Promise.resolve({ data: DB.row ? [DB.row] : [], error: null });
    DB.updates.push({ payload: st.payload, filters: st.filters });
    // A predicate naming a terminal status, or a compare-and-set on a status the
    // row no longer holds, matches nothing — what PostgREST actually returns.
    const blocked = st.filters.some(([op, col, a, b]) => {
      if (col !== 'status') return false;
      if (op === 'not') return /cancelled|abandoned/.test(String(b));
      if (op === 'eq') return !DB.row || DB.row.status !== a;
      return false;
    });
    const rows = blocked ? [] : (DB.row ? [{ ...DB.row, ...st.payload }] : []);
    DB.matched = rows.length;
    return Promise.resolve({ data: rows, error: null });
  };
  const make = () => {
    const st = { op: null, payload: null, filters: [] };
    const api = {
      select: () => api,
      insert: (p) => { st.op = 'insert'; st.payload = p; return api; },
      update: (p) => { st.op = 'update'; st.payload = p; return api; },
      eq: (c, v) => { st.filters.push(['eq', c, v]); return api; },
      in: (c, v) => { st.filters.push(['in', c, v]); return api; },
      not: (c, o, v) => { st.filters.push(['not', c, o, v]); return api; },
      limit: () => api,
      maybeSingle: () => {
        const seen = DB.row;
        if (DB.advanceAfterRead) DB.row = { ...DB.row, status: DB.advanceAfterRead };
        return Promise.resolve({ data: seen, error: null });
      },
      single: () => settle(st).then((r) => ({ data: (r.data || [])[0] || null, error: null })),
      then: (ok, bad) => settle(st).then(ok, bad),
    };
    return api;
  };
  return { from: () => make() };
});

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true),
}));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async () => null),
  set: jest.fn(async () => true),
  setex: jest.fn(async () => true),
  setexWithCeiling: jest.fn(async () => true),
  delete: jest.fn(async () => true),
}));
jest.mock('../../shared/services/observe/observe-language', () => ({
  languageFor: jest.fn(async () => 'ur'),
  clampToMarket: (l) => l,
  marketDefault: () => 'en',
  marketLangConfig: () => ({ offer: ['en', 'ur'], fallback: 'en' }),
}));

const endpoint = require('../../shared/routes/observe-mewaka-endpoint');
const Draft = require('../../shared/services/observe/observe-draft.service');
const Resume = require('../../shared/services/observe/observe-resume.service');

const COACH_ID = 'u-coach';
const SESSION_ID = 'obs-cancelled';
const TOKEN = `${COACH_ID}:${SESSION_ID}`;

const cancelledRow = (over = {}) => ({
  id: SESSION_ID,
  status: 'cancelled',
  observation_type: 'leader_observation',
  observer_user_id: COACH_ID,
  user_id: 'u-teacher',
  debrief_status: 'pending',
  analysis_data: { framework: 'fico', domains: {} },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  DB.row = cancelledRow();
  DB.updates = [];
  DB.matched = 1;
  DB.advanceAfterRead = null;
});

describe('the endpoint refuses a terminal observation', () => {
  it('RED: a late INIT on a cancelled observation is refused, not prefilled', async () => {
    const res = await endpoint.handleObserveMewakaRequest({ action: 'INIT', flow_token: TOKEN });
    expect(res.data && res.data.error).toBeTruthy();
    expect(res.screen).toBeUndefined();
  });

  it('RED: a late submit writes nothing and never reaches SUCCESS', async () => {
    const res = await endpoint.handleObserveMewakaRequest({
      action: 'data_exchange', flow_token: TOKEN, screen: 'DOMAIN_E',
      data: { _screen: 'DOMAIN_E', r_e1: '2' },
    });
    expect(res.screen).not.toBe('SUCCESS');
    expect(res.data && res.data.error).toBeTruthy();
    expect(DB.updates.filter((u) => 'status' in (u.payload || {}))).toHaveLength(0);
  });

  it('an abandoned observation is refused the same way', async () => {
    DB.row = cancelledRow({ status: 'abandoned' });
    const res = await endpoint.handleObserveMewakaRequest({ action: 'INIT', flow_token: TOKEN });
    expect(res.data && res.data.error).toBeTruthy();
  });

  it('a live observation still opens', async () => {
    DB.row = cancelledRow({ status: 'confirmed' });
    const res = await endpoint.handleObserveMewakaRequest({ action: 'INIT', flow_token: TOKEN });
    expect(res.data && res.data.error).toBeFalsy();
    expect(res.screen).toBeTruthy();
  });
});

describe('the write itself carries the predicate — the race window, not just the read', () => {
  it('RED: applyObserverEdits refuses a terminal row instead of promoting it', async () => {
    const out = await Draft.applyObserverEdits(SESSION_ID, { r_e1: '2' });
    expect(out && out.refused).toBe('terminal');
    const promotions = DB.updates.filter(
      (u) => (u.payload || {}).status === 'observer_review_complete' && DB.matched > 0,
    );
    expect(promotions).toHaveLength(0);
  });

  it('RED: the update names the terminal statuses in its predicate', async () => {
    await Draft.applyObserverEdits(SESSION_ID, { r_e1: '2' });
    const upd = DB.updates.find((u) => 'status' in (u.payload || {}));
    expect(upd).toBeTruthy();
    const names = JSON.stringify(upd.filters);
    expect(names).toMatch(/cancelled/);
    expect(names).toMatch(/abandoned/);
  });
});

describe('the cancel ack stops being a claim', () => {
  it('RED: a compare-and-set that matched no row reports raced, not cancelled', async () => {
    // The pipeline advanced between the read and the compare-and-set write, so
    // the predicate on the status we read matches nothing.
    DB.row = cancelledRow({ status: 'confirmed' });
    DB.advanceAfterRead = 'analyzing';
    const out = await Resume.cancelObservationCore(SESSION_ID, { id: COACH_ID });
    expect(out.outcome).toBe('raced');
  });

  it('a cancel that DID match still reports cancelled', async () => {
    DB.row = cancelledRow({ status: 'confirmed' });
    const out = await Resume.cancelObservationCore(SESSION_ID, { id: COACH_ID });
    expect(out.outcome).toBe('cancelled');
  });

  it('an already-terminal row is reported as already, never as a fresh cancel', async () => {
    const out = await Resume.cancelObservationCore(SESSION_ID, { id: COACH_ID });
    expect(out.outcome).toBe('already');
  });
});
