'use strict';
/**
 * The ranked Next after a watched video (ctx `after_video`): `videos/start`'s WATCH answer (a child with no class,
 * web_quiz_home_v3) carries `watch.next` from the next-thing slot (switch `web_quiz_next_offer`, default OFF: no
 * `next` key and the answer is today's, byte for byte). The door's own three choices are candidates beside the child's:
 *
 *   the quiz after it   only under a watch root; href '#after/<vid>' (the door mints its code ON THE TAP, never here)
 *   the next lesson     the next in the subject screen's order this child has not finished; href '#watch/<vid>'
 *   more videos         href '#videos'
 *
 * Their words are the door's own (EN/UR, native-read). The slot's answer races its own deadline (offerFor), and the
 * caller asks it beside the video's signing, so a slow slot never adds to a fast video.
 *   watchNext({ studentId, vid, title, lang, kidLang, after, device })  -> { next } | {}  (never throws)
 */
const { subOf, artOr } = require('./web-quiz-next-offer-sources');

const COPY = Object.freeze({
  after: ['Play the quiz', 'کوئز کھیلیں'],
  next: ['Watch next', 'اگلی ویڈیو دیکھیں'],
  more: ['More videos', 'اور ویڈیوز دیکھیں'],
});
const words = (k) => ({ title: COPY[k][0], title_ur: COPY[k][1] });

/** The door's candidates for after this video (pure but for the next-lesson read). */
async function doorChoices({ studentId, vid, title, kidLang, after }) {
  const out = [];
  if (after) out.push({ kind: 'quiz', variant: 'after_video', id: `after.${vid}`, href: `#after/${vid}`, ...words('after'), ...subOf(title), minutes: 3, ...artOr(null, 'quiz') });
  const nx = await require('./web-quiz-library').nextLesson({ vid, studentId, lang: kidLang });
  if (nx) out.push({ kind: 'video', variant: 'next_lesson', id: nx.vid, href: `#watch/${nx.vid}`, ...words('next'), ...subOf(nx.title), minutes: 3, ...artOr(nx.poster, 'video') });
  out.push({ kind: 'video', variant: 'more', id: 'videos', href: '#videos', ...words('more'), minutes: 3, ...artOr(null, 'video') });
  return out;
}

async function watchNext({ studentId, vid, title = '', lang = null, kidLang = null, after = false, device = null } = {}) {
  try {
    if (!studentId || !device) return {};
    const R = require('./web-quiz-next-offer-result');
    if (!(await require('./web-quiz-next-offer').switches()).on) return {};
    const extra = await doorChoices({ studentId, vid, title, kidLang: kidLang || lang, after });
    const field = await R.offerFor({ studentId, device, lang, ctx: 'after_video', extra });
    const next = field && field.next_offer;
    return next && typeof next === 'object' && typeof next.href === 'string' ? { next } : {};
  } catch (_) {
    return {};
  }
}

module.exports = { watchNext, doorChoices, COPY };
