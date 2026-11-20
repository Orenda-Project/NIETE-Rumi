/**
 * bd-9652yj (queue #166) — the report-ready message's way back to WhatsApp.
 *
 * For a coach on the coach app nudge (app-redirect isCoachNudged: coach_app_nudge + the portal's full-app rule), the
 * "Your debrief report is ready… [Open my report]" button message carries one more line: "Report not opening? Reply 1
 * and I'll send it here." and arms the reply-1 offer for THAT report (coach-app-nudge armReply 'report'). Replying 1
 * sends today's WhatsApp report card (sendReportCardHere). Every other coach's message is exactly today's. The template
 * (outside the 24 h window) is unchanged: a template's words cannot change without Meta.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { tableDouble } = require('../helpers/table-double');

const COACH = '11111111-1111-4111-8111-111111111111';
const OTHER_COACH = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';
const NOW = Date.parse('2026-11-05T10:00:00Z');
// Synthetic numbers, built from parts so no phone-shaped literal sits in the test (tests/setup/phone-shaped-fixtures).
const PHONE_A = ['92', '000', '0000001'].join('');
const PHONE_B = ['92', '000', '0000002'].join('');
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString();

let db; let wa; let nudged; let arm; let picture;

function load() {
  jest.resetModules();
  jest.doMock('../../shared/config/supabase', () => db);
  wa = { sendCtaUrl: jest.fn(async () => true), sendTemplate: jest.fn(async () => true), sendMessage: jest.fn(async () => true) };
  jest.doMock('../../shared/services/whatsapp.service', () => wa);
  jest.doMock('../../shared/services/app-redirect.service', () => ({ isCoachNudged: (id) => nudged(id) }));
  jest.doMock('../../shared/services/coach-app-offer', () => ({ armReply: (...a) => arm(...a) }));
  jest.doMock('../../shared/services/observe/coach-report-card', () => ({ sendCoachReportPicture: (...a) => picture(...a) }));
  return require('../../shared/services/observe/coach-report-whatsapp.service');
}

const session = (over = {}) => ({
  id: ID, observer_user_id: COACH, observation_type: 'leader_observation', debrief_status: 'done',
  created_at: minsAgo(60), coach_report_opened_at: null, coach_report_seen_at: null, coach_report_whatsapp_at: null,
  done_at: minsAgo(11), talk_audio_id: null, talk_r2_key: 'observer_debrief/x.webm',
  analysis_data: { framework: 'fico', observer_debrief: { feedback: { rubric: 'fico', wins: [] } } },
  ...over,
});

beforeEach(() => {
  process.env.INTERNAL_API_KEY = 'test-internal-key'; // staging signs report links with this key
  process.env.PORTAL_URL = 'https://portal-sandbox.example';
  nudged = jest.fn(async (id) => id === COACH);
  arm = jest.fn(async () => true);
  picture = jest.fn(async () => true);
  db = tableDouble({
    app_settings: [{ key: 'coach_reports_app', value: true }],
    users: [{ id: COACH, phone_number: PHONE_A, preferred_language: 'en' }, { id: OTHER_COACH, phone_number: PHONE_B, preferred_language: 'ur' }],
    coaching_sessions: [session()],
  });
});

describe('recorded on WhatsApp (sendReportLinkNow)', () => {
  test('a nudged coach: the reply-1 line rides on the same message, and the offer is armed for this report', async () => {
    const S = load();
    expect(await S.sendReportLinkNow({ sessionId: ID, coachId: COACH, phone: PHONE_A, lang: 'en' })).toBe('sent');
    expect(wa.sendCtaUrl).toHaveBeenCalledTimes(1);
    const msg = wa.sendCtaUrl.mock.calls[0][1];
    expect(msg.body).toMatch(/^Your debrief report is ready\./);
    expect(msg.body).toMatch(/Report not opening\? Reply \*1\* and I'll send it here\./);
    expect(msg.buttonText).toBe('Open my report');
    expect(arm).toHaveBeenCalledWith(COACH, 'report', expect.objectContaining({ sessionId: ID }));
  });

  test('in Urdu', async () => {
    const S = load();
    await S.sendReportLinkNow({ sessionId: ID, coachId: COACH, phone: PHONE_A, lang: 'ur' });
    expect(wa.sendCtaUrl.mock.calls[0][1].body).toMatch(/رپورٹ نہیں کھل رہی؟ \*1\* لکھ کر بھیجیں، میں یہیں بھیج دوں\u00A0گی۔/);
  });

  test('a coach not on the nudge: exactly today\'s words, nothing armed', async () => {
    nudged = jest.fn(async () => false);
    const S = load();
    await S.sendReportLinkNow({ sessionId: ID, coachId: COACH, phone: PHONE_A, lang: 'en' });
    expect(wa.sendCtaUrl.mock.calls[0][1].body).toBe('Your debrief report is ready. It opens in the app, in English or Urdu.');
    expect(arm).not.toHaveBeenCalled();
  });

  test('the nudge check failing is "not nudged" (today\'s words), never a lost report', async () => {
    nudged = jest.fn(async () => { throw new Error('boom'); });
    const S = load();
    expect(await S.sendReportLinkNow({ sessionId: ID, coachId: COACH, phone: PHONE_A, lang: 'en' })).toBe('sent');
    expect(wa.sendCtaUrl.mock.calls[0][1].body).not.toMatch(/Reply/);
  });

  test('Meta refuses the button: nothing is armed', async () => {
    const S = load();
    wa.sendCtaUrl.mockResolvedValueOnce(false);
    expect(await S.sendReportLinkNow({ sessionId: ID, coachId: COACH, phone: PHONE_A, lang: 'en' })).toBe('failed');
    expect(arm).not.toHaveBeenCalled();
  });
});

describe('recorded in the app (the sweep)', () => {
  test('inside her window: the button message carries the line for a nudged coach', async () => {
    const S = load();
    const out = await S.runSweep({ now: NOW, windowOpen: async () => true });
    expect(out.sent).toBe(1);
    expect(wa.sendCtaUrl.mock.calls[0][1].body).toMatch(/Reply \*1\*/);
    expect(arm).toHaveBeenCalledWith(COACH, 'report', expect.objectContaining({ sessionId: ID }));
  });

  test('outside her window the template goes unchanged, and nothing is armed', async () => {
    db.tables.app_settings.push({ key: 'coach_report_template_enabled', value: true });
    const S = load();
    const out = await S.runSweep({ now: NOW, windowOpen: async () => false });
    expect(out.sent).toBe(1);
    expect(wa.sendTemplate).toHaveBeenCalledTimes(1);
    expect(arm).not.toHaveBeenCalled();
  });
});

