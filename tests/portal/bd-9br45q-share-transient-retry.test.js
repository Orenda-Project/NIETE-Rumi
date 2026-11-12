'use strict';
/**
 * bd-9br45q — "Send on WhatsApp" from the portal gave up on Meta's transient refusals. Prod, 14 days to 12 Nov 2026:
 * 5 lesson_plan.delivery.failed via NIETE_PORTAL_SHARE, every one transient — code 2 "Service temporarily unavailable"
 * (is_transient=true; the same teacher failed twice in a row) and 131000 "Something went wrong".
 *
 * Rule: ONE more try, after a short wait, only when Meta's code is transient (2, 131000). Any other refusal is the real
 * answer the first time (one send, no wait). A second transient refusal stays `failed` with Meta's code.
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: () => { throw new Error('no db in this test'); } }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendTemplate: jest.fn() }));
jest.mock('../../bot/shared/services/assessment/assessment-browse.service', () => ({ listChapters: jest.fn(async () => []) }));

const Share = require('../../bot/shared/services/share-send.service');

const USER = { id: 'u1', phone_number: '923001112222', preferred_language: 'en' };
const PAPER = {
  kind: 'paper', itemRef: 'paper:r1', title: 'Plants and food', chapter: 3, grade: 4, subject: 'Science', questions: 15, pdfUrl: 'https://r2.example/p.pdf',
};

/** `answers` = what Meta says on each send, in order: true (accepted) or a { code, message } refusal. */
function deps(answers) {
  const sends = [];
  const waits = [];
  return {
    sends,
    waits,
    templateName: () => 'share_paper_v1',
    user: async () => USER,
    item: async () => PAPER,
    now: () => new Date('2026-11-12T10:00:00Z'),
    wait: async (ms) => { waits.push(ms); },
    sendTemplate: async (to, name, lang, components, opts) => {
      const a = answers[sends.length];
      sends.push(name);
      if (a === true) return true;
      Object.assign(opts.report, a);
      return false;
    },
  };
}
const send = (d) => Share.sendShare({ userId: 'u1', kind: 'paper', id: 'r1' }, d);

describe('bd-9br45q: one retry on a transient Meta refusal', () => {
  test.each([
    [2, 'Service temporarily unavailable'],
    [131000, 'Something went wrong'],
  ])('code %s then accepted → sent, after one wait', async (code, message) => {
    const d = deps([{ code, message }, true]);
    const out = await send(d);
    expect(out).toEqual({ status: 'sent', at: '2026-11-12T10:00:00.000Z' });
    expect(d.sends).toHaveLength(2);
    expect(d.waits).toHaveLength(1);
    expect(d.waits[0]).toBeGreaterThan(0);
  });

  test('transient twice → failed with the second code, never a third send', async () => {
    const d = deps([{ code: 2, message: 'Service temporarily unavailable' }, { code: 131000, message: 'Something went wrong' }, true]);
    const out = await send(d);
    expect(out).toEqual({ status: 'failed', reason: 'refused', code: 131000, message: 'Something went wrong' });
    expect(d.sends).toHaveLength(2);
  });

  test('a non-transient refusal is the answer: one send, no wait', async () => {
    const d = deps([{ code: 131026, message: 'Message undeliverable' }, true]);
    const out = await send(d);
    expect(out).toEqual({ status: 'failed', reason: 'refused', code: 131026, message: 'Message undeliverable' });
    expect(d.sends).toHaveLength(1);
    expect(d.waits).toHaveLength(0);
  });

  test('template gone is still unavailable, not retried', async () => {
    const d = deps([{ code: Share.TEMPLATE_GONE[0], message: 'gone' }, true]);
    const out = await send(d);
    expect(out).toEqual({ status: 'unavailable', reason: 'template_missing' });
    expect(d.sends).toHaveLength(1);
  });

  test('accepted first time: one send, no wait', async () => {
    const d = deps([true]);
    expect((await send(d)).status).toBe('sent');
    expect(d.sends).toHaveLength(1);
    expect(d.waits).toHaveLength(0);
  });

  test('TRANSIENT codes are exported as exactly 2 and 131000', () => {
    expect(Share.TRANSIENT).toEqual([2, 131000]);
  });
});
