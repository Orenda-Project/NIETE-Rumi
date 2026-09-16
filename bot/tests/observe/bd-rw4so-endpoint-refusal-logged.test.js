/**
 * bd-rw4so — a cancelled review form refused at the Flow ENDPOINT leaves no
 * trace, so nobody can count how often coaches hit one.
 *
 * Staging, 16 Sep 2026 (DC/HITL sweep pass 4, row 6b): the coach reopened the
 * armed FICO form on cancelled observation ab92e71d and forced a real round
 * trip. The endpoint refused CORRECTLY — no draft applied, no promotion,
 * SUCCESS never reached, `analysis_data` carried no observer-edit key. But
 * Axiom for that window holds only a generic `Decrypted flow data` row:
 * `loadSessionFromToken` returns `{ error }` with no `logToFile`, so a refused
 * stale form is invisible in production and the honest answer to "how many
 * coaches hit a cancelled form this week" is UNKNOWN.
 *
 * The button layer already logs its twin, and this is deliberately the same
 * shape and the same (info) level so the two can be counted together:
 *   observe-resume.service.js:199
 *   '🚫 observe-resume: tap refused — the observation is over'
 *   { sessionId, status, tap }
 *
 * Instance of the systemic bd-3zexi (79 of 87 error-envelope returns emit no
 * log at all).
 *
 * These cases drive the REAL endpoint handler, so the changed line actually
 * executes on this branch — a helper test plus a source-grep "wiring" test
 * satisfies red-first while shipping a dead path (bd-s192t). Only supabase,
 * redis and the draft service are mocked.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

const logged = [];
jest.mock('../../shared/utils/logger', () => ({
  logToFile: jest.fn((m, d) => logged.push({ level: 'info', m, d })),
  logError: jest.fn((m, d) => logged.push({ level: 'error', m, d })),
  logWarn: jest.fn((m, d) => logged.push({ level: 'warn', m, d })),
}));

jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    __store: store,
    setexWithCeiling: jest.fn((k, ttl, v) => { store.set(k, v); return Promise.resolve('OK'); }),
    get: jest.fn((k) => {
      const v = store.get(k);
      if (!v) return Promise.resolve(null);
      try { return Promise.resolve(JSON.parse(v)); } catch { return Promise.resolve(v); }
    }),
    delete: jest.fn((k) => { store.delete(k); return Promise.resolve(1); }),
  };
});

let mockSession = null;

jest.mock('../../shared/config/supabase', () => ({
  from: (table) => {
    const b = {};
    ['select', 'eq', 'order', 'limit', 'not', 'in', 'is', 'neq'].forEach((m) => { b[m] = () => b; });
    b.update = () => b;
    const settle = () => {
      // languageFor() reads users.preferred_language; the refusal must not
      // depend on it, so it is answered plainly here.
      if (table === 'users') return { data: { preferred_language: 'en' }, error: null };
      return { data: mockSession, error: null };
    };
    b.single = async () => settle();
    b.maybeSingle = async () => settle();
    b.then = (ok, ko) => Promise.resolve(settle()).then(ok, ko);
    return b;
  },
}));

jest.mock('../../shared/services/observe/observe-draft.service', () => {
  const actual = jest.requireActual('../../shared/services/observe/observe-draft.service');
  return { ...actual, applyObserverEdits: jest.fn().mockResolvedValue({ indicators_rescored: 1 }) };
});

const { handleObserveMewakaRequest } = require('../../shared/routes/observe-mewaka-endpoint');

const SID = 'obs-rw4so';
const TOKEN = `coach-1:${SID}`;

/** A leader observation owned by coach-1, cancelled unless told otherwise. */
function row(status = 'cancelled') {
  return {
    id: SID,
    status,
    user_id: 'teacher-1',
    observer_user_id: 'coach-1',
    observation_type: 'leader_observation',
    analysis_data: {},
  };
}

/** Every refusal event the endpoint emitted. */
const refusals = () => logged.filter((l) => /refused/.test(String(l.m)));

beforeEach(() => {
  logged.length = 0;
  mockSession = row('cancelled');
});

describe('bd-rw4so — the endpoint refusal is countable in production', () => {
  test('a forced data_exchange on a cancelled observation emits ONE refusal event', async () => {
    const res = await handleObserveMewakaRequest({
      action: 'data_exchange',
      flow_token: TOKEN,
      data: { _screen: 'DOMAIN_A', r_A1_1: '3' },
    });

    // the guard itself still holds — SUCCESS is never reached
    expect(res.screen).not.toBe('SUCCESS');

    const events = refusals();
    expect(events).toHaveLength(1);
    // info level, like the button layer's twin — an error-level monitor must
    // not page on a coach tapping a stale form, but Axiom must still see it.
    expect(events[0].level).toBe('info');
    expect(events[0].d).toMatchObject({ sessionId: SID, status: 'cancelled' });
    // the tap is what makes a count actionable: which surface did she use
    expect(String(events[0].d.tap)).toBe('data_exchange');
  });

  test('reopening the form (INIT) on a cancelled observation is logged too', async () => {
    await handleObserveMewakaRequest({ action: 'INIT', flow_token: TOKEN });

    const events = refusals();
    expect(events).toHaveLength(1);
    expect(events[0].d).toMatchObject({ sessionId: SID, status: 'cancelled' });
    expect(String(events[0].d.tap)).toBe('INIT');
  });

  test('an abandoned observation is refused and counted on the same event', async () => {
    mockSession = row('abandoned');
    await handleObserveMewakaRequest({ action: 'INIT', flow_token: TOKEN });

    const events = refusals();
    expect(events).toHaveLength(1);
    expect(events[0].d).toMatchObject({ sessionId: SID, status: 'abandoned' });
  });

  // A guard that over-logs is its own bug: a refusal event on a live form would
  // make the production count meaningless.
  test('CONTROL — a live observation emits no refusal event', async () => {
    mockSession = row('awaiting_observer_review');
    await handleObserveMewakaRequest({ action: 'INIT', flow_token: TOKEN });

    expect(refusals()).toHaveLength(0);
  });
});
