/**
 * bd-s1oo0.7 (L7) — the child test in the coach app.
 *
 * Mounted at /api/portal/leader/child-test by dashboard/index.js. On WhatsApp a
 * coach cannot show the child an opened card and record at once; the app page
 * (portal/src/portal/pages/LeaderChildTest.tsx) can. These routes hold NO
 * child-test logic: each relays to the bot (services/portal-child-test.client.js)
 * with the SESSION user, never one from the request.
 *
 *   GET  /visits                      today's observe2 visits by this coach
 *   GET  /list?visitId=               today's five children (the server's draw; no redraws)
 *   POST /outcome                     { visitId, drawId, outcome: present|absent|refused, note? }
 *   GET  /session/:id                 per block: media in, AI status, check prefill
 *   GET  /session/:id/card/:block     the child's card (no answer keys)
 *   POST /session/:id/presign         { block, kind: audio|photo, contentType, sizeBytes } → R2 PUT url
 *   POST /session/:id/media           { block, audioKey?, photoKey?, timing?, photoDeclined? } → attached, scoring started
 *   POST /session/:id/check           { block, coachMarks } → stored next to the AI's marks
 *
 * The Learning assessment (the child takes the battery alone; the coach picks a school, not a visit):
 *   GET  /sa/schools                  the coach's schools, today's observe visit first
 *   GET  /sa/list?schoolId=&visitId=&grade=  today's children at that school (visitId optional; grade 1–5 with sa_all_grades)
 *   POST /sa/child                    { schoolId, visitId?, grade, listGrade?, firstName, section?, clientChildId } → the list (sa_add_child)
 *   POST /sa/outcome                  { schoolId, visitId?, drawId, outcome, note?, clientSessionId?, block?, repick?, grade? } → present opens a session
 *   the engine's sink, for one session the coach opened here:
 *   GET  /sa/session/:id/battery?lang=&full= this child's block of the battery (or the whole form), ur or en
 *   POST /sa/session/:id/batch        { seqFrom, seqTo, events[], results[], lang?, device? } → { ackedTo }
 *   POST /sa/session/:id/presign      { taskId, itemId?, mime, bytes } → R2 PUT url for one recording
 *   POST /sa/session/:id/register     { taskId, itemId?, key } → the recording is kept
 *   GET  /sa/session/:id/status       what the server holds, for the visit bar
 *   POST /sa/session/:id/link         a signed link so another phone can run this child's battery
 *   GET  /sa/switches                 the page's own switches for this coach (read here, no bot call)
 *   GET  /sa/session/:id/results      the session's results page, read only (also behind `sa_results_view`;
 *                                     a session user on `sa_results_admins` reads any coach's session)
 *   GET  /sa/session/:id/review      the visit review (also behind `sa_review_page`): per task the recordings, the app's
 *                                     and the agents' marks per item, and the reviewer's own marks
 *   POST /sa/session/:id/review/mark { taskId, itemKey, mark: correct|wrong|unclear|null, note? } → the reviewer's mark
 *   GET  /sa/sessions                the results dashboard on real sessions (also behind `sa_real_dashboard`): the
 *                                     coach's own; a session user on `sa_results_admins` reads every coach's
 *   another phone, with NO portal session — the token names the session and its coach:
 *   POST /sa/link/:token/session/:id/(batch|presign|register), GET …/status
 *        the bot names the token's coach first; that coach's portal_child_test_sa decides (404 when off)
 * Behind its own switch, `portal_child_test_sa` (same shape), instead of `portal_child_test`.
 *
 * GATES, in order: a portal session (401), the leader family (403), and the
 * `portal_child_test` app_settings flag — true, or a pilot list of user ids
 * (404 when off, the same answer as a route that does not exist). The bot adds
 * its own CHILD_TEST_ENABLED gate behind these.
 */

const express = require('express');
const supabase = require('../config/supabase');
const { makeRequireLeaderRole } = require('../lib/leader-role');
const {
  isFlagEnabledForUser, PORTAL_CHILD_TEST_KEY, PORTAL_CHILD_TEST_SA_KEY, SA_RESULTS_VIEW_KEY, SA_RESULTS_ADMINS_KEY, SA_REAL_DASHBOARD_KEY, SA_REVIEW_PAGE_KEY,
} = require('../lib/feature-flags');
const Client = require('../services/portal-child-test.client');

