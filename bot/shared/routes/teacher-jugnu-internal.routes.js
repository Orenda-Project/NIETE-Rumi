'use strict';
/**
 * The teacher's Jugnu tab on /api/internal/tr (switch web_quiz_teacher_jugnu, parents web_quiz_challenge_v2
 * and web_quiz_challenge). Mounted by teacher-report-internal.routes in one delimited block:
 *
 *   pageExtras(req, v, lang)          → null when the switch is off (the report renders as today, byte for
 *                                        byte); else { href, label } for the tab link, plus { view } when
 *                                        ?tab=jugnu asked for the tab itself
 *   GET  /fwd/:token?class=&lang=      302 → wa.me/?text=<wa.t.fwd_text with this week's story title>;
 *                                        404 when off, when the class has no live link or no story this week
 *   POST /queue/:token {loose_id, candidate_id, decision, class}
 *        same|no|undo → the join-queue service's decide(); unsure → nothing; link → linkClassCodes()
 *        → 303 back to the tab (?e=1 when nothing was saved); 404 when off or the queue copy is absent
 *
 * The confirm queue's writes (merged_into, merge_log, quiz_share_codes.class_id) are the identity
 * service's; this file only passes the teacher's tap to it. WHO is asking comes from the signed token.
 */
const { logToFile } = require('../utils/logger');
const { jugnuOn } = require('../services/quiz/teacher-jugnu-flags');
const Data = require('../services/quiz/teacher-jugnu.data');
const Page = require('../templates/teacher-jugnu.page');
const { REPORT_PATH } = require('../templates/teacher-report.page');

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOr = (v) => (typeof v === 'string' && UUID_RX.test(v) ? v : null);
const DECISIONS = new Set(['same', 'no', 'undo']);

/** The tab's data with what the page needs to decide on the forward button. */
async function tabFor(teacherId, listId, lang) {
  const tab = await Data.jugnuTab(teacherId, { listId, lang });
  if (!tab) return null;
  const title = tab.story ? tab.story[lang] || tab.story.en : null;
  const names = tab.kids.flatMap((k) => [k.first, k.father]).filter(Boolean);
  tab.forwardText = Page.forwardText(title, lang, names);
  tab.forwardable = Boolean(tab.forwardText);
  return tab;
}

async function pageExtras(req, v, lang) {
  if (!(await jugnuOn())) return null;
  const listId = uuidOr(req.query.class);
  const out = Page.tabLink(req.params.token, lang, listId);
  if (req.query.tab !== 'jugnu') return out;
  const tab = (await tabFor(v.teacherId, listId, lang)) || { list: null, kids: [], coverage: null };
  const queue = Page.queueReady(lang) && tab.list ? await Data.confirmQueue(v.teacherId, tab, lang) : null;
  out.view = Page.renderJugnu(tab, {
    lang, tokens: { self: req.params.token }, queue, notice: req.query.e === '1' ? 'failed' : null, scope: v.quizId ? 'quiz' : 'all',
  });
  return out;
}

/** Adds the tab's own routes to the report's internal router; helpers are the report's own. */
function attach(router, { authorise, handle, notFound, noStore, languageFor }) {
  router.get('/fwd/:token', handle(async (req, res) => {
    const v = authorise(req, res);
    if (!v) return;
    if (!(await jugnuOn())) { notFound(req, res, v); return; }
    const lang = await languageFor(req, v.teacherId, null);
    const tab = await tabFor(v.teacherId, uuidOr(req.query.class), lang);
    if (!tab || !tab.forwardable) { notFound(req, res, v); return; }
    noStore(res);
    res.redirect(302, `https://wa.me/?text=${encodeURIComponent(tab.forwardText)}`);
  }));

  router.post('/queue/:token', handle(async (req, res) => {
    const v = authorise(req, res);
    if (!v) return;
    if (!(await jugnuOn()) || !Page.queueReady('en')) { notFound(req, res, v); return; }
    const body = req.body || {};
    const listId = uuidOr(body.class);
    let ok = false;
    const Q = Data.queueService();
    try {
      if (Q && body.decision === 'unsure') ok = true; // "Not sure" leaves the pair; nothing is written
      else if (Q && DECISIONS.has(body.decision) && uuidOr(body.loose_id) && uuidOr(body.candidate_id)) {
        const r = await Q.decide({ teacherUserId: v.teacherId, looseId: body.loose_id, candidateId: body.candidate_id, decision: body.decision });
        ok = Boolean(r && r.ok);
      } else if (Q && body.decision === 'link' && listId && typeof Q.linkClassCodes === 'function') {
        const tab = await Data.jugnuTab(v.teacherId, { listId });
        if (tab && tab.list && tab.list.id === listId && tab.list.classId) {
          const r = await Q.linkClassCodes({ teacherUserId: v.teacherId, classId: tab.list.classId });
          ok = Boolean(r && !r.off);
        }
      }
    } catch (err) {
      logToFile('⚠️ teacher jugnu queue: the tap did not save', { error: err.message }, 'warn');
      ok = false;
    }
    noStore(res);
    const q = [['tab', 'jugnu'], ['class', listId], ['e', ok ? null : '1']].filter(([, x]) => x).map(([k, x]) => `${k}=${encodeURIComponent(x)}`).join('&');
    res.redirect(303, `${REPORT_PATH}/${encodeURIComponent(req.params.token)}?${q}`);
  }));
}

module.exports = { attach, pageExtras };
