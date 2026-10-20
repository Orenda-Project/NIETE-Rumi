'use strict';
/**
 * Who the big flight is for (switch sa_game, default OFF): the child a hub token and chip name on this phone, the same
 * check the games door makes (web-quiz-hub kidFromHub: a forwarded link opens nothing).
 *
 *   info({ token, kid, device, lang })  → { status: 404 } off | { status: 401 } no child | { status: 403, lang } not
 *     eligible | { status: 200, body }; body = { ok: true, lang: 'en'|'ur', grade, form: 'game.G1'|'game.G23'|'game.G45' }
 *
 * The grade is the Challenge's own server-side chain (enrolment, list, the child's own pick, the newest quiz session;
 * web-quiz-challenge gradeOf), and the form its band (grade 1; 2–3; 4–5). An unknown grade or one outside 1–5 has no
 * form: the child gets the not-eligible note, never a guessed form. No name,
 * no phone and no id leave here: the page knows the child only by the token and chip it already has.
 */
const Flag = require('./flag');
const { clampLanguage } = require('../../config/ux-strings');

function formOf(grade) {
  const g = parseInt(String(grade == null ? '' : grade).replace(/\D/g, ''), 10);
  if (g === 1) return 'game.G1';
  if (g === 2 || g === 3) return 'game.G23';
  if (g === 4 || g === 5) return 'game.G45';
  return null;
}

async function info({ token, kid, device, lang } = {}) {
  if (!(await Flag.on())) return { status: 404 };
  const who = await require('../quiz/web-quiz-hub').kidFromHub(String(token || ''), kid == null ? null : String(kid), device == null ? undefined : String(device));
  if (!who || !who.studentId) return { status: 401 };
  const l = clampLanguage(lang === 'en' || lang === 'ur' ? lang : who.lang || 'ur') === 'en' ? 'en' : 'ur';
  const grade = await require('../quiz/web-quiz-challenge').gradeOf({ studentId: who.studentId });
  const form = formOf(grade);
  if (!form) return { status: 403, lang: l };
  return { status: 200, body: { ok: true, lang: l, grade: String(grade), form } };
}

module.exports = { info, formOf };
