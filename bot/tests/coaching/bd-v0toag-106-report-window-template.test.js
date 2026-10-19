/**
 * bd-v0toag.106 — a coaching report sent more than 24 h after the teacher's last message never reaches her.
 *
 * The hero report goes out free-form (WhatsAppService.sendImage). Past Meta's 24 h window Meta takes the send,
 * then refuses it with 131047 in an asynchronous status receipt, so the bot logs `coaching.report.sent` and the
 * teacher gets nothing (two app-recording teachers, 19 Oct 2026).
 *
 * The fix: when her window is closed, the report image goes out as the approved `share_dc_report_v1` template
 * (sendShare kind 'dc' — IMAGE header, no 24 h limit). The voice debrief and the survey are free-form and would be
 * refused too, so they are not sent on that path. An open window, or a template that cannot go, keeps today's send.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendImage: jest.fn(() => Promise.resolve(true)),
  sendMessage: jest.fn(() => Promise.resolve({})),
}));
jest.mock('../../shared/services/coaching/report-window-send', () => {
  const actual = jest.requireActual('../../shared/services/coaching/report-window-send');
  return { ...actual, sendReportByTemplateIfWindowClosed: jest.fn() };
});

const { sendReportByTemplateIfWindowClosed: realSend, followUpsAllowed } =
  jest.requireActual('../../shared/services/coaching/report-window-send');
const windowSend = require('../../shared/services/coaching/report-window-send');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const ReportGenerator = require('../../shared/services/coaching/report-generator.service');

const req = { phone: '920000000000', userId: 'u1', sessionId: 's1' };

describe('sendReportByTemplateIfWindowClosed', () => {
  test('window open → no template, today\'s free-form send goes', async () => {
    const sendShare = jest.fn();
    const out = await realSend(req, { windowOpen: async () => true, sendShare });
    expect(out).toBeNull();
    expect(sendShare).not.toHaveBeenCalled();
  });

  test('window closed → the report goes as the dc share template', async () => {
    const sendShare = jest.fn(async () => ({ status: 'sent', at: 'x' }));
    const out = await realSend(req, { windowOpen: async () => false, sendShare });
    expect(out).toBe('template');
    expect(sendShare).toHaveBeenCalledWith({ userId: 'u1', kind: 'dc', id: 's1' });
  });

  test.each([
    [{ status: 'unavailable', reason: 'not_configured' }],
    [{ status: 'failed', reason: 'refused' }],
    [{ status: 'not_found' }],
  ])('window closed but the template cannot go (%o) → falls back to today\'s send', async (answer) => {
    const out = await realSend(req, { windowOpen: async () => false, sendShare: async () => answer });
    expect(out).toBeNull();
  });

  test('a throw anywhere falls back to today\'s send, never throws', async () => {
    const out = await realSend(req, { windowOpen: async () => { throw new Error('db'); }, sendShare: jest.fn() });
    expect(out).toBeNull();
  });

  test('no user id → no template attempt', async () => {
    const sendShare = jest.fn();
    expect(await realSend({ ...req, userId: null }, { windowOpen: async () => false, sendShare })).toBeNull();
    expect(sendShare).not.toHaveBeenCalled();
  });
});

describe('followUpsAllowed', () => {
  test('voice debrief + survey are skipped only when the report went as a template', () => {
    expect(followUpsAllowed('template')).toBe(false);
    expect(followUpsAllowed(true)).toBe(true);
    expect(followUpsAllowed(false)).toBe(true);
  });
});

describe('ReportGenerator.sendHeroImageReport', () => {
  beforeEach(() => jest.clearAllMocks());

  test('window closed → template sent, no free-form image', async () => {
    windowSend.sendReportByTemplateIfWindowClosed.mockResolvedValue('template');
    const out = await ReportGenerator.sendHeroImageReport('920000000000', 's1', Buffer.from('png'), 'cap', 'T', null, { userId: 'u1' });
    expect(out).toBe('template');
    expect(windowSend.sendReportByTemplateIfWindowClosed).toHaveBeenCalledWith({ phone: '920000000000', userId: 'u1', sessionId: 's1' });
    expect(WhatsAppService.sendImage).not.toHaveBeenCalled();
  });

  test('window open → the free-form image goes exactly as before', async () => {
    windowSend.sendReportByTemplateIfWindowClosed.mockResolvedValue(null);
    const out = await ReportGenerator.sendHeroImageReport('920000000000', 's1', Buffer.from('png'), 'cap', 'T', null, { userId: 'u1' });
    expect(out).not.toBe('template');
    expect(WhatsAppService.sendImage).toHaveBeenCalledTimes(1);
  });
});
