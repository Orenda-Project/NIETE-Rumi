/* Jugnu's reminder worker (served at /sw.js, scope /, while app_settings web_quiz_push_remind is on; else sw-off.js).
   It shows the one daily reminder, opens the quiz on a tap, stops on the Stop action and re-subscribes when the browser
   rotates the subscription. It has NO network request handler of any kind and keeps no cache: page loads never pass
   through it (JV3 condition 1; a source test in dashboard/tests/push-remind-edge.service.test.js holds that). The
   payload is {t, b, url, tag, lang, test}; it never carries a child's name. */
'use strict';

var ICON = '/wq/jugnu/hello.webp';
var COPY = {
  en: { t: 'Jugnu', b: "Today's quiz is ready. Tap to play.", test: 'Test: reminders are on.', stop: 'Stop reminders' },
  ur: { t: 'جگنو', b: 'آج کا کوئز تیار ہے۔ کھیلنے کے لیے دبائیں۔', test: 'ٹیسٹ: یاد دہانی آن ہے۔', stop: 'یاد دہانی بند کریں' },
};
var DB = 'wq-push';
var STORE = 'kv';

function str(v, max) { return typeof v === 'string' && v ? v.slice(0, max || 200) : ''; }

/** A same-site path only (never another site, never //host); else the home page. */
function safeUrl(u) {
  return typeof u === 'string' && /^\/(?![\/\\])/.test(u) && u.length <= 300 ? u : '/';
}

function post(path, body) {
  return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', keepalive: true })
    .catch(function () { return null; });
}

/** What the page kept at subscribe time ({key, code, lang}), or null. */
function idbGet(k) {
  return new Promise(function (resolve) {
    try {
      var open = indexedDB.open(DB, 1);
      open.onupgradeneeded = function () { open.result.createObjectStore(STORE); };
      open.onerror = function () { resolve(null); };
      open.onsuccess = function () {
        try {
          var g = open.result.transaction(STORE, 'readonly').objectStore(STORE).get(k);
          g.onsuccess = function () { resolve(g.result || null); };
          g.onerror = function () { resolve(null); };
        } catch (_) { resolve(null); }
      };
    } catch (_) { resolve(null); }
  });
}

function keyBytes(b64u) {
  var s = String(b64u).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  var raw = atob(s);
  var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function withSub(fn) {
  return self.registration.pushManager.getSubscription().then(function (sub) { return sub ? fn(sub) : null; }).catch(function () { return null; });
}

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = {}; }
  if (!d || typeof d !== 'object') d = {};
  var lang = d.lang === 'en' ? 'en' : 'ur';
  var c = COPY[lang];
  e.waitUntil(self.registration.showNotification(str(d.t, 60) || c.t, {
    body: str(d.b, 200) || (d.test ? c.test : c.b),
    icon: ICON,
    tag: str(d.tag, 40) || 'jugnu-remind',
    lang: lang,
    dir: lang === 'ur' ? 'rtl' : 'ltr',
    data: { url: safeUrl(d.url) },
    actions: [{ action: 'stop', title: c.stop }],
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  if (e.action === 'stop') {
    e.waitUntil(withSub(function (sub) {
      return post('/api/wqpush/unsubscribe', { endpoint: sub.endpoint, by: 'notification' })
        .then(function () { return sub.unsubscribe(); });
    }));
    return;
  }
  var url = safeUrl(e.notification.data && e.notification.data.url);
  e.waitUntil(Promise.all([
    self.clients.openWindow(url).catch(function () { return null; }),
    withSub(function (sub) { return post('/api/wqpush/opened', { endpoint: sub.endpoint }); }),
  ]));
});

self.addEventListener('pushsubscriptionchange', function (e) {
  var old = (e.oldSubscription && e.oldSubscription.endpoint) || null;
  e.waitUntil(idbGet('ctx').then(function (ctx) {
    if (!ctx || !ctx.key) return null;
    var next = e.newSubscription ? Promise.resolve(e.newSubscription)
      : self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(ctx.key) });
    return next.then(function (sub) {
      return post('/api/wqpush/subscribe', { sub: sub.toJSON(), code: ctx.code || null, lang: ctx.lang === 'en' ? 'en' : 'ur', rotate_from: old });
    });
  }).catch(function () { return null; }));
});
