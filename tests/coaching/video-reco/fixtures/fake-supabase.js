'use strict';
/**
 * A recording stand-in for the supabase client: every chain is logged as [table, [method, args]...], and
 * resolves to the reply queued for its table (or {data:null,error:null}). Throwing replies are supported.
 */
function fakeSupabase(replies = {}) {
  const calls = [];
  const client = {
    calls,
    from(table) {
      const chain = [table];
      calls.push(chain);
      const b = {};
      for (const m of ['select', 'eq', 'neq', 'gte', 'lte', 'not', 'in', 'is', 'limit', 'order', 'maybeSingle', 'single', 'upsert', 'update', 'insert']) {
        b[m] = (...args) => { chain.push([m, args]); return b; };
      }
      b.then = (res, rej) => {
        const r = replies[table];
        const reply = typeof r === 'function' ? r(chain) : r;
        if (reply instanceof Error) return Promise.reject(reply).then(res, rej);
        return Promise.resolve(reply || { data: null, error: null }).then(res, rej);
      };
      return b;
    },
  };
  return client;
}
module.exports = { fakeSupabase };
