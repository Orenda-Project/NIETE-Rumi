/**
 * Coach reports in the app — the WhatsApp side (bot/shared/services/observe/coach-report-whatsapp.service.js).
 *
 * For a coach with app_settings.coach_reports_app on, her debrief report is a page in the coach app. WhatsApp only
 * brings ONE link to it, and only if she has not opened it:
 *   - recorded on WhatsApp: the link goes at once, in place of today's report picture (she is in the chat, so the
 *     24-hour window is open: a cta_url button, no template);
 *   - recorded in the app: the sweep sends it after 10 minutes if she has neither opened the report nor closed its Home
 *     card; inside her 24-hour window a cta_url button, outside it the UTILITY template (only once it is approved and
 *     switched on; until then nothing is sent and nothing is claimed).
 * At most one message per report: one conditional UPDATE claims it (coach_report_whatsapp_at, opened and seen all
 * NULL); only the claimer sends; a refused send is not retried.
 * The link is staging's one-tap app link (/go/<token>, app-login-link.js) to that ONE report (target
 * 'coach_report:<id>', coach-report-target.js); sandbox's /t/ door is not on staging.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { tableDouble } = require('../helpers/table-double');

const COACH = '11111111-1111-4111-8111-111111111111';
const OTHER_COACH = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';
const ID2 = '44444444-4444-4444-8444-444444444444';
const NOW = Date.parse('2026-11-05T10:00:00Z');
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString();

let db;
let wa;
let windowOpen;

function load() {
  jest.resetModules();
  jest.doMock('../../shared/config/supabase', () => db);
  wa = { sendCtaUrl: jest.fn(async () => true), sendTemplate: jest.fn(async () => true), sendMessage: jest.fn(async () => true) };
  jest.doMock('../../shared/services/whatsapp.service', () => wa);
  return require('../../shared/services/observe/coach-report-whatsapp.service');
}

const session = (over = {}) => ({
  id: ID, observer_user_id: COACH, observation_type: 'leader_observation', debrief_status: 'done',
  created_at: minsAgo(60), coach_report_opened_at: null, coach_report_seen_at: null, coach_report_whatsapp_at: null,
  done_at: minsAgo(11), talk_audio_id: null, talk_r2_key: 'observer_debrief/x.webm',
  ...over,
});

beforeEach(() => {
  process.env.INTERNAL_API_KEY = 'test-internal-key';
  process.env.PORTAL_URL = 'https://portal-sandbox.example';
  windowOpen = true;
  db = tableDouble({
    app_settings: [{ key: 'coach_reports_app', value: [COACH] }],
    users: [{ id: COACH, phone_number: '920000000001', preferred_language: 'ur' }, { id: OTHER_COACH, phone_number: '920000000002', preferred_language: 'en' }],
    coaching_sessions: [session()],
  });
});

describe('the link', () => {
  test('the one-tap app link (/go/) to ONE report: target coach_report:<id>', () => {
    const S = load();
    const { verifyAppLink } = require('../../shared/services/app-login-link');
    const url = S.reportLinkUrl(COACH, ID);
    expect(url).toMatch(/^https:\/\/portal-sandbox\.example\/go\/[^/]+$/);
    expect(verifyAppLink(url.split('/go/')[1])).toMatchObject({ u: COACH, f: `coach_report:${ID}` });
  });

  test('no id that is a uuid, no link (and nothing else can be named)', () => {
    const S = load();
    expect(S.reportLinkUrl(COACH, 'not-a-uuid')).toBeNull();
    expect(S.reportLinkUrl(COACH, `${ID}/x`)).toBeNull();
  });

  test('no signing key or no portal address: no link', () => {
    const S = load();
    delete process.env.INTERNAL_API_KEY;
    expect(S.reportLinkUrl(COACH, ID)).toBeNull();
    process.env.INTERNAL_API_KEY = 'test-internal-key';
    process.env.PORTAL_URL = '';
    expect(S.reportLinkUrl(COACH, ID)).toBeNull();
  });
});

describe('recorded on WhatsApp: the link goes at once', () => {
  test('switch on: claims the report and sends ONE cta_url "Open my report" in her language', async () => {
    const S = load();
    const out = await S.sendReportLinkNow({ sessionId: ID, coachId: COACH, phone: '920000000001', lang: 'ur' });
    expect(out).toBe('sent');
    expect(wa.sendCtaUrl).toHaveBeenCalledTimes(1);
    const [to, msg] = wa.sendCtaUrl.mock.calls[0];
    expect(to).toBe('920000000001');
    expect(msg.buttonText).toBe('میری رپورٹ کھولیں');
    expect(msg.url).toMatch(/\/go\//);
    expect([...msg.buttonText].length).toBeLessThanOrEqual(20);
    expect(db.tables.coaching_sessions[0].coach_report_whatsapp_at).not.toBeNull();
  });

  test('switch off for her: nothing is sent and nothing is claimed (the caller sends today\'s picture)', async () => {
    db.tables.app_settings = [{ key: 'coach_reports_app', value: [OTHER_COACH] }];
    const S = load();
    expect(await S.sendReportLinkNow({ sessionId: ID, coachId: COACH, phone: '920000000001', lang: 'en' })).toBe('off');
    expect(wa.sendCtaUrl).not.toHaveBeenCalled();
    expect(db.tables.coaching_sessions[0].coach_report_whatsapp_at).toBeNull();
  });

  test('already opened in the app: nothing to send', async () => {
    db.tables.coaching_sessions[0].coach_report_opened_at = minsAgo(1);
    const S = load();
    expect(await S.sendReportLinkNow({ sessionId: ID, coachId: COACH, phone: '920000000001', lang: 'en' })).toBe('not_claimed');
    expect(wa.sendCtaUrl).not.toHaveBeenCalled();
  });

  test('Meta refuses the button: "failed" (the caller falls back to the text card); the claim stays, never retried', async () => {
    const S = load();
    wa.sendCtaUrl.mockResolvedValueOnce(false);
    expect(await S.sendReportLinkNow({ sessionId: ID, coachId: COACH, phone: '920000000001', lang: 'en' })).toBe('failed');
    expect(db.tables.coaching_sessions[0].coach_report_whatsapp_at).not.toBeNull();
  });
});

describe('recorded in the app: the sweep', () => {
  test('ready 11 minutes, unopened, window open: one cta_url, claimed', async () => {
    const S = load();
    const counts = await S.runSweep({ now: NOW, windowOpen: async () => windowOpen });
    expect(counts).toMatchObject({ enabled: true, sent: 1 });
    expect(wa.sendCtaUrl).toHaveBeenCalledTimes(1);
    expect(db.tables.coaching_sessions[0].coach_report_whatsapp_at).not.toBeNull();
    // a second sweep sends nothing
    await S.runSweep({ now: NOW + 20000, windowOpen: async () => true });
    expect(wa.sendCtaUrl).toHaveBeenCalledTimes(1);
  });

  test('ready only 5 minutes: not yet', async () => {
    db.tables.coaching_sessions[0].done_at = minsAgo(5);
    const S = load();
    await S.runSweep({ now: NOW, windowOpen: async () => true });
    expect(wa.sendCtaUrl).not.toHaveBeenCalled();
  });

  test('opened, or closed with ✕: never messaged', async () => {
    db.tables.coaching_sessions[0].coach_report_seen_at = minsAgo(2);
    const S = load();
    await S.runSweep({ now: NOW, windowOpen: async () => true });
    expect(wa.sendCtaUrl).not.toHaveBeenCalled();
  });

  test('recorded on WhatsApp: the sweep leaves it (the link went at once)', async () => {
    db.tables.coaching_sessions[0].talk_audio_id = 'wamid-audio';
    const S = load();
    await S.runSweep({ now: NOW, windowOpen: async () => true });
    expect(wa.sendCtaUrl).not.toHaveBeenCalled();
  });

  test('a coach without the switch: never messaged', async () => {
    db.tables.coaching_sessions[0].observer_user_id = OTHER_COACH;
    const S = load();
    await S.runSweep({ now: NOW, windowOpen: async () => true });
    expect(wa.sendCtaUrl).not.toHaveBeenCalled();
  });

  test('window closed and the template not switched on: nothing sent, nothing claimed', async () => {
    const S = load();
    await S.runSweep({ now: NOW, windowOpen: async () => false });
    expect(wa.sendCtaUrl).not.toHaveBeenCalled();
    expect(wa.sendTemplate).not.toHaveBeenCalled();
    expect(db.tables.coaching_sessions[0].coach_report_whatsapp_at).toBeNull();
  });

  test('window closed and the approved template switched on: the template, its button carrying the token', async () => {
    db.tables.app_settings.push({ key: 'coach_report_template_enabled', value: true });
    const S = load();
    await S.runSweep({ now: NOW, windowOpen: async () => false });
    expect(wa.sendTemplate).toHaveBeenCalledTimes(1);
    const [, name, lang, components] = wa.sendTemplate.mock.calls[0];
    expect(name).toBe('coach_report_ready_v1');
    expect(lang).toBe('ur');
    expect(components[0]).toMatchObject({ type: 'button', sub_type: 'url', index: '0' });
  });

  test('two reports for one coach: two links, each to its own report', async () => {
    db.tables.coaching_sessions.push(session({ id: ID2, done_at: minsAgo(12) }));
    const S = load();
    await S.runSweep({ now: NOW, windowOpen: async () => true });
    expect(wa.sendCtaUrl).toHaveBeenCalledTimes(2);
  });
});
