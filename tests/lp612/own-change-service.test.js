'use strict';
/**
 * bd-snkn32.15 — "Change this plan": the request (lp612-own-change). Every dependency is passed in: no Supabase, no
 * queue. The guard's rules are pinned in own-edit-guard.test.js; this pins what the service does with them — above
 * all, that a refusal writes nothing and queues nothing (no money spent).
 */
const { createChangeService } = require('../../bot/shared/services/lp612-own-change');
const { OWN_JOB_TYPE } = require('../../bot/shared/services/lp612-own.service');

const ANSWERS = { size: '51_70', resources: ['textbook'], level: 'mixed', way: 'practical', note: '' };
const ROOT = {
  id: 'root', user_id: 'u1', segment_id: 'grade_8_science.c02.p010-013', lesson_id: null, lang: 'en',
  template_version: 'v9.1', answers: ANSWERS, status: 'ready', parent_own_id: null, edit_round: null, edit_request: null,
};
const K5_ROOT = { ...ROOT, segment_id: null, lesson_id: 'grade_3_urdu_ch1_seg2', lang: 'ur', template_version: 'k5_own_v1' };
const ASK = { userId: 'u1', ownId: 'root', part: 'activity', text: 'Use a role play with four groups of students', correlationId: 'c1' };

function harness({ chain = [ROOT], today = 0, insert, ...over } = {}) {
  const calls = { inserts: [], queued: [], since: [] };
  const deps = {
    selectOwn: jest.fn(async (id, userId) => chain.find((r) => r.id === id && r.user_id === userId) || null),
    listChain: jest.fn(async () => chain),
    countToday: jest.fn(async (userId, since) => { calls.since.push(since); return today; }),
    insertOwn: jest.fn(insert || (async (row) => { calls.inserts.push(row); return { id: 'chg-1' }; })),
    patchOwn: jest.fn(async () => {}),
    queueJob: jest.fn(async (...args) => { calls.queued.push(args); }),
    now: () => Date.parse('2026-11-10T20:30:00Z'),
    log: jest.fn(),
    ...over,
  };
  return { svc: createChangeService(deps), deps, calls };
}

it('queues round 1 as a new row under the root, copying the root, with her request', async () => {
  const { svc, calls } = harness();
  expect(await svc.requestChange(ASK)).toEqual({ outcome: 'queued', ownId: 'chg-1' });
  expect(calls.inserts[0]).toEqual({
    user_id: 'u1', segment_id: ROOT.segment_id, lang: 'en', template_version: 'v9.1', answers: ANSWERS,
    status: 'authoring', correlation_id: 'c1', parent_own_id: 'root', edit_round: 1,
    edit_request: { part: 'activity', text: ASK.text },
  });
  expect(calls.queued[0].slice(0, 3)).toEqual([ROOT.segment_id, OWN_JOB_TYPE, { ownId: 'chg-1', correlationId: 'c1' }]);
  expect(calls.since[0]).toBe('2026-11-10T19:00:00.000Z'); // her Pakistan day
});

it('asked from round 1, round 2 still hangs off the root', async () => {
  const r1 = { ...ROOT, id: 'r1', parent_own_id: 'root', edit_round: 1, edit_request: { part: 'hook', text: 'x' } };
  const { svc, deps, calls } = harness({ chain: [ROOT, r1] });
  await svc.requestChange({ ...ASK, ownId: 'r1' });
  expect(deps.listChain).toHaveBeenCalledWith('root', 'u1');
  expect(calls.inserts[0]).toMatchObject({ parent_own_id: 'root', edit_round: 2 });
});

it('a grades 1–5 day keeps its lesson, its book language and its parts', async () => {
  const { svc, calls } = harness({ chain: [K5_ROOT] });
  await svc.requestChange({ ...ASK, part: 'we_do', text: 'بچوں کو جوڑوں میں کنکروں سے گنتی کروائیں' });
  expect(calls.inserts[0]).toMatchObject({ lesson_id: K5_ROOT.lesson_id, lang: 'ur', edit_request: { part: 'we_do' } });
  expect(calls.inserts[0]).not.toHaveProperty('segment_id');
  expect(calls.queued[0][0]).toBe(K5_ROOT.lesson_id);
});

it.each([
  ['someone else\'s plan', { ...ASK, userId: 'u2' }, {}, 'not_found'],
  ['no plan id', { ...ASK, ownId: undefined }, {}, 'bad_request'],
  ['a part from the other band', { ...ASK, part: 'we_do' }, {}, 'bad_request'],
  ['too short', { ...ASK, text: 'more games' }, {}, 'too_short'],
  ['only punctuation', { ...ASK, text: 'Please add a full stop at the end of each line' }, {}, 'too_small'],
  ['five already today', ASK, { today: 5 }, 'daily_limit'],
  ['a round still being written', ASK, { chain: [ROOT, { ...ROOT, id: 'r1', parent_own_id: 'root', edit_round: 1, status: 'authoring' }] }, 'in_flight'],
])('%s: refused, nothing written, nothing queued', async (_, ask, over, outcome) => {
  const { svc, deps } = harness(over);
  expect((await svc.requestChange(ask)).outcome).toBe(outcome);
  expect(deps.insertOwn).not.toHaveBeenCalled();
  expect(deps.queueJob).not.toHaveBeenCalled();
});

it('two taps at once: the database\'s unique round refuses the second as in flight', async () => {
  const { svc, deps } = harness({ insert: async () => ({ conflict: true }) });
  expect((await svc.requestChange(ASK)).outcome).toBe('in_flight');
  expect(deps.queueJob).not.toHaveBeenCalled();
});

it('an insert that fails is an error, never queued', async () => {
  const { svc, deps } = harness({ insert: async () => null });
  expect((await svc.requestChange(ASK)).outcome).toBe('error');
  expect(deps.queueJob).not.toHaveBeenCalled();
});

it('a queue that fails marks the row failed, so it never counts', async () => {
  const { svc, deps } = harness({ queueJob: jest.fn(async () => { throw new Error('sqs down'); }) });
  expect((await svc.requestChange(ASK)).outcome).toBe('error');
  expect(deps.patchOwn).toHaveBeenCalledWith('chg-1', expect.objectContaining({ status: 'failed', error_code: 'ENQUEUE_FAILED' }));
});
