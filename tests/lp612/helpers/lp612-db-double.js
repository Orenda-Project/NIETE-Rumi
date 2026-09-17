/**
 * A PostgREST double for the lp612 lane — the network boundary, and nothing above it.
 *
 * `requestLesson` and the worker both talk to Supabase, and the E2E drives both in one run, so a
 * per-call queue of canned results (what the unit suites use) cannot serve it: the claim the tap
 * inserts must be the row the worker then reads. This keeps the two tables in memory instead.
 *
 * Only the operations this lane actually issues are implemented; anything else throws rather than
 * silently resolving, so a call shape that changes is a failing test and not a green one.
 */
const RENDERS = 'niete_lp612_renders';
const SEGMENTS = 'niete_lp612_segments';

const state = { renders: [], segments: [], seq: 0, waiters: [] };

const match = (row, filters) => filters.every(([c, v]) => row[c] === v);

function builder(table) {
  const rows = () => (table === RENDERS ? state.renders : state.segments);
  const q = { op: 'select', payload: null, filters: [], limit: null };

  const settle = (shape) => {
    if (q.op === 'insert') {
      const row = { id: `render-${++state.seq}`, ...q.payload };
      rows().push(row);
      return Promise.resolve({ data: shape === 'single' ? row : [row], error: null });
    }
    let hit = rows().filter((r) => match(r, q.filters));
    if (q.op === 'update') {
      hit.forEach((r) => Object.assign(r, q.payload));
      return Promise.resolve({ data: shape === 'single' ? (hit[0] || null) : hit, error: null });
    }
    if (q.limit != null) hit = hit.slice(0, q.limit);
    if (shape === 'single' || shape === 'maybeSingle') {
      return Promise.resolve({ data: hit[0] || null, error: null });
    }
    return Promise.resolve({ data: hit, error: null });
  };

  const b = {
    select: () => b,
    insert: (p) => { q.op = 'insert'; q.payload = p; return b; },
    update: (p) => { q.op = 'update'; q.payload = p; return b; },
    eq: (c, v) => { q.filters.push([c, v]); return b; },
    limit: (n) => { q.limit = n; return b; },
    single: () => settle('single'),
    maybeSingle: () => settle('maybeSingle'),
    then: (res, rej) => settle('many').then(res, rej),
  };
  return b;
}

const rpc = (name, args) => {
  if (name === 'lp612_join_waiters') {
    const w = { user_id: args.p_user_id || 'u1', phone: args.p_phone || '923001111111' };
    state.waiters = [w];
    const row = state.renders.find((r) => r.id === args.p_render_id);
    if (row) row.waiters = state.waiters;
    return Promise.resolve({ data: 'joined', error: null });
  }
  if (name === 'lp612_claim_waiters') return Promise.resolve({ data: state.waiters, error: null });
  throw new Error(`lp612 db double: unexpected rpc ${name}`);
};

const db = { from: (t) => builder(t), rpc };

const reset = (segments = []) => {
  state.renders = [];
  state.segments = segments.map((s) => ({ ...s }));
  state.seq = 0;
  state.waiters = [];
};

module.exports = { db, reset, state, RENDERS, SEGMENTS };
