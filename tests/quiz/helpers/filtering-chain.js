'use strict';
/**
 * A Supabase query stub that APPLIES its filters, for the lp_v8 offer suites.
 *
 * `tests/quiz/helpers/supabase-chain.js` records calls and replays a canned
 * result; that is the right shape when the assertion is "which filters were
 * asked for". It is the wrong shape here: the cohort build is a set of reads
 * whose CORRECTNESS is the filtering — a build that forgets
 * `.eq('status','sent')`, or pages one window instead of looping, returns a
 * plausible-looking cohort made of the wrong teachers. So this chain filters,
 * orders and ranges over fixtures the way PostgREST would, and a query that
 * drops a filter fails here rather than in production.
 *
 * Same idiom as `bot/tests/quiz/transcript-quiz-flow-endpoint.test.js`
 * (`makeChain`), widened with the range operators the cohort window needs
 * (`gte`/`lt`/`lte`/`gt`), `not`, and an exact `count` for a `head: true` read.
 */

/** Rows a table starts with, and every write made against it. */
function makeChain(table, rows, writes, { seq } = {}) {
  let data = [...(rows || [])];
  let head = false;
  let orderKey = null;
  let desc = false;
  const time = (v) => {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? v : t;
  };
  const chain = {
    select: (_cols, opts) => { if (opts && opts.head) head = true; return chain; },
    eq: (f, v) => { data = data.filter((r) => r[f] === v); return chain; },
    neq: (f, v) => { data = data.filter((r) => r[f] !== v); return chain; },
    is: (f, v) => {
      data = data.filter((r) => (v === null ? (r[f] === null || r[f] === undefined) : r[f] === v));
      return chain;
    },
    not: (f, op, v) => {
      if (op !== 'is') throw new Error(`filtering-chain: .not(${f}, ${op}) is not modelled`);
      data = data.filter((r) => (v === null ? !(r[f] === null || r[f] === undefined) : r[f] !== v));
      return chain;
    },
    in: (f, vs) => { data = data.filter((r) => vs.includes(r[f])); return chain; },
    gte: (f, v) => { data = data.filter((r) => time(r[f]) >= time(v)); return chain; },
    gt: (f, v) => { data = data.filter((r) => time(r[f]) > time(v)); return chain; },
    lte: (f, v) => { data = data.filter((r) => time(r[f]) <= time(v)); return chain; },
    lt: (f, v) => { data = data.filter((r) => time(r[f]) < time(v)); return chain; },
    order: (f, opts) => { orderKey = f; desc = Boolean(opts && opts.ascending === false); return chain; },
    limit: (n) => { data = data.slice(0, n); return chain; },
    range: (from, to) => {
      if (orderKey) {
        data = [...data].sort((a, b) => {
          const av = time(a[orderKey]);
          const bv = time(b[orderKey]);
          return desc ? (bv > av ? 1 : bv < av ? -1 : 0) : (av > bv ? 1 : av < bv ? -1 : 0);
        });
      }
      data = data.slice(from, to + 1);
      return chain;
    },
    insert: (row) => {
      const made = { id: `${table}-${seq()}`, ...row };
      writes.push({ table, op: 'insert', row: made });
      data = [made];
      return chain;
    },
    update: (patch) => { writes.push({ table, op: 'update', patch, matched: () => data }); return chain; },
    delete: () => { writes.push({ table, op: 'delete' }); return chain; },
    single: async () => ({ data: data[0] || null, error: null }),
    maybeSingle: async () => ({ data: data[0] || null, error: null }),
    then: (resolve) => resolve({ data: head ? null : data, error: null, count: data.length }),
  };
  return chain;
}

/**
 * @param {object} tables  table name → fixture rows
 * @returns {{from: Function, writes: Array, reads: Array}}
 */
function makeSupabase(tables) {
  const writes = [];
  const reads = [];
  let n = 0;
  const seq = () => { n += 1; return `new-${n}`; };
  const from = jest.fn((table) => {
    reads.push(table);
    return makeChain(table, tables[table] || [], writes, { seq });
  });
  return { from, writes, reads, tables };
}

module.exports = { makeChain, makeSupabase };
