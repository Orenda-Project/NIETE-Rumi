'use strict';
/**
 * bd-l6424d — the in-flight rescue: a coach whose lesson-plan request was already being worked gets the Lesson Plans
 * tab, ONE message, never the tab and the catalogue.
 *
 * Asked whether a coach who names a topic in a lesson-plan request should also get the Lesson Plans tab, the operator,
 * 23 Oct 2026: "yes to topic requests too". A request already being worked when the cutover came is the third topic
 * door: the worker drains the free-form job (it carries the topic the coach asked for) and, under LP_612_ROUTE_ALL,
 * answers it (`cutover_inflight_gamma`). It asks the switch first and returns once a link is sent. Otherwise it opens
 * the catalogue, whose own door asks the switch again:
 *   - the switch said no (a principal, an analytics-only coach, a teacher the link does not cover): the second ask says
 *     no too, and the Flow goes — the Flow led by the "lessons come from your textbook" line, one message;
 *   - the switch said yes but the SEND failed (Meta refused the button and the same link as plain text): the second
 *     ask says yes again and tries the link once more — a second button and a second plain-text attempt, a second
 *     app_funnel.command and a second link_failed row — and only when that is refused too does the Flow go. Nothing
 *     the coach sees is doubled: every refused attempt delivered nothing, so the Flow is the one message that arrives.
 * The not-in-catalogue line goes only when neither the link nor the Flow could be sent.
 *
 * Drives the REAL worker `process()`, app-redirect and the catalogue door, and the minted link through the REAL GET /go
 * router. Faked: WhatsApp, the database (memory), the queue's row writes, and the generation services the drained job
 * never reaches.
 */

const mockWa = {
  sendFlow: jest.fn(async () => true),
  sendMessage: jest.fn(async () => true),
  sendCtaUrl: jest.fn(async () => true),
};
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendFlow: (...a) => mockWa.sendFlow(...a),
  sendMessage: (...a) => mockWa.sendMessage(...a),
  sendCtaUrl: (...a) => mockWa.sendCtaUrl(...a),
}));
const { makeDb } = require('../quiz/helpers/memory-db');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));
jest.mock('../../bot/shared/services/content.service', () => ({}));
jest.mock('../../bot/shared/services/feature-linker.service', () => ({}));
jest.mock('../../bot/shared/services/feature-registration.service', () => ({}));
jest.mock('../../bot/shared/services/curriculum-lp-ast.service', () => ({}));
jest.mock('../../bot/shared/services/grounded-lp-render.service', () => ({ renderAndServeGrounded: jest.fn() }));
jest.mock('../../bot/shared/services/lp-feedback.service', () => ({}));
jest.mock('../../bot/shared/database/bot-helpers', () => ({ storeLessonPlan: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/lesson-plan-queue.service', () => ({
  markFailed: jest.fn(async () => true),
  getRequest: jest.fn(), markProcessing: jest.fn(), markCompleted: jest.fn(),
}));
// The portal's own sink, for the /go router.
jest.mock('../../dashboard/services/telemetry.service', () => ({ logEvent: jest.fn(), flush() {}, isEnabled: () => true }));

const http = require('http');
const express = require('express');

const PORTAL = 'https://portal.example.test';
const FLOW_ID = 'flow-lp';
const PHONE = '923004440022';
const person = (id, role) => ({
  id, role, name: 'P', first_name: 'P', preferred_language: 'ur', phone_number: PHONE,
  registration_completed: true, registration_state: 'completed',
});
const COACH = person('9d4a3f5b-4a3e-4f6c-8d7b-3fbc9e5dae44', 'coach');
const PRINCIPAL = person('ae5b4a6c-5b4f-4a7d-9e8c-4acdaf6ebf55', 'principal');
const TEACHER = person('bf6c5b7d-6c5a-4b8e-8f9d-5bdeba7fca66', 'teacher');

