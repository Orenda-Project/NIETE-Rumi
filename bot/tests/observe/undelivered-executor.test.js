/**
 * Acting on ONE undelivered report: who is told, in whose language, and what is
 * written back.
 *
 * The identity question is the one that has cost us before. On a bound
 * observation `session.users` is the OBSERVED TEACHER, not the coach, so a
 * service that reads it to decide who to message sends the teacher a message
 * about herself that she never asked for, in the wrong language, about work she
 * did not do. The coach is `observer_user_id`. Asserted here directly, because
 * every previous instance of this bug passed every test that did not ask.
 *
 * The write is a compare-and-set on `updated_at`. Fifteen-minute ticks across
 * several replicas mean the same row is classified concurrently; without the
 * CAS the same coach gets the same reminder once per replica.
 */

const SESSION_ID = 'sess-undelivered-1';
const COACH_PHONE = '923333000000';
const TEACHER_PHONE = '923001234567';

// The factory is hoisted above these, so the shared state lives on `global`.
const state = global;

jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn((table) => {
    const chain = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      order: jest.fn(() => chain),
      limit: jest.fn(() => chain),
      single: jest.fn(async () => (table === 'users'
        ? { data: global.__mockCoach, error: null }
        : { data: global.__mockRow, error: null })),
      maybeSingle: jest.fn(async () => (table === 'users'
        ? { data: global.__mockCoach, error: null }
        : { data: global.__mockRow, error: null })),
      update: jest.fn((payload) => {
        const call = { table, payload, eq: [] };
        global.__mockUpdates.push(call);
        const upd = {
          eq: jest.fn((col, val) => { call.eq.push([col, val]); return upd; }),
          // PostgREST answers an unmatched CAS with zero ROWS, not an error.
          select: jest.fn(() => Promise.resolve({ data: global.__mockCasResult, error: null })),
          then: (resolve) => resolve({ data: null, error: null }),
        };
        return upd;
      }),
    };
    return chain;
  }),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockSend = {
  sendMessage: jest.fn(async () => true),
  sendTemplate: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => {}),
  sendImageFromBuffer: jest.fn(async () => true),
};
jest.mock('../../shared/services/whatsapp.service', () => mockSend);
jest.mock('../../shared/storage/r2', () => ({
  downloadFromR2: jest.fn(async () => Buffer.from('x')),
  uploadImageBuffer: jest.fn(async () => 'k'),
}));

const sessionRow = (over = {}, deliveryOver = undefined) => ({
  id: SESSION_ID,
  observation_type: 'leader_observation',
  status: 'observer_review_complete',
  observer_user_id: 'coach-uuid-1',
  user_id: 'teacher-uuid-1',
  updated_at: '2026-09-01T09:00:00Z',
  // The trap: `users` on a bound observation is the OBSERVED TEACHER.
  users: { phone_number: TEACHER_PHONE, name: 'Ms Khadija', preferred_language: 'ur' },
  analysis_data: deliveryOver === undefined ? {} : { teacher_delivery: deliveryOver },
  ...over,
});

const coachTexts = () => mockSend.sendMessage.mock.calls
  .filter((c) => c[0] === COACH_PHONE).map((c) => String(c[1]));
const teacherTexts = () => mockSend.sendMessage.mock.calls
  .filter((c) => c[0] === TEACHER_PHONE).map((c) => String(c[1]));
const deliveryWrites = () => state.__mockUpdates
  .filter((u) => u.payload.analysis_data && u.payload.analysis_data.teacher_delivery)
  .map((u) => ({ delivery: u.payload.analysis_data.teacher_delivery, eq: u.eq }));

let ObserveSend;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.OBSERVE_FRAMEWORK = 'fico';
  state.__mockUpdates = [];
  state.__mockCasResult = [{ id: SESSION_ID }];   // CAS wins by default
  state.__mockRow = sessionRow({}, { status: 'awaiting_confirm', teacher_name: 'Ms Khadija' });
  state.__mockCoach = { id: 'coach-uuid-1', phone_number: COACH_PHONE, name: 'Coach Rifat', preferred_language: 'en' };
  ObserveSend = require('../../shared/services/observe/observe-send.service');
});
afterEach(() => { delete process.env.OBSERVE_FRAMEWORK; });

describe('the reminder reaches the COACH', () => {
  test('a 2-day-old awaiting_confirm reminds the coach, and never the teacher', async () => {
    state.__mockRow.updated_at = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();

    const decision = await ObserveSend.processUndeliveredDelivery(SESSION_ID);
    expect(decision.action).toBe('remind');

    expect(coachTexts()).toHaveLength(1);
    expect(teacherTexts()).toHaveLength(0);
    // The teacher's own name is what makes the message actionable.
    expect(coachTexts()[0]).toContain('Ms Khadija');
  });

  test('the reminder is in the COACH\'s language, not the teacher\'s', async () => {
    state.__mockRow.updated_at = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    const { observeStrings } = require('../../shared/services/observe/observe-strings');

    await ObserveSend.processUndeliveredDelivery(SESSION_ID);

    // The coach reads English; the observed teacher's preference is Urdu. A
    // service reading `session.users` here would answer in Urdu.
    const expected = observeStrings('en').send_undelivered_reminder_fo.replace('{name}', 'Ms Khadija');
    expect(coachTexts()[0]).toBe(expected);
    expect(coachTexts()[0]).not.toBe(
      observeStrings('ur').send_undelivered_reminder_fo.replace('{name}', 'Ms Khadija'));
  });

  test('the reminder is stamped on the row so it is never sent twice', async () => {
    state.__mockRow.updated_at = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    await ObserveSend.processUndeliveredDelivery(SESSION_ID);

    const w = deliveryWrites();
    expect(w.length).toBeGreaterThan(0);
    expect(typeof w[0].delivery.reminded_at).toBe('string');
    expect(w[0].delivery.reminder_count).toBe(1);
    // Keys, never a new status value: six readers treat teacher_delivery.status
    // as a closed vocabulary, and one of them decides which rows a coach sees.
    expect(w[0].delivery.status).toBe('awaiting_confirm');
  });

  test('a coach with no resolvable phone is skipped rather than guessed at', async () => {
    state.__mockRow.updated_at = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    state.__mockCoach = null;

    const decision = await ObserveSend.processUndeliveredDelivery(SESSION_ID);
    expect(decision.action).toBe('skip');
    expect(decision.reason).toBe('coach_unresolved');
    // Silent beats the wrong person. The observed teacher must hear nothing.
    expect(mockSend.sendMessage).not.toHaveBeenCalled();
    expect(deliveryWrites()).toHaveLength(0);
  });
});

