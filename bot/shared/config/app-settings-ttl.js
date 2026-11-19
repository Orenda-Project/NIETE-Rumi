'use strict';
/**
 * One TTL for the app_settings switch caches — 30 s in production.
 *
 * Several services cache the switches they read from app_settings for 30 s each (app-redirect, the
 * web-quiz hub flags, the quiz card and book, the class-round flags, the story teacher …). The E2E mock
 * lane flips those switches mid-run and had to sleep 31 s after every flip so each cache would expire —
 * 18 times in one run, 558 s. APP_SETTINGS_FLAG_TTL_MS lets a test lane shorten every cache at once
 * (the lane sets 1000); unset, or anything but a whole number of milliseconds up to an hour, keeps 30 s.
 */
const APP_SETTINGS_FLAG_TTL_MS = (() => {
  const raw = String(process.env.APP_SETTINGS_FLAG_TTL_MS || '').trim();
  if (!raw) return 30 * 1000;
  const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
  return Number.isInteger(n) && n > 0 && n <= 3600000 ? n : 30 * 1000;
})();

module.exports = { APP_SETTINGS_FLAG_TTL_MS };
