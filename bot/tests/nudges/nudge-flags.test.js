'use strict';
/**
 * bd-mg9c7.159.10 — the three R8 switches read "on" the same way.
 *
 * Sandbox E2E, 23 Sep 18:05 PKT: every R8 flag was set to `1`. The sweeper and
 * the afternoon offer ran; the coaching ask never scheduled a row and logged
 * nothing, because its switch alone accepted only the literal `'true'`. A flag
 * that one module reads as on and its neighbour reads as off is a half-set
 * feature with no error to find it by.
 *
 * The real `onLessonDelivered` and the real `prepare` run below; Supabase and
 * the store are the only mocks (the network boundary).
 */

const mockSchedule = jest.fn(async ({ userId, kind, nudgeDate }) => ({
  row: { id: 'nudge-1', user_id: userId, kind, nudge_date: nudgeDate, status: 'pending' },
  created: true,
}));
jest.mock('../../shared/services/nudges/teacher-nudges.store', () => ({
  schedule: (...a) => mockSchedule(...a),
  rowsFor: jest.fn(async () => []),
  todayRow: jest.fn(async () => null),
  KINDS: { COACHING_AFTER_LP: 'coaching_after_lp', LP_QUIZ_OFFER: 'lp_quiz_offer' },
}));
jest.mock('../../shared/services/nudges/teacher-nudges.sweeper', () => {
  const actual = jest.requireActual('../../shared/services/nudges/teacher-nudges.sweeper');
  return { ...actual, register: jest.fn() };
});
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

// Every read resolves to "a teacher, never coached": the role lookup and the
// coached-before lookup are the only queries onLessonDelivered makes.
function mockChain(result) {
  const q = {};
  for (const m of ['select', 'eq', 'neq', 'or', 'in', 'gte', 'lt', 'lte', 'order', 'limit']) q[m] = () => q;
  q.maybeSingle = async () => result.single;
  q.single = async () => result.single;
  q.then = (res, rej) => Promise.resolve({ data: result.list, error: null }).then(res, rej);
  return q;
}
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn((table) => (table === 'users'
    ? mockChain({ single: { data: { id: 'u1', role: 'teacher' }, error: null }, list: [] })
    : mockChain({ single: { data: null, error: null }, list: [] }))),
  rpc: jest.fn(),
}));

const Ask = require('../../shared/services/nudges/lp-coaching-ask.service');
const Offer = require('../../shared/services/nudges/lp-quiz-offer.service');
const Sweeper = require('../../shared/services/nudges/teacher-nudges.sweeper');

const ON = ['1', 'true', 'TRUE', ' yes '];
const OFF = [undefined, '', '0', 'false', 'no'];
const KEYS = ['TEACHER_NUDGES_ENABLED', 'LP_COACHING_ASK_ENABLED', 'LP_QUIZ_OFFER_ENABLED'];

function setFlag(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

// 09:00 PKT on a Tuesday — a morning lesson, before the offer's 15:00 send.
const MORNING = new Date('2026-09-22T04:00:00Z');

describe('the coaching ask switch (lp-coaching-ask.service)', () => {
  const saved = {};
  beforeAll(() => { for (const k of KEYS) saved[k] = process.env[k]; });
  afterAll(() => { for (const k of KEYS) setFlag(k, saved[k]); });
  beforeEach(() => mockSchedule.mockClear());

  it.each(ON)('%p schedules the ask for a delivered lesson', async (value) => {
    setFlag('LP_COACHING_ASK_ENABLED', value);
    const out = await Ask.onLessonDelivered({
      userId: 'u1', lessonId: 'grade_4_math_ch5_seg3', deliveredAt: MORNING.toISOString(),
    });
    expect(out.reason).not.toBe('disabled');
    expect(out.scheduled).toBe(true);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });

  it.each(OFF)('%p leaves the ask off and writes nothing', async (value) => {
    setFlag('LP_COACHING_ASK_ENABLED', value);
    const out = await Ask.onLessonDelivered({
      userId: 'u1', lessonId: 'grade_4_math_ch5_seg3', deliveredAt: MORNING.toISOString(),
    });
    expect(out).toEqual({ scheduled: false, reason: 'disabled' });
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});

describe('the afternoon offer switch (lp-quiz-offer.service)', () => {
  it.each(ON)('%p is on — a morning tick waits for the send time instead', async (value) => {
    setFlag('LP_QUIZ_OFFER_ENABLED', value);
    const out = await Offer.prepare({ now: MORNING });
    expect(out.reason).toBe('before_send_time');
  });

  it.each(OFF)('%p is off', async (value) => {
    setFlag('LP_QUIZ_OFFER_ENABLED', value);
    const out = await Offer.prepare({ now: MORNING });
    expect(out.reason).toBe('disabled');
  });
});

describe('one reading of "on" across the three switches', () => {
  it.each([...ON, ...OFF])('%p means the same to the sweeper, the ask and the offer', async (value) => {
    for (const k of KEYS) setFlag(k, value);
    const sweeperOn = Sweeper.isEnabled();
    const askOn = (await Ask.onLessonDelivered({
      userId: 'u1', lessonId: 'grade_4_math_ch5_seg3', deliveredAt: MORNING.toISOString(),
    })).reason !== 'disabled';
    const offerOn = (await Offer.prepare({ now: MORNING })).reason !== 'disabled';
    expect({ askOn, offerOn }).toEqual({ askOn: sweeperOn, offerOn: sweeperOn });
  });
});
