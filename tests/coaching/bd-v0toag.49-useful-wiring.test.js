'use strict';
/**
 * v10 coaching test (bd-v0toag.49): the "Was this useful?" survey is wired end to end on staging.
 * Without these the buttons would be sent and every tap silently lost (an unrouted prefix falls
 * through to generic text handling), or the reason would be eaten by intent detection.
 */
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

test('the report generator asks right after the voice debrief, never on a retry', () => {
  const src = read('bot/shared/services/coaching/report-generator.service.js');
  const voice = src.indexOf('await this.generateAndSendVoiceDebrief(session, from, coachingSessionId');
  const ask = src.indexOf('askIfInTest(');
  expect(voice).toBeGreaterThan(-1);
  expect(ask).toBeGreaterThan(voice);
  expect(src.slice(voice, ask)).not.toMatch(/commitment-card\.service/); // before the commitment card
  expect(src.slice(src.lastIndexOf('if (!isRetry)', voice), ask)).toContain('if (!isRetry)');
});

test('the bot routes coaching_fb_ taps to the survey', () => {
  const src = read('bot/whatsapp-bot.js');
  expect(src).toMatch(/buttonId\.startsWith\('coaching_fb_yes_'\) \|\| buttonId\.startsWith\('coaching_fb_no_'\)/);
  expect(src).toMatch(/coaching-feedback\.service'\)[\s\S]{0,200}handleFeedbackButton\(buttonId, from, \{ messageId: message\.id \}\)/);
});

test('the text handler reads the survey window before the LP survey and intent detection', () => {
  const src = read('bot/shared/handlers/text-message.handler.js');
  const coaching = src.indexOf('handlePendingReason(user.id, from, messageBody');
  const lp = src.indexOf('LpFeedbackService.consumeReasonIfPending(user.id');
  expect(coaching).toBeGreaterThan(-1);
  expect(coaching).toBeLessThan(lp);
});

describe('recordQualityMetrics: one row per session', () => {
  const writes = [];
  let existing = null;
  beforeAll(() => {
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: () => {
        const c = {
          select: () => c, eq: () => c,
          maybeSingle: async () => ({ data: existing, error: null }),
          update: (p) => { writes.push(['update', p]); return c; },
          insert: async (r) => { writes.push(['insert', r]); return { error: null }; },
          then: (ok, bad) => Promise.resolve({ error: null }).then(ok, bad),
        };
        return c;
      },
    }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
  });
  const session = { id: 's1', created_at: '2026-10-19T05:00:00Z', completed_at: '2026-10-19T05:05:00Z', total_cost: 0.1 };

  test('a row from an earlier survey tap is updated, never duplicated', async () => {
    existing = { id: 7 };
    writes.length = 0;
    const H = require('../../bot/shared/services/coaching/coaching-helpers.service');
    await H.recordQualityMetrics(session);
    expect(writes.map((w) => w[0])).toEqual(['update']);
    expect(writes[0][1]).not.toHaveProperty('user_satisfaction_rating');
  });

  test('no row yet: inserted as today', async () => {
    existing = null;
    writes.length = 0;
    const H = require('../../bot/shared/services/coaching/coaching-helpers.service');
    await H.recordQualityMetrics(session);
    expect(writes.map((w) => w[0])).toEqual(['insert']);
    expect(writes[0][1]).toEqual(expect.objectContaining({ coaching_session_id: 's1', processing_time_seconds: 300 }));
  });
});
