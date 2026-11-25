/**
 * bd-chz35n.25 — the coaching report delivery fixes from the 25 Nov report-opens trace, built OFF.
 *
 * One switch, app_settings.report_delivery_fixes (report-delivery-switch.js). No row = everything as today.
 *   template_link  "<approved template name>"  window closed → the report template carries an "Open my report" URL button
 *   tip_wording    true                         the link message names the report's one thing to try
 *   time_on_page   true                         the report page records how long it was open (route test in tests/portal)
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/coaching/ab-v10-arms', () => ({ groupFor: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendCtaUrl: jest.fn(), sendMessage: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { groupFor } = require('../../bot/shared/services/coaching/ab-v10-arms');
const WA = require('../../bot/shared/services/whatsapp.service');
const Switch = require('../../bot/shared/services/coaching/report-delivery-switch');
const { linkButtonFor } = require('../../bot/shared/services/coaching/report-link-button');
const { sendReportByTemplateIfWindowClosed } = require('../../bot/shared/services/coaching/report-window-send');
const { sendReportLinkIfNew } = require('../../bot/shared/services/coaching/report-link-send');

const SID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';
const ENV = { ...process.env };

/** app_settings answers `setting` (undefined = no row); coaching_sessions answers `action`. */
function db({ setting, action, settingsError } = {}) {
  supabase.from.mockImplementation((table) => {
    const q = {};
    ['select', 'eq', 'limit'].forEach((m) => { q[m] = jest.fn(() => q); });
    if (table === 'app_settings') {
      q.then = (res, rej) => Promise.resolve(settingsError ? { data: null, error: { message: 'down' } }
        : { data: setting === undefined ? [] : [{ key: Switch.KEY, value: setting }], error: null }).then(res, rej);
    }
    q.maybeSingle = jest.fn(async () => ({ data: action === undefined ? null : { prioritized_action: action }, error: null }));
    return q;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  Switch._resetCache();
  process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co', PORTAL_URL: 'https://portal.example' };
  groupFor.mockResolvedValue({ group: 'C', plan: 'v9', report: 'new' });
  WA.sendCtaUrl.mockResolvedValue(true);
  WA.sendMessage.mockResolvedValue(true);
});
afterAll(() => { process.env = ENV; });

describe('the switch', () => {
  test.each([
    [undefined], [null], ['garbage'], [42], [{}], [{ template_link: '', tip_wording: 'yes', time_on_page: 1 }],
  ])('%o → everything off', (value) => {
    expect(Switch.parse(value)).toEqual({ linkTemplate: null, tipWording: false, timeOnPage: false });
  });

  test('each part reads on its own; a JSON string is read too', () => {
    expect(Switch.parse({ template_link: ' share_dc_report_link_v1 ' })).toEqual({ linkTemplate: 'share_dc_report_link_v1', tipWording: false, timeOnPage: false });
    expect(Switch.parse('{"tip_wording":true,"time_on_page":"true"}')).toEqual({ linkTemplate: null, tipWording: true, timeOnPage: true });
  });

  test('no row, or a failed read → off', async () => {
    db();
    expect(await Switch.current()).toEqual({ linkTemplate: null, tipWording: false, timeOnPage: false });
    Switch._resetCache();
    db({ settingsError: true });
    expect(await Switch.current()).toEqual({ linkTemplate: null, tipWording: false, timeOnPage: false });
  });

  test('a settings read that never answers → off within the bound, so the report is never held up', async () => {
    supabase.from.mockImplementation(() => {
      const q = {};
      ['select', 'eq'].forEach((m) => { q[m] = jest.fn(() => q); });
      q.then = () => new Promise(() => {}); // never settles
      return q;
    });
    const t0 = Date.now();
    expect(await Switch.current(Date.now(), { timeoutMs: 50 })).toEqual({ linkTemplate: null, tipWording: false, timeOnPage: false });
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('(1) the report button on the closed-window template', () => {
  test('switch off → no button, and the closed-window send is exactly today\'s', async () => {
    db();
    expect(await linkButtonFor({ userId: UID, sessionId: SID })).toBeNull();
    const sendShare = jest.fn(async () => ({ status: 'sent' }));
    const out = await sendReportByTemplateIfWindowClosed({ phone: '92300', userId: UID, sessionId: SID },
      { windowOpen: async () => false, sendShare, quizButton: async () => null });
    expect(out).toBe('template');
    expect(sendShare).toHaveBeenCalledTimes(1);
    expect(sendShare).toHaveBeenCalledWith({ userId: UID, kind: 'dc', id: SID });
  });

  test('switch on, new-report teacher → the named template with her /cr token as the button', async () => {
    db({ setting: { template_link: 'share_dc_report_link_v1' } });
    const b = await linkButtonFor({ userId: UID, sessionId: SID });
    expect(b.template).toBe('share_dc_report_link_v1');
    const { verifyReportLink } = require('../../bot/shared/services/coaching/report-link-token');
    expect(verifyReportLink(b.token)).toEqual({ ok: true, sessionId: SID, userId: UID });

    const sendShare = jest.fn(async () => ({ status: 'sent' }));
    const out = await sendReportByTemplateIfWindowClosed({ phone: '92300', userId: UID, sessionId: SID },
      { windowOpen: async () => false, sendShare, quizButton: async () => { throw new Error('not asked'); } });
    expect(out).toBe('template');
    expect(sendShare).toHaveBeenCalledTimes(1);
    expect(sendShare).toHaveBeenCalledWith({ userId: UID, kind: 'dc', id: SID, clip: { template: 'share_dc_report_link_v1', token: b.token } });
    expect(logEvent).toHaveBeenCalledWith('coaching.report.link_template_sent', expect.objectContaining({ sessionId: SID }));
  });

  test('switch on but the button template is refused → today\'s plain template', async () => {
    db({ setting: { template_link: 'share_dc_report_link_v1' } });
    const sendShare = jest.fn(async (r) => (r.clip ? { status: 'failed', reason: 'refused', code: 132001 } : { status: 'sent' }));
    const out = await sendReportByTemplateIfWindowClosed({ phone: '92300', userId: UID, sessionId: SID },
      { windowOpen: async () => false, sendShare, quizButton: async () => null });
    expect(out).toBe('template');
    expect(sendShare).toHaveBeenLastCalledWith({ userId: UID, kind: 'dc', id: SID });
    expect(logEvent).toHaveBeenCalledWith('coaching.report.link_template_not_sent', expect.objectContaining({ code: 132001 }));
  });

  test.each([[null], [{ group: 'A', report: 'old' }]])('switch on, teacher %o without the new report → no button', async (g) => {
    db({ setting: { template_link: 'share_dc_report_link_v1' } });
    groupFor.mockResolvedValue(g);
    expect(await linkButtonFor({ userId: UID, sessionId: SID })).toBeNull();
  });

  test('window open → nothing asked, nothing sent', async () => {
    db({ setting: { template_link: 'share_dc_report_link_v1' } });
    const sendShare = jest.fn();
    expect(await sendReportByTemplateIfWindowClosed({ phone: '92300', userId: UID, sessionId: SID },
      { windowOpen: async () => true, sendShare })).toBeNull();
    expect(sendShare).not.toHaveBeenCalled();
  });
});

describe('(2) link wording that names the one thing to try', () => {
  const TIP = { action: 'x', thing_to_try: { text: 'Ask two children by name.', tag: 'C9' } };
  const send = (language = 'en') => sendReportLinkIfNew({ coachingSessionId: SID, userId: UID, phone: '92300', language });

  test('switch off → today\'s wording, byte for byte', async () => {
    db({ action: TIP });
    await send();
    expect(WA.sendCtaUrl.mock.calls[0][1].body)
      .toBe('Your full report: what went well, your one thing to try next class, and your marks.');
  });

  test('switch on → the wording names her one thing to try', async () => {
    db({ setting: { tip_wording: true }, action: TIP });
    await send();
    const body = WA.sendCtaUrl.mock.calls[0][1].body;
    expect(body).toContain('Ask two children by name.');
    expect(body).not.toBe('Your full report: what went well, your one thing to try next class, and your marks.');
    expect(logEvent).toHaveBeenCalledWith('coaching.report.link_wording', expect.objectContaining({ wording: 'tip', coachingSessionId: SID }));
  });

  test('switch on, Urdu → the Urdu wording with the tip', async () => {
    db({ setting: { tip_wording: true }, action: TIP });
    await send('ur');
    const body = WA.sendCtaUrl.mock.calls[0][1].body;
    expect(body).toMatch(/[؀-ۿ]/);
    expect(body).toContain('Ask two children by name.');
  });

  test('switch on, no tip stored → today\'s wording', async () => {
    db({ setting: { tip_wording: true }, action: { action: 'x' } });
    await send();
    expect(WA.sendCtaUrl.mock.calls[0][1].body)
      .toBe('Your full report: what went well, your one thing to try next class, and your marks.');
  });

  test('a very long tip is cut short', async () => {
    db({ setting: { tip_wording: true }, action: { thing_to_try: { text: 'a'.repeat(900) } } });
    await send();
    const body = WA.sendCtaUrl.mock.calls[0][1].body;
    expect([...body].length).toBeLessThan(300);
    expect(body).toContain('…');
  });
});
