'use strict';
/**
 * The teacher home's shape, pure: the reads in (teacher-home.data), the page's JSON out. No I/O, no clock but `now`.
 *
 * THE TOP CARD (the ONE job), in this order:
 *   class    the newest send of the last 72 h that FEW children have finished (< 5): the class line in words + "Send
 *            again" (the report page's own re-forward when the report is on for this teacher, else the class message
 *            again) + "See report" when there is one
 *   story    else the stories shelf's first book for the class's grade (a link to the stories page's own sheet)
 *   video    else the bank's ready video quiz for that grade, its class message already built ("Send to my class")
 *   make     else the maker page
 * (between class and story: an un-quizzed lesson plan or coaching session of the last 7 days → "Quiz from your last
 *  lesson: <topic>" with "Quiz this", the library card second)
 * THE TIMELINE: lesson plans, coaching sessions and sent quizzes (stories too), newest first; each row ONE verb:
 *   quiz_this (a lesson or a session with no quiz yet) · again (a sent quiz) · none (a quiz being made)
 */
const SEND_WINDOW_MS = 72 * 3600 * 1000;
const LESSON_WINDOW_MS = 7 * 86400000;
const FEW = 5;
const MAX_ROWS = 30;
const SENT = new Set(['sent', 'report_sent']);

const ms = (v) => { const t = new Date(v || 0).getTime(); return Number.isFinite(t) ? t : 0; };

/** One timeline row from a /quiz list row. */
function lessonRow(r, played, reports) {
  const tag = r.kind === 'session' ? 'coach' : 'lp';
  const row = { kind: tag, key: r.key, title: r.topic || '', date: r.date || null, verb: null, id: null, sendKind: null };
  if (SENT.has(r.state) && r.quizId) {
    const p = played.get(r.quizId);
    Object.assign(row, { verb: 'again', id: r.quizId, sendKind: 'again', played: p ? p.played : 0 });
    const rep = reports.get(r.quizId);
    if (rep) row.report = rep.live;
  } else if (r.state === 'making') {
    row.status = 'making';
    row.quizId = r.quizId;
  } else if (r.kind === 'lesson' || (r.kind === 'session' && ['none', 'offered', 'failed'].includes(r.state))) {
    Object.assign(row, { verb: 'quiz_this', id: r.key, make: r.kind === 'lesson' ? 'lesson' : 'coaching' });
  }
  return row;
}

/** One timeline row from a sent quiz of the teacher's that /quiz's list does not carry (a story send, an older quiz). */
function ownRow(id, p, reports) {
  const row = { kind: p.source === 'story' ? 'story' : 'quiz', key: `q_${id}`, title: p.topic || '', date: p.date || null, verb: 'again', id, sendKind: 'again', played: p.played || 0 };
  const rep = reports.get(id);
  if (rep) row.report = rep.live;
  return row;
}

/** The sent quizzes of the report that the lessons list does not already show. */
const extraOwn = (lessons, played) => {
  const shown = new Set(lessons.map((r) => r.quizId).filter(Boolean));
  return [...played.entries()].filter(([id]) => !shown.has(id));
};

/** One timeline row from a library send (the maker's). */
const shareRow = (s) => ({
  kind: 'quiz', key: `sc_${s.shareCodeId}`, title: s.topic || '', date: s.at, verb: 'again', id: s.shareCodeId, sendKind: 'share', played: s.played,
});

