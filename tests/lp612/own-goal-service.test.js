/**
 * bd-snkn32.56 — the request side of a goal start: it is refused unless portal_lp_own_goal_start names her (the bot
 * checks again; the portal hiding the button is not the guard), and a goal plan takes no book pages or next lesson.
 */
const { createOwnService } = require('../../bot/shared/services/lp612-own.service');

const SEG = 'grade_8_science.c02.p010-013';
const ANSWERS = { size: '51_70', resources: ['board'], level: 'mixed', way: 'worked', note: '', goal: { kind: 'topic', text: 'Magnets and poles' } };

function harness(goalOn) {
  const inserts = [];
  const deps = {
    templateVersion: () => 'v9.1',
    segmentExists: jest.fn(async (id) => id === SEG),
    readStoredDoc: jest.fn(async () => ({ sections: {} })),
    requestParent: jest.fn(async () => ({ outcome: 'queued' })),
    insertOwn: jest.fn(async (row) => { inserts.push(row); return { id: 'own-1' }; }),
    patchOwn: jest.fn(),
    queueJob: jest.fn(async () => {}),
    countToday: jest.fn(async () => 0),
    goalStartOn: jest.fn(async (userId) => goalOn && userId === 'u1'),
    now: () => Date.now(),
    log: jest.fn(),
  };
  return { svc: createOwnService(deps), deps, inserts };
}

describe('requestOwn with a goal', () => {
  it('is refused when the goal start is off for her, before anything is written', async () => {
    const { svc, deps } = harness(false);
    const out = await svc.requestOwn({ userId: 'u1', segmentId: SEG, answers: ANSWERS });
    expect(out.outcome).toBe('not_found');
    expect(deps.insertOwn).not.toHaveBeenCalled();
  });

  it('is refused for someone not on the list', async () => {
    const { svc } = harness(true);
    expect((await svc.requestOwn({ userId: 'u2', segmentId: SEG, answers: ANSWERS })).outcome).toBe('not_found');
  });

  it('on for her: queued, her goal saved with her answers, no textbook', async () => {
    const { svc, inserts } = harness(true);
    const out = await svc.requestOwn({ userId: 'u1', segmentId: SEG, answers: ANSWERS });
    expect(out.outcome).toBe('queued');
    expect(inserts[0].answers.goal).toEqual({ kind: 'topic', text: 'Magnets and poles' });
    expect(inserts[0].answers.resources).not.toContain('textbook');
  });

  it('takes no book pages and no next lesson', async () => {
    const { svc } = harness(true);
    expect((await svc.requestOwn({ userId: 'u1', segmentId: SEG, answers: { ...ANSWERS, pages: { start: 10, end: 11 } } })).outcome).toBe('bad_request');
    expect((await svc.requestOwn({ userId: 'u1', segmentId: SEG, answers: { ...ANSWERS, extend: { next: 'x', shape: 'both' } } })).outcome).toBe('bad_request');
  });

  it('with no flag reader wired at all, a goal is refused (fail-closed)', async () => {
    const { svc, deps } = harness(true);
    delete deps.goalStartOn;
    const s2 = createOwnService(deps);
    expect((await s2.requestOwn({ userId: 'u1', segmentId: SEG, answers: ANSWERS })).outcome).toBe('not_found');
    expect((await svc.requestOwn({ userId: 'u1', segmentId: SEG, answers: { ...ANSWERS, goal: undefined } })).outcome).toBe('queued');
  });
});
