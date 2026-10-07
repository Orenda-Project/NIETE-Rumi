'use strict';
/**
 * One boot line per service: which web-quiz config this process actually runs with.
 *
 *   web_quiz.config { audioBucket, childVoiceBucket, baseHost, tokenSecret }
 *
 * The bucket NAMES the quiz clips and the children's recordings go to, the HOST
 * child links are minted on, and whether the link-signing secret is this
 * deployment's own or derived from the internal key ("own" | "derived" | "none").
 * Names and hosts only, never a secret value. Read right after a deploy, it shows
 * every service agrees without anyone reading the variables.
 *
 * Light on purpose: nothing here may become a boot dependency (no network, no
 * Supabase, not the challenge module). The child-voice rule is the challenge's
 * own (CHILD_VOICE_BUCKET, else the quiz-audio bucket); a test holds them equal.
 */
const AudioStore = require('./web-quiz-audio-store');
const { logEvent } = require('../../utils/structured-logger');

function hostOf(url) {
  try { return new URL(String(url || '').trim()).hostname || null; } catch (_) { return null; }
}

/** The config as it resolves from `env`. Pure. */
function webQuizConfig(env = process.env) {
  const audioBucket = AudioStore.quizAudioBucket(env);
  return {
    audioBucket,
    childVoiceBucket: String(env.CHILD_VOICE_BUCKET || '').trim() || audioBucket,
    baseHost: hostOf(env.WEB_QUIZ_BASE_URL) || hostOf(env.PORTAL_URL),
    tokenSecret: env.WEB_QUIZ_TOKEN_SECRET ? 'own' : env.INTERNAL_API_KEY ? 'derived' : 'none',
  };
}

/** Log the line once at boot. Never throws: a log line must not stop a service starting. */
function logWebQuizConfig(env = process.env) {
  try {
    const c = webQuizConfig(env);
    logEvent('web_quiz.config', c);
    return c;
  } catch (_) {
    return null;
  }
}

module.exports = { webQuizConfig, logWebQuizConfig };
