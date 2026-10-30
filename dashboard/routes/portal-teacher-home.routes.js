'use strict';
/**
 * Teacher Home card — the teacher Home's ONE card, its scores row and its per-teacher tile order. Mounted at /api/portal by
 * dashboard/index.js beside the other teacher modules (same CORS / limiter stack).
 *
 *   GET  /api/portal/me/home       → { success, now, order, orderOn, card, scores: { coach, observation }, quizHome[, quizTile] }
 *   POST /api/portal/me/home/tap   { kind } → 204 (logs app_funnel.action home_card.tap; nothing else)
 *
 * Guards, in order (portal-share.routes.js's pattern): no session 401 → portal_teacher_v2 off 404 (nothing read) →
 * portal_teacher_home_card off 404 { success:false, off:true } (the portal keeps today's Home).
 *
 * The user is ALWAYS the session's. Every read runs in parallel and settles on its own (Promise.allSettled): a failed
 * read is that part ABSENT (no chip, fixed order, a lower rung), never a 5xx — the Home must open whatever the card does.
 *   order        services/teacher-home-order.service.js rankFeatures(countsFor(...)), only when
 *                portal_teacher_home_order is on for the teacher; else Home.tsx's fixed order and orderOn false
 *   card         pickCard (the design rule R5 ladder). Rungs 1 (class) and 3 (lesson) come from the bot's teacher home choice
 *                (one brain for the quiz job); rungs 2, 4, 5 from this service's own reads. A bot that is off, down,
 *                or answers anything but a 200 without off:true → quizHome null, and rungs 1 and 3 cannot fire (there
 *                is no quiz home for "Quiz this" / "Send again" to go to); rungs 2, 4, 5 still work.
 *   scores       the teacher's newest own completed report and newest observation sent to the teacher: { marks, max, at, id } only
 *                when marks is a number (the report page's rule), else null
 *   own report   rung 2 and the coach chip exist only when portal_self_observation is on for the teacher: the report page
 *                they open answers 404 otherwise (requireSelfObservation in portal.routes.js), so the card never sends a
 *                teacher there. Off, unreadable or failed = no coach_report rung and no coach chip.
 *   quizHome     the bot's signed quiz-home path, relative, as it gave it; null for a coach / principal
 *   quizTile     true only when portal_teacher_home_quiz_tile is on for the teacher AND quizHome is a path: the Home draws
 *                its "Quizzes" tile (one tap into the quiz home, logged as kind quiz_tile). Off or no quiz home: no key.
 *
 * Logged (R11), PII-free, never awaited, never thrown: app_funnel.action { action:'home_card.shown' | 'home_card.tap',
 * feature:'home', kind, orderOn, lang } with the session's userId, as app-funnel.routes.js logs every action.
 */
const express = require('express');
const supabase = require('../config/supabase');
const {
  isFlagEnabledForUser, PORTAL_TEACHER_V2_KEY, PORTAL_TEACHER_HOME_CARD_KEY, PORTAL_TEACHER_HOME_ORDER_KEY,
  PORTAL_SELF_OBSERVATION_KEY, PORTAL_TEACHER_HOME_QUIZ_TILE_KEY,
} = require('../lib/feature-flags');
const telemetry = require('../services/telemetry.service');
const TeacherObservation = require('../lib/teacher-observation');
const Order = require('../services/teacher-home-order.service');

/** The bot's portal-home route (bot first-touch/teacher-home.portal.routes.js). ONE place to change it. */
const BOT_PORTAL_HOME_PATH = '/api/internal/thportal/portal-home';
const BOT_TIMEOUT_MS = 8000;

const CARD_KINDS = ['class', 'coach_report', 'lesson', 'observation', 'first_plan'];
// "Quiz this lesson" on the plan page / on a Digital Coach report; quiz_tile: the Home's "Quizzes" tile
const TAP_KINDS = [...CARD_KINDS, 'chip_coach', 'chip_obs', 'lp_quiz', 'coach_quiz', 'quiz_tile'];
/** The scores slice of analysis_data, never the whole column (~30 KB a row), and the card's title words. */
const SESSION_SLICE = 'id, created_at, scores:analysis_data->scores, topic:analysis_data->>topic, subject:analysis_data->>subject';

