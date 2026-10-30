'use strict';
/**
 * bd-pw1ccr.4.2 — which topic a lesson finishes, and when the topic-end nudge goes out. Pure.
 * Mapping checked on sandbox: lesson day = the chapter's first topic day + segment_index − 1
 * (230 of 233 chapters align; G1 Maths ch2-4 do not).
 */
const T = require('../../bot/shared/services/nudges/topic-end');

const seg = (i, id = `l${i}`) => ({ lesson_id: id, segment_index: i });
// G1 English ch4 shape: eight teaching days 27-34, a worksheet (995) and a revision (990).
const LESSONS = [seg(1), seg(2), seg(3), seg(4), seg(4, 'l4b'), seg(5), seg(6), seg(7), seg(8), seg(995), seg(990)];
const TOPICS = [
  { topicId: 'a', name: 'Poem', days: [27, 28] },
  { topicId: 'b', name: 'Plurals', days: [29, 30, 31] },
  { topicId: 'c', name: 'ABC Order', days: [32, 33, 34] },
];

describe('topicEndingAt', () => {
  test('the last day of a topic finishes it', () => {
    expect(T.topicEndingAt({ lessons: LESSONS, topics: TOPICS, segmentIndex: 2 })).toEqual({ topic: TOPICS[0] });
    expect(T.topicEndingAt({ lessons: LESSONS, topics: TOPICS, segmentIndex: 8 })).toEqual({ topic: TOPICS[2] });
  });

  test('a day inside a topic finishes nothing', () => {
    expect(T.topicEndingAt({ lessons: LESSONS, topics: TOPICS, segmentIndex: 4 })).toEqual({ reason: 'topic_continues' });
  });

  test('a split day counts once, both parts map to the same day', () => {
    expect(T.topicEndingAt({ lessons: LESSONS, topics: TOPICS, segmentIndex: 5 })).toEqual({ topic: TOPICS[1] });
  });

  test('worksheets and revision are not teaching days', () => {
    expect(T.topicEndingAt({ lessons: LESSONS, topics: TOPICS, segmentIndex: 995 })).toEqual({ reason: 'not_a_teaching_day' });
  });

  test('a chapter with no topics', () => {
    expect(T.topicEndingAt({ lessons: LESSONS, topics: [], segmentIndex: 2 })).toEqual({ reason: 'no_topics' });
  });

  test('a chapter whose days do not line up with its lessons is skipped', () => {
    const short = TOPICS.slice(0, 2); // 5 days for 8 lessons
    expect(T.topicEndingAt({ lessons: LESSONS, topics: short, segmentIndex: 2 })).toEqual({ reason: 'chapter_unaligned' });
    const gap = LESSONS.filter((l) => l.segment_index !== 3);
    expect(T.topicEndingAt({ lessons: gap, topics: TOPICS, segmentIndex: 2 })).toEqual({ reason: 'chapter_unaligned' });
  });
});

describe('topicsSubject', () => {
  test('catalog keys to topic keys', () => {
    expect(T.topicsSubject('math')).toBe('maths');
    expect(T.topicsSubject('general_science')).toBe('science');
    expect(T.topicsSubject('english')).toBe('english');
    expect(T.topicsSubject('urdu')).toBe('urdu');
    expect(T.topicsSubject('islamiat')).toBeNull();
  });
});

describe('scheduleFor', () => {
  // 2026-11-02 is a Monday.
  test('taken in the morning: that afternoon, after the lesson is taught', () => {
    const s = T.scheduleFor(new Date('2026-11-02T04:00:00Z')); // 09:00 PKT
    expect(s.nudgeDate).toBe('2026-11-02');
    expect(s.scheduledAt.toISOString()).toBe('2026-11-02T09:30:00.000Z'); // 14:30 PKT
  });

  test('taken after the cutoff: the next school day, Friday evening → Monday', () => {
    const s = T.scheduleFor(new Date('2026-11-06T14:00:00Z')); // Fri 19:00 PKT
    expect(s.nudgeDate).toBe('2026-11-09');
    expect(s.scheduledAt.toISOString()).toBe('2026-11-09T09:30:00.000Z');
  });

  test('taken at the weekend: Monday', () => {
    expect(T.scheduleFor(new Date('2026-11-07T05:00:00Z')).nudgeDate).toBe('2026-11-09');
  });
});

describe('retryDate', () => {
  test('window shut: the next school day in the same week', () => {
    expect(T.retryDate('2026-11-02')).toBe('2026-11-03');
    expect(T.retryDate('2026-11-05')).toBe('2026-11-06');
  });

  test('Friday has no retry', () => {
    expect(T.retryDate('2026-11-06')).toBeNull();
  });
});
