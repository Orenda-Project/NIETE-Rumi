/**
 * The battery's service worker, scope /sa/ (switch sa_engine): the child's page keeps working when the network goes
 * down mid-child. Served no-cache by routes/sa-engine.routes.js; it never touches /wq/'s or the portal's requests.
 *
 *   the engine's files and play.html   network first (3 s), else the cached copy: an update reaches an online phone,
 *                                      an offline phone still opens the page
 *   the battery file and Jugnu's clips cache first (they never change under one URL: the clip name is a hash)
 *   anything else (the sink's /api calls, other paths)  not touched
 *
 * The page asks for a session's files with postMessage({ type: 'prepare', urls, fresh? }) on a MessageChannel and gets
 * back { ok, cached, missing[], bytes }; "ready offline" is shown only when missing is empty. The files are fetched six at
 * a time, and one that fails (a 429 from a busy tunnel, a dropped request) is tried once more after a short pause.
 * Round 8 (the coach's "ready for offline"): a URL in `fresh` (a battery file, which changes under one URL when a switch
 * flips) is read from the network even when a copy is kept, and keeps that copy when the network fails; bytes counts
 * what came over the network. postMessage({ type: 'check', urls }) answers { ok, cached, missing[] } from the phone
 * alone, fetching nothing.
 */
'use strict';

// sa-3: the install of sa-2 may have kept the portal's page for an engine file the folder did not have yet.
// sa-4: the prepare queue (six at a time, one retry): phones take the new worker and the new engine files.
// sa-5: round 7 (RDF auto with no last-word step): the new engine files.
// sa-6: round 7b (back, End test + Restart, End this section, the auto stop-checks, the instruction lines): the new engine files.
// sa-7: a line held by a hidden page plays on when it is shown again, never in the phone's voice (sa-voice.js, sa-engine.js).
// sa-8: round 8, the child's flow (no Done line on a reading, story questions wait for Next, practice says its answer).
// sa-9: round 8 offline: sa-offline.js prepVisit / checkVisit / partOf (the coach page's "ready for offline").
// sa-10: round 8 offline: Jugnu's pictures go on the phone with "ready for offline" (sa-offline.js ART).
// sa-11: round 8 offline: the Start gate checks the phone first and the background download gives it the line (sa-offline.js fresh / paused).
// sa-12: round 8 offline: an installed worker is used without waiting on register() (which rejects with no signal).
// sa-13: round 8: the engine files (speak.audio() for the word highlight, the story's ear with r8_reading_position).
// sa-14 (production only): the engine files again. Each VERSION bump drops only the sa-core-* cache; the batteries, clips
// and word timings stay in SESSION, so neither of these two refreshed a battery or clip copy a phone already held.
// sa-15: round 8 close: sa-ui.js (the story questions' hint names Next / «آگے»).
// sa-16: round 8 close: sa-offline.js asks the registration to update() and waits (bounded) for a new worker before
// 'prepare', so a phone still on the previous SESSION prepares into the new one, not into a cache it is about to delete.
var VERSION = 'sa-16';
var CORE = 'sa-core-' + VERSION;
// v2: v1 may hold the portal's page cached as a clip (a missing clip used to answer 200 HTML); it is dropped.
// v3: letter-sound clips re-made under the same keys (one held "ssss", not "s s s"); a kept copy would play the old one.
// v4: batteries re-read after the round-5 switches (one at a time on Next only, the child's last-word tap in auto); a copy kept
// under v3 between the deploy and the flip would keep the old behaviour.
// v5: round 7: the letter name ثے re-voiced under its key ("se", not a "t" word) and the batteries' new lines.
// v6: round 7b: a battery served while its switches are ON carries their ui flags and new lines (sa-battery-switches.js); a copy
// kept under v5 would keep the old behaviour on a phone that already took it. Turn the switches on BEFORE this reaches a tier.
// v7: round 8 close: v4 clips re-made under their keys (sums end on "equals", letter sounds held, praise excited) and the
// battery files' new lines; a kept copy would play the old one. Phones re-download their clips on the next prepare.
// clips.lock.json records the bytes each SESSION was taken with (dashboard/scripts/sa-clips-lock.js); the dashboard test
// sa-clips-lock fails when a locked file changes under the same SESSION.
var SESSION = 'sa-session-v7';
var CORE_FILES = ['play.html', 'sa-core.js', 'sa-store.js', 'sa-voice.js', 'sa-ui.js', 'sa-sync.js', 'sa-rec.js',
  'sa-engine.js', 'sa-mic.js', 'sa-offline.js', 'sa-page.js', 'sa.css', 'sink-coach.js', 'sink-game.js', 'skin-game.css', 'skin-game.js'];
