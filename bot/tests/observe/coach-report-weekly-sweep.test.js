/**
 * Coach reports in the app, phase 3 — the WhatsApp side of the weekly report (coach-report-whatsapp.service
 * runWeeklySweep). Her week is ready on Friday at 16:00 (a card on her Home). At 16:30, if she has neither opened it
 * nor closed the card, ONE message brings the link to that week (item `week:<Monday>`): inside her 24-hour window a
 * cta_url button, outside it the approved template only (switch), else nothing. Only for a coach with the switch on
 * and at least one debrief that week; only on Friday 16:30–21:00 PKT (quiet hours after). One teacher_nudges row per
 * coach per week (kind coach_weekly_report) is the claim: opened/seen in the app wrote it first → nothing is sent.
 */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { tableDouble } = require('../helpers/table-double');

const COACH = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const at = (date, hourPkt = 10) => new Date(Date.parse(`${date}T00:00:00Z`) + (hourPkt - 5) * 3600 * 1000).toISOString();
const FRI_1631 = Date.parse(at('2026-11-06', 16.52));

let db;
let wa;
function load() {
  jest.resetModules();
  jest.doMock('../../shared/config/supabase', () => db);
  wa = { sendCtaUrl: jest.fn(async () => true), sendTemplate: jest.fn(async () => true) };
  jest.doMock('../../shared/services/whatsapp.service', () => wa);
  return require('../../shared/services/observe/coach-report-whatsapp.service');
}
const debrief = (id, iso, coach = COACH) => ({
  id, observer_user_id: coach, observation_type: 'leader_observation', debrief_status: 'done', created_at: iso, done_at: iso,
});

beforeEach(() => {
  process.env.INTERNAL_API_KEY = 'test-internal-key';
  process.env.PORTAL_URL = 'https://portal-sandbox.example';
  db = tableDouble({
    app_settings: [{ key: 'coach_reports_app', value: [COACH] }],
    users: [{ id: COACH, phone_number: '920000000001', preferred_language: 'en' }, { id: OTHER, phone_number: '920000000002', preferred_language: 'ur' }],
    coaching_sessions: [debrief('a', at('2026-11-03')), debrief('b', at('2026-11-05')), debrief('c', at('2026-11-04'), OTHER)],
    teacher_nudges: [],
  });
});

test('Friday 16:31, unopened, window open: one link to her week, the row claimed as sent', async () => {
  const S = load();
  const out = await S.runWeeklySweep({ now: FRI_1631, windowOpen: async () => true });
  expect(out).toMatchObject({ enabled: true, sent: 1 });
  expect(wa.sendCtaUrl).toHaveBeenCalledTimes(1);
  const { verifyAppLink } = require('../../shared/services/app-login-link');
  const url = wa.sendCtaUrl.mock.calls[0][1].url;
  expect(verifyAppLink(url.split('/go/')[1])).toMatchObject({ u: COACH, f: 'coach_week:2026-11-02' });
  expect(wa.sendCtaUrl.mock.calls[0][1].buttonText).toBe('Open my week');
  expect(db.tables.teacher_nudges).toHaveLength(1);
  expect(db.tables.teacher_nudges[0]).toMatchObject({ user_id: COACH, kind: 'coach_weekly_report', nudge_date: '2026-11-02', status: 'sent' });
  // a second sweep sends nothing
  await S.runWeeklySweep({ now: FRI_1631 + 20000, windowOpen: async () => true });
  expect(wa.sendCtaUrl).toHaveBeenCalledTimes(1);
});

test('opened or closed in the app first (its row exists): nothing is sent', async () => {
  db.tables.teacher_nudges.push({ id: 'n0', user_id: COACH, kind: 'coach_weekly_report', nudge_date: '2026-11-02', status: 'skipped', choice: 'opened' });
  const S = load();
  await S.runWeeklySweep({ now: FRI_1631, windowOpen: async () => true });
  expect(wa.sendCtaUrl).not.toHaveBeenCalled();
});

test('before 16:30, after 21:00, or not a Friday: nothing', async () => {
  const S = load();
  for (const t of [Date.parse(at('2026-11-06', 16.2)), Date.parse(at('2026-11-06', 21.5)), Date.parse(at('2026-11-05', 17))]) {
    // eslint-disable-next-line no-await-in-loop
    await S.runWeeklySweep({ now: t, windowOpen: async () => true });
  }
  expect(wa.sendCtaUrl).not.toHaveBeenCalled();
});

test('a coach without the switch, or with no debrief this week: nothing', async () => {
  db.tables.coaching_sessions = [debrief('c', at('2026-11-04'), OTHER), debrief('z', at('2026-10-28'))];
  const S = load();
  await S.runWeeklySweep({ now: FRI_1631, windowOpen: async () => true });
  expect(wa.sendCtaUrl).not.toHaveBeenCalled();
});

test('window closed and the template not on: nothing sent, nothing claimed', async () => {
  const S = load();
  await S.runWeeklySweep({ now: FRI_1631, windowOpen: async () => false });
  expect(wa.sendTemplate).not.toHaveBeenCalled();
  expect(db.tables.teacher_nudges).toHaveLength(0);
});

test('window closed and the approved template on: the template with the week token', async () => {
  db.tables.app_settings.push({ key: 'coach_report_template_enabled', value: true });
  const S = load();
  await S.runWeeklySweep({ now: FRI_1631, windowOpen: async () => false });
  expect(wa.sendTemplate).toHaveBeenCalledTimes(1);
  expect(wa.sendTemplate.mock.calls[0][1]).toBe('coach_report_ready_v1');
});

test('Meta refuses: the row says failed and it is never retried', async () => {
  const S = load();
  wa.sendCtaUrl.mockResolvedValueOnce(false);
  await S.runWeeklySweep({ now: FRI_1631, windowOpen: async () => true });
  expect(db.tables.teacher_nudges[0].status).toBe('failed');
  await S.runWeeklySweep({ now: FRI_1631 + 20000, windowOpen: async () => true });
  expect(wa.sendCtaUrl).toHaveBeenCalledTimes(1);
});
