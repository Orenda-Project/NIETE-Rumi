'use strict';
/**
 * A WhatsApp number change is recorded, never acted on.
 *
 * Meta posts a `system` message when a teacher uses WhatsApp's "Change number": the sender (`from`) is the OLD
 * number and `system.wa_id` is the new one (`user_changed_number`); a user-id-only change carries no number
 * (`user_changed_user_id`). The bot dropped both silently, so nobody knew how often it happens.
 *
 * recordSystem logs `identity.number_changed` with what a move WOULD do, using the coach phone edit's own read-only
 * steps (loadTargetWithHistory, then classifyTarget): free, shell or taken. It writes nothing, sends nothing, never
 * throws, and the event carries account ids and a verdict, never a phone number or a name.
 *
 * Only the network edge is doubled: the database (a table fake) and the file logger. The structured event logger is
 * the real module, spied.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

let mockTables = {};
let mockThrow = false;
const mockWrites = [];
jest.mock('../../bot/shared/config/supabase', () => ({
  from(table) {
    if (mockThrow) throw new Error('database unreachable');
    const filters = [];
    let head = false;
    const b = {};
    b.select = (cols, opts) => { head = Boolean(opts && opts.head); return b; };
    b.eq = (c, v) => { filters.push([c, v]); return b; };
    ['update', 'insert', 'upsert', 'delete'].forEach((m) => { b[m] = (payload) => { mockWrites.push({ table, m, payload }); return b; }; });
    const run = () => {
      const rows = (mockTables[table] || []).filter((r) => filters.every(([c, v]) => String(r[c]) === String(v)));
      return head ? { data: null, count: rows.length, error: null } : { data: rows, error: null };
    };
    b.maybeSingle = async () => ({ data: run().data ? run().data[0] || null : null, error: null });
    b.single = b.maybeSingle;
    b.then = (ok, ko) => Promise.resolve(run()).then(ok, ko);
    return b;
  },
}));

// The teacher's keyed reference (tk) needs the HMAC key; a fixed test key makes it deterministic here.
process.env.WEB_QUIZ_KID_KEY = 'identity-events-test-key-0123456789abcdef';
const StructuredLogger = require('../../bot/shared/utils/structured-logger');
const IdentityEvents = require('../../bot/shared/services/identity/identity-events');
const { tk } = require('../../bot/shared/services/quiz/web-quiz-kid');

// A synthetic number, built from parts so the repo holds no phone-shaped literal (920000… is never a real mobile).
const fx = (n) => '92' + '000' + String(n).padStart(7, '0');
const OLD = fx(101);
const NEW = fx(202);
const TEACHER = { id: 'a0000000-0000-4000-8000-000000000101', phone_number: OLD, name: 'Ayesha Testwala' };
const OTHER = { id: 'a0000000-0000-4000-8000-000000000202', phone_number: NEW, name: 'Someone Else' };

const systemMessage = (system) => ({ from: OLD, id: 'wamid.test', timestamp: '1762400000', type: 'system', system });
const changedNumber = (extra = {}) => systemMessage({
  body: `User A changed from ${OLD} to ${NEW}`, wa_id: NEW, type: 'user_changed_number', ...extra,
});

let events;
beforeEach(() => {
  mockTables = {
    users: [TEACHER],
    training_certificates: [], training_assessment_attempts: [], teacher_training_progress: [], coaching_sessions: [],
  };
  mockThrow = false;
  mockWrites.length = 0;
  events = jest.spyOn(StructuredLogger, 'logEvent').mockImplementation(() => {});
});
afterEach(() => { events.mockRestore(); });

const numberChanged = () => events.mock.calls.filter(([name]) => name === 'identity.number_changed').map(([, data]) => data);

describe('identity.number_changed', () => {
  test('the new number has no account: verdict free', async () => {
    await IdentityEvents.recordSystem({ message: changedNumber(), user: TEACHER });
    expect(numberChanged()).toEqual([
      { tk: tk(TEACHER.id), type: 'user_changed_number', verdict: 'free', targetTk: null },
    ]);
  });

  test('the new number has an account with nothing irreplaceable: verdict shell, with its id', async () => {
    mockTables.users.push(OTHER);
    await IdentityEvents.recordSystem({ message: changedNumber(), user: TEACHER });
    expect(numberChanged()).toEqual([
      { tk: tk(TEACHER.id), type: 'user_changed_number', verdict: 'shell', targetTk: tk(OTHER.id) },
    ]);
  });

  test('the new number has an account with history: verdict taken', async () => {
    mockTables.users.push(OTHER);
    mockTables.training_certificates.push({ id: 'cert-1', user_id: OTHER.id });
    await IdentityEvents.recordSystem({ message: changedNumber(), user: TEACHER });
    expect(numberChanged()).toEqual([
      { tk: tk(TEACHER.id), type: 'user_changed_number', verdict: 'taken', targetTk: tk(OTHER.id) },
    ]);
  });

  test('a user-id-only change carries no number: recorded without a lookup', async () => {
    await IdentityEvents.recordSystem({
      message: systemMessage({ body: 'User A changed their user id', type: 'user_changed_user_id' }), user: TEACHER,
    });
    expect(numberChanged()).toEqual([
      { tk: tk(TEACHER.id), type: 'user_changed_user_id', verdict: 'user_id_only', targetTk: null },
    ]);
  });

  test('a number change whose new number Meta could not share: recorded as no_new_number', async () => {
    await IdentityEvents.recordSystem({ message: changedNumber({ wa_id: undefined }), user: TEACHER });
    expect(numberChanged()).toEqual([
      { tk: tk(TEACHER.id), type: 'user_changed_number', verdict: 'no_new_number', targetTk: null },
    ]);
  });

  test('the older type name customer_changed_number counts as a number change', async () => {
    await IdentityEvents.recordSystem({
      message: systemMessage({ body: 'x', new_wa_id: NEW, type: 'customer_changed_number' }), user: TEACHER,
    });
    expect(numberChanged()).toEqual([
      { tk: tk(TEACHER.id), type: 'customer_changed_number', verdict: 'free', targetTk: null },
    ]);
  });

  test('the database is unreachable: still recorded, verdict unknown, nothing thrown', async () => {
    mockThrow = true;
    await expect(IdentityEvents.recordSystem({ message: changedNumber(), user: TEACHER })).resolves.toBeUndefined();
    expect(numberChanged()).toEqual([
      { tk: tk(TEACHER.id), type: 'user_changed_number', verdict: 'unknown', targetTk: null },
    ]);
  });

  test('other system messages and odd input record nothing and never throw', async () => {
    await IdentityEvents.recordSystem({ message: systemMessage({ type: 'customer_identity_changed', body: 'x' }), user: TEACHER });
    await IdentityEvents.recordSystem({ message: { type: 'system' }, user: TEACHER });
    await IdentityEvents.recordSystem({ message: null, user: null });
    await IdentityEvents.recordSystem();
    expect(numberChanged()).toEqual([]);
  });

  test('the event logger itself failing is swallowed', async () => {
    events.mockImplementation(() => { throw new Error('logger down'); });
    await expect(IdentityEvents.recordSystem({ message: changedNumber(), user: TEACHER })).resolves.toBeUndefined();
  });

  test('no key on the service: still recorded, the reference is null (the count survives)', async () => {
    const saved = process.env.WEB_QUIZ_KID_KEY;
    delete process.env.WEB_QUIZ_KID_KEY;
    try {
      await IdentityEvents.recordSystem({ message: changedNumber(), user: TEACHER });
    } finally { process.env.WEB_QUIZ_KID_KEY = saved; }
    expect(numberChanged()).toEqual([
      { tk: null, type: 'user_changed_number', verdict: 'free', targetTk: null },
    ]);
  });

  test('log only: nothing is written', async () => {
    mockTables.users.push(OTHER);
    await IdentityEvents.recordSystem({ message: changedNumber(), user: TEACHER });
    expect(mockWrites).toEqual([]);
  });

  test('no event carries a phone number or a name', async () => {
    mockTables.users.push(OTHER);
    await IdentityEvents.recordSystem({ message: changedNumber(), user: TEACHER });
    expect(numberChanged()).toHaveLength(1);
    const text = JSON.stringify(numberChanged());
    for (const secret of [OLD, NEW, TEACHER.name, OTHER.name, TEACHER.id, OTHER.id]) expect(text).not.toContain(secret);
  });
});
