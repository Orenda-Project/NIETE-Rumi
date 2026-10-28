'use strict';
/**
 * bd-v0toag.127 — `coaching.report.template_not_sent` says only `{status:'failed', reason:'refused'}`, so a refused
 * report template cannot be told apart in the logs (131047? 132001? a bad parameter?). Meta's own error code and
 * message now travel sendTemplate → sendShare → the log line.
 */

jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('axios', () => ({ post: jest.fn() }));

const axios = require('axios');
const { logEvent } = require('../../shared/utils/structured-logger');
const { sendReportByTemplateIfWindowClosed } = require('../../shared/services/coaching/report-window-send');
const Share = require('../../shared/services/share-send.service');

const req = { phone: '920000000000', userId: 'u1', sessionId: 's1' };

beforeEach(() => jest.clearAllMocks());

describe('template_not_sent carries Meta\'s code and message', () => {
  test('refused → code and message on the log line', async () => {
    const sendShare = async () => ({ status: 'failed', reason: 'refused', code: 131026, message: 'Message undeliverable' });
    expect(await sendReportByTemplateIfWindowClosed(req, { windowOpen: async () => false, sendShare })).toBeNull();
    expect(logEvent).toHaveBeenCalledWith('coaching.report.template_not_sent', {
      userId: 'u1', sessionId: 's1', status: 'failed', reason: 'refused', code: 131026, message: 'Message undeliverable',
    });
  });

  test('no code from Meta (not configured) → code and message are null', async () => {
    const sendShare = async () => ({ status: 'unavailable', reason: 'not_configured' });
    await sendReportByTemplateIfWindowClosed(req, { windowOpen: async () => false, sendShare });
    expect(logEvent).toHaveBeenCalledWith('coaching.report.template_not_sent', {
      userId: 'u1', sessionId: 's1', status: 'unavailable', reason: 'not_configured', code: null, message: null,
    });
  });
});

describe('sendShare passes Meta\'s refusal through', () => {
  const deps = (sendTemplate) => ({
    templateName: () => 'share_dc_report_v1',
    user: async () => ({ id: 'u1', phone_number: '920000000000', preferred_language: 'en' }),
    item: async () => ({ kind: 'dc', itemRef: 'report:s1', title: 'T', grade: 4, subject: 'Science', imageUrl: 'https://r2.example/r.png' }),
    now: () => new Date('2026-10-28T10:00:00Z'),
    sendTemplate,
  });

  test('refused → code and message in the result', async () => {
    const d = deps(async (a, b, c, e, opts) => { opts.report.code = 131026; opts.report.message = 'Message undeliverable'; return false; });
    expect(await Share.sendShare({ userId: 'u1', kind: 'dc', id: 's1' }, d))
      .toEqual({ status: 'failed', reason: 'refused', code: 131026, message: 'Message undeliverable' });
  });

  test('a throw stays { failed, error }, nothing internal in the result', async () => {
    const d = deps(async () => { throw new Error('boom'); });
    expect(await Share.sendShare({ userId: 'u1', kind: 'dc', id: 's1' }, d)).toEqual({ status: 'failed', reason: 'error' });
  });
});

describe('WhatsAppService.sendTemplate reports Meta\'s message next to its code', () => {
  test('Meta refusal → report.code and report.message', async () => {
    axios.post.mockRejectedValue({ message: 'Request failed', response: { data: { error: { code: 131026, message: 'Message undeliverable' } } } });
    const WhatsAppService = require('../../shared/services/whatsapp.service');
    const report = {};
    expect(await WhatsAppService.sendTemplate('920000000000', 'share_dc_report_v1', 'en', [], { report })).toBe(false);
    expect(report).toEqual({ code: 131026, message: 'Message undeliverable' });
  });

  test('no error body → both null', async () => {
    axios.post.mockRejectedValue({ message: 'socket hang up' });
    const WhatsAppService = require('../../shared/services/whatsapp.service');
    const report = {};
    await WhatsAppService.sendTemplate('920000000000', 'share_dc_report_v1', 'en', [], { report });
    expect(report).toEqual({ code: null, message: null });
  });
});
