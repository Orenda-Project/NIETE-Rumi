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

describe('a story the teacher sent this month', () => {
  const SHELF = [{ id: 'b1', title: 'The Thirsty Crow' }, { id: 'b2', title: 'Rain' }, { id: 'b3', title: 'The Moon' }];
  const BASE = '/quiz/teacher/T/stories';
  const story = (q, book, n, played = 9) => [q, { played, of: 30, date: day(n), topic: `Story ${q}`, source: 'story', book }];
  const shelfHome = (sends, o = {}) => home({ grade: 3, stories: SHELF, storiesBase: BASE, played: new Map(sends), ...o });

  test('a book sent within 30 days: the library pick is the next book, and the sent book carries its newest send\'s date', () => {
    const h = shelfHome([story('s1', 'b1', 10), story('s2', 'b1', 3), story('s3', 'b9', 2)]);
    expect(h.primary).toMatchObject({ kind: 'story', id: 'b2', title: 'Rain', href: `${BASE}?book=b2` });
    expect(h.library.stories).toEqual([
      { id: 'b1', title: 'The Thirsty Crow', href: `${BASE}?book=b1`, sent: day(3) },
      { id: 'b2', title: 'Rain', href: `${BASE}?book=b2` },
      { id: 'b3', title: 'The Moon', href: `${BASE}?book=b3` },
    ]);
  });

  test('a book sent 31 days ago (or a send with no book): no skip and no date', () => {
    const h = shelfHome([story('s1', 'b1', 31), story('s2', null, 2)]);
    expect(h.primary).toMatchObject({ kind: 'story', id: 'b1' });
    expect(h.library.stories.every((b) => !('sent' in b))).toBe(true);
  });

  test('a quiz that is not a story send never marks a book', () => {
    const h = shelfHome([['q1', { played: 9, of: 30, date: day(2), topic: 'Water', source: 'video', book: 'b1' }]]);
    expect(h.primary).toMatchObject({ kind: 'story', id: 'b1' });
    expect('sent' in h.library.stories[0]).toBe(false);
  });

  test('every shelf book sent: the pick falls to the video, then to the maker', () => {
    const all = [story('s1', 'b1', 4), story('s2', 'b2', 5), story('s3', 'b3', 6)];
    const h = shelfHome(all);
    expect(h.primary).toMatchObject({ kind: 'video', id: 'qv' });
    expect(h.library.stories.map((b) => b.sent)).toEqual([day(4), day(5), day(6)]);
    expect(shelfHome(all, { video: null, maker: '/m/x' }).primary).toEqual({ kind: 'make', href: '/m/x' });
  });

  test('a teacher with no story sends: the home is byte-identical to before', () => {
    // sha256(JSON)[:16] of this very home on the code before sent stories were known
    const played = new Map([['q1', { played: 9, of: 30, date: day(5), topic: 'Water', source: 'transcript' }], ['q2', { played: 7, of: null, date: day(40), topic: 'Shapes', source: 'video' }]]);
    const h = Model.buildHome({ first: 'Amina', grade: 3, played, stories: SHELF, storiesBase: BASE, video: VIDEO, maker: '/m/x', now: NOW });
    expect(require('crypto').createHash('sha256').update(JSON.stringify(h)).digest('hex').slice(0, 16)).toBe('f90b85165ab766f6');
  });
});

describe('the top card names what it sends again (only with `named`)', () => {
  const sent = (src) => new Map([['s1', { played: 0, of: 30, date: day(0.1), topic: "What's Next?", source: src, book: src === 'story' ? 'b1' : null }]]);

  test('a story send → item "story"; any other send → item "quiz"', () => {
    expect(home({ played: sent('story'), named: true }).primary).toMatchObject({ kind: 'class', title: "What's Next?", item: 'story' });
    expect(home({ played: sent('video'), named: true }).primary).toMatchObject({ kind: 'class', item: 'quiz' });
    expect(home({ shares: [share(0.1, 0)], named: true }).primary).toMatchObject({ kind: 'class', title: 'Shapes', item: 'quiz' });
    const own = { kind: 'lesson', key: 'lsn_own', date: day(0.1), state: 'sent', quizId: 'qo', topic: 'Water' };
    expect(home({ lessons: [own], played: new Map([['qo', { played: 0, of: 30, date: day(0.1), topic: 'Water' }]]), named: true }).primary)
      .toMatchObject({ kind: 'class', title: 'Water', item: 'quiz' });
  });

  test('without `named` the card is today\'s: no item key, the same JSON', () => {
    const off = home({ played: sent('story') });
    expect(off.primary.kind).toBe('class');
    expect('item' in off.primary).toBe(false);
    expect(JSON.stringify(home({ played: sent('story'), named: false }))).toBe(JSON.stringify(off));
  });
});