var NETWORK_WAIT_MS = 3000;
var PREFETCH_AT_ONCE = 6;
var RETRY_MS = 1500;

/**
 * prefetch(urls, { fetch, match, put, ok, limit?, retryMs?, fresh?, onBytes? }) → Promise<missing urls>: each url not
 * already kept (match) is fetched, at most `limit` at a time, kept (put) when ok(url, res); a failure is tried once more
 * after retryMs. A url in fresh is fetched first even when kept (a failure then falls back to the kept copy).
 * onBytes(n) gets each fetched response's content-length. Never rejects.
 */
function prefetch(urls, o) {
  var limit = o.limit || PREFETCH_AT_ONCE;
  var wait = o.retryMs != null ? o.retryMs : RETRY_MS;
  var fresh = o.fresh || [];
  var queue = urls.slice();
  var missing = [];
  function once(u) {
    return Promise.resolve().then(function () { return o.fetch(u); }).then(function (res) {
      if (!o.ok(u, res)) throw new Error(String(res && res.status));
      if (o.onBytes) o.onBytes(Number((res.headers && res.headers.get && res.headers.get('content-length')) || 0) || 0);
      return Promise.resolve(o.put(u, res)).then(function () { return true; });
    }).then(null, function () { return false; });
  }
  function one(u) {
    var first = fresh.indexOf(u) >= 0 ? once(u) : Promise.resolve(false);
    return first.then(function (got) { return got ? true : o.match(u); }).then(null, function () { return null; }).then(function (hit) {
      if (hit) return true;
      return once(u).then(function (got) {
        return got ? true : new Promise(function (r) { setTimeout(r, wait); }).then(function () { return once(u); });
      });
    }).then(function (got) { if (!got) missing.push(u); });
  }
  function worker() { var u = queue.shift(); return u === undefined ? null : one(u).then(worker); }
  var workers = [];
  for (var i = 0; i < Math.min(limit, urls.length); i++) workers.push(worker());
  return Promise.all(workers).then(function () { return urls.filter(function (u) { return missing.indexOf(u) >= 0; }); });
}

/** A response worth keeping: 2xx, and the type the URL is (a clip is audio, a battery JSON, an engine file not HTML). */
function cacheable(url, res) {
  if (!res || !res.ok) return false;
  var type = String((res.headers && res.headers.get && res.headers.get('content-type')) || '').toLowerCase();
  var p = new URL(url).pathname;
  if (/\.(mp3|m4a|ogg)$/.test(p)) return type.indexOf('audio/') === 0;
  // a battery read while a switch was never read (X-SA-Switches: unread, sa_r8_switch_hold) guessed its OFFs: the page uses it,
  // the phone never keeps it for the next child
  if (/\.json$/.test(p)) return type.indexOf('json') >= 0 && String((res.headers.get && res.headers.get('x-sa-switches')) || '').toLowerCase() !== 'unread';
  if (/\.html$/.test(p)) return type.indexOf('text/html') === 0;
  return type.indexOf('text/html') < 0;
}

/** One engine file into the install cache, only when it is one (a cold portal may answer its own page once). */
function installOne(cache, url, fetchFn) {
  return Promise.resolve().then(function () { return fetchFn(url, { cache: 'no-cache' }); })
    .then(function (res) { return cacheable(url, res) ? cache.put(url, res) : null; })
    .catch(function () { return null; });
}

