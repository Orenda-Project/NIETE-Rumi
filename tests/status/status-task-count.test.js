/**
 * /status counts TASKS, not the actions you can take on them (bd-43516).
 *
 * A teacher with ONE coaching session in flight was told "You have 2 things
 * running right now.", and the summary read:
 *
 *   • Continue: classroom observation
 *   • Stop: classroom observation
 *
 * Those are two actions on one task. listActiveResources() pushes a
 * `resume_flow_<flow>` AND a `cancel_flow_<flow>` row per live conversation state
 * — correct for the radio list, where each is separately selectable — but
 * buildMainScreen counted and bulleted that same array. It scales the wrong way
 * too: two in-flight flows would announce "4 things running".
 *
 * The DB-backed kinds (quiz / coaching / lesson_plan) push one row each, which is
 * why only the state-backed kind miscounted.
 *
 * So the invariant is a split: the ROWS stay per-action (she must be able to pick
 * resume or stop), while the HEADING and SUMMARY are per-task.
 */

function chainResolving(result) {
  const chain = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'not', 'gte', 'order', 'limit']) {
    chain[m] = jest.fn(() => chain);
  }
  chain.single = jest.fn().mockResolvedValue(result);
  chain.then = (resolve) => resolve(result);
  return chain;
}

function load({ activeState = null } = {}) {
  jest.resetModules();
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: jest.fn(() => chainResolving({ data: [], error: null })),
  }));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    isAvailable: () => false,
    redis: { get: jest.fn().mockResolvedValue(null), del: jest.fn() },
  }));
  jest.doMock('../../bot/shared/services/conversation-state.service', () => ({
    getState: jest.fn().mockResolvedValue(activeState),
    setState: jest.fn().mockResolvedValue(activeState),
    clearState: jest.fn().mockResolvedValue(true),
  }));

  return {
    TeacherState: require('../../bot/shared/services/teacher-state.service'),
    endpoint: require('../../bot/shared/routes/status-flow-endpoint'),
  };
}

const COACHING = {
  flow: 'coaching', step: 'AWAITING_CLASSROOM_AUDIO', payload: {}, stack: [], version: 1,
};

describe('/status counts tasks, not actions (bd-43516)', () => {
  it('tags the resume/cancel pair with a shared task key, so they can be collapsed', async () => {
    const { TeacherState } = load({ activeState: COACHING });
    const items = await TeacherState.listActiveResources('u-1');

    const pair = items.filter((i) => i.kind === 'flow_resume' || i.kind === 'flow_cancel');
    expect(pair).toHaveLength(2);

    // Both actions belong to ONE task, and say so.
    const keys = new Set(pair.map((i) => i.taskKey));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe('flow:coaching');

    // And each carries the bare task name, without the action verb, so a summary
    // can be built without string-surgery on "Continue: ".
    for (const it of pair) {
      expect(it.taskTitle).toBe('classroom observation');
      expect(it.taskTitle).not.toMatch(/^(Continue|Stop):/);
    }
  });

  it('says "1 thing" and bullets it ONCE, while still offering both actions', async () => {
    const { endpoint } = load({ activeState: COACHING });
    const res = await endpoint.handleStatusFlowInit('u-1');

    expect(res.screen).toBe('MAIN');
    expect(res.data.summary_heading).toBe('You have 1 thing running right now.');

    const bullets = res.data.summary_body.split('\n').filter(Boolean);
    expect(bullets).toHaveLength(1);
    expect(bullets[0]).toBe('• classroom observation');

    // The radio rows are unchanged — resume, cancel, and Done.
    const ids = res.data.resources.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['resume_flow_coaching', 'cancel_flow_coaching', 'done']));
    expect(res.data.resources).toHaveLength(3);
  });

  it('a DB-backed task still counts as one — no double counting introduced', async () => {
    // Guards the fix from over-collapsing: kinds that already pushed a single row
    // must keep counting as one, and must not be grouped with each other just
    // because they lack a flow.
    const { TeacherState } = load({ activeState: null });
    const items = await TeacherState.listActiveResources('u-1');
    const keys = items.map((i) => i.taskKey || i.id);
    expect(new Set(keys).size).toBe(items.length);
  });

  it('no state at all → the idle screen, not a "0 things" heading', async () => {
    const { endpoint } = load({ activeState: null });
    const res = await endpoint.handleStatusFlowInit('u-1');
    expect(res.screen).toBe('SUCCESS');
  });
});