const router = express.Router();

// The portal's one sign-in check (lib/portal-auth.js): it also ends the session of a retired account.
const { requirePortalAuth } = require('../lib/portal-auth');

async function requireTeacherV2(req, res, next) {
  let on = false;
  try { on = await isFlagEnabledForUser(supabase, PORTAL_TEACHER_V2_KEY, req.session.portalUserId); } catch (_) { on = false; }
  if (!on) return res.status(404).json({ success: false, error: 'Not found' });
  return next();
}

async function requireHomeCard(req, res, next) {
  let on = false;
  try { on = await isFlagEnabledForUser(supabase, PORTAL_TEACHER_HOME_CARD_KEY, req.session.portalUserId); } catch (_) { on = false; }
  if (!on) return res.status(404).json({ success: false, off: true });
  return next();
}

const langOf = (v) => (String(v || '').trim().toLowerCase() === 'ur' ? 'ur' : 'en');
const valueOf = (s) => (s && s.status === 'fulfilled' ? s.value : null);

function emit(action, props) {
  try { telemetry.logEvent('app_funnel.action', { action, feature: 'home', ...props }); } catch (_) { /* logging never decides the response */ }
}

/** One row (or null) from a .then-able query; a PostgREST error throws so allSettled marks it failed. */
async function one(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message || 'read failed');
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

/** A sliced coaching_sessions row back into the { analysis_data } shape the service's pure functions read. */
const asSession = (r) => (r ? { id: r.id, created_at: r.created_at, analysis_data: { scores: r.scores || null, topic: r.topic || null, subject: r.subject || null } } : null);

async function readUser(userId) {
  return one(supabase.from('users').select('role, preferred_language').eq('id', userId).limit(1));
}

/**
 * The bot's teacher-home choice for this user: { path, primary, facts } or null. Any answer carrying off:true (switch
 * off, a coach role, no such user), any non-200, a missing path, or a throw → null. Never throws.
 */
async function callBot(userId, lang) {
  try {
    const axios = require('axios');
    const baseUrl = (process.env.MAIN_BOT_URL || '').replace(/\/$/, '');
    const apiKey = process.env.INTERNAL_API_KEY || '';
    if (!baseUrl || !apiKey) return null;
    const r = await axios.get(`${baseUrl}${BOT_PORTAL_HOME_PATH}`, {
      params: { uid: userId, lang }, headers: { 'x-api-key': apiKey }, timeout: BOT_TIMEOUT_MS, validateStatus: () => true,
    });
    const d = r && r.status === 200 ? r.data : null;
    if (!d || typeof d !== 'object' || d.off === true || typeof d.path !== 'string' || !d.path) return null;
    return { path: d.path, primary: d.primary && typeof d.primary === 'object' ? d.primary : { kind: 'none' }, facts: d.facts || null };
  } catch (_) {
    return null;
  }
}

