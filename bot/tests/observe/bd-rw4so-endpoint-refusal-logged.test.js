/**
 * bd-rw4so — what the Flow ENDPOINT does when a coach reopens the review form
 * of an observation that is already over.
 *
 * Staging, 16 Sep 2026 (DC/HITL sweep pass 4, row 6b): the coach reopened the
 * armed FICO form on cancelled observation ab92e71d and forced a real round
 * trip. The endpoint refused CORRECTLY — no draft applied, no promotion,
 * SUCCESS never reached, `analysis_data` carried no observer-edit key. Two
 * defects sat on top of that correct behaviour, and this file pins both:
 *
 *   1. OBSERVABILITY. `loadSessionFromToken` returned `{ error }` with no
 *      `logToFile`, so Axiom held only a generic `Decrypted flow data` row and
 *      "how many coaches hit a cancelled form this week" had no answer in
 *      production. Instance of the systemic bd-3zexi. Fixed with one
 *      info-level event carrying { sessionId, status, tap }, the same shape as
 *      the button layer's twin at observe-resume.service.js:199.
 *
 *   2. THE COACH IS TOLD THE WRONG THING. The endpoint returns the correct
 *      catalogue sentence (`flow_terminal_refused`) but inside the
 *      `{ data: { error } }` envelope, which Meta does NOT render — it shows
 *      its own generic "Something went wrong. Try again later." instead
 *      (bd-8cq24). The one state she most needs named arrives as a transient
 *      error she will retry. Rule 24(d).
 *
 * Why the sentence is delivered to the CHAT rather than on a screen — this is
 * deliberately a FIFTH pattern, not one of bd-8cq24's four, and the reason is
 * that none of those four is reachable for this Flow: observe-fico-flow.json
 * declares DOMAIN_B/C/D/F plus a terminal SUCCESS, no screen declares an
 * error/message/caption field, SUCCESS declares only `session_id` and its body
 * text is hardcoded "Your FICO observation has been saved" (wrong copy for a
 * refusal), and `routing_model` is strictly forward-only so re-rendering a
 * screen or returning SUCCESS from INIT is the invalid-screen-transition class
 * behind 593 of bd-3zexi's 600 client-side errors. Fixing it ON a screen needs
 * a Flow JSON revision plus a Meta re-publish, which is inert until published
 * and must not ride a code-only drop. So the endpoint mirrors the button
 * layer's proven behaviour (observe-resume.service.js `_refuseTerminal`, which
 * the sweep verified green at row 6a) and speaks in the chat.
 *
 * Send-once: a reply-button/Flow message stays tappable, so a coach can refuse
 * twice in seconds. The sentence is claimed with the house tap-lock convention
 * — `redisService.setNX(key, '1', 300)`, as in add-another.service.js:105,
 * media-attach.service.js and observe-binding.service.js:222 — while the LOG
 * still fires on every refusal, because suppressing the log would defeat the
 * counting that defect 1 exists to enable.
 *
 * These cases drive the REAL endpoint handler, so the changed lines actually
 * execute on this branch (bd-s192t). Only supabase, redis, WhatsApp and the
 * draft service are mocked.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
// The ICT/NIETE deployment is the FICO market, and that matters for the
// language cases below: a refusal's language is clamped to the MARKET's offer
// (observe-language.js MARKET_LANGS), not just to the catalogue. Left unset the
// pack defaults to mewaka, whose offer is ['sw','en'] with a 'sw' fallback — so
// an Urdu coach's refusal came back in SWAHILI, which is CORRECT for a market
// that does not serve Urdu, and is why this must be declared explicitly.
process.env.OBSERVE_FRAMEWORK = 'fico';

const logged = [];
jest.mock('../../shared/utils/logger', () => ({
  logToFile: jest.fn((m, d) => logged.push({ level: 'info', m, d })),
  logError: jest.fn((m, d) => logged.push({ level: 'error', m, d })),
  logWarn: jest.fn((m, d) => logged.push({ level: 'warn', m, d })),
}));

const mockSent = [];
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn((to, text) => { mockSent.push({ to, text }); return Promise.resolve({}); }),
  sendFlow: jest.fn(() => Promise.resolve({})),
}));

jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    __store: store,
    setexWithCeiling: jest.fn((k, ttl, v) => { store.set(k, v); return Promise.resolve('OK'); }),
    // REAL ioredis contract: SET NX returns 'OK' when it set the key and null
    // when the key already existed. Modelling that faithfully is the whole
    // point — a double-tap must find the key present.
    setNX: jest.fn((k, v) => {
      if (store.has(k)) return Promise.resolve(null);
      store.set(k, v);
      return Promise.resolve('OK');
    }),
    get: jest.fn((k) => {
      const v = store.get(k);
      if (!v) return Promise.resolve(null);
      try { return Promise.resolve(JSON.parse(v)); } catch { return Promise.resolve(v); }
    }),
    delete: jest.fn((k) => { store.delete(k); return Promise.resolve(1); }),
  };
});

let mockSession = null;
let mockCoachLanguage = 'en';

const COACH_PHONE = '923000000001';

jest.mock('../../shared/config/supabase', () => ({
  from: (table) => {
    const b = {};
    ['select', 'eq', 'order', 'limit', 'not', 'in', 'is', 'neq'].forEach((m) => { b[m] = () => b; });
    b.update = () => b;
    const settle = () => {
      // Both the language resolver and the refusal's recipient lookup read
      // `users` — answer them with one row carrying each field they ask for.
      if (table === 'users') {
        return { data: { preferred_language: mockCoachLanguage, phone_number: COACH_PHONE }, error: null };
      }
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

const redis = require('../../shared/services/cache/railway-redis.service');
const { handleObserveMewakaRequest } = require('../../shared/routes/observe-mewaka-endpoint');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

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
  mockSent.length = 0;
  redis.__store.clear();
  mockCoachLanguage = 'en';
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

describe('bd-rw4so — the coach reads the real reason in her chat', () => {
  test('the refusal sentence is sent to her, from the catalogue, not swallowed by Meta', async () => {
    await handleObserveMewakaRequest({
      action: 'data_exchange', flow_token: TOKEN, data: { _screen: 'DOMAIN_A' },
    });

    expect(mockSent).toHaveLength(1);
    expect(mockSent[0].to).toBe(COACH_PHONE);
    expect(mockSent[0].text).toBe(observeStrings('en').flow_terminal_refused);
  });

  test('it is in HER language, resolved through the catalogue', async () => {
    mockCoachLanguage = 'ur';
    await handleObserveMewakaRequest({ action: 'INIT', flow_token: TOKEN });

    const UR = observeStrings('ur').flow_terminal_refused;
    expect(UR).not.toBe(observeStrings('en').flow_terminal_refused);
    expect(mockSent.map((s) => s.text)).toContain(UR);
  });

  // A Flow message stays tappable; she can refuse twice in seconds. She must
  // not be told twice — but the refusal must still be COUNTED twice, or the
  // production number this whole bead exists to enable would undercount.
  test('a double tap tells her ONCE but is still logged BOTH times', async () => {
    await handleObserveMewakaRequest({ action: 'INIT', flow_token: TOKEN });
    await handleObserveMewakaRequest({
      action: 'data_exchange', flow_token: TOKEN, data: { _screen: 'DOMAIN_A' },
    });

    expect(mockSent).toHaveLength(1);
    expect(refusals()).toHaveLength(2);
  });

  test('CONTROL — a live observation is told nothing', async () => {
    mockSession = row('awaiting_observer_review');
    await handleObserveMewakaRequest({ action: 'INIT', flow_token: TOKEN });

    expect(mockSent).toHaveLength(0);
  });

  // The limit that keeps this a terminal-refusal fix and not a new broadcast
  // surface: every OTHER error envelope this endpoint returns stays silent.
  test('LIMIT — no other error envelope sends anything', async () => {
    // a malformed token never resolves a session at all
    const bad = await handleObserveMewakaRequest({ action: 'INIT', flow_token: 'nonsense' });
    expect(bad.data.error).toBeDefined();

    // an unknown screen on a LIVE observation is our bug, not her state
    mockSession = row('awaiting_observer_review');
    const unknown = await handleObserveMewakaRequest({
      action: 'data_exchange', flow_token: TOKEN, data: { _screen: 'NOT_A_SCREEN' },
    });
    expect(unknown.data.error).toBeDefined();

    expect(mockSent).toHaveLength(0);
  });
});
