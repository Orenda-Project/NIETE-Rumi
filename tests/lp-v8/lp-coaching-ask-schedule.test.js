'use strict';
/**
 * 4.1 — the coaching ask is scheduled off the lesson the teacher
 * was actually sent.
 *
 * The REAL `deliverV8Lesson` runs in every case below: WhatsApp, Supabase, R2
 * and the survey are mocked at the network boundary and nothing else is. A
 * suite that mocked the delivery service would prove the hook exists in a file
 * and not that it runs on the path a teacher walks.
 *
 * The three times are the whole rule: a morning lesson brings the ask
 * the same day, an afternoon one waits for the next school day at 07:30, and a
 * Friday afternoon one waits for Monday. The second download of the same day
 * schedules the same (user, date, kind) so the table's UNIQUE collapses it —
 * "the first lesson plan of the day" is a constraint, never a count.
 */

// The store is IO — always a mock. It answers `created:true` unless a test says
// otherwise, which is what the real INSERT does for a first row of the day.
// The paths are literals because `jest.mock` is hoisted above every const.
jest.mock('../../bot/shared/services/nudges/teacher-nudges.store', () => ({
  schedule: jest.fn(async ({ userId, kind, nudgeDate }) => ({
    row: { id: 'nudge-1', user_id: userId, kind, nudge_date: nudgeDate, status: 'pending' },
    created: true,
  })),
  rowsFor: jest.fn(async () => []),
  todayRow: jest.fn(async () => null),
  KINDS: { COACHING_AFTER_LP: 'coaching_after_lp', LP_QUIZ_OFFER: 'lp_quiz_offer' },
}));