/** Which way a request is answered: 'core' | 'static' | null (not ours). */
function strategyFor(url, method, origin) {
  if (method !== 'GET') return null;
  var u = new URL(url);
  if (u.origin !== origin) return null;
  var p = u.pathname;
  if (/^\/sa\/v\d+\//.test(p) || /^\/sa\/batteries\//.test(p) || /\.(mp3|m4a|ogg|webp|png|woff2)$/.test(p)) {
    return /^\/(sa|wq)\//.test(p) ? 'static' : null;
  }
  if (/^\/sa\/[^/]+\.(js|css|html|json)$/.test(p) && p !== '/sa/sw.js') return 'core';
  return null;
}

if (typeof module === 'object' && module.exports) {
  module.exports = { strategyFor: strategyFor, cacheable: cacheable, installOne: installOne, prefetch: prefetch, CORE_FILES: CORE_FILES, CORE: CORE, SESSION: SESSION };
} else {
  self.addEventListener('install', function (e) {
    e.waitUntil(caches.open(CORE).then(function (c) {
      // One by one: a file the game lane has not shipped yet must not stop the worker installing.
      return Promise.all(CORE_FILES.map(function (f) { return installOne(c, new URL('/sa/' + f, self.location.href).href, fetch); }));
    }).then(function () { return self.skipWaiting(); }));
  });

  self.addEventListener('activate', function (e) {
    e.waitUntil(caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return (k.indexOf('sa-core-') === 0 && k !== CORE) || (k.indexOf('sa-session-') === 0 && k !== SESSION); }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); }));
  });

  var fromCache = function (req) {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || new Response('offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    });
  };

  self.addEventListener('fetch', function (e) {
    var how = strategyFor(e.request.url, e.request.method, self.location.origin);
    if (!how) return;
    if (how === 'static') {
      e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
        return hit || fetch(e.request).then(function (res) {
          if (cacheable(e.request.url, res)) { var copy = res.clone(); caches.open(SESSION).then(function (c) { c.put(e.request, copy); }); }
          return res;
        });
      }).catch(function () { return fromCache(e.request); }));
      return;
    }
    e.respondWith(new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(fromCache(e.request)); } }, NETWORK_WAIT_MS);
      fetch(e.request).then(function (res) {
        if (cacheable(e.request.url, res)) {
          var copy = res.clone();
          var key = new URL(e.request.url); key.search = '';
          caches.open(CORE).then(function (c) { c.put(key.toString(), copy); });
        }
        if (!done) { done = true; clearTimeout(timer); resolve(res.ok ? res : fromCache(e.request).then(function (hit) { return hit.status === 503 ? res : hit; })); }
      }, function () {
        if (!done) { done = true; clearTimeout(timer); resolve(fromCache(e.request)); }
      });
    }));
  });

  self.addEventListener('message', function (e) {
    var d = e.data || {};
    var port = e.ports && e.ports[0];
    if ((d.type !== 'prepare' && d.type !== 'check') || !port) return;
    var urls = (d.urls || []).filter(function (u) { return typeof u === 'string'; });
    if (d.type === 'check') {
      e.waitUntil(Promise.all(urls.map(function (u) {
        return caches.match(u, { ignoreSearch: true }).then(function (hit) { return hit ? null : u; }, function () { return u; });
      })).then(function (r) {
        var missing = r.filter(Boolean);
        port.postMessage({ ok: missing.length === 0, cached: urls.length - missing.length, missing: missing });
      }));
      return;
    }
    var bytes = 0;
    e.waitUntil(caches.open(SESSION).then(function (c) {
      return prefetch(urls, {
        fetch: function (u) { return fetch(u); },
        match: function (u) { return caches.match(u, { ignoreSearch: true }); },
        put: function (u, res) { return c.put(u, res); },
        ok: function (u, res) { return cacheable(new URL(u, self.location.href).href, res); },
        fresh: (d.fresh || []).filter(function (u) { return typeof u === 'string'; }),
        onBytes: function (n) { bytes += n; },
      });
    }).then(function (missing) {
      port.postMessage({ ok: missing.length === 0, cached: urls.length - missing.length, missing: missing, bytes: bytes });
    }, function (err) {
      port.postMessage({ ok: false, cached: 0, missing: urls, error: String(err) });
    }));
  });
}
