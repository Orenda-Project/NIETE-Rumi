'use strict';
/**
 * bd-ptl6x9.7 — the weak-skill Jugnu nudge's button, on /api/internal/tr (mounted by teacher-report-internal.routes;
 * the portal's /r/<token>/sfwd forwards here with x-api-key):
 *
 *   GET /sfwd/:token?class=<class list id>&ex=<missing|numbers|bigger>&lang=<en|ur>
 *       302 → wa.me/?text=<one fixed line naming the game> + newline + <the class's standing link>?ex=<game>
 *       404 when the nudge is off, the class link is off, the game is not one of the three, the list is not this
 *       teacher's, or the class's link cannot be had.
 *
 * WHO is asking comes from the signed report token. 0 messages: the teacher forwards from her own phone. The line
 * carries no digit, no child's name and no result; the link page picks the child (the class link's own steps).
 */
const { logEvent } = require('../utils/structured-logger');
const { WORDS } = require('../templates/weak-skill-jugnu.template');
const { clampLanguage } = require('../config/ux-strings');

const LINES = {
  en: (game) => `Our class has a Jugnu game to practise: ${game}. Children can play it on this phone. Tap to start:`,
  ur: (game) => `ہماری جماعت کے لیے جگنو کا ایک مشق والا کھیل: ${game}۔ بچے اسی فون پر کھیل سکتے ہیں۔ شروع کرنے کے لیے دبائیں:`,
};

function attach(router, { authorise, handle, notFound, noStore }) {
  router.get('/sfwd/:token', handle(async (req, res) => {
    const v = authorise(req, res);
    if (!v) return;
    const { nudgeSettings } = require('../services/nudges/weak-skill-jugnu/switch'); // eslint-disable-line global-require
    const { classLinkOn } = require('../services/quiz/teacher-jugnu-flags'); // eslint-disable-line global-require
    const game = typeof req.query.ex === 'string' ? req.query.ex : '';
    if (!Object.prototype.hasOwnProperty.call(WORDS, game)) { notFound(req, res, v); return; }
    if (!(await nudgeSettings()).enabled || !(await classLinkOn())) { notFound(req, res, v); return; }

    const lists = await require('../services/nudges/weak-skill-jugnu/reader').listsOf(v.teacherId); // eslint-disable-line global-require
    const list = lists.find((l) => l.listId === req.query.class);
    if (!list) { notFound(req, res, v); return; }
    const Link = require('../services/quiz/web-quiz-class-link'); // eslint-disable-line global-require
    const m = await Link.mint({ teacherId: v.teacherId, classId: list.classId });
    const url = m && m.ok ? Link.linkUrl(m.code) : null;
    if (!url) { notFound(req, res, v); return; }

    const lang = clampLanguage(req.query.lang);
    const text = `${LINES[lang](WORDS[game][lang].game)}\n${url}?ex=${game}`;
    const { tk } = require('../services/quiz/web-quiz-kid'); // eslint-disable-line global-require
    logEvent('weak_skill_jugnu.forwarded', { tk: tk(v.teacherId), game, grade: list.grade });
    noStore(res);
    res.redirect(302, `https://wa.me/?text=${encodeURIComponent(text)}`);
  }));
}

module.exports = { attach, LINES };
