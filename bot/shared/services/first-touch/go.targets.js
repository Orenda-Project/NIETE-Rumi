'use strict';
/**
 * Where the one door sends a person once the server knows who they are — named here, by constant, so the landing
 * never guesses a route. Each target is another page's own module; until it is on this branch the target answers
 * null and the landing shows the honest line instead (never a 500, never a dead button).
 *
 *   teacher  → /quiz/teacher/<th token>   the teacher home: `./teacher-home.token` exports signTeacherHome({uid, lang, via})
 *   join     → /j/<j token>               the join page: `./join.token` exports signJoin({uid, n, lang})
 *   child    → /h/<hub token>?src=quiz    the hub (the same shell as /quiz/home), minted as sendHub does
 *   autoBind / bindChosen                 the join page: `./join.service` exports bindOnLanding({phoneNorm, userId, kids})
 *                                         and bindChosen({phoneNorm, userId, kid}) → {ok, next?, error?}
 */
const TEACHER_HOME_PATH = '/quiz/teacher/';
const JOIN_PATH = '/j/';
const HUB_SRC = 'src=quiz';

function optional(mod) {
  try { return require(mod); } catch (_) { return null; }
}

/** A same-site path from the hub's absolute link (the edge passes only this site's paths on). */
function pathOf(url) {
  if (!url) return null;
  try { const u = new URL(url); return `${u.pathname}${u.search}`; } catch (_) { return null; }
}

function teacher({ uid, lang = 'bi' }) {
  const M = optional('./teacher-home.token');
  if (!M || typeof M.signTeacherHome !== 'function') return null;
  const t = M.signTeacherHome({ uid: String(uid), lang, via: 'go' });
  return t ? `${TEACHER_HOME_PATH}${t}` : null;
}

function join({ uid, n, lang = 'bi' }) {
  const M = optional('./join.token');
  if (!M || typeof M.signJoin !== 'function') return null;
  const t = M.signJoin({ uid: String(uid), n, lang });
  return t ? `${JOIN_PATH}${t}` : null;
}

async function child(kids) {
  const url = await require('../quiz/web-quiz-hub-flags').hubLink(kids, 'one_door');
  const p = pathOf(url);
  if (!p) return null;
  return `${p}${p.includes('?') ? '&' : '?'}${HUB_SRC}`;
}

async function autoBind(args) {
  const M = optional('./join.service');
  if (!M || typeof M.bindOnLanding !== 'function') return null;
  return M.bindOnLanding(args);
}

async function bindChosen(args) {
  const M = optional('./join.service');
  if (!M || typeof M.bindChosen !== 'function') return null;
  return M.bindChosen(args);
}

module.exports = { teacher, join, child, autoBind, bindChosen, pathOf, TEACHER_HOME_PATH, JOIN_PATH, HUB_SRC };
