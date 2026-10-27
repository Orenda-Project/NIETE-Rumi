'use strict';
/**
 * Where the one door sends a person once the server knows who they are — named here, so the landing never guesses a
 * route. The teacher home and the join page are their own modules; until one is on this branch its target answers
 * null and the landing shows the honest line instead (never a 500, never a dead button).
 *
 *   teacher  → /quiz/teacher/<th token>   when quiz_teacher_home is ON: the teacher home's `./teacher-home.token`
 *                                         signTeacherHome({uid, lang, via}); until that module is here, the same token
 *                                         shape is signed inline ({k:'th', uid, lang, via:'go', exp: 24 h})
 *              else → /m/<m token>        the quiz-maker page (quiz_maker_page ON and its `./maker.token` here):
 *                                         a working teacher screen (library chips, send to the class group)
 *              else → null                the landing's honest line
 *   join     → /quiz/join/<j token>       the join page's `../quiz/web-quiz-student-join` joinUrl({n, lang})
 *   child    → /h/<hub token>?from=quiz   the child home (the same shell as /quiz/home), minted as the hub reply does
 *                                         (the landing's en|ur in the token under web_quiz_return_lang);
 *                                         `from=quiz` = a known child arriving from /quiz (no "saved" line)
 *   bind     → the join page's bindPick({n, kid, device, src}) → { next } | { refused } — the one write of a binding;
 *              the landing has already checked `kid` is one of THIS phone's (or this device's) children
 */
const TEACHER_HOME_PATH = '/quiz/teacher/';
const MAKER_PATH = '/m/';
const TH_TTL_S = 24 * 60 * 60;

const Optional = require('./optional-modules');
const studentJoin = () => Optional.load('studentJoin');

/** A same-site path from the hub's absolute link (the edge passes only this site's paths on). */
function pathOf(url) {
  if (!url) return null;
  try { const u = new URL(url); return `${u.pathname}${u.search}`; } catch (_) { return null; }
}

/** A link that said bi: the teacher's stored language (en → en, ur → ur); absent or unreadable → bi. */
async function storedLang(uid) {
  try {
    const { data } = await require('../../config/supabase').from('users').select('preferred_language').eq('id', String(uid)).maybeSingle();
    const l = data && data.preferred_language;
    return l === 'en' || l === 'ur' ? l : 'bi';
  } catch (_) { return 'bi'; }
}

async function teacher({ uid, lang = 'bi' }) {
  if ((await require('./one-door.flags').flags()).teacherHome) {
    if (lang !== 'en' && lang !== 'ur') lang = await storedLang(uid);
    const M = Optional.load('teacherHomeToken');
    let t = null;
    if (M && typeof M.signTeacherHome === 'function') t = M.signTeacherHome({ uid: String(uid), lang, via: 'go' });
    else {
      const T = require('../quiz/web-quiz-token');
      t = T.sign({ k: 'th', uid: String(uid), lang, via: 'go', exp: Math.floor(Date.now() / 1000) + TH_TTL_S });
    }
    return t ? `${TEACHER_HOME_PATH}${t}` : null;
  }
  // the teacher home is not serving: the quiz-maker page is a working teacher screen when it is on
  const Maker = Optional.load('makerToken');
  if (Maker && typeof Maker.signMaker === 'function' && (await require('../quiz/web-quiz-identity-flags').flags()).makerPage) {
    const t = Maker.signMaker({ uid: String(uid), lang, tour: 0, via: 'menu' });
    return t ? `${MAKER_PATH}${t}` : null;
  }
  return null;
}

function join({ n, lang = 'bi' }) {
  const M = studentJoin();
  if (!M || typeof M.joinUrl !== 'function') return null;
  const url = M.joinUrl({ n, lang: lang === 'ur' ? 'ur' : 'bi' });
  return typeof url === 'string' && url ? (pathOf(url) || url) : null;
}

async function child(kids, from = 'quiz', lang = null) {
  // web_quiz_return_lang: the landing's language (en|ur; 'bi' is none) rides the hub token (off: today's link)
  const url = await require('../quiz/web-quiz-hub-flags').hubLink(kids, { caller: 'one_door', lang });
  const p = pathOf(url);
  if (!p) return null;
  return `${p}${p.includes('?') ? '&' : '?'}from=${from}`;
}

/** Can a binding be written from this landing (the join page's writer on this branch)? */
function canBind() {
  const M = studentJoin();
  return Boolean(M && typeof M.bindPick === 'function');
}

async function bindPick(args) {
  const M = studentJoin();
  if (!M || typeof M.bindPick !== 'function') return null;
  return M.bindPick(args);
}

module.exports = { teacher, join, child, canBind, bindPick, pathOf, storedLang, TEACHER_HOME_PATH, MAKER_PATH };
