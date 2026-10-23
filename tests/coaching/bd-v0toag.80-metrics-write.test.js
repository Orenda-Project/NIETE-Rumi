'use strict';
/**
 * bd-v0toag.80: the "Do you agree?" thumb and reason land on coaching_quality_metrics. A session that already
 * has two rows made .maybeSingle() return an error with no data, so both writers inserted a third row; and
 * supabase reports update/insert failures as { error }, never a throw, so a failed write was silent.
 * The fake db behaves as PostgREST does: maybeSingle on several rows → error, limit() → the rows.
 */
const S = '11111111-2222-3333-4444-555555555555';
const U = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function fakeDb({ metricsRows = 0, updateError = null, insertError = null } = {}) {
  const writes = [];
  const rows = Array.from({ length: metricsRows }, (_, i) => ({ id: `m${i}` }));
  const from = (t) => {
    const c = {
      select: () => c,
      eq: () => c,
      limit: async (n) => ({ data: t === 'coaching_quality_metrics' ? rows.slice(0, n) : [], error: null }),
      maybeSingle: async () => {
        if (t === 'coaching_quality_metrics') {
          return rows.length > 1
            ? { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } }
            : { data: rows[0] || null, error: null };
        }
        if (t === 'coaching_sessions') return { data: { id: S, user_id: U }, error: null };
        if (t === 'users') return { data: { preferred_language: 'en' }, error: null };
        return { data: null, error: null };
      },
      update: (patch) => { writes.push(['update', patch]); return { eq: async () => ({ error: updateError }) }; },
      insert: async (row) => { writes.push(['insert', row]); return { error: insertError }; },
    };
    return c;
  };
  return { from, writes };
}

describe('bot: the WhatsApp thumb (A/B)', () => {
  let db;
  let logToFile;
  let svc;
  const load = (opts) => {
    jest.resetModules();
    db = fakeDb(opts);
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: (t) => db.from(t) }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendInteractiveButtons: jest.fn(async () => true), sendMessage: jest.fn(async () => true), sendReaction: jest.fn(async () => true),
    }));
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({ set: jest.fn(), get: jest.fn(), delete: jest.fn() }));
    logToFile = jest.fn();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile, logError: jest.fn() }));
    jest.doMock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
    jest.doMock('../../bot/shared/services/coaching/ab-v10-arms', () => ({ groupFor: jest.fn(async () => ({ group: 'A', report: 'today' })) }));
    jest.doMock('../../bot/shared/services/quiz/transcript-quiz-offer.service', () => ({ triggerEarly: jest.fn(async () => true) }));
    svc = require('../../bot/shared/services/coaching/coaching-feedback.service');
  };

  test('a session with two metrics rows is updated, never given a third', async () => {
    load({ metricsRows: 2 });
    await svc.handleFeedbackButton(`coaching_fb_yes_${S}`, '923000000000');
    expect(db.writes).toEqual([['update', { user_satisfaction_rating: 1 }]]);
  });

  test('a session with no row gets exactly one insert', async () => {
    load({ metricsRows: 0 });
    await svc.handleFeedbackButton(`coaching_fb_no_${S}`, '923000000000');
    expect(db.writes).toEqual([['insert', expect.objectContaining({ coaching_session_id: S, user_satisfaction_rating: 0 })]]);
  });

  test.each([
    ['update', { metricsRows: 1, updateError: { message: 'permission denied' } }],
    ['insert', { metricsRows: 0, insertError: { message: 'violates check constraint' } }],
  ])('a failed %s is logged with the supabase message, not dropped', async (_, opts) => {
    load(opts);
    await svc.handleFeedbackButton(`coaching_fb_yes_${S}`, '923000000000');
    const msg = (opts.updateError || opts.insertError).message;
    expect(logToFile).toHaveBeenCalledWith('Coaching Feedback: metrics write failed', expect.objectContaining({ coachingSessionId: S, error: msg }));
  });
});

describe('dashboard: the report page thumb and reason (C/D)', () => {
  const { recordUseful } = require('../../dashboard/services/coaching-useful');

  test('a session with two metrics rows is updated, never given a third', async () => {
    const db = fakeDb({ metricsRows: 2 });
    expect(await recordUseful(db, { sessionId: S, userId: U, useful: false })).toBe(true);
    expect(db.writes).toEqual([['update', { user_satisfaction_rating: 0 }]]);
  });

  test('a session with no row gets exactly one insert', async () => {
    const db = fakeDb({ metricsRows: 0 });
    expect(await recordUseful(db, { sessionId: S, userId: U, reason: 'too long' })).toBe(true);
    expect(db.writes).toEqual([['insert', expect.objectContaining({ coaching_session_id: S, user_feedback: 'too long' })]]);
  });

  test('a failed update returns false', async () => {
    const db = fakeDb({ metricsRows: 1, updateError: { message: 'permission denied' } });
    expect(await recordUseful(db, { sessionId: S, userId: U, useful: true })).toBe(false);
  });
});