describe('give up, and expire', () => {
  test('after a reminder and three days of silence the coach is told we stopped', async () => {
    state.__mockRow = sessionRow(
      { updated_at: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString() },
      {
        status: 'awaiting_confirm', teacher_name: 'Ms Khadija',
        reminded_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(),
        reminder_count: 1,
      },
    );

    const decision = await ObserveSend.processUndeliveredDelivery(SESSION_ID);
    expect(decision.action).toBe('give_up');
    expect(coachTexts()).toHaveLength(1);
    expect(deliveryWrites()[0].delivery.gave_up_at).toBeTruthy();
    expect(deliveryWrites()[0].delivery.gave_up_reason).toBe('no_send_after_reminder');
  });

  test('an 8-day-old report nobody ever chased is closed with NO message to anyone', async () => {
    state.__mockRow.updated_at = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();

    const decision = await ObserveSend.processUndeliveredDelivery(SESSION_ID);
    expect(decision.action).toBe('expire');
    // This is the 407-row half of today's backlog. It must be silent.
    expect(mockSend.sendMessage).not.toHaveBeenCalled();
    expect(mockSend.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(deliveryWrites()[0].delivery.gave_up_at).toBeTruthy();
    expect(deliveryWrites()[0].delivery.gave_up_reason).toBe('too_old_to_chase');
  });

  test('a report with no delivery record at all still gets a record written', async () => {
    state.__mockRow = sessionRow({ updated_at: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString() });
    const decision = await ObserveSend.processUndeliveredDelivery(SESSION_ID);
    expect(decision.action).toBe('expire');
    expect(deliveryWrites()[0].delivery.gave_up_at).toBeTruthy();
  });
});

describe('one message per row, however many replicas are running', () => {
  test('the write is a compare-and-set on updated_at', async () => {
    state.__mockRow.updated_at = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    await ObserveSend.processUndeliveredDelivery(SESSION_ID);

    const eqCols = deliveryWrites()[0].eq.map(([col]) => col);
    expect(eqCols).toContain('id');
    expect(eqCols).toContain('updated_at');
    const seen = deliveryWrites()[0].eq.find(([col]) => col === 'updated_at');
    expect(seen[1]).toBe(state.__mockRow.updated_at);
  });

  test('losing the CAS sends nothing — the replica that won already did', async () => {
    state.__mockRow.updated_at = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    state.__mockCasResult = [];   // another replica moved updated_at first

    const decision = await ObserveSend.processUndeliveredDelivery(SESSION_ID);
    expect(decision.action).toBe('skip');
    expect(decision.reason).toBe('lost_race');
    expect(mockSend.sendMessage).not.toHaveBeenCalled();
  });

  test('the claim is written BEFORE the send, so a crash cannot double-message', async () => {
    state.__mockRow.updated_at = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    let writesAtSendTime = -1;
    mockSend.sendMessage.mockImplementationOnce(async () => {
      writesAtSendTime = deliveryWrites().length;
      return true;
    });

    await ObserveSend.processUndeliveredDelivery(SESSION_ID);

    // If the send came first, a crash between send and write means the next
    // tick finds no reminded_at and messages her all over again.
    expect(writesAtSendTime).toBeGreaterThan(0);
  });
});

describe('the copy', () => {
  test('both coach-facing lines exist in every observe language and are distinct', () => {
    const { observeStrings } = require('../../shared/services/observe/observe-strings');
    for (const lang of ['en', 'ur', 'sw']) {
      const S = observeStrings(lang);
      for (const key of ['send_undelivered_reminder_fo', 'send_undelivered_gave_up_fo']) {
        expect(typeof S[key]).toBe('string');
        expect(S[key].length).toBeGreaterThan(20);
        expect(S[key]).toContain('{name}');
      }
      expect(S.send_undelivered_reminder_fo).not.toBe(S.send_undelivered_gave_up_fo);
      // It must not be confusable with the untapped-teacher chase, which is a
      // different situation with a different next step.
      expect(S.send_undelivered_reminder_fo).not.toBe(S.send_nudged_fo);
    }
    const { observeStrings: os } = require('../../shared/services/observe/observe-strings');
    expect(os('ur').send_undelivered_reminder_fo).not.toBe(os('en').send_undelivered_reminder_fo);
    expect(os('sw').send_undelivered_reminder_fo).not.toBe(os('en').send_undelivered_reminder_fo);
  });
});