const router = express.Router();

// The portal's one sign-in check (lib/portal-auth.js): it also ends the session of a retired account.
const { requirePortalAuth } = require('../lib/portal-auth');

async function getUserById(userId) {
  const { data, error } = await supabase.from('users').select('id, role').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

const requireLeaderRole = makeRequireLeaderRole({ getUser: getUserById });

function requireFlag(key) {
  return async (req, res, next) => {
    const on = await isFlagEnabledForUser(supabase, key, req.session && req.session.portalUserId);
    if (!on) return res.status(404).json({ success: false, error: 'Not found' });
    return next();
  };
}

const gates = [requirePortalAuth, requireLeaderRole, requireFlag(PORTAL_CHILD_TEST_KEY)];
const saGates = [requirePortalAuth, requireLeaderRole, requireFlag(PORTAL_CHILD_TEST_SA_KEY)];

function pick(src, fields) {
  const out = {};
  for (const f of fields) if (src && src[f] !== undefined) out[f] = src[f];
  return out;
}

/** Relay to the bot. A throw (unconfigured / unreachable / 5xx) is a 502. */
function relay(path, build) {
  return async (req, res) => {
    try {
      const body = { userId: req.session.portalUserId, ...(await build(req)) };
      const { httpStatus, body: answer } = await Client.call(path, body);
      if (httpStatus >= 500) throw new Error(`bot answered ${httpStatus}`);
      return res.status(httpStatus).json(answer);
    } catch (error) {
      console.error(`Portal child-test ${path} failed:`, error.message);
      return res.status(502).json({ success: false, error: 'Could not reach Rumi. Please try again.' });
    }
  };
}

router.get('/visits', ...gates, relay('visits', () => ({})));
router.get('/list', ...gates, relay('list', (req) => pick(req.query, ['visitId'])));
router.post('/outcome', ...gates, relay('outcome', (req) => pick(req.body, ['visitId', 'drawId', 'outcome', 'note'])));
router.get('/session/:id', ...gates, relay('session', (req) => ({ sessionId: req.params.id })));
router.get('/session/:id/card/:block', ...gates, relay('card', (req) => ({ sessionId: req.params.id, block: req.params.block })));
router.post('/session/:id/presign', ...gates, relay('presign', (req) => ({
  sessionId: req.params.id, ...pick(req.body, ['block', 'kind', 'contentType', 'sizeBytes']),
})));
router.post('/session/:id/media', ...gates, relay('media', (req) => ({
  sessionId: req.params.id, ...pick(req.body, ['block', 'audioKey', 'photoKey', 'timing', 'photoDeclined']),
})));
router.post('/session/:id/check', ...gates, relay('check', (req) => ({
  sessionId: req.params.id, ...pick(req.body, ['block', 'coachMarks']),
})));

// The page's switches, each an app_settings row of the usual shape (true, or a pilot list of users.id); off when absent.
const SA_SWITCHES = {
  handbackV2: 'sa_handback_v2',
  micRequired: 'sa_mic_required',
  coachPicksBlock: 'sa_coach_picks_block',
  rdfForm: 'sa_rdf_form',
  resultsView: SA_RESULTS_VIEW_KEY,
  // Wave 3: the card's RDF entry becomes RDF auto + RDF manual (the content lane's forms switch)
  rdfW3Forms: 'sa_rdf_w3_forms',
  voiceGateV2: 'sa_voice_gate_v2',
  // the coach re-picks the part of a resumed child (the server's own row of the same name moves the session)
  resumeRepick: 'sa_resume_repick',
  // every grade: the coach names Grade 1–5 for the school (the bot's own row of the same name draws it)
  allGrades: 'sa_all_grades',
  // Add a child on the spot (the bot's own row of the same name writes the child)
  addChild: 'sa_add_child',
  // Urdu that fits on these pages (portal/src/portal/lib/assess/urFit.ts): the same row as the child's screens
  urFit: 'sa_ur_fit',
  // the example results dashboard (synthetic students, no DB rows): sandbox only, see SANDBOX_ONLY
  exampleDashboard: 'sa_example_dashboard',
  // the same dashboard on this tier's real sessions (GET /sa/sessions below): any host, its row decides
  realDashboard: SA_REAL_DASHBOARD_KEY,
  // the visit review page (GET /sa/session/:id/review below)
  reviewPage: SA_REVIEW_PAGE_KEY,
  // round 7b: the corner End test works and the child can be restarted; coach-led End this section; the dashboard's
  // mode / date / coach filters and its skips-and-stops view
  endTestRestart: 'sa_end_test_restart',
  endSection: 'sa_end_section',
  dashFilters: 'sa_dash_filters',
  // round 7b item 14: every words-per-minute number is correct words per minute, labelled CWPM
  cwpm: 'sa_cwpm',
  // round 8 (portal components/assess/offlineReady.ts): the child's battery on the phone before Start; "Get ready for
  // offline" on the schools screen; Start waits at most 1.5 s for the Present answer
  r8OfflineFirst: 'sa_r8_offline_first',
  r8OfflinePrep: 'sa_r8_offline_prep',
  r8FastStart: 'sa_r8_fast_start',
  // round 8: the microphone check on an iPhone (portal components/assess/AssessPreflight.tsx): its AudioContext is made
  // inside the tap, and the recording can be played again by a tap
  iosMic: 'sa_r8_ios_mic',
};
// Switches that are off on any host but sandbox, whatever their row says.
const SANDBOX_ONLY = new Set(['exampleDashboard']);
const onThisHost = (name) => !SANDBOX_ONLY.has(name) || process.env.RAILWAY_ENVIRONMENT_NAME === 'sandbox';

router.get('/sa/switches', ...saGates, async (req, res) => {
  const userId = req.session.portalUserId;
  const names = Object.keys(SA_SWITCHES);
  const on = await Promise.all(names.map((n) => onThisHost(n) && isFlagEnabledForUser(supabase, SA_SWITCHES[n], userId)));
  return res.json({ success: true, switches: Object.fromEntries(names.map((n, i) => [n, on[i]])) });
});

router.get('/sa/schools', ...saGates, relay('sa/schools', () => ({})));
router.get('/sa/list', ...saGates, relay('sa/list', (req) => pick(req.query, ['schoolId', 'visitId', 'grade'])));
router.post('/sa/outcome', ...saGates, relay('sa/outcome', (req) => pick(req.body, ['schoolId', 'visitId', 'drawId', 'outcome', 'note', 'clientSessionId', 'block', 'repick', 'grade', 'restart'])));
router.post('/sa/child', ...saGates, relay('sa/child', (req) => pick(req.body, ['schoolId', 'visitId', 'grade', 'listGrade', 'firstName', 'section', 'clientChildId'])));
const onSession = (fields) => (req) => ({ sessionId: req.params.id, ...pick(req.method === 'GET' ? req.query : req.body, fields) });
router.get('/sa/session/:id/battery', ...saGates, relay('sa/battery', onSession(['lang', 'full'])));
router.post('/sa/session/:id/batch', ...saGates, relay('sa/batch', onSession(['seqFrom', 'seqTo', 'events', 'results', 'lang', 'device'])));
router.post('/sa/session/:id/presign', ...saGates, relay('sa/presign', onSession(['taskId', 'itemId', 'mime', 'bytes'])));
router.post('/sa/session/:id/register', ...saGates, relay('sa/register', onSession(['taskId', 'itemId', 'key'])));
router.get('/sa/session/:id/status', ...saGates, relay('sa/status', onSession([])));
router.post('/sa/session/:id/last-word-hint', ...saGates, relay('sa/last-word-hint', onSession(['taskId'])));
router.post('/sa/session/:id/link', ...saGates, relay('sa/link-mint', onSession([])));
// Read only, behind its own switch too. The coach's own session (the bot checks); a SESSION user on
// sa_results_admins reads any coach's — asAdmin is set here from that check, never from the request.
router.get('/sa/session/:id/results', ...saGates, requireFlag(SA_RESULTS_VIEW_KEY), relay('sa/results', async (req) => (
  (await isFlagEnabledForUser(supabase, SA_RESULTS_ADMINS_KEY, req.session.portalUserId))
    ? { sessionId: req.params.id, asAdmin: true }
    : { sessionId: req.params.id })));

// The results dashboard on real sessions, behind its own switch too: the coach's own sessions; a SESSION user on
// sa_results_admins reads every coach's (asAdmin set here, never from the request). No names (the bot's saSessions).
const asAdminOf = async (req) => ((await isFlagEnabledForUser(supabase, SA_RESULTS_ADMINS_KEY, req.session.portalUserId)) ? { asAdmin: true } : {});
router.get('/sa/sessions', ...saGates, requireFlag(SA_REAL_DASHBOARD_KEY), relay('sa/sessions', asAdminOf));
// The visit review, behind its own switch too: one session item by item, and a reviewer's mark on one item. The
// coach's own session; a SESSION user on sa_results_admins any (asAdmin set here, never from the request).
router.get('/sa/session/:id/review', ...saGates, requireFlag(SA_REVIEW_PAGE_KEY), relay('sa/review', async (req) => (
  { sessionId: req.params.id, ...(await asAdminOf(req)) })));
router.post('/sa/session/:id/review/mark', ...saGates, requireFlag(SA_REVIEW_PAGE_KEY), relay('sa/review-mark', async (req) => (
  { sessionId: req.params.id, ...pick(req.body, ['taskId', 'itemKey', 'mark', 'note']), ...(await asAdminOf(req)) })));

const LINK_FIELDS = {
  batch: ['seqFrom', 'seqTo', 'events', 'results', 'lang', 'device'],
  presign: ['taskId', 'itemId', 'mime', 'bytes'],
  register: ['taskId', 'itemId', 'key'],
  status: [],
};

// The linked phone's own random id (sink-coach.js), for the bot's one-phone-per-link rule; only from the header.
const PHONE_RE = /^[A-Za-z0-9_-]{16,64}$/;

function linkArgs(req, op) {
  const phone = typeof req.get === 'function' ? req.get('x-sa-phone') : undefined;
  return PHONE_RE.test(String(phone || ''))
    ? { token: req.params.token, op, sessionId: req.params.id, phone }
    : { token: req.params.token, op, sessionId: req.params.id };
}

async function requireLinkedCoach(req, res, next) {
  if (!LINK_FIELDS[req.params.op]) return res.status(404).json({ success: false, error: 'Not found' });
  try {
    const { httpStatus, body } = await Client.call('sa/via-link', linkArgs(req, 'whois'));
    if (httpStatus >= 500) throw new Error(`bot answered ${httpStatus}`);
    const coach = httpStatus === 200 && body && body.coachUserId;
    if (!coach || !(await isFlagEnabledForUser(supabase, PORTAL_CHILD_TEST_SA_KEY, coach))) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    return next();
  } catch (error) {
    console.error('Portal child-test sa/link failed:', error.message);
    return res.status(502).json({ success: false, error: 'Could not reach Rumi. Please try again.' });
  }
}

async function linkRelay(req, res) {
  const { op } = req.params;
  const body = { ...linkArgs(req, op), ...pick(req.method === 'GET' ? req.query : req.body, LINK_FIELDS[op]) };
  try {
    const { httpStatus, body: answer } = await Client.call('sa/via-link', body);
    if (httpStatus >= 500) throw new Error(`bot answered ${httpStatus}`);
    return res.status(httpStatus).json(answer);
  } catch (error) {
    console.error('Portal child-test sa/link failed:', error.message);
    return res.status(502).json({ success: false, error: 'Could not reach Rumi. Please try again.' });
  }
}

router.post('/sa/link/:token/session/:id/:op', requireLinkedCoach, linkRelay);
router.get('/sa/link/:token/session/:id/:op', requireLinkedCoach, linkRelay);

module.exports = router;
