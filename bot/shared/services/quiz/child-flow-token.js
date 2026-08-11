'use strict';
/**
 * bd-2475 — the Student Videos Flow (STUDENT_VIDEOS_FLOW_ID) has always been
 * keyed by a registered `userId` (teacher). A "watch more videos" binge round
 * is offered to anonymous quiz-taking children — no `users` row, so there is
 * no userId to embed. This is the phone-keyed variant of that token, carrying
 * exactly what's needed to attribute the next round back to the same teacher
 * report (shareCodeId) and the same child (studentId), without ever creating
 * a `users` row for a child.
 *
 * Token shape: childpick:<phone>:<shareCodeId>:<studentId>:<language>:<ts>
 * Distinguished from a teacher token (`<userId>:student-videos:<ts>`) by the
 * `childpick:` prefix — a userId (UUID) never starts with that string.
 */

const PREFIX = 'childpick:';

const stripPlus = (p) => (p && p.startsWith('+') ? p.slice(1) : p);

function build({ phone, shareCodeId, studentId, language = 'en' }) {
  return `${PREFIX}${stripPlus(phone)}:${shareCodeId}:${studentId}:${language}:${Date.now()}`;
}

function parse(flowToken) {
  if (typeof flowToken !== 'string' || !flowToken.startsWith(PREFIX)) return null;
  const [phone, shareCodeId, studentId, language] = flowToken.slice(PREFIX.length).split(':');
  if (!phone || !shareCodeId || !studentId) return null;
  return { phone, shareCodeId, studentId, language: language || 'en' };
}

module.exports = { build, parse, PREFIX };