/** The newest send of the window with few children finished, as the class card; or null. */
function classCard({ lessons, played, shares, reports, now }) {
  const sends = [];
  extraOwn(lessons, played).forEach(([id, p]) => sends.push({ own: true, id, title: p.topic || '', at: ms(p.date), played: p.played || 0 }));
  lessons.filter((r) => SENT.has(r.state) && r.quizId).forEach((r) => {
    const p = played.get(r.quizId);
    sends.push({ own: true, id: r.quizId, title: r.topic || (p && p.topic) || '', at: ms((p && p.date) || r.date), played: p ? p.played : 0 });
  });
  shares.forEach((s) => sends.push({ own: false, id: s.shareCodeId, title: s.topic || '', at: ms(s.at), played: s.played }));
  const recent = sends.filter((s) => now - s.at <= SEND_WINDOW_MS && s.at <= now + 60000).sort((a, b) => b.at - a.at);
  const top = recent[0];
  if (!top || top.played >= FEW) return null;
  const rep = top.own ? reports.get(top.id) : null;
  return {
    kind: 'class', title: top.title, played: top.played,
    again: rep && rep.remind ? { href: rep.remind } : { sendKind: top.own ? 'again' : 'share', id: top.id },
    report: rep ? rep.live : null,
  };
}

/**
 * → the page's JSON (minus the class messages, which the router adds for the cards that send from the page).
 * `stories` = the shelf's books for `grade` or null; `video` = the bank pick or null; `storiesBase` = the stories
 * page's path for this token, or null when the stories page is not there.
 */
function buildHome({
  first = null, grade = 2, lessons = [], played = new Map(), shares = [], reports = new Map(), stories = null,
  video = null, maker = null, storiesBase = null, children = null, confirm = [], tryStudent = null, change = false,
  now = Date.now(),
}) {
  const rows = [...lessons.map((r) => lessonRow(r, played, reports)), ...extraOwn(lessons, played).map(([id, p]) => ownRow(id, p, reports)), ...shares.map(shareRow)]
    .sort((a, b) => ms(b.date) - ms(a.date)).slice(0, MAX_ROWS);
  const books = Array.isArray(stories) && stories.length && storiesBase
    ? stories.map((b) => ({ id: b.id, title: b.title, href: `${storiesBase}?book=${encodeURIComponent(b.id)}` })) : [];
  let primary = classCard({ lessons, played, shares, reports, now });
  if (!primary) primary = lastLesson(rows, now);
  if (!primary && books.length) primary = { kind: 'story', id: books[0].id, title: books[0].title, href: books[0].href, grade };
  if (!primary && video) primary = { kind: 'video', id: video.quizId, title: video.topic, grade };
  if (!primary && maker) primary = { kind: 'make', href: maker };
  const zeroKidsOpen = lessons.filter((r) => SENT.has(r.state) && r.quizId && now - ms((played.get(r.quizId) || {}).date || r.date) <= 7 * 86400000
    && !((played.get(r.quizId) || {}).played)).length + shares.filter((s) => now - ms(s.at) <= 7 * 86400000 && !s.played).length;
  return {
    first, grade, primary: primary || { kind: 'none' }, timeline: rows,
    library: { grade, stories: books, all: books.length ? storiesBase : null, video: video ? { id: video.quizId, title: video.topic } : null },
    maker, children, confirm, tryStudent, change,
    facts: {
      has_lp: lessons.some((r) => r.kind !== 'session'), has_coaching: lessons.some((r) => r.kind === 'session'),
      zero_kids_open: zeroKidsOpen, primary_kind: primaryKind(primary),
    },
  };
}

/** The newest lesson plan or coaching session of the last 7 days with no quiz yet, as the top card; or null. */
function lastLesson(rows, now) {
  const r = rows.find((x) => x.verb === 'quiz_this' && x.date && now - ms(x.date) <= LESSON_WINDOW_MS);
  return r ? { kind: 'lesson', id: r.id, make: r.make, title: r.title, from: r.kind } : null;
}

/** The event's name for the top card. */
function primaryKind(p) {
  if (!p) return 'none';
  if (p.kind === 'class') return 'class_line';
  if (p.kind === 'lesson') return p.make === 'coaching' ? 'coaching_quiz' : 'lp_quiz';
  if (p.kind === 'story' || p.kind === 'video' || p.kind === 'make') return 'library';
  return p.kind;
}

module.exports = { buildHome, classCard, lessonRow, shareRow, ownRow, lastLesson, primaryKind, SEND_WINDOW_MS, LESSON_WINDOW_MS, FEW, MAX_ROWS };
