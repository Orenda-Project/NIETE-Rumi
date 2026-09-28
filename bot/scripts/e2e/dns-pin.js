'use strict';
/**
 * dns-pin — a resolver fallback for the mock lane, preloaded with `node -r`.
 *
 * The machine running the lane has lost its router's DNS for 15+ minutes mid-run four times
 * (getaddrinfo ENOTFOUND olvritwoqujtjvwfulbh.supabase.co, runs 20260927-1923 … 20260928-1127),
 * which ends every scenario after it. fetch/undici resolve through dns.lookup → the OS resolver;
 * when that fails with ENOTFOUND/EAI_AGAIN this answers from public resolvers over the network
 * directly (dns.Resolver → 1.1.1.1 / 8.8.8.8), remembers the answer, and hands it back in the
 * shape dns.lookup promised. The OS resolver is always tried first; nothing changes while it works.
 * Off with E2E_DNS_FALLBACK=off. A lane device only: never loaded outside local-stack.sh.
 */
const dns = require('dns');
if (String(process.env.E2E_DNS_FALLBACK || 'on').toLowerCase() !== 'off') {
  const resolver = new dns.Resolver();
  resolver.setServers(['1.1.1.1', '8.8.8.8']);
  const cache = new Map();
  const origLookup = dns.lookup;
  const RETRY = /ENOTFOUND|EAI_AGAIN|EAI_NONAME|ESERVFAIL/;
  function fallback(hostname, options, cb) {
    const all = options && options.all;
    const hit = cache.get(hostname);
    const answer = (addrs) => all ? cb(null, addrs.map((a) => ({ address: a, family: 4 }))) : cb(null, addrs[0], 4);
    if (hit) return answer(hit);
    resolver.resolve4(hostname, (err, addrs) => {
      if (err || !addrs || !addrs.length) return cb(err || new Error('dns-pin: no answer for ' + hostname));
      cache.set(hostname, addrs);
      try { require('../../shared/utils/logger').logToFile('🧭 dns-pin: OS resolver failed, answered from 1.1.1.1', { hostname, addrs }); } catch (_) {}
      answer(addrs);
    });
  }
  dns.lookup = function patchedLookup(hostname, options, cb) {
    if (typeof options === 'function') { cb = options; options = {}; }
    if (typeof hostname !== 'string' || /^[\d.]+$|:/.test(hostname) || hostname === 'localhost') return origLookup.call(dns, hostname, options, cb);
    return origLookup.call(dns, hostname, options, (err, address, family) => {
      if (err && RETRY.test(String(err.code || err.message))) return fallback(hostname, options || {}, cb);
      cb(err, address, family);
    });
  };
  if (dns.promises && dns.promises.lookup) {
    const { promisify } = require('util');
    dns.promises.lookup = promisify(dns.lookup);
  }
}