router.get('/me/home', requirePortalAuth, requireTeacherV2, requireHomeCard, async (req, res) => {
  const userId = req.session.portalUserId;
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const fixed = [...Order.FIXED_ORDER];
  try {
    const userP = readUser(userId);
    const orderOnP = isFlagEnabledForUser(supabase, PORTAL_TEACHER_HOME_ORDER_KEY, userId).catch(() => false);
    const since7 = new Date(nowMs - Order.LESSON_FALLBACK_MS).toISOString().replace('Z', ''); // lesson_plans: no time zone
    const settled = await Promise.allSettled([
      userP,
      orderOnP,
      // the order: the six "did" reads, only when the switch is on for the teacher
      orderOnP.then((on) => (on ? Order.countsFor(supabase, userId, nowMs) : null)),
      // the bot, in the teacher's language (the user read first, then the call; a failed user read asks in English)
      userP.catch(() => null).then((u) => callBot(userId, langOf(u && u.preferred_language))),
      // the teacher's newest own completed report (rung 2 + the coach chip)
      one(supabase.from('coaching_sessions').select(SESSION_SLICE).eq('user_id', userId)
        .is('observation_type', null).eq('status', 'completed').not('analysis_data', 'is', null)
        .order('created_at', { ascending: false }).limit(1)),
      // the newest observation the coach SENT the teacher (lib/teacher-observation.js's rule; rung 4 + the observation chip)
      one(supabase.from('coaching_sessions').select(SESSION_SLICE).eq('user_id', userId)
        .eq('observation_type', TeacherObservation.OBSERVATION_TYPE)
        .in('analysis_data->teacher_delivery->>status', TeacherObservation.SENT_TO_TEACHER)
        .order('created_at', { ascending: false }).limit(1)),
      // lesson plans ever (0 → rung 5)
      (async () => {
        const { count, error } = await supabase.from('lesson_plans').select('id', { count: 'exact', head: true }).eq('user_id', userId);
        if (error) throw new Error(error.message || 'count failed');
        return typeof count === 'number' ? count : null;
      })(),
      // the teacher's newest UN-QUIZZED plan of 7 days: the lesson rung's fallback when the bot answered with no job
      one(supabase.from('lesson_plans').select('id, topic, created_at').eq('user_id', userId).is('quiz_id', null)
        .gte('created_at', since7).order('created_at', { ascending: false }).limit(1)),
      // may the teacher open their own reports? (gates rung 2 and the coach chip; a failed read = no)
      isFlagEnabledForUser(supabase, PORTAL_SELF_OBSERVATION_KEY, userId).catch(() => false),
      // the "Quizzes" tile (portal_teacher_home_quiz_tile; a failed read = no tile)
      isFlagEnabledForUser(supabase, PORTAL_TEACHER_HOME_QUIZ_TILE_KEY, userId).catch(() => false),
    ]);
    const [user, orderOn, counts, bot, coachRow, obsRow, lpCount, lastPlan, selfObservation, quizTileOn] = settled.map(valueOf);

    const isCoach = Order.isCoachRole(user && user.role);
    const lang = langOf(user && user.preferred_language);
    const quizHome = !isCoach && bot ? bot.path : null;
    const coach = selfObservation === true ? asSession(coachRow) : null;
    const observation = asSession(obsRow);
    let card = null;
    try {
      card = Order.pickCard({ bot, coach, observation, lastPlan, lpCount, quizHome, isCoach, now: nowMs });
    } catch (_) { card = null; }
    let order = fixed;
    if (orderOn === true && counts) {
      try { order = Order.rankFeatures(counts, nowMs); } catch (_) { order = fixed; }
    }

    emit('home_card.shown', { userId, kind: card ? card.kind : 'none', orderOn: orderOn === true, lang });
    return res.json({
      success: true,
      now,
      order,
      orderOn: orderOn === true,
      card,
      scores: { coach: Order.scoreOf(coach), observation: Order.scoreOf(observation) },
      quizHome,
      // the "Quizzes" tile: only with its switch on for this teacher AND a quiz home to open; off, the key is absent
      ...(quizTileOn === true && quizHome ? { quizTile: true } : {}),
    });
  } catch (error) {
    // Nothing above should throw; if it does, the Home still opens as today's.
    console.error('❌ Portal me/home failed', { error: error && error.message });
    return res.json({ success: true, now, order: fixed, orderOn: false, card: null, scores: { coach: null, observation: null }, quizHome: null });
  }
});

router.post('/me/home/tap', requirePortalAuth, requireTeacherV2, requireHomeCard, (req, res) => {
  const kind = req.body && req.body.kind;
  if (typeof kind !== 'string' || !TAP_KINDS.includes(kind)) {
    return res.status(400).json({ success: false, error: 'kind is required' });
  }
  const userId = req.session.portalUserId;
  res.status(204).end();
  // After the answer: the tap's context (order switch, language), then the log. Nothing here can reach the response.
  Promise.allSettled([
    isFlagEnabledForUser(supabase, PORTAL_TEACHER_HOME_ORDER_KEY, userId),
    readUser(userId),
  ]).then(([o, u]) => {
    const user = valueOf(u);
    emit('home_card.tap', { userId, kind, orderOn: valueOf(o) === true, lang: langOf(user && user.preferred_language) });
  }).catch(() => {});
  return undefined;
});

module.exports = router;
module.exports.BOT_PORTAL_HOME_PATH = BOT_PORTAL_HOME_PATH;
