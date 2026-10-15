'use strict';
/**
 * The class week card's forward on /api/internal/tr (switch web_quiz_class_week; the card lives on the Jugnu
 * tab, so web_quiz_teacher_jugnu must be on too). Mounted by teacher-jugnu-internal.routes' attach().
 *
 *   GET /wfwd/:token?class=&lang=   302 → wa.me/?text=<jg.week.forward> <the class link>, and
 *                                   class_week_forwarded{cls, term}; 404 when off, when the class is not
 *                                   drawn, outside its week window, has no live link, or the line is absent.
 *
 * WHO is asking comes from the signed token; the class list must be the teacher's own (jugnuTab picks
 * from the teacher's lists only). 0 messages: the teacher forwards from their own phone.
 */
const { jugnuOn } = require('../services/quiz/teacher-jugnu-flags');
const Data = require('../services/quiz/teacher-jugnu.data');
const Week = require('../services/quiz/teacher-class-week');

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOr = (v) => (typeof v === 'string' && UUID_RX.test(v) ? v : null);
const namesOf = (tab) => tab.kids.flatMap((k) => [k.first, k.father]).filter(Boolean);

/** The card for a Jugnu tab already built (the page), or null. */
function cardForTab(tab, lang, T) {
  if (!tab || !tab.list) return Promise.resolve(null);
  return Week.cardFor({ list: tab.list, names: namesOf(tab), lang, T });
}

function attach(router, { authorise, handle, notFound, noStore, languageFor }) {
  router.get('/wfwd/:token', handle(async (req, res) => {
    const v = authorise(req, res);
    if (!v) return;
    if (!(await jugnuOn())) { notFound(req, res, v); return; }
    const lang = await languageFor(req, v.teacherId, null);
    const listId = uuidOr(req.query.class);
    const tab = await Data.jugnuTab(v.teacherId, { listId, lang });
    const T = require('../templates/teacher-jugnu.page').T; // eslint-disable-line global-require
    const card = tab && tab.list && tab.list.id === listId ? await cardForTab(tab, lang, T) : null;
    if (!card) { notFound(req, res, v); return; }
    Week.forwarded(card);
    noStore(res);
    res.redirect(302, `https://wa.me/?text=${encodeURIComponent(card.text)}`);
  }));
}

module.exports = { attach, cardForTab, windowShown: Week.windowShown };
