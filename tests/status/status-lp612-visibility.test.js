/**
 * The most common thing a NIETE teacher waits on is the one thing /status could
 * not see.
 *
 * `listActiveResources` probes `lesson_plan_requests`. The 6-12 path — the Flow
 * picker, which is how lesson plans are actually requested here — does not write
 * there. It claims a row in `niete_lp612_renders` with status 'authoring' and
 * parks the teacher in that row's `waiters` array. Measured on production over
 * seven days: 18,196 rows written by the path a teacher uses, 25 by the table
 * /status reads. For the ~2 minutes she is genuinely waiting, the surface built
 * to answer "what is running" answered "nothing".
 *
 * WHY `waiters` AND NOT `requested_by`. One render serves every teacher who taps
 * the same lesson while it is being authored — the second tapper is appended to
 * `waiters` by `lp612_join_waiters` and never becomes `requested_by`. She is
 * waiting just as much as the first. Reading `requested_by` would have shown the
 * lesson to exactly one of them. The claim path writes the requester INTO
 * `waiters` (lp612-serving.service.js, the insert at the miss branch), so
 * containment covers both without a second clause.
 *
 * LISTED, NEVER OFFERED. A render is shared: stopping it would discard a lesson
 * other teachers are queued behind. So the item is summary-only, like training —
 * it appears in "You have N things running" and emits no tappable row.
 *
 * TDD: written before the implementation.
 */

const RENDERS = 'niete_lp612_renders';
const SEGMENTS = 'niete_lp612_segments';

// `contains` is in this list because the probe filters `waiters` with it. Every
// other probe in the service shares this mock, so the list is the union.
const CHAIN_METHODS = [
  'select', 'insert', 'update', 'delete',
  'eq', 'in', 'is', 'not', 'gte', 'lte', 'contains', 'order', 'limit',
];

function chainResolving(byTable) {
  return (table) => {
    const result = { data: byTable[table] || [], error: null };
    const chain = {};
    for (const m of CHAIN_METHODS) chain[m] = jest.fn(() => chain);
    chain.single = jest.fn().mockResolvedValue(result);
    chain.then = (resolve) => resolve(result);
    chain.__table = table;
    return chain;
  };
}

/**
 * A chain that records one method's arguments and answers every table from
 * `data`. `omit` drops the spied method from the pass-through list so the spy is
 * the only definition of it.
 */
function spyChain({ method, sink, data }) {
  return (table) => {
    const chain = {};
    for (const m of CHAIN_METHODS) {
      if (m === method) continue;
      chain[m] = jest.fn(() => chain);
    }
    chain[method] = jest.fn((...args) => { sink.push({ table, args }); return chain; });
    chain.then = (resolve) => resolve({ data: data[table] || [], error: null });
    return chain;
  };
}

