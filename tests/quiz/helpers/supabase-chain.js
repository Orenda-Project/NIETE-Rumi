'use strict';
/**
 * A tiny chainable Supabase query stub for the transcript-quiz suites.
 *
 * `chain(result)` returns a proxy where every builder method (.select, .eq,
 * .order, .insert, .update, …) records its call and returns the same proxy;
 * awaiting the proxy resolves `result`; `.single()` / `.maybeSingle()` resolve
 * the first row. `fromMock(tables)` maps a table name to either a fixed result
 * or a function `(calls) => result` evaluated when the query is awaited, so a
 * test can answer differently depending on the filters that were applied.
 */
function chain(resultOrFn) {
  const calls = [];
  const resolve = () => {
    const r = typeof resultOrFn === 'function' ? resultOrFn(calls) : resultOrFn;
    return r || { data: null, error: null };
  };
  const self = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') {
        return (res, rej) => Promise.resolve(resolve()).then(res, rej);
      }
      if (prop === 'single' || prop === 'maybeSingle') {
        return () => {
          const r = resolve();
          const data = Array.isArray(r.data) ? (r.data[0] ?? null) : (r.data ?? null);
          return Promise.resolve({ data, error: r.error || null });
        };
      }
      if (prop === '_calls') return calls;
      return (...args) => { calls.push([prop, ...args]); return self; };
    },
  });
  return self;
}

function fromMock(tables) {
  const log = [];
  const fn = jest.fn((table) => {
    const c = chain(tables[table]);
    log.push({ table, chain: c });
    return c;
  });
  fn._log = log;
  fn.callsFor = (table) => log.filter((l) => l.table === table).map((l) => l.chain._calls);
  return fn;
}

/** Install a table map on an existing jest.fn (the mocked `supabase.from`) and expose callsFor on it. */
function installFrom(outer, tables) {
  const f = fromMock(tables);
  outer.mockImplementation(f);
  outer.callsFor = f.callsFor;
  outer._log = f._log;
  return f;
}

module.exports = { chain, fromMock, installFrom };