// pkt-time is PURE and runs for real.

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocumentByLink: jest.fn().mockResolvedValue({ messages: [{ id: 'wamid.1' }] }),
  sendVoicenoteFromR2Key: jest.fn().mockResolvedValue(false),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendVideoWithButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: (k) => `https://r2.invalid/${k}`,
  getPresignedUrl: jest.fn(async (u) => `${u}?signed`),
}));
jest.mock('../../bot/shared/services/lp-feedback.service', () => ({
  scheduleFeedbackPrompt: jest.fn(),
}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({
  pushToShelf: jest.fn().mockResolvedValue(true),
  flushShelf: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/lp-delivery-marker.service', () => ({
  recordDeliveryMarker: jest.fn().mockResolvedValue(true),
}), { virtual: true });
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));
jest.mock('../../bot/shared/services/lp-v8-catalog.service', () => ({ lessonById: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const { installFrom } = require('../quiz/helpers/supabase-chain');
const Store = require('../../bot/shared/services/nudges/teacher-nudges.store');
const V8Catalog = require('../../bot/shared/services/lp-v8-catalog.service');

const USER = '11111111-1111-4111-8111-111111111111';
const LESSON = 'g3_eng_ch2_seg1';

function catalogHit({ lpType = 'lesson' } = {}) {
  return {
    lesson: {
      segment_index: 1, day_label: 'Day 1', topic: 'Naming words', topic_short: 'Naming words',
      pages: '12-14', pages_label: 'pp. 12-14', section: 'A', lp_type: lpType,
      row: { title: 'Naming words' },
    },
    chapter: { number: 2, title: 'Words around us' },
    book: { grade: 3, subject: 'English', subject_key: 'english' },
  };
}

/** Tables the real deliverV8Lesson touches, with the answer key present or not. */
function installTables({ withAnswerKey = false } = {}) {
  installFrom(supabase.from, {
    users: { data: [{ id: USER, phone_number: '923001234567', preferred_language: 'en' }], error: null },
    niete_lp_assets: (calls) => {
      const kind = (calls.find((c) => c[0] === 'eq' && c[1] === 'asset_kind') || [])[2];
      if (kind === 'answer_key') {
        return withAnswerKey
          ? { data: [{ id: 'asset-key', lesson_id: LESSON, asset_kind: 'answer_key', r2_key: `${LESSON}_key.pdf`, content_hash: 'khash', version_stamp: 'v8.1', is_current: true }], error: null }
          : { data: null, error: null };
      }
      return { data: [{ id: 'asset-lesson', lesson_id: LESSON, asset_kind: 'lesson', r2_key: `${LESSON}.pdf`, content_hash: 'chash', version_stamp: 'v8.1', is_current: true }], error: null };
    },
    niete_lp_downloads: { data: null, error: null },
    lesson_plans: { data: [{ id: 'lp-row-1' }], error: null },
    coaching_sessions: { data: [], error: null },
  });
}

/** Fake the clock at a PKT wall time, expressed as the UTC instant it is. */
function atPktUtc(dateStr, hh, mm) {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + ((hh * 60 + mm) - 300) * 60000);
}

async function deliverAt(when, opts = {}) {
  jest.setSystemTime(when);
  const { deliverV8Lesson } = require('../../bot/shared/services/lp-v8-delivery.service');
  return deliverV8Lesson({ userId: USER, lessonId: LESSON, ...opts });
}

describe('deliverV8Lesson schedules the coaching ask', () => {
  beforeEach(() => {
    // Deliberately NO jest.resetModules(): a reset re-runs the mock factories,
    // so the service under test would hold a different `supabase.from` than the
    // one configured here and every delivery would fail for the wrong reason.
    jest.clearAllMocks();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'performance'] });
    process.env.LP_COACHING_ASK_ENABLED = 'true';
    delete process.env.LP_COACHING_ASK_DELAY_MINUTES;
    V8Catalog.lessonById.mockReturnValue(catalogHit());
    installTables();
  });
  afterEach(() => {
    jest.useRealTimers();
    delete process.env.LP_COACHING_ASK_ENABLED;
    delete process.env.LP_COACHING_ASK_DELAY_MINUTES;
  });

  test('a 10:00 PKT lesson books the ask at 10:00 + the delay, same PKT day', async () => {
    // Tue 22 Sep 2026, 10:00 PKT.
    const res = await deliverAt(atPktUtc('2026-09-22', 10, 0));
    expect(res.ok).toBe(true);
    expect(Store.schedule).toHaveBeenCalledTimes(1);
    const arg = Store.schedule.mock.calls[0][0];
    expect(arg.kind).toBe('coaching_after_lp');
    expect(arg.userId).toBe(USER);
    expect(arg.nudgeDate).toBe('2026-09-22');
    expect(new Date(arg.scheduledAt).toISOString()).toBe(atPktUtc('2026-09-22', 10, 10).toISOString());
    // Red-team #29: never inside the 30-second survey's window.
    expect(new Date(arg.scheduledAt).getTime() - atPktUtc('2026-09-22', 10, 0).getTime())
      .toBeGreaterThanOrEqual(10 * 60 * 1000);
  });

  test('a 15:10 PKT lesson books 07:30 the next school day', async () => {
    await deliverAt(atPktUtc('2026-09-22', 15, 10));           // Tuesday
    const arg = Store.schedule.mock.calls[0][0];
    expect(arg.nudgeDate).toBe('2026-09-23');
    expect(new Date(arg.scheduledAt).toISOString()).toBe(atPktUtc('2026-09-23', 7, 30).toISOString());
  });

  test('a Friday 15:10 PKT lesson books Monday 07:30', async () => {
    await deliverAt(atPktUtc('2026-09-25', 15, 10));           // Friday
    const arg = Store.schedule.mock.calls[0][0];
    expect(arg.nudgeDate).toBe('2026-09-28');                  // Monday
    expect(new Date(arg.scheduledAt).toISOString()).toBe(atPktUtc('2026-09-28', 7, 30).toISOString());
  });

  test('a 21:30 PKT lesson books 07:30 the next school day, never at night', async () => {
    await deliverAt(atPktUtc('2026-09-22', 21, 30));
    const arg = Store.schedule.mock.calls[0][0];
    expect(new Date(arg.scheduledAt).toISOString()).toBe(atPktUtc('2026-09-23', 7, 30).toISOString());
  });

  test('the second lesson of the same day schedules the same key — the UNIQUE collapses it', async () => {
    await deliverAt(atPktUtc('2026-09-22', 9, 0));
    Store.schedule.mockResolvedValueOnce({ row: { id: 'nudge-1' }, created: false });
    const res = await deliverAt(atPktUtc('2026-09-22', 11, 30));
    expect(res.ok).toBe(true);                                  // the PDF still lands
    const [first, second] = Store.schedule.mock.calls.map((c) => c[0]);
    expect(second.nudgeDate).toBe(first.nudgeDate);
    expect(second.userId).toBe(first.userId);
    expect(second.kind).toBe(first.kind);
  });

  test('the flag unset schedules nothing at all', async () => {
    delete process.env.LP_COACHING_ASK_ENABLED;
    const res = await deliverAt(atPktUtc('2026-09-22', 10, 0));
    expect(res.ok).toBe(true);
    expect(Store.schedule).not.toHaveBeenCalled();
  });

  test('an assessment that also ships an answer key still books exactly one ask, for the lesson', async () => {
    V8Catalog.lessonById.mockReturnValue(catalogHit({ lpType: 'assessment' }));
    installTables({ withAnswerKey: true });
    await deliverAt(atPktUtc('2026-09-22', 10, 0));
    expect(Store.schedule).toHaveBeenCalledTimes(1);
    expect(Store.schedule.mock.calls[0][0].context.asset_id).toBe('asset-lesson');
  });

  test('a failed send books no ask — there is no lesson to have planned', async () => {
    const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
    WhatsAppService.sendDocumentByLink.mockResolvedValueOnce(null);
    const res = await deliverAt(atPktUtc('2026-09-22', 10, 0));
    expect(res.ok).toBe(false);
    expect(Store.schedule).not.toHaveBeenCalled();
  });

  test('a store that throws never costs the teacher the lesson plan', async () => {
    Store.schedule.mockRejectedValueOnce(new Error('teacher_nudges is not on this database'));
    const res = await deliverAt(atPktUtc('2026-09-22', 10, 0));
    expect(res.ok).toBe(true);
  });
});
