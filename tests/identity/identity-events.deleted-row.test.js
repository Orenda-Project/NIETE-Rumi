'use strict';
/**
 * A soft-deleted account that keeps its number comes back to life without anyone seeing it.
 *
 * getOrCreateUser finds a teacher by her number and has no deleted check, so a row with `deleted_at` set is served as
 * live on her next message. That behaviour stays exactly as it is (changing it is a decision, not a log line); what
 * changes is that it is now recorded: `identity.deleted_row_resumed`, once per account per process (getOrCreateUser
 * runs on every message), carrying the account id and nothing else.
 *
 * Only the network edge is doubled: the database. The structured event logger is the real module, spied.
 */
const mockState = { existingUser: null, updates: [] };

jest.mock('../../bot/shared/config/supabase', () => {
  const api = {
    from() { return api; },
    select() { return api; },
    eq() { return api; },
    single() {
      return mockState.existingUser
        ? Promise.resolve({ data: { ...mockState.existingUser }, error: null })
        : Promise.resolve({ data: null, error: { code: 'PGRST116' } });
    },
    insert() { return api; },
    update(row) {
      mockState.updates.push(row);
      return { eq: () => Promise.resolve({ data: null, error: null }) };
    },
  };
  return api;
});

// The teacher's keyed reference (tk) needs the HMAC key; a fixed test key makes it deterministic here.
process.env.WEB_QUIZ_KID_KEY = 'identity-events-test-key-0123456789abcdef';
const StructuredLogger = require('../../bot/shared/utils/structured-logger');
const { getOrCreateUser } = require('../../bot/shared/database/bot-helpers');
const { tk } = require('../../bot/shared/services/quiz/web-quiz-kid');

// A synthetic number, built from parts so the repo holds no phone-shaped literal (920000… is never a real mobile).
const fx = (n) => '92' + '000' + String(n).padStart(7, '0');
const PHONE = fx(303);
const row = (over = {}) => ({
  id: 'a0000000-0000-4000-8000-000000000303', phone_number: PHONE, name: 'Bushra Testwala',
  registration_completed: true, deleted_at: '2026-10-01T09:00:00.000Z', ...over,
});

let events;
beforeEach(() => {
  mockState.existingUser = null;
  mockState.updates = [];
  events = jest.spyOn(StructuredLogger, 'logEvent').mockImplementation(() => {});
});
afterEach(() => { events.mockRestore(); });

const resumed = () => events.mock.calls.filter(([name]) => name === 'identity.deleted_row_resumed').map(([, data]) => data);

describe('identity.deleted_row_resumed', () => {
  test('a soft-deleted row found by number is recorded, and returned exactly as today', async () => {
    mockState.existingUser = row();
    const user = await getOrCreateUser(PHONE);
    expect(user).toEqual({ ...row(), last_message_at: expect.any(String) });
    expect(resumed()).toEqual([{ tk: tk(row().id) }]);
  });

  test('recorded once per account per process: the second message adds nothing', async () => {
    mockState.existingUser = row({ id: 'a0000000-0000-4000-8000-000000000304' });
    await getOrCreateUser(PHONE);
    await getOrCreateUser(PHONE);
    expect(resumed()).toEqual([{ tk: tk('a0000000-0000-4000-8000-000000000304') }]);
  });

  test('a live row records nothing', async () => {
    mockState.existingUser = row({ id: 'a0000000-0000-4000-8000-000000000305', deleted_at: null });
    const user = await getOrCreateUser(PHONE);
    expect(user.id).toBe('a0000000-0000-4000-8000-000000000305');
    expect(resumed()).toEqual([]);
  });

  test('the event logger failing never reaches the teacher: the row still comes back', async () => {
    events.mockImplementation(() => { throw new Error('logger down'); });
    mockState.existingUser = row({ id: 'a0000000-0000-4000-8000-000000000306' });
    const user = await getOrCreateUser(PHONE);
    expect(user.id).toBe('a0000000-0000-4000-8000-000000000306');
  });

  test('log only: the one write is today\'s last_message_at stamp', async () => {
    mockState.existingUser = row({ id: 'a0000000-0000-4000-8000-000000000307' });
    await getOrCreateUser(PHONE);
    expect(mockState.updates).toEqual([{ last_message_at: expect.any(String) }]);
  });

  test('the event carries no phone number and no name', async () => {
    mockState.existingUser = row({ id: 'a0000000-0000-4000-8000-000000000308' });
    await getOrCreateUser(PHONE);
    expect(resumed()).toHaveLength(1);
    const text = JSON.stringify(resumed());
    expect(text).not.toContain(PHONE);
    expect(text).not.toContain('Bushra');
    expect(text).not.toContain('a0000000-0000-4000-8000-000000000308');
  });
});
