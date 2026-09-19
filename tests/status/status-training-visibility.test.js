/**
 * A teacher mid-training-quiz is work in flight, and /status could not see it.
 *
 * Teacher training keeps its progress in its own table and never touches the
 * conversation store, so teacher-state.service.js had no reference to it at all.
 * Measured on production: a handful of teachers at any moment sit part-way
 * through a quiz, with the exact question recorded, while /status tells them
 * nothing is running.
 *
 * IT IS LISTED, NOT OFFERED. Training's own progress model is better than a
 * conversation-store wait — durable, per-module, no TTL — and it has its own way
 * back in (/training). Nothing needs to move onto the store. But every item
 * listActiveResources returns becomes a tappable row in the Flow, and a tap that
 * discards a half-finished quiz is a worse answer than simply saying it is there.
 * So the item is summary-only: it appears in "You have N things running" and
 * emits no selectable row.
 *
 * TDD: written before the implementation.
 */

function chainResolving(byTable) {
  return (table) => {
    const result = { data: byTable[table] || [], error: null };
    const chain = {};
    for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'not', 'gte', 'lte', 'order', 'limit']) {
      chain[m] = jest.fn(() => chain);
    }
    chain.single = jest.fn().mockResolvedValue(result);
    chain.then = (resolve) => resolve(result);
    chain.__table = table;
    return chain;
  };
}

function load({ activeState = null, tables = {}, fromImpl = null } = {}) {
  jest.resetModules();
  const calls = [];
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: jest.fn((table) => {
      calls.push(table);
      if (fromImpl) return fromImpl(table);
      return chainResolving(tables)(table);
    }),
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
    supabase: require('../../bot/shared/config/supabase'),
    tablesTouched: calls,
  };
}

const COACHING = {
  flow: 'coaching', step: 'AWAITING_CLASSROOM_AUDIO', payload: {}, stack: [], version: 1,
};

const ATTEMPT = {
  id: 'att-1',
  current_question_index: 3,
  total_questions: 10,
};

const TRAINING = 'training_assessment_attempts';

describe('/status sees a teacher mid-training-quiz', () => {
  it('lists an in-flight attempt', async () => {
    const { TeacherState } = load({ tables: { [TRAINING]: [ATTEMPT] } });
    const items = await TeacherState.listActiveResources('u-1');

    const training = items.filter((i) => i.kind === 'training');
    expect(training).toHaveLength(1);
    expect(training[0].refId).toBe('att-1');
  });

  it('names the question she is on, so the line is worth reading', async () => {
    const { TeacherState } = load({ tables: { [TRAINING]: [ATTEMPT] } });
    const [item] = (await TeacherState.listActiveResources('u-1')).filter((i) => i.kind === 'training');

    // index is 0-based and counts ANSWERED questions, so index 3 means she is on Q4.
    expect(item.title).toBe('Teacher training · question 4 of 10');
  });

  it('still names it when the question count is missing, rather than rendering undefined', async () => {
    const { TeacherState } = load({
      tables: { [TRAINING]: [{ id: 'att-2', current_question_index: null, total_questions: null }] },
    });
    const [item] = (await TeacherState.listActiveResources('u-1')).filter((i) => i.kind === 'training');

    expect(item.title).toBe('Teacher training');
    expect(item.title).not.toMatch(/undefined|null|NaN/);
  });

  it('asks the training table for THIS teacher only', async () => {
    const seen = [];
    const fromImpl = (table) => {
      const chain = {};
      for (const m of ['select', 'insert', 'update', 'delete', 'in', 'is', 'not', 'gte', 'lte', 'order', 'limit']) {
        chain[m] = jest.fn(() => chain);
      }
      chain.eq = jest.fn((col, val) => { seen.push({ table, col, val }); return chain; });
      chain.then = (resolve) => resolve({ data: table === TRAINING ? [ATTEMPT] : [], error: null });
      return chain;
    };
    const { TeacherState } = load({ fromImpl });
    await TeacherState.listActiveResources('u-77');

    expect(seen).toContainEqual({ table: TRAINING, col: 'user_id', val: 'u-77' });
  });

  // The bound is the whole probe. Attempts stay `in_progress` indefinitely:
  // production carries 84 of them going back a week, of which about 6 have been
  // touched in the last six hours. Without this clause /status would tell a
  // teacher she has a quiz running that she abandoned on Tuesday.
  it('only asks for attempts touched recently, and the window is six hours', async () => {
    const bounds = [];
    const fromImpl = (table) => {
      const chain = {};
      for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'not', 'lte', 'order', 'limit']) {
        chain[m] = jest.fn(() => chain);
      }
      chain.gte = jest.fn((col, val) => { bounds.push({ table, col, val }); return chain; });
      chain.then = (resolve) => resolve({ data: table === TRAINING ? [ATTEMPT] : [], error: null });
      return chain;
    };
    const { TeacherState } = load({ fromImpl });
    await TeacherState.listActiveResources('u-1');

    const bound = bounds.find((b) => b.table === TRAINING);
    expect(bound).toBeDefined();
    expect(bound.col).toBe('last_activity_at');

    const hoursAgo = (Date.now() - Date.parse(bound.val)) / 3_600_000;
    expect(hoursAgo).toBeGreaterThan(5.9);
    expect(hoursAgo).toBeLessThan(6.1);
  });

  // The other two clauses of the predicate. Recency alone is not enough: an
  // attempt keeps its last_activity_at when it FINISHES, so a quiz she passed
  // twenty minutes ago is recent AND done. On production `passed` is 674 rows a
  // week against roughly 6 genuinely open ones, so dropping either clause turns
  // "what is running" into "what you touched today".
  it('asks only for attempts still in progress, not ones already finished', async () => {
    const eqs = [];
    const isNulls = [];
    const fromImpl = (table) => {
      const chain = {};
      for (const m of ['select', 'insert', 'update', 'delete', 'in', 'not', 'gte', 'lte', 'order', 'limit']) {
        chain[m] = jest.fn(() => chain);
      }
      chain.eq = jest.fn((col, val) => { eqs.push({ table, col, val }); return chain; });
      chain.is = jest.fn((col, val) => { isNulls.push({ table, col, val }); return chain; });
      chain.then = (resolve) => resolve({ data: table === TRAINING ? [ATTEMPT] : [], error: null });
      return chain;
    };
    const { TeacherState } = load({ fromImpl });
    await TeacherState.listActiveResources('u-1');

    expect(eqs).toContainEqual({ table: TRAINING, col: 'status', val: 'in_progress' });
    expect(isNulls).toContainEqual({ table: TRAINING, col: 'completed_at', val: null });
  });

  it('takes the most recent first and stops at two, so one teacher cannot flood the screen', async () => {
    const seen = { order: null, limit: null };
    const fromImpl = (table) => {
      const chain = {};
      for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'not', 'gte', 'lte']) {
        chain[m] = jest.fn(() => chain);
      }
      chain.order = jest.fn((col, opts) => { if (table === TRAINING) seen.order = { col, opts }; return chain; });
      chain.limit = jest.fn((n) => { if (table === TRAINING) seen.limit = n; return chain; });
      chain.then = (resolve) => resolve({ data: table === TRAINING ? [ATTEMPT] : [], error: null });
      return chain;
    };
    const { TeacherState } = load({ fromImpl });
    await TeacherState.listActiveResources('u-1');

    expect(seen.order).toEqual({ col: 'last_activity_at', opts: { ascending: false } });
    expect(seen.limit).toBe(2);
  });
});

