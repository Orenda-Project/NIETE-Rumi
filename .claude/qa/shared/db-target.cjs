'use strict';
/* db-target.cjs — the ONE place the Node harness picks the database it reads and writes (bd-z3ze4).
 *
 *   E2E_ENV=local  → the run's own local database (local-db.sh): NIETE_LOCAL_SUPABASE_*, 127.0.0.1 only.
 *                    Missing or non-local creds give {url:null} — NEVER a fallback to the sandbox, because
 *                    the bot under test is not on the sandbox and a write there is both wrong and invisible.
 *   anything else  → the sandbox: NIETE_SANDBOX_SUPABASE_*, exactly as before.
 *
 * Python tooling makes the same choice in niete_training_db._creds("local").
 */
const LOCAL_URL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/;

function dbCreds(env = process.env) {
  if (env.E2E_ENV === 'local') {
    const url = env.NIETE_LOCAL_SUPABASE_URL || '', key = env.NIETE_LOCAL_SUPABASE_SERVICE_ROLE_KEY || '';
    if (!LOCAL_URL.test(url) || !key) return { url: null, key: null, kind: 'local' };
    return { url: url.replace(/\/+$/, ''), key, kind: 'local' };
  }
  return { url: env.NIETE_SANDBOX_SUPABASE_URL || null, key: env.NIETE_SANDBOX_SUPABASE_SERVICE_ROLE_KEY || null, kind: 'sandbox' };
}

module.exports = { dbCreds };
