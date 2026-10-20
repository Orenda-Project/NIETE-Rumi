'use strict';
/**
 * Who the big flight is for (switch sa_game, default OFF): the child a hub token and chip name on this phone, the same
 * check the games door makes (web-quiz-hub kidFromHub: a forwarded link opens nothing).
 *
 *   info({ token, kid, device, lang })  → { status: 404 } off | { status: 401 } no child | { status: 200, body }
 *     body = { ok: true, lang: 'en'|'ur', grade, form: 'game.G1'|'game.G23'|'game.G45' }
 *
 * The form names the game's grade band in the battery file (the Challenge's bands: grade 1; 2–3; 4–5 and up). No name,
 * no phone and no id leave here: the page knows the child only by the token and chip it already has.
 */
const Flag = require('./flag');
const { clampLanguage } = require('../../config/ux-strings');

function formOf(grade) {
  const g = parseInt(String(grade == null ? '' : grade).replace(/\D/g, ''), 10);
  if (g === 1) return 'game.G1';
  if (g === 2 || g === 3) return 'game.G23';
  if (g >= 4) return 'game.G45';
  return 'game.G23';
}

async function info({ token, kid, device, lang } = {}) {
  if (!(await Flag.on())) return { status: 404 };
  const who = await require('../quiz/web-quiz-hub').kidFromHub(String(token || ''), kid == null ? null : String(kid), device == null ? undefined : String(device));
  if (!who || !who.studentId) return { status: 401 };
  const l = clampLanguage(lang === 'en' || lang === 'ur' ? lang : who.lang || 'ur');
  return { status: 200, body: { ok: true, lang: l === 'en' ? 'en' : 'ur', grade: who.grade == null ? null : String(who.grade), form: formOf(who.grade) } };
}

module.exports = { info, formOf };
