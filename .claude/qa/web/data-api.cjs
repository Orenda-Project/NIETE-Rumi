// data-api — the web lane's data E2E reads (bd-5b3u70.16): ctx.rows / ctx.snapshot / ctx.dataRules / ctx.dataKeys.
// The same calls the bot's mock lane drivers get as api.*, from the engine's db-read.cjs, pointed at THIS run's own
// database: the one dev-portal.sh cloned and wrote to <run>/db/db.env. A run with no db.env, a db.env naming a
// non-local database, or an engine without data checks (before 2.3.0) answers { ok:false, notChecked } on every call:
// the driver records the data step NOT CHECKED, never PASS, and the scenario's other steps still run.
// Reads only. Tests: test_data_api.js.
'use strict';
const fs = require('fs');
const path = require('path');

const ENGINE_BIN = path.resolve(__dirname, '..', 'engine', 'bin');
const OLD_ENGINE = 'this engine has no data checks (db-read.cjs) — pull the workspace for engine 2.3.0 or later';
const NO_RUN_DB = 'no run database (<run>/db/db.env) — the data checks read only the run\'s own local database';

function readEnvFile(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
  } catch (_) { return null; }
  return out;
}

function dataApi({ runDir, repo, engineBin = ENGINE_BIN, opts = {} } = {}) {
  let DR, prefixes;
  try {
    DR = require(path.join(engineBin, 'db-read.cjs'));
    ({ prefixes } = require(path.join(engineBin, 'db-target.cjs')));
  } catch (_) {
    const off = () => ({ ok: false, notChecked: OLD_ENGINE });
    return { rows: async () => off(), snapshot: async () => off(), dataRules: async () => off(), dataKeys: off };
  }
  const file = readEnvFile(path.join(runDir || '', 'db', 'db.env'));
  // db-read names the local creds by the prefix of the repo it runs in (db-target.cjs prefixes(), no argument); set
  // that, the given repo's and the generic name, so whichever it resolves reads this run's database.
  let env = null;
  if (file && file.SUPABASE_URL && file.SUPABASE_SERVICE_ROLE_KEY) {
    env = { E2E_ENV: 'local' };
    for (const p of new Set([prefixes().local, prefixes(repo).local, 'E2E_LOCAL_SUPABASE'])) {
      env[p + '_URL'] = file.SUPABASE_URL; env[p + '_SERVICE_ROLE_KEY'] = file.SUPABASE_SERVICE_ROLE_KEY;
    }
  }
  const none = () => ({ ok: false, notChecked: NO_RUN_DB });
  return {
    rows: async (table, filter) => (env ? DR.rows(table, filter, { env }) : none()),
    snapshot: async (watch) => (env ? DR.snapshot(watch, { ...opts, env }) : none()),
    dataRules: async (watch, cast, before) => (env ? DR.dataRules(watch, cast, before, { ...opts, env }) : none()),
    dataKeys: () => DR.watchFor(repo),
  };
}

module.exports = { dataApi };
