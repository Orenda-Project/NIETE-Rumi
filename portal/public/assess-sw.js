/**
 * The Learning assessment's offline worker (switch sa_r8_offline_prep), scope /portal/leader/assess: registered only
 * when a coach taps "Get ready for offline", so the page itself opens again with no signal at the school (a phone
 * that reloads the tab). Online it changes nothing a coach can see:
 *
 *   a page open (navigation)    network first (NAV_WAIT_MS), else the page kept at the last open or "Get ready"
 *   /assets/* (hashed, immutable) the kept copy, else the network (and kept)
 *   GET /api/portal/*            network first (API_WAIT_MS when a copy is kept), else the kept answer: who is signed
 *                                in, the switches, the schools, a prepared list. Only 200 answers are kept; a
 *                                session's own reads (…/session/…) are never kept (a stale status would mislead).
 *   anything else               not touched (POSTs go to the network; the page queues what cannot go)
 *
 * postMessage({ type: 'warm', urls }) on a MessageChannel keeps those URLs now (the page and its files, the reads the
 * page made before this worker controlled it) and answers { ok, cached, missing[] }.
 * The child's test page (/sa/) has its own worker (dashboard/sa/sw.js); this one never answers for it.
 */
'use strict';

var CACHE = 'assess-offline-v1';
var NAV_WAIT_MS = 4000;
var API_WAIT_MS = 6000;
var SHELL = '/portal/leader/assess';

/** Which way a request is answered: 'page' | 'asset' | 'api' | null (not ours). */
function strategyFor(url, method, mode, origin) {
  if (method !== 'GET') return null;
  var u = new URL(url);
  if (u.origin !== origin) return null;
  if (mode === 'navigate') return u.pathname.indexOf('/portal/leader/assess') === 0 ? 'page' : null;
  if (/^\/assets\/[^/]+\.(js|css|woff2?|png|svg|webp)$/.test(u.pathname)) return 'asset';
  if (u.pathname.indexOf('/api/portal/') === 0 && u.pathname.indexOf('/session/') < 0) return 'api';
  return null;
}

/** first(fetchFn, keptFn, waitMs) → the network's answer, or the kept one when the network fails or (with a kept copy) is slow. */
function networkFirst(net, kept, waitMs, keep) {
  return new Promise(function (resolve) {
    var done = false;
    var timer = null;
    function fallback(orRes) {
      return Promise.resolve(kept()).then(function (hit) {
        if (done) return;
        if (hit) { done = true; if (timer) clearTimeout(timer); resolve(hit); return; }
        if (orRes) { done = true; resolve(orRes); }
      });
    }
    Promise.resolve(kept()).then(function (hit) {
      if (hit && !done) timer = setTimeout(function () { fallback(null); }, waitMs);
    });
    Promise.resolve().then(net).then(function (res) {
      if (done) return;
      if (res && res.status === 200) { done = true; if (timer) clearTimeout(timer); keep(res.clone()); resolve(res); return; }
      // a 4xx/5xx: the kept answer when there is one (a server mid-restart), else the server's own answer
      fallback(res);
    }, function () {
      if (done) return;
      fallback(null).then(function () {
        if (!done) { done = true; resolve(new Response('offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })); }
      });
    });
  });
}

if (typeof module === 'object' && module.exports) {
  module.exports = { strategyFor: strategyFor, networkFirst: networkFirst, CACHE: CACHE, SHELL: SHELL };
} else {
  self.addEventListener('install', function () { self.skipWaiting(); });
  self.addEventListener('activate', function (e) {
    e.waitUntil(caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('assess-offline-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); }));
  });

  var put = function (key, res) { caches.open(CACHE).then(function (c) { return c.put(key, res); }).catch(function () {}); };
  var match = function (key) { return caches.open(CACHE).then(function (c) { return c.match(key); }).catch(function () { return undefined; }); };

  self.addEventListener('fetch', function (e) {
    var how = strategyFor(e.request.url, e.request.method, e.request.mode, self.location.origin);
    if (!how) return;
    if (how === 'asset') {
      e.respondWith(match(e.request).then(function (hit) {
        return hit || fetch(e.request).then(function (res) { if (res && res.status === 200) put(e.request, res.clone()); return res; });
      }));
      return;
    }
    // every assessment page is the one app page: kept under one key
    var key = how === 'page' ? SHELL : e.request.url;
    e.respondWith(networkFirst(function () { return fetch(e.request); }, function () { return match(key); },
      how === 'page' ? NAV_WAIT_MS : API_WAIT_MS, function (res) { put(key, res); }));
  });

  self.addEventListener('message', function (e) {
    var d = e.data || {};
    var port = e.ports && e.ports[0];
    if (d.type !== 'warm' || !port) return;
    var urls = (d.urls || []).filter(function (u) { return typeof u === 'string'; });
    e.waitUntil(caches.open(CACHE).then(function (c) {
      return Promise.all(urls.map(function (u) {
        var abs = new URL(u, self.location.href);
        if (abs.origin !== self.location.origin) return u;
        var key = abs.pathname.indexOf('/portal/leader/assess') === 0 ? SHELL : abs.href;
        return fetch(abs.href, { credentials: 'same-origin' }).then(function (res) {
          if (!res || res.status !== 200) return c.match(key).then(function (hit) { return hit ? null : u; });
          return c.put(key, res).then(function () { return null; });
        }, function () { return c.match(key).then(function (hit) { return hit ? null : u; }); });
      }));
    }).then(function (r) {
      var missing = r.filter(Boolean);
      port.postMessage({ ok: missing.length === 0, cached: urls.length - missing.length, missing: missing });
    }, function (err) { port.postMessage({ ok: false, cached: 0, missing: urls, error: String(err) }); }));
  });
}
