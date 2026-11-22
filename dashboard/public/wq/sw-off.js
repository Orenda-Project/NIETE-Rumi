/* Jugnu's reminder worker, switched OFF (served at /sw.js while app_settings web_quiz_push_remind is off): a phone that
   still holds the reminder worker drops it on its next page load. Nothing else listens here. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.registration.unregister()); });
