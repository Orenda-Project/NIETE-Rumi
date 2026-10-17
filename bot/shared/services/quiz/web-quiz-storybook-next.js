'use strict';
/**
 * The storybooks the next-thing ranker may offer (web-quiz-next-offer-sources.js asks this module when it is present):
 *
 *   candidates({ studentId, lang, grade, token, chip })  →  [{ kind:'storybook', id, href, title, title_ur, minutes,
 *                                                              art, rule? }]
 *
 * First the newest half-read ready book of the last 7 days (`rule:'resume'`, the same rule as the hub's
 * `stories.resume`), then up to MAX_UNREAD unread ready books of the child's grade and language in the child's shelf
 * order; `minutes` is pages × 0.4, rounded, at least 1. `href` opens the reader on the child's own hub link (the
 * half-read book at its `resume.page_n`: `#story/<id>/p<N>`). `[]` while `web_quiz_stories` is off, when no link can be
 * built, or on any failure: it never throws.
 */
const { clampLanguage } = require('../../config/ux-strings');

const MAX_UNREAD = 3;
const MIN_PER_PAGE = 0.4;

const enc = encodeURIComponent;
const minutesOf = (b) => Math.max(1, Math.round((Number(b.pages) || 0) * MIN_PER_PAGE));

function row(b, art, link, rule) {
  // The book has one title, in its own language: the tile shows it in either. No cover: the tile uses Jugnu's picture.
  return {
    kind: 'storybook', id: b.id, ...(rule ? { rule } : {}), href: link(b.id), title: b.title, title_ur: b.title,
    minutes: minutesOf(b), ...(art ? { art } : {}),
  };
}

async function candidates({ studentId, lang, grade, token, chip, now = Date.now() } = {}) {
  try {
    if (!studentId || !token || !chip) return [];
    const S = require('./web-quiz-stories'); // eslint-disable-line global-require
    if (!(await S.storiesOn(now))) return [];
    const l = clampLanguage(lang);
    const link = (id) => `/h/${enc(token)}?kid=${enc(chip)}&lang=${l}#story/${enc(id)}`;
    const [resume, { ordered, done }] = await Promise.all([
      S.resumeOf(studentId, now),
      S.orderedBooks(studentId, { grade: S.gradeOf(grade) || 1, lang: l, now }),
    ]);
    const out = [];
    // the half-read book opens on the page after the last one the child heard or read (the reader reads /p<N>)
    if (resume) out.push(row({ id: resume.book_id, title: resume.title, pages: resume.pages }, resume.cover, (id) => `${link(id)}/p${resume.page_n}`, 'resume'));
    ordered.filter((b) => !done.has(b.id) && !(resume && b.id === resume.book_id)).slice(0, MAX_UNREAD)
      .forEach((b) => out.push(row(b, S.fileUrl(b.id, b.cover_file), link)));
    return out;
  } catch (_) {
    return [];
  }
}

module.exports = { candidates, MAX_UNREAD, _reset: () => {} };
