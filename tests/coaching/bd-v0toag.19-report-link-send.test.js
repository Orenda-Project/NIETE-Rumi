/**
 * v10 coaching test (bd-v0toag.19): groups C and D get the link to their report page.
 *
 * Right after the report image, one link button (cta_url) that opens /cr/<token>. A failed button
 * falls back to the link as text. A, B, an undrawn school, the switch off or no link: nothing is
 * sent. Never throws: a failed link never fails the report.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/coaching/ab-v10-switch', () => ({ v10Enabled: jest.fn() }));
jest.mock('../../bot/shared/services/coaching/ab-v10-arms', () => ({ groupFor: jest.fn() }));
jest.mock('../../bot/shared/services/coaching/report-link-token', () => ({ reportLinkUrl: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendCtaUrl: jest.fn(), sendMessage: jest.fn() }));

const { groupFor } = require('../../bot/shared/services/coaching/ab-v10-arms');
const { reportLinkUrl } = require('../../bot/shared/services/coaching/report-link-token');
const WA = require('../../bot/shared/services/whatsapp.service');
const { sendReportLinkIfNew } = require('../../bot/shared/services/coaching/report-link-send');

const SID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';
const URL = 'https://portal.example/cr/tok';
const arm = (group, report) => ({ group, plan: 'v9', report });

function tracker() {
  return { opts: jest.fn((part) => ({ part })), record: jest.fn() };
}
const call = (track, language = 'en') =>
  sendReportLinkIfNew({ coachingSessionId: SID, userId: UID, phone: '923000000000', language, track });

beforeEach(() => {
  jest.clearAllMocks();
  reportLinkUrl.mockReturnValue(URL);
  WA.sendCtaUrl.mockResolvedValue(true);
  WA.sendMessage.mockResolvedValue(true);
});

describe('sendReportLinkIfNew', () => {
  test.each(['C', 'D'])('group %s gets one link button to its report page', async (g) => {
    groupFor.mockResolvedValue(arm(g, 'new'));
    const track = tracker();
    expect(await call(track)).toBe(true);
    expect(reportLinkUrl).toHaveBeenCalledWith({ sessionId: SID, userId: UID });
    expect(WA.sendCtaUrl).toHaveBeenCalledTimes(1);
    const [to, o, opts] = WA.sendCtaUrl.mock.calls[0];
    expect(to).toBe('923000000000');
    expect(o.url).toBe(URL);
    expect(o.body).toBeTruthy();
    expect([...o.buttonText].length).toBeLessThanOrEqual(20);
    expect(opts).toEqual({ part: 'link' });
    expect(track.record).toHaveBeenCalledWith('link', true);
    expect(WA.sendMessage).not.toHaveBeenCalled();
  });

  test('Urdu teacher gets the Urdu button', async () => {
    groupFor.mockResolvedValue(arm('C', 'new'));
    await call(tracker(), 'ur');
    const o = WA.sendCtaUrl.mock.calls[0][1];
    expect(o.body).toMatch(/[؀-ۿ]/);
    expect([...o.buttonText].length).toBeLessThanOrEqual(20);
  });

  test('a failed button falls back to the link as text', async () => {
    groupFor.mockResolvedValue(arm('D', 'new'));
    WA.sendCtaUrl.mockResolvedValue(false);
    const track = tracker();
    expect(await call(track)).toBe(true);
    expect(WA.sendMessage).toHaveBeenCalledWith('923000000000', expect.stringContaining(URL));
    expect(track.record).toHaveBeenCalledWith('link', true);
  });

  test('both sends failing is logged as failed, never thrown', async () => {
    groupFor.mockResolvedValue(arm('C', 'new'));
    WA.sendCtaUrl.mockRejectedValue(new Error('meta down'));
    WA.sendMessage.mockResolvedValue(false);
    const track = tracker();
    expect(await call(track)).toBe(false);
    expect(track.record).toHaveBeenCalledWith('link', false, expect.any(Error));
  });

  test.each([
    ['group A', arm('A', 'today')],
    ['group B', arm('B', 'today')],
    ['school not drawn or switch off', null],
  ])('%s: nothing is sent', async (_, g) => {
    groupFor.mockResolvedValue(g);
    const track = tracker();
    expect(await call(track)).toBe(false);
    expect(WA.sendCtaUrl).not.toHaveBeenCalled();
    expect(WA.sendMessage).not.toHaveBeenCalled();
    expect(track.record).not.toHaveBeenCalled();
  });

  test('no link (PORTAL_URL or key missing): nothing is sent', async () => {
    groupFor.mockResolvedValue(arm('C', 'new'));
    reportLinkUrl.mockReturnValue(null);
    expect(await call(tracker())).toBe(false);
    expect(WA.sendCtaUrl).not.toHaveBeenCalled();
    expect(WA.sendMessage).not.toHaveBeenCalled();
  });

  test('works without a tracker', async () => {
    groupFor.mockResolvedValue(arm('C', 'new'));
    expect(await call(undefined)).toBe(true);
  });
});

describe('wiring', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../..', 'bot/shared/services/coaching/report-generator.service.js'), 'utf8');

  test('the link goes right after the report image and before the voice note', () => {
    const image = src.indexOf("await track.record('image', true);");
    const link = src.indexOf('sendReportLinkIfNew(');
    const voice = src.indexOf('await this.generateAndSendVoiceDebrief(session, from, coachingSessionId');
    expect(image).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(image);
    expect(voice).toBeGreaterThan(link);
  });
});
