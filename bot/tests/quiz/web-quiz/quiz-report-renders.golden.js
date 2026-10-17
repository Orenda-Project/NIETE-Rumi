'use strict';
/** The teacher report's QUIZ renders (EN + UR, screen + PDF, notices, class-list states, the class tab's quiz rows):
 * one string, compared against the committed golden so a story change never moves a quiz report's bytes. */
module.exports = function renders(page) {
  const { renderPage, renderMessagePage } = page;
const LINK = 'https://x.test/q/AB';
const base = (o = {}) => ({
  quiz: { id: 'q-1', topic: 'Plants', subject: 'science', grade: '5', source: 'lp_v8', date: '2026-10-05T09:00:00Z' },
  roster: { state: 'known', className: '5-A', lists: [{ id: 'l', label: '5-A' }] },
  summary: { played: 1, of: 3, avg: 60, hardestN: 2 },
  played: [{ first: 'Ayesha', roll: 2, correct: 3, total: 4, pct: 75, onList: true }, { first: 'Bilal', correct: 1, total: 4, pct: 25, onList: false }],
  notPlayed: [{ first: 'Hina', roll: 1, studentId: 's1' }],
  provisional: [{ typed: 'Zed Q', sessionId: 'x', correct: 1, total: 4 }],
  questions: [{ n: 1, text: 'Q?', correctPct: 50, wrongTop: { option: 'B', text: 'W', pct: 50 } }],
  guidance: { muddled: 'm', board: 'b', check: 'c' },
  reminder: { text: `Play ${LINK}` }, ...o });
const variants = [base(), base({ notPlayed: [] }), base({ roster: { state: 'ambiguous', lists: [{ id: 'a', label: '5-A' }, { id: 'b', label: '5-B' }] } }), base({ roster: { state: 'none', lists: [] } }), base({ quiz: { id: 'q2' } })];
let out = '';
for (const lang of ['en', 'ur']) for (const print of [false, true]) for (const notice of [null, 'closed', 'failed']) variants.forEach((v) => {
  out += renderPage({ quiz: v }, { lang, print, notice, tab: 'quiz', tokens: { self: 'T' }, now: 1 }) + '\n=====\n';
});
for (const lang of ['en', 'ur']) out += renderPage({ class: { cells: [{ grade: '5', subject: 'science', quizzes: 2, played: 3, avg: 50 }], weeks: [{ weekStart: '2026-10-05', played: 2, avg: 40 }], quizzes: [{ id: 'q', topic: 'P', date: '2026-10-05', played: 2, of: 5, avg: 40 }] } }, { lang, tab: 'class', tokens: { self: 'T', quiz: { q: 'tq' } }, now: 1 });
out += renderMessagePage({}) + renderMessagePage({ kind: 'expired', lang: 'ur' });

// More "All my classes" shapes of quiz rows only (with/without a class size, nobody played, print, a
// sent library quiz, no rows) — these must not change a byte.
const rows = [
  { id: 'q', topic: 'P', date: '2026-10-05', played: 2, of: 5, avg: 40, source: 'lp_v8' },
  { id: 'r', topic: 'Q', date: '2026-10-04', played: 4, of: null, avg: 75, source: 'transcript', sent: true },
  { id: 's', topic: 'R', date: '2026-10-03', played: 0, of: 9, avg: null, source: 'lp_v8' },
];
let more = '';
for (const lang of ['en', 'ur']) for (const print of [false, true]) for (const qz of [rows, [rows[1]], [rows[2]], []]) {
  more += renderPage({ class: { cells: [{ grade: '5', subject: 'science', quizzes: 2, played: 3, avg: 50 }], weeks: [], quizzes: qz } }, { lang, print, tab: 'class', scope: 'quiz', tokens: { self: 'T', quiz: { q: 'tq' } }, now: 1 }) + '\n=====\n';
}
  return out + more;
};