function load({ activeState = null, tables = {}, fromImpl = null } = {}) {
  jest.resetModules();
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: jest.fn((table) => (fromImpl ? fromImpl(table) : chainResolving(tables)(table))),
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

/**
 * postgrest-js's own `contains()` serialisation, mirrored verbatim from
 * @supabase/postgrest-js so this suite can assert the WIRE FORMAT rather than the
 * argument. Kept as a copy on purpose: the real module lives in bot/node_modules,
 * and root suites run before that is installed.
 *
 *   string -> cs.<value>                (correct for jsonb)
 *   Array  -> cs.{<value.join(',')}>    (a Postgres ARRAY literal — wrong for jsonb)
 *   object -> cs.<JSON.stringify(value)>
 */
function pgContains(value) {
  if (typeof value === 'string') return `cs.${value}`;
  if (Array.isArray(value)) return `cs.{${value.join(',')}}`;
  return `cs.${JSON.stringify(value)}`;
}

const RENDER = { id: 'rnd-1', segment_id: 'seg-9', started_at: new Date().toISOString() };
const SEGMENT = { segment_id: 'seg-9', menu_title: 'World War I: Causes' };

const COACHING = {
  flow: 'coaching', step: 'AWAITING_CLASSROOM_AUDIO', payload: {}, stack: [], version: 1,
};

const lp612Of = (items) => items.filter((i) => String(i.id).startsWith('lp612_'));

describe('/status sees a 6-12 lesson plan being authored', () => {
  it('lists the render that is in flight', async () => {
    const { TeacherState } = load({ tables: { [RENDERS]: [RENDER], [SEGMENTS]: [SEGMENT] } });

    const found = lp612Of(await TeacherState.listActiveResources('u-1'));
    expect(found).toHaveLength(1);
    expect(found[0].refId).toBe('rnd-1');
    expect(found[0].kind).toBe('lesson_plan');
  });

  it('names the lesson, so the bullet is worth reading', async () => {
    const { TeacherState } = load({ tables: { [RENDERS]: [RENDER], [SEGMENTS]: [SEGMENT] } });

    const [item] = lp612Of(await TeacherState.listActiveResources('u-1'));
    expect(item.title).toBe('Lesson plan · World War I: Causes');
  });

  it('still names it when the segment lookup returns nothing, rather than rendering undefined', async () => {
    const { TeacherState } = load({ tables: { [RENDERS]: [RENDER], [SEGMENTS]: [] } });

    const [item] = lp612Of(await TeacherState.listActiveResources('u-1'));
    expect(item.title).toBe('Lesson plan');
    expect(item.title).not.toMatch(/undefined|null|NaN/);
  });

  // THE LEAK GUARD, and the reason this probe cannot be a bare status filter.
  // `authoring` is a deployment-wide state: without this clause every teacher who
  // sent /status would be shown whatever lesson any other teacher happened to be
  // waiting on.
  it('asks only for renders THIS teacher is waiting on', async () => {
    const seen = [];
    const { TeacherState } = load({
      fromImpl: spyChain({ method: 'contains', sink: seen, data: { [RENDERS]: [RENDER], [SEGMENTS]: [SEGMENT] } }),
    });
    await TeacherState.listActiveResources('u-77');

    const call = seen.find((c) => c.table === RENDERS);
    expect(call).toBeDefined();
    expect(call.args[0]).toBe('waiters');

    // ASSERTED ON THE SERIALISED FORM, NOT THE ARGUMENT — and that distinction is
    // the entire lesson of this bug. The first version of this test asserted
    // `args[1]` equalled `[{ user_id: 'u-77' }]`. It passed. The shipped query
    // still matched nothing, on every call, for every teacher.
    //
    // postgrest-js serialises `contains(column, value)` three different ways, and
    // an ARRAY goes through `value.join(',')` — which on an array of objects is
    // the literal text "[object Object]". So the query that actually went out was
    // `waiters=cs.{[object Object]}`: a Postgres ARRAY literal, against a JSONB
    // column, containing a string no row will ever hold.
    //
    // The argument looked perfectly correct. Only the wire format was wrong, and
    // a mock of the supabase CLIENT sits above the layer that produces it — which
    // is exactly what this repo's own rule means by "mock at the network boundary,
    // never the module you are changing".
    expect(pgContains(call.args[1])).toBe('cs.[{"user_id":"u-77"}]');
    expect(pgContains(call.args[1])).not.toContain('[object Object]');
  });

  // A render is 'ready' the moment the PDF exists and 'failed' when it gave up.
  // Both keep the row. Dropping this clause turns "being prepared" into "every
  // lesson plan she has ever been served".
  it('asks only for renders still being authored', async () => {
    const seen = [];
    const { TeacherState } = load({
      fromImpl: spyChain({ method: 'eq', sink: seen, data: { [RENDERS]: [RENDER], [SEGMENTS]: [SEGMENT] } }),
    });
    await TeacherState.listActiveResources('u-1');

    const call = seen.find((c) => c.table === RENDERS && c.args[0] === 'status');
    expect(call).toBeDefined();
    expect(call.args[1]).toBe('authoring');
  });

  // Authoring takes about two minutes. A row still 'authoring' hours later is a
  // stranded run the sweeper has not reached yet, not work she is waiting on —
  // telling her it is running would be a lie with a clock on it.
  it('bounds the window at thirty minutes', async () => {
    const seen = [];
    const { TeacherState } = load({
      fromImpl: spyChain({ method: 'gte', sink: seen, data: { [RENDERS]: [RENDER], [SEGMENTS]: [SEGMENT] } }),
    });
    await TeacherState.listActiveResources('u-1');

    const call = seen.find((c) => c.table === RENDERS);
    expect(call).toBeDefined();
    expect(call.args[0]).toBe('started_at');

    const minutesAgo = (Date.now() - Date.parse(call.args[1])) / 60_000;
    expect(minutesAgo).toBeGreaterThan(29);
    expect(minutesAgo).toBeLessThan(31);
  });

  it('stops at two, so one teacher cannot flood the screen', async () => {
    const seen = [];
    const { TeacherState } = load({
      fromImpl: spyChain({ method: 'limit', sink: seen, data: { [RENDERS]: [RENDER], [SEGMENTS]: [SEGMENT] } }),
    });
    await TeacherState.listActiveResources('u-1');

    const call = seen.find((c) => c.table === RENDERS);
    expect(call).toBeDefined();
    expect(call.args[0]).toBe(2);
  });

  it('does not query the segment table when nothing is in flight', async () => {
    const touched = [];
    const { TeacherState } = load({
      fromImpl: (table) => {
        touched.push(table);
        return chainResolving({})(table);
      },
    });
    await TeacherState.listActiveResources('u-1');

    expect(touched).toContain(RENDERS);
    expect(touched).not.toContain(SEGMENTS);
  });
});

describe('the 6-12 entry is listed, never offered as a tap', () => {
  it('is marked summary-only', async () => {
    const { TeacherState } = load({ tables: { [RENDERS]: [RENDER], [SEGMENTS]: [SEGMENT] } });

    const [item] = lp612Of(await TeacherState.listActiveResources('u-1'));
    expect(item.summaryOnly).toBe(true);
  });

  it('is counted and bulleted on the Flow screen but emits no selectable row', async () => {
    const { endpoint } = load({ tables: { [RENDERS]: [RENDER], [SEGMENTS]: [SEGMENT] } });
    const res = await endpoint.handleStatusFlowInit('u-1');

    expect(res.screen).toBe('MAIN');
    expect(res.data.summary_heading).toBe('You have 1 thing running right now.');
    expect(res.data.summary_body).toContain('World War I: Causes');

    expect(res.data.resources.map((r) => r.id)).toEqual(['done']);
  });

  // parseResourceId's own comment warns about the failure this guards: a row whose
  // id nothing can read is a tap silently dropped. A summary-only item emits no row
  // at all, so the router is never reached — but if that ever changes, this fails.
  it('never emits a row id the tap router cannot parse', async () => {
    const { TeacherState, endpoint } = load({
      tables: { [RENDERS]: [RENDER], [SEGMENTS]: [SEGMENT] },
      activeState: COACHING,
    });
    const res = await endpoint.handleStatusFlowInit('u-1');

    for (const row of res.data.resources) {
      if (row.id === 'done') continue;
      expect(TeacherState.parseResourceId(row.id).kind).not.toBe('unknown');
    }
  });

  // THE FAIL-CLOSED GUARD, and the reason the id is not `cancel_lp_<id>`.
  //
  // cancelResource routes `kind: 'lesson_plan'` to an UPDATE on
  // `lesson_plan_requests` keyed by refId — and this item's refId is a RENDER id
  // from a different table entirely. Feeding one to the other would report a
  // successful cancel for a write that matched nothing.
  //
  // It cannot happen, and this pins the two independent reasons it cannot: the
  // item is summary-only so no row is emitted, AND the id carries no `cancel_`
  // prefix, so even a hand-fed tap parses as `unknown` and is refused rather than
  // being routed at the wrong table. Dropping `summaryOnly` alone must not be
  // enough to cause a bad write.
  it('cannot be routed into the lesson-plan cancel path even if a row were emitted', async () => {
    const { TeacherState } = load({ tables: { [RENDERS]: [RENDER], [SEGMENTS]: [SEGMENT] } });
    const [item] = lp612Of(await TeacherState.listActiveResources('u-1'));

    const parsed = TeacherState.parseResourceId(item.id);
    expect(parsed.kind).toBe('unknown');
    expect(parsed.kind).not.toBe('lesson_plan');
  });

  // It must not cost the coaching pair its taps on the way in.
  it('sits alongside a live coaching wait without disturbing it', async () => {
    const { endpoint } = load({
      tables: { [RENDERS]: [RENDER], [SEGMENTS]: [SEGMENT] },
      activeState: COACHING,
    });
    const res = await endpoint.handleStatusFlowInit('u-1');

    const ids = res.data.resources.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['resume_flow_coaching', 'cancel_flow_coaching', 'done']));
    expect(res.data.resources).toHaveLength(3);
    expect(res.data.summary_heading).toBe('You have 2 things running right now.');
  });
});

describe('the probe degrades rather than taking /status down', () => {
  it('a failing render query leaves the other sources intact', async () => {
    const { TeacherState } = load({
      fromImpl: (table) => {
        if (table === RENDERS) throw new Error('renders unavailable');
        const chain = {};
        for (const m of CHAIN_METHODS) chain[m] = jest.fn(() => chain);
        chain.then = (resolve) => resolve({
          data: table === 'quizzes' ? [{ id: 'q-1', topic: 'Fractions' }] : [],
          error: null,
        });
        return chain;
      },
    });

    const items = await TeacherState.listActiveResources('u-1');
    expect(lp612Of(items)).toHaveLength(0);
    expect(items.some((i) => i.kind === 'quiz')).toBe(true);
  });
});