const PROD = [
  { key: 'app_redirect_lesson_plan', value: 'teachers' },
  { key: 'portal_teacher_v2', value: 'teachers' },
  { key: 'leader_app_lesson_plan', value: 'coaches' },
];
// A free-form job queued before the cutover: the topic the coach asked for, in the language frozen at enqueue.
const jobFor = (user) => ({
  requestId: 'req-1', userId: user.id, phoneNumber: PHONE, topic: 'fractions', contentType: 'lesson_plan', language: 'ur',
});

const KEYS = ['LP_612_ENABLED', 'LP_612_ROUTE_ALL', 'PAKISTAN_LP_FLOW_ID', 'PORTAL_URL', 'INTERNAL_API_KEY', 'SUPABASE_URL',
  'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'APP_STORE_URL'];
const saved = {};
let Worker; let me;

function load(user, settings = PROD) {
  jest.resetModules();
  me = { ...user };
  mockDb = makeDb({ users: [{ ...user }], app_settings: settings.map((r) => ({ ...r })), user_feature_first_use: [] });
  Worker = require('../../bot/workers/lesson-plan-generation.worker');
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const fn of Object.values(mockWa)) fn.mockReset().mockResolvedValue(true);
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, {
    LP_612_ENABLED: 'true', LP_612_ROUTE_ALL: 'true', PAKISTAN_LP_FLOW_ID: FLOW_ID,
    PORTAL_URL: PORTAL, INTERNAL_API_KEY: 'test-internal-key', SUPABASE_URL: 'https://abcdefgh.supabase.co',
    // Dummy LLM keys keep this file hermetic (bd-i26e96); nothing here calls a model.
    OPENAI_API_KEY: 'test-openai', OPENROUTER_API_KEY: 'test-openrouter',
  });
});
afterAll(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });
async function tap(url) {
  const token = url.slice(`${PORTAL}/go/`.length);
  const sessions = [];
  const a = express();
  a.use((req, _res, next) => {
    const s = { regenerate(cb) { cb(); }, save(cb) { cb(); } };
    req.session = s; sessions.push(s); next();
  });
  a.use(require('../../dashboard/routes/app-login.routes').createAppLoginRouter({
    findUser: async (id) => (id === me.id ? { id: me.id, name: 'P' } : null),
    isTeacherV2: async () => false,
    isCoachApp: async () => true,
  }));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  const res = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: `/go/${token}` }, (r) => {
      r.resume(); r.on('end', () => resolve({ status: r.statusCode, location: r.headers.location }));
    }).on('error', reject);
  });
  return { ...res, session: sessions[0] };
}

const ctas = () => mockWa.sendCtaUrl.mock.calls;
const flows = () => mockWa.sendFlow.mock.calls;
const texts = () => mockWa.sendMessage.mock.calls;
const funnelRows = (name) => require('../../bot/shared/utils/logger').logToFile.mock.calls.filter(([n]) => n === name).map(([, p]) => p);

