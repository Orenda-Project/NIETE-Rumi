'use strict';
/**
 * Where the web quiz's server time goes (W37 M4, item 9: "watch more" spends ~3 s in the bot per hop).
 *
 *   run(route, fn, statusOf?)  runs one /api/internal/wq request inside a counter and logs
 *                              web_quiz.timing {route, status?, ms, db} — db = database round trips
 *                              (supabase.from / .rpc calls) made while serving it. Always logged when the
 *                              request took SLOW_MS or more; otherwise a SAMPLE share of requests.
 *   patch(client)              wraps the shared client's from/rpc ONCE so they count — but only inside
 *                              run(); every other caller of the client is untouched (no store, no count).
 *
 * route is the Express pattern ("/quiz/:code"), never a code, token or name.
 */
const { AsyncLocalStorage } = require('async_hooks');
const { logEvent } = require('../../utils/structured-logger');

const SLOW_MS = 700;
let SAMPLE = 0.05;
const als = new AsyncLocalStorage();

function patch(client) {
  if (!client || client.__wqTimed) return;
  for (const name of ['from', 'rpc']) {
    const orig = client[name];
    if (typeof orig !== 'function') continue;
    client[name] = function timed(...args) {
      const s = als.getStore();
      if (s) s.db += 1;
      return orig.apply(this, args);
    };
  }
  Object.defineProperty(client, '__wqTimed', { value: true, enumerable: false });
}

async function run(route, fn, statusOf) {
  const s = { db: 0, t0: Date.now() };
  return als.run(s, async () => {
    try {
      return await fn();
    } finally {
      const ms = Date.now() - s.t0;
      if (ms >= SLOW_MS || Math.random() < SAMPLE) {
        const r = typeof route === 'function' ? route() : route;
        const ev = { route: String(r || '').slice(0, 60) };
        if (statusOf) ev.status = statusOf();
        ev.ms = ms;
        ev.db = s.db;
        logEvent('web_quiz.timing', ev);
      }
    }
  });
}

module.exports = {
  run, patch, SLOW_MS,
  setSample: (p) => { SAMPLE = p; },
  // the running request's round trips so far; null outside a web-quiz request
  peek: () => { const st = als.getStore(); return st ? st.db : null; },
  // ms since the running request began (the portal's 10 s clock); null outside a web-quiz request
  elapsed: () => { const st = als.getStore(); return st ? Date.now() - st.t0 : null; },
};
