/**
 * Read the local .env file — unless Railway already supplied the environment (bd-bodycs).
 *
 * On a deploy, or under `railway run`, every variable comes from Railway. Reading a
 * checkout's .env on top of that fills each key Railway left unset with whatever the
 * file holds; dotenv never overrides a set key, but the unset ones are enough. On
 * 2026-11-06 a sandbox probe picked up 11 production values that way. So when any
 * Railway marker is present the file is not read at all. A plain local run reads it
 * exactly as before.
 *
 * Tested by tests/config/load-env.test.js.
 */

const RAILWAY_MARKERS = [
  'RAILWAY_ENVIRONMENT',
  'RAILWAY_ENVIRONMENT_NAME',
  'RAILWAY_ENVIRONMENT_ID',
  'RAILWAY_PROJECT_ID',
];

function loadEnv({ env = process.env, dotenv } = {}) {
  if (RAILWAY_MARKERS.some((key) => env[key])) {
    return { loaded: false, reason: 'railway' };
  }
  (dotenv || require('dotenv')).config();
  return { loaded: true };
}

module.exports = { loadEnv, RAILWAY_MARKERS };