describe('the training entry is listed, never offered as a tap', () => {
  it('is marked summary-only', async () => {
    const { TeacherState } = load({ tables: { [TRAINING]: [ATTEMPT] } });
    const [item] = (await TeacherState.listActiveResources('u-1')).filter((i) => i.kind === 'training');

    expect(item.summaryOnly).toBe(true);
  });

  it('appears in the summary but emits no selectable row', async () => {
    const { endpoint } = load({ tables: { [TRAINING]: [ATTEMPT] } });
    const res = await endpoint.handleStatusFlowInit('u-1');

    expect(res.screen).toBe('MAIN');
    expect(res.data.summary_body).toContain('Teacher training');

    const ids = res.data.resources.map((r) => r.id);
    expect(ids).toEqual(['done']);
  });

  it('counts toward the heading, so she is not told nothing is running', async () => {
    const { endpoint } = load({ tables: { [TRAINING]: [ATTEMPT] } });
    const res = await endpoint.handleStatusFlowInit('u-1');

    expect(res.data.summary_heading).toBe('You have 1 thing running right now.');
  });

  // parseResourceId's own comment warns about this: a row whose id nothing can
  // read is a tap silently dropped. A summary-only item emits no row at all, so
  // the router is left untouched — but if that ever changes, this fails.
  it('never emits a row id the tap router cannot parse', async () => {
    const { TeacherState, endpoint } = load({
      tables: { [TRAINING]: [ATTEMPT] },
      activeState: COACHING,
    });
    const res = await endpoint.handleStatusFlowInit('u-1');

    for (const row of res.data.resources) {
      if (row.id === 'done') continue;
      expect(TeacherState.parseResourceId(row.id).kind).not.toBe('unknown');
    }
  });
});

describe('it does not disturb what /status already did', () => {
  it('leaves the coaching pair fully tappable alongside it', async () => {
    const { endpoint } = load({
      tables: { [TRAINING]: [ATTEMPT] },
      activeState: COACHING,
    });
    const res = await endpoint.handleStatusFlowInit('u-1');

    const ids = res.data.resources.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['resume_flow_coaching', 'cancel_flow_coaching', 'done']));
    expect(res.data.resources).toHaveLength(3);

    // Two tasks in the summary: the coaching pair collapses to one, training adds one.
    expect(res.data.summary_heading).toBe('You have 2 things running right now.');
  });

  it('with no training attempt, the screen is exactly what it was before', async () => {
    const { endpoint } = load({ activeState: COACHING, tables: {} });
    const res = await endpoint.handleStatusFlowInit('u-1');

    expect(res.data.summary_heading).toBe('You have 1 thing running right now.');
    expect(res.data.resources.map((r) => r.id))
      .toEqual(['resume_flow_coaching', 'cancel_flow_coaching', 'done']);
  });

  it('a training-table failure degrades to the old behaviour instead of breaking /status', async () => {
    const fromImpl = (table) => {
      const chain = {};
      for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'not', 'gte', 'lte', 'order', 'limit']) {
        chain[m] = jest.fn(() => chain);
      }
      chain.then = (resolve, reject) => (
        table === TRAINING
          ? (reject ? reject(new Error('relation does not exist')) : Promise.reject(new Error('x')))
          : resolve({ data: [], error: null })
      );
      return chain;
    };
    const { TeacherState } = load({ fromImpl, activeState: COACHING });
    const items = await TeacherState.listActiveResources('u-1');

    // The coaching pair survives; only the training entry is missing.
    expect(items.filter((i) => i.kind === 'flow_resume')).toHaveLength(1);
    expect(items.filter((i) => i.kind === 'training')).toHaveLength(0);
  });

  it('an empty account is still the idle screen, not a "0 things" heading', async () => {
    const { endpoint } = load({ tables: {} });
    const res = await endpoint.handleStatusFlowInit('u-1');
    expect(res.screen).toBe('SUCCESS');
  });
});
