'use strict';
/**
 * The teacher's report link token — kind `tr`.
 *
 * A teacher opens their quiz report at `/r/<token>`: from the /quiz menu, from
 * the post-completion PDF, from a template button. The token says WHOSE report
 * and WHICH quiz (`q`, or '*' for every class), and nothing else; every read
 * behind it filters on that teacher. It is signed with the web quiz's own key
 * (web-quiz-token sign/verify, so one secret and one HMAC rule) and lives 30
 * days, because it rides inside PDFs the teacher keeps.
 *
 * A child-page token (session `s`, preview `p`) is never a report token: the
 * kind is part of what is signed.
 */

const WQT = require('./web-quiz-token');

const KIND = 'tr';
const TTL_S = 30 * 24 * 60 * 60;
// Links PRINTED in a PDF the teacher may forward to a group: short-lived, so a forwarded
// PDF is not a month-long pass to the class's names and scores. The 30-day token rides
// only in the teacher's own WhatsApp message.
const PDF_TTL_S = 48 * 60 * 60;
const ALL = '*';

/**
 * @param {{teacherId: string, quizId?: string|null, ttlS?: number, now?: number}} args  ttlS: PDF_TTL_S for printed links
 * @returns {string|null} null when there is no teacher or no secret (fails closed)
 */
function signTeacherReport({ teacherId, quizId = null, ttlS = TTL_S, now = Date.now() } = {}) {
  if (!teacherId) return null;
  const life = Math.max(60, Math.min(TTL_S, Number(ttlS) || TTL_S)); // never longer than 30 days
  return WQT.sign({ k: KIND, t: String(teacherId), q: quizId ? String(quizId) : ALL, exp: Math.floor(now / 1000) + life });
}

/** { teacherId, quizId|null } for a genuine, unexpired report token; else null. */
function verifyTeacherReport(token) {
  const p = WQT.verify(token, KIND);
  if (!p || !p.t) return null;
  return { teacherId: p.t, quizId: p.q && p.q !== ALL ? p.q : null };
}

/**
 * Why a token was refused, for the page's message and the denied event:
 * 'expired' when it is genuine and of this kind but past its date, else 'bad'.
 * Only the expiry is read from an unverified body after the signature is
 * checked with the expiry ignored — never anything that grants access.
 */
function explain(token) {
  if (verifyTeacherReport(token)) return 'ok';
  try {
    const dot = String(token || '').indexOf('.');
    if (dot < 1) return 'bad';
    const body = token.slice(0, dot);
    const key = WQT.secret();
    if (!key) return 'bad';
    const crypto = require('crypto');
    const want = crypto.createHmac('sha256', key).update(body).digest('base64url').slice(0, 22);
    const sig = token.slice(dot + 1);
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return 'bad';
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p && p.k === KIND && p.exp && p.exp < Math.floor(Date.now() / 1000) ? 'expired' : 'bad';
  } catch {
    return 'bad';
  }
}

module.exports = { signTeacherReport, verifyTeacherReport, explain, KIND, TTL_S, PDF_TTL_S };
