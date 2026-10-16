'use strict';
/**
 * The door's verdict cache: "who holds this handset", per phone, for 10 minutes,
 * so a child's every message does not cost six head counts.
 *
 * Its own module so that whoever changes a handset's answer can drop the cached
 * verdict without requiring the door itself (student-ingress requires the quiz
 * modules, and student identity is one of them). Requires only Redis. Never throws.
 */
const redisService = require('./cache/railway-redis.service');

const CACHE_TTL_SECS = 10 * 60;
const CACHE_KEY = (phone) => `student_ingress:${String(phone || '').replace(/^\+/, '')}`;

async function get(phone) {
  return Promise.resolve(redisService.get(CACHE_KEY(phone))).catch(() => null);
}

/** `ttlSecs`: the 10-minute default; a shorter one for a verdict that must not outlive a minute (the guest's). */
async function set(phone, verdict, ttlSecs = CACHE_TTL_SECS) {
  await Promise.resolve(redisService.set(CACHE_KEY(phone), verdict, ttlSecs)).catch(() => {});
}

async function forget(phone) {
  await Promise.resolve(redisService.delete(CACHE_KEY(phone))).catch(() => {});
}

module.exports = { CACHE_KEY, CACHE_TTL_SECS, get, set, forget };
