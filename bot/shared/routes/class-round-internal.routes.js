'use strict';
/**
 * /api/internal/tr/round/* — the class round's locked mode on the teacher's phone (web_quiz_class_round). Mounted
 * inside the teacher report's internal router (requireInternalKey, JSON bodies); WHO is asking comes only from the
 * signed report token. With the switch off (or a parent off) every route answers the report's own 404 page.
 *
 *   GET  /round/:token                 the round screen the server's state allows (start / teacher / child / hand-back)
 *   POST /round/:token/start           fixes the server-random order (once), 303 back to the round
 *   POST /round/:token/absent {pos}    marks a position absent (teacher's screen only)
 *   POST /round/:token/next {act,hold} the long-press: calls the next child
 *   POST /round/:token/teacher {act,hold} the long-press: back to the teacher's screen
 *   POST /round/:token/declined {pos}  a child's "not today" (teacher's screen only)
 *   POST /round/:token/pause | resume  pause for today / carry on (the order kept)
 *   POST /round/:token/not-this-term   the card's "Not this term" (from the draw to the window's end, before the round
 *                                      starts; no message)
 * The round closes on the "next" long-press with nobody left to call (the thanks screen), or at the window's end.
 * Every answer is private and never stored; nothing is set on the browser.
 */
const express = require('express');
const supabase = require('../config/supabase');
const { clampLanguage } = require('../config/ux-strings');
const { logToFile } = require('../utils/logger');
const { logEvent } = require('../utils/structured-logger');
const Token = require('../services/quiz/teacher-report-token');
const Flags = require('../services/quiz/web-quiz-class-round-flags');
const Round = require('../services/quiz/web-quiz-class-round');
const { REPORT_PATH } = require('../templates/teacher-report.page');
const Page = require('../templates/class-round.page');

/** @param {{page: Function, noStore: Function, queryLang: Function}} h  the report router's helpers */
module.exports = function classRoundRouter({ page, noStore, queryLang }) {
  const router = express.Router();

  // The report's own token check and pages (route 'round' in the log: never the token).
  function authorise(req, res) {
    const v = Token.verifyTeacherReport(req.params.token);
    if (v) return v;
    const reason = Token.explain(req.params.token) === 'expired' ? 'expired' : 'bad';
    logEvent('teacher_report.denied', { reason, route: 'round' });
    page(res, reason === 'expired' ? 410 : 401, reason === 'expired' ? 'expired' : 'incomplete', queryLang(req));
    return null;
  }

  async function langOf(req, teacherId) {
    const asked = queryLang(req);
    if (asked) return asked;
    try {
      const { data } = await supabase.from('users').select('preferred_language').eq('id', teacherId).maybeSingle();
      return clampLanguage(data && data.preferred_language);
    } catch (_) {
      return clampLanguage(null);
    }
  }

  // Off → the report's own 404, before anything else is read (the token is not even checked).
  const gate = (fn) => async (req, res) => {
    try {
      if (!(await Flags.roundOn())) { page(res, 404, 'missing', queryLang(req)); return; }
      const v = authorise(req, res);
      if (!v) return;
      await fn(req, res, v);
    } catch (err) {
      logToFile('❌ class round route failed', { error: err.message }, 'error');
      if (!res.headersSent) page(res, 500, 'error', queryLang(req));
    }
  };

  const tok = (req) => encodeURIComponent(req.params.token);
  const backToRound = async (req, res, v) => {
    noStore(res);
    res.redirect(303, `${REPORT_PATH}/${tok(req)}/round?lang=${await langOf(req, v.teacherId)}`);
  };

  router.get('/:token', gate(async (req, res, v) => {
    const html = await Round.screen(v.teacherId, { lang: await langOf(req, v.teacherId), token: req.params.token });
    if (!html) { page(res, 404, 'missing', queryLang(req)); return; }
    noStore(res);
    res.status(200).type('html').send(html);
  }));

  router.post('/:token/start', gate(async (req, res, v) => {
    const draw = await Round.start(v.teacherId);
    if (!draw) { page(res, 404, 'missing', queryLang(req)); return; }
    await backToRound(req, res, v);
  }));

  const toReport = async (req, res, v) => {
    noStore(res);
    res.redirect(303, `${REPORT_PATH}/${tok(req)}?tab=class&lang=${await langOf(req, v.teacherId)}`);
  };
  // Each action: 404 when there is no live round for this teacher; otherwise back to the round (or to the report
  // once the round is closed or the class has said "Not this term").
  const action = (fn) => gate(async (req, res, v) => {
    const out = await fn(v.teacherId, req.body || {});
    if (!out.draw) { page(res, 404, 'missing', queryLang(req)); return; }
    if (out.closed) {   // the teacher's close screen: thanks, no count
      noStore(res);
      res.status(200).type('html').send(Page.renderThanks({ lang: await langOf(req, v.teacherId) }));
      return;
    }
    if (out.toReport) { await toReport(req, res, v); return; }
    await backToRound(req, res, v);
  });

  router.post('/:token/absent', action((t, b) => Round.absent(t, b.pos)));
  router.post('/:token/declined', action((t, b) => Round.declined(t, b.pos)));
  router.post('/:token/pause', action((t) => Round.pause(t, true)));
  router.post('/:token/resume', action((t) => Round.pause(t, false)));
  router.post('/:token/next', action((t, b) => Round.next(t, b)));
  router.post('/:token/teacher', action((t, b) => Round.toTeacher(t, b)));
  router.post('/:token/not-this-term', action(async (t) => {
    const out = await Round.notThisTerm(t);
    return { ...out, toReport: out.ok };
  }));

  return router;
};
