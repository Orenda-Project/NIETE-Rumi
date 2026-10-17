'use strict';
/**
 * The top card's lesson rule: an un-quizzed lesson plan or coaching session of the last 7 days is the top card only
 * when it is NEWER than the teacher's last send (a teacher who already sent something since that lesson is offered the
 * library, not a quiz of an older lesson).
 */
const Model = require('../../shared/services/first-touch/teacher-home.model');

const NOW = Date.parse('2026-10-16T12:00:00Z');
const day = (n) => new Date(NOW - n * 86400000).toISOString();
const lesson = (n, topic) => ({ kind: 'lesson', key: `lsn_${n}`, date: day(n), state: 'none', quizId: null, topic });
const share = (n, played) => ({ shareCodeId: `sc${n}`, quizId: `q${n}`, topic: 'Shapes', at: day(n), played });
const VIDEO = { quizId: 'qv', topic: 'Fractions' };
const home = (o) => Model.buildHome({ grade: 4, video: VIDEO, now: NOW, ...o });

test('a lesson newer than the last send is the top card', () => {
  expect(home({ lessons: [lesson(1, 'Plants')], shares: [share(2, 9)] }).primary).toMatchObject({ kind: 'lesson', title: 'Plants' });
  expect(home({ lessons: [lesson(1, 'Plants')] }).primary).toMatchObject({ kind: 'lesson', title: 'Plants' });
});

test('a lesson older than the last send is not: the library pick is', () => {
  const h = home({ lessons: [lesson(2, 'Plants')], shares: [share(1, 9)] });
  expect(h.primary.kind).toBe('video');
  expect(h.facts.primary_kind).toBe('library');
  expect(h.timeline.find((r) => r.key === 'lsn_2')).toMatchObject({ verb: 'quiz_this' });
});

test('the teacher\'s own sent quiz counts as a send too', () => {
  const own = { kind: 'lesson', key: 'lsn_own', date: day(1), state: 'sent', quizId: 'qo', topic: 'Water' };
  const played = new Map([['qo', { played: 9, of: 30, date: day(1), topic: 'Water' }]]);
  expect(home({ lessons: [lesson(3, 'Plants'), own], played }).primary.kind).toBe('video');
  expect(home({ lessons: [lesson(0.5, 'Plants'), own], played }).primary).toMatchObject({ kind: 'lesson', title: 'Plants' });
});