describe('a covered coach whose request was in flight', () => {
  test('ONE message: the Lesson Plans tab button. No catalogue Flow, no textbook line, no apology', async () => {
    load(COACH);
    await Worker.process(jobFor(COACH));
    expect(ctas()).toHaveLength(1);
    expect(flows()).toHaveLength(0);
    expect(texts()).toHaveLength(0);
    const [to, { body, buttonText, url }] = ctas()[0];
    expect(to).toBe(PHONE);
    expect(body).toBe('وہ لیسن پلان پڑھیں جو آپ کے اساتذہ کو ملتے ہیں۔');
    expect(buttonText).toBe('لیسن پلان');
    const res = await tap(url);
    expect(res.status).toBe(303);
    expect(res.location).toBe('/portal/teacher/lessons');
    expect(res.session).toEqual(expect.objectContaining({ portalUserId: COACH.id, isPortalAuth: true }));
    const cmds = funnelRows('app_funnel.command');
    expect(cmds).toEqual([
      expect.objectContaining({ feature: 'lesson_plan', door: 'cutover_inflight_gamma', verdict: 'link', audience: 'leader' }),
    ]);
    expect(res.session.appJourney).toEqual(expect.objectContaining({ id: cmds[0].journeyId, feature: 'leader_lessons' }));
    // The job is still drained (marked failed, final), whichever answer the coach got.
    expect(require('../../bot/shared/services/lesson-plan-queue.service').markFailed).toHaveBeenCalledTimes(1);
  });

  test('if the link cannot be delivered, it is tried at each door, then the catalogue Flow is the one message that arrives', async () => {
    load(COACH);
    mockWa.sendCtaUrl.mockResolvedValue(false);  // Meta refuses the button…
    mockWa.sendMessage.mockResolvedValue(false); // …and the same link as plain text
    await Worker.process(jobFor(COACH));
    expect(flows()).toHaveLength(1);
    // The rescue's own ask tries the link (button, then plain text) and is refused; the catalogue door asks again, the
    // switch still says yes, and it tries once more. Two attempts, pinned, so a change to the retry is a visible one.
    expect(mockWa.sendCtaUrl).toHaveBeenCalledTimes(2);
    expect(mockWa.sendMessage).toHaveBeenCalledTimes(2);
    expect(funnelRows('app_funnel.command')).toHaveLength(2);
    expect(funnelRows('app_funnel.link_failed')).toHaveLength(2);
    // Every link attempt was refused, so the Flow is the only thing that reached the coach.
    for (const r of [...mockWa.sendCtaUrl.mock.results, ...mockWa.sendMessage.mock.results]) expect(await r.value).toBe(false);
  });
});

describe('everyone else whose request was in flight: exactly as before', () => {
  test('a principal under "coaches": ONE message, the catalogue Flow led by the textbook line, no link', async () => {
    load(PRINCIPAL);
    await Worker.process(jobFor(PRINCIPAL));
    expect(ctas()).toHaveLength(0);
    expect(texts()).toHaveLength(0);
    expect(flows()).toHaveLength(1);
    expect(flows()[0][1].flowId).toBe(FLOW_ID);
    const { resolveUx } = require('../../bot/shared/config/ux-strings');
    expect(flows()[0][1].body).toBe(`${resolveUx('lp612RouteRedirect', { language: 'ur' })}\n\n${resolveUx('lpBrowseBody', { language: 'ur' })}`);
  });

  test('an analytics-only coach: the catalogue Flow, no link', async () => {
    load(COACH, [...PROD, { key: 'portal_analytics_only', value: [COACH.id] }]);
    await Worker.process(jobFor(COACH));
    expect(ctas()).toHaveLength(0);
    expect(flows()).toHaveLength(1);
    expect(require('../../bot/shared/utils/logger').logToFile).toHaveBeenCalledWith(
      expect.stringMatching(/Leader app link: not for this user/), expect.objectContaining({ why: 'analytics_only' }));
  });

  test('a teacher: the teacher link, as before', async () => {
    load(TEACHER);
    await Worker.process(jobFor(TEACHER));
    expect(ctas()).toHaveLength(1);
    expect(flows()).toHaveLength(0);
    expect(require('../../bot/shared/services/app-login-link').verifyAppLink(ctas()[0][1].url.slice(`${PORTAL}/go/`.length)).f)
      .toBe('lesson_plan');
  });

  test('without LP_612_ROUTE_ALL the rescue never asks the switch: the not-in-catalogue line, for a coach too', async () => {
    delete process.env.LP_612_ROUTE_ALL;
    load(COACH);
    await Worker.process(jobFor(COACH));
    expect(ctas()).toHaveLength(0);
    expect(flows()).toHaveLength(0);
    expect(texts()).toHaveLength(1);
    expect(texts()[0][1]).toMatch(/menu/);
  });
});
