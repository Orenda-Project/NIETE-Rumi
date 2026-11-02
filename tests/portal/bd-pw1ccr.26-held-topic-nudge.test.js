/**
 * bd-pw1ccr.26 — which chapter, if any, a teacher's topic-end nudge is held on (services/held-topic-nudge.service.js).
 * The rules live in one SQL statement; this pins the parts the card depends on and the row it hands back.
 */
const { heldTopicNudge, HELD_SQL } = require('../../dashboard/services/held-topic-nudge.service');

const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const CONTEXT = { topic_id: 'b', topic_name: 'Plurals', grade: 1, subject: 'english', chapter: 4, taken_at: '2026-11-02T04:00:00.000Z' };

test('a held row comes back as the chapter the card opens', async () => {
  const db = jest.fn(async () => ({ rows: [{ context: CONTEXT }] }));
  expect(await heldTopicNudge(db, TEACHER)).toEqual({ topicId: 'b', topicName: 'Plurals', grade: 1, subject: 'english', chapter: 4 });
  expect(db).toHaveBeenCalledWith(HELD_SQL, [TEACHER]);
});

test('nothing held, no teacher, or a row missing its chapter: null', async () => {
  expect(await heldTopicNudge(jest.fn(async () => ({ rows: [] })), TEACHER)).toBeNull();
  const db = jest.fn();
  expect(await heldTopicNudge(db, null)).toBeNull();
  expect(db).not.toHaveBeenCalled();
  expect(await heldTopicNudge(jest.fn(async () => ({ rows: [{ context: { ...CONTEXT, chapter: null } }] })), TEACHER)).toBeNull();
});

test('a database error is thrown, never read as nothing held', async () => {
  await expect(heldTopicNudge(jest.fn(async () => { throw new Error('down'); }), TEACHER)).rejects.toThrow('down');
});

test.each([
  ['her own topic-end rows only', /tn\.user_id = \$1[\s\S]*tn\.kind = 'topic_end_nudge'/],
  ['held = skipped because the window was shut', /tn\.status = 'skipped'[\s\S]*skip_reason' = 'window_closed'/],
  ['this school week only', /nudge_date >= \(\(now\(\) AT TIME ZONE 'Asia\/Karachi'\)::date - 6\)/],
  ['her school is in group B', /niete_topic_nudge_ab_assignment[\s\S]*ab_group = 'B'/],
  ['not once the nudge got through', /NOT EXISTS[\s\S]*s\.status = 'sent'/],
  ['not once she made a paper for the chapter since taking the plan', /NOT EXISTS[\s\S]*assessment_requests[\s\S]*chapter_number/],
])('the lookup keeps to %s', (_, re) => {
  expect(HELD_SQL).toMatch(re);
});
