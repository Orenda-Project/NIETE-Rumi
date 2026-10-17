'use strict';
/**
 * A teacher sends a storybook to the class: the bot side of the portal's /api/teacher/* and /quiz/teacher/<th>/stories
 * (dashboard/routes/teacher-stories.routes.js forwards path for path). Behind the internal key, like /api/internal/wq.
 * The teacher is the one a teacher-home token names (`th`); app_settings web_quiz_stories_teacher off → 404 stories_off.
 *
 *   GET  /stories?th=&grade=&lang=[&all=1]   the story shelf for that grade and language (+ `ui`, the page's language)
 *   GET  /preview?th=&story_id=[&class=]     the send made ready: the book, the exact class message, the send link
 *   POST /share {th, story_id, class?}       {code, link, class_message}, the send marked sent
 *   POST /send {th, story_id, class?}        the teacher's tap (the page's form): the send opened and marked sent, 302 → wa.me
 *   GET  /page/:th[?grade=&lang=&book=]      the Stories page (HTML): the shelf, or one book's preview
 *                                            (the shelf only, with one line, when `send` is false)
 */
const express = require('express');
const { requireInternalKey } = require('../middleware/require-internal-key');
const { logToFile } = require('../utils/logger');
const Stories = require('../services/quiz/story-teacher.service');
const Page = require('../templates/teacher-stories.page');

const router = express.Router();
router.use(requireInternalKey);
router.use(express.json({ limit: '8kb' }));

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cls = (v) => (typeof v === 'string' && UUID_RX.test(v) ? v : null);

const handle = (fn) => async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const out = await fn(req, res);
    if (res.headersSent) return undefined;
    if (out && out.redirect) return res.redirect(302, out.redirect);
    return res.status(200).json(out);
  } catch (err) {
    if (err instanceof Stories.StoryError) return res.status(err.status).json(err.body);
    logToFile('❌ story send route failed', { path: req.path, error: err.message }, 'error');
    return res.status(500).json({ error: 'server_error' });
  }
};

/**
 * The page's own language, the teacher home's rule (teacher-home.page pageLang): a one-language token keeps its
 * language; a two-language token follows the language asked, else Urdu.
 */
function uiFor(tok, asked) {
  if (tok && (tok.lang === 'en' || tok.lang === 'ur')) return tok.lang;
  return asked === 'en' ? 'en' : 'ur';
}

/** The shelf a page or the home asks for. No grade: Grade 2 (the largest shelf); no language: the page's. */
async function shelfFor(th, q = {}) {
  const tok = Stories.teacherToken(th);
  const ui = uiFor(tok, q.lang);
  const shelf = await Stories.shelf({ uid: tok && tok.uid, grade: q.grade || 2, lang: q.lang || ui, all: q.all === '1' });
  return { ...shelf, ui, uid: tok && tok.uid };
}

router.get('/stories', handle(async (req) => {
  const { uid, ...shelf } = await shelfFor(req.query.th, req.query);
  return shelf;
}));

router.get('/preview', handle((req) => {
  const q = req.query || {};
  const tok = Stories.teacherToken(q.th);
  return Stories.preview({ uid: tok && tok.uid, storyId: q.story_id, classId: cls(q.class), ui: uiFor(tok, q.lang) });
}));

router.post('/share', handle((req) => {
  const b = req.body || {};
  return Stories.share({ uid: Stories.teacherOf(b.th), storyId: b.story_id, classId: cls(b.class) });
}));

router.post('/send', handle((req) => {
  const b = req.body || {};
  return Stories.send({ uid: Stories.teacherOf(b.th), storyId: b.story_id, classId: cls(b.class) });
}));

/** The Stories page. Also the teacher home's slot (its `/api/internal/th/:token/stories` calls servePage). */
async function servePage(req, res) {
  res.set('Cache-Control', 'no-store');
  const th = String((req.params && (req.params.th || req.params.token)) || '');
  const q = req.query || {};
  try {
    const { uid, ...shelf } = await shelfFor(th, { grade: q.grade, lang: q.lang, all: '1' });
    let html;
    // No web link for this teacher's class: the shelf and its line, never a preview that would be refused.
    if (typeof q.book === 'string' && UUID_RX.test(q.book) && shelf.send !== false) {
      let p = null;
      try {
        p = await Stories.preview({ uid, storyId: q.book, ui: shelf.ui });
      } catch (err) {
        if (!(err instanceof Stories.StoryError)) throw err;
      }
      const tile = (shelf.books || []).find((b) => b.id === q.book);
      html = Page.renderPreview({ th, shelf, ui: shelf.ui, p, firstPage: tile && tile.first_page, error: !p });
    } else {
      html = Page.renderShelf({ th, shelf, ui: shelf.ui });
    }
    return res.status(200).type('html').send(html);
  } catch (err) {
    if (err instanceof Stories.StoryError) return res.status(err.status).json(err.body);
    logToFile('❌ story page failed', { error: err.message }, 'error');
    return res.status(500).json({ error: 'server_error' });
  }
}
router.get('/page/:th', servePage);

module.exports = router;
module.exports.servePage = servePage;
