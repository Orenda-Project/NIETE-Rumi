'use strict';
/**
 * /api/internal/thportal/* — the teacher app's home card asks the quiz home for its ONE quiz job, called only by the
 * dashboard's own /api/portal/me/home (server to server, x-api-key). WHO is asking is the portal session's users.id,
 * passed as `uid`; the dashboard has already checked the session.
 *
 *   GET /portal-home?uid=<users.id>&lang=en|ur
 *     → 200 { path: '/quiz/teacher/<th token, via portal>', primary, facts }
 *         primary  { kind:'class', title, played } | { kind:'lesson', id, make, title, from } | { kind:'none' }
 *         facts    the quiz home's own facts (has_lp, has_coaching, zero_kids_open, primary_kind)
 *     → 200 { off:true, reason:'role' }    a coach, principal or other leader (the quiz home is a teacher's)
 *     → 404 { off:true[, reason:'user'] }  quiz_teacher_home off (or its read failed), or no such user
 *     → 400 bad uid · 401 no key · 503 { error:'mk.error' } a read that threw (never a 500)
 *
 * Mounted on a path of its own (not under /api/internal/th: that router's switch answers every path beneath it).
 * The top card is the quiz home's (teacher-home.model buildHome) from the quiz home's own quick reads, so the app card
 * and the page it opens never disagree; only the class and lesson rungs are passed on (the app draws the others from
 * its own reads). Not a quiz-home open: teacher_home_open is NOT logged; `teacher_home.portal` carries the kind only.
 */
const express = require('express');
const { requireInternalKey } = require('../../middleware/require-internal-key');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const Flags = require('./teacher-home.flags');
const HomeToken = require('./teacher-home.token');
const Data = require('./teacher-home.data');
const Model = require('./teacher-home.model');

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// the same set as teacher-home.routes.js: a leader never gets the quiz home's card
const COACH_ROLES = new Set(['coach', 'principal', 'school_leader', 'supervisor', 'aeo', 'head']);
const ownSentOf = (lessons) => lessons.filter((r) => (r.state === 'sent' || r.state === 'report_sent') && r.quizId).map((r) => r.quizId);

/** The walk-through persona's view of the lists (sandbox test phones; absent → the lists as they are), as the home's. */
async function walkLists(user, lists) {
  let P = null;
  try { P = require('./optional-modules').load('testPersona'); } catch (_) { P = null; }
  if (!P || typeof P.forHome !== 'function' || !user || !user.phone_number) return lists;
  try { return (await P.forHome(user.phone_number, lists)) || lists; } catch (_) { return lists; }
}

/** Only the quiz rungs, only the fields the app card shows. */
function primaryOf(p) {
  if (p && p.kind === 'class') return { kind: 'class', title: p.title || '', played: Number(p.played) || 0 };
  if (p && p.kind === 'lesson') return { kind: 'lesson', id: p.id, make: p.make, title: p.title || '', from: p.from };
  return { kind: 'none' };
}

/** Builds the router. `deps` (tests) stands in for a data source; production passes nothing. */
function createRouter(deps = null) {
  const router = express.Router();
  router.use(requireInternalKey);
  const send = (res, status, body) => { res.set('Cache-Control', 'private, no-store'); res.status(status).json(body); };

  router.get('/portal-home', async (req, res) => {
    try {
      let on = false;
      try { on = (await Flags.on()) === true; } catch (_) { on = false; }
      if (!on) return send(res, 404, { off: true });
      const uid = typeof req.query.uid === 'string' && UUID_RX.test(req.query.uid) ? req.query.uid : null;
      if (!uid) return send(res, 400, { error: 'bad_uid' });
      const lang = req.query.lang === 'en' ? 'en' : 'ur';
      // the quick home's reads, started with the user read (quickReads in teacher-home.routes.js)
      const soon = [
        Data.within(Data.lessons(uid, deps, { light: true }), Data.REPORT_BUDGET_MS, [], 'lessons'),
        Data.within(Data.playedOwn(uid, deps, { light: true }), Data.REPORT_BUDGET_MS, new Map(), 'class report'),
        Data.within(Data.libraryShares(uid, deps, Date.now(), { light: true }), Data.SIDE_BUDGET_MS, [], 'library shares'),
        Data.within(Data.sendableRows(uid, deps), Data.SIDE_BUDGET_MS, null, 'send-again check'),
      ];
      const user = await Data.teacherOf(uid, deps);
      if (!user) return send(res, 404, { off: true, reason: 'user' });
      if (COACH_ROLES.has(String(user.role || '').toLowerCase())) return send(res, 200, { off: true, reason: 'role' });
      const t = HomeToken.signTeacherHome({ uid, lang, via: 'portal' });
      if (!t) throw new Error('home token not signed');
      const [lessons0, played0, shares0, sendRows] = await Promise.all(soon);
      const { lessons, played, shares } = await walkLists(user, { lessons: lessons0, played: played0, shares: shares0 });
      // "Send again" only where the send would answer (quickLists' rule); rows unread or late → offered as before
      const againable = sendRows ? new Set([...ownSentOf(lessons), ...played.keys()].filter((id) => sendRows.has(id))) : null;
      const home = Model.buildHome({ first: Data.firstNameOf(user), lessons, played, shares, againable, stories: null, video: null, maker: null });
      const primary = primaryOf(home.primary);
      try { logEvent('teacher_home.portal', { w: 's', ev_v: 1, primary_kind: primary.kind, lang }); } catch (_) { /* never decides */ }
      return send(res, 200, { path: HomeToken.teacherHomePath(t), primary, facts: home.facts });
    } catch (err) {
      logToFile('❌ teacher home portal card failed', { error: err && err.message }, 'error');
      if (!res.headersSent) send(res, 503, { error: 'mk.error' });
      return undefined;
    }
  });

  return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