describe('reply 1: the report card here (sendReportCardHere)', () => {
  test('her own report: today\'s WhatsApp picture card for it, in her language', async () => {
    const S = load();
    const user = { id: COACH, preferred_language: 'ur' };
    expect(await S.sendReportCardHere({ sessionId: ID, user, from: PHONE_A })).toBe(true);
    expect(picture).toHaveBeenCalledTimes(1);
    const [from, feedback, Sx, framework, lang] = picture.mock.calls[0];
    expect(from).toBe(PHONE_A);
    expect(feedback).toEqual({ rubric: 'fico', wins: [] });
    expect(Sx.coach_report_link_button).toBe('میری رپورٹ کھولیں');
    expect(framework).toBe('fico');
    expect(lang).toBe('ur');
  });

  test('someone else\'s report, no report, or no feedback on it: false, nothing sent', async () => {
    const S = load();
    expect(await S.sendReportCardHere({ sessionId: ID, user: { id: OTHER_COACH }, from: PHONE_B })).toBe(false);
    expect(await S.sendReportCardHere({ sessionId: '44444444-4444-4444-8444-444444444444', user: { id: COACH }, from: '9200' })).toBe(false);
    db.tables.coaching_sessions[0].analysis_data = {};
    expect(await S.sendReportCardHere({ sessionId: ID, user: { id: COACH }, from: PHONE_A })).toBe(false);
    expect(picture).not.toHaveBeenCalled();
  });

  test('the picture send failing is false (the caller says where to find it)', async () => {
    picture = jest.fn(async () => false);
    const S = load();
    expect(await S.sendReportCardHere({ sessionId: ID, user: { id: COACH }, from: PHONE_A })).toBe(false);
  });
});
