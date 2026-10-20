'use strict';
/**
 * One recording per quiz at a time (app_settings `web_quiz_audio_claim`, default OFF). A quiz's clip job is queued from
 * the teacher's link, the page open and the worker's own "come back in a minute", under different job ids, so two
 * workers could record the same quiz at once and pay for every clip twice. On, the worker's job claims the quiz (under
 * its plan) in Redis before it records and lets the claim go when it ends; a second job meanwhile skips.
 * on(): read through the caller's client, 30 s cache, JSON `true` only, fails closed. claim(): Redis down claims (the
 * job records: a rare double beats a silent quiz).
 */
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_audio_claim';
const TTL_MS = 30 * 1000;
// a claim outlives the job's own 600 s visibility, never a stuck worker by much
const CLAIM_TTL_S = 900;
let cache = null;

async function on({ db, now = Date.now() } = {}) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const client = db || require('../../config/supabase');
    const { data, error } = await client.from('app_settings').select('key, value').eq('key', KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: (data || []).some((r) => r && r.key === KEY && r.value === true) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ web quiz audio claim: settings lookup failed — off', { error: err.message });
    return false;
  }
}

const claimKey = (quizId, plan) => `wq:audio:claim:${quizId}:${plan && plan.sig ? plan.sig : 'base'}`;

async function claim(quizId, plan) {
  const redis = require('../cache/railway-redis.service');
  return redis.setNX(claimKey(quizId, plan), String(Date.now()), CLAIM_TTL_S);
}

async function release(quizId, plan) {
  try { await require('../cache/railway-redis.service').delete(claimKey(quizId, plan)); } catch (_) { /* it lapses on its own */ }
}

module.exports = { on, claim, release, claimKey, KEY, CLAIM_TTL_S, _resetCache: () => { cache = null; } };
