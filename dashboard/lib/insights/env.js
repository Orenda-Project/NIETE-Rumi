'use strict';
/**
 * COACHIP nightly job: the environment assertion (NIGHTLY_JOB §1) and the dry run's read-only client (§2).
 * Nothing is written anywhere until assertEnvironment() has passed in write mode; prod is read-only in code
 * (PROD_WRITES_ALLOWED = false) whatever COACHIP_ENV says.
 */
const fs = require('fs');
const path = require('path');
const C = require('./constants');

class EnvRefusal extends Error {
  constructor(reason) {
    super(`env_mismatch: ${reason}`);
    this.name = 'EnvRefusal';
    this.exitCode = 3;
    this.failureClass = 'env_mismatch';
  }
}

/** The Supabase project ref: the first host label of the REST URL. */
function parseRef(url) {
  try { return new URL(url).hostname.split('.')[0] || null; } catch (_) { return null; }
}

/** The project ref inside a Postgres URL: the pooler user `postgres.<ref>` or the host `db.<ref>.supabase.co`. */
function parseDbRef(databaseUrl) {
  try {
    const u = new URL(databaseUrl);
    const user = decodeURIComponent(u.username || '');
    if (user.includes('.')) return user.split('.').pop();
    const m = u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/);
    return m ? m[1] : null;
  } catch (_) { return null; }
}

/**
 * Refuses (EnvRefusal, exit 3) unless the connection's ref is the ref COACHIP_ENV expects, and refuses any write to prod.
 * Returns { ref, mode: 'write' | 'read_only', env }. Makes no DB call.
 */
function assertEnvironment({ supabaseUrl, databaseUrl, coachipEnv, dryRun, bucket } = {}) {
  const ref = parseRef(supabaseUrl);
  if (!ref) throw new EnvRefusal('no project ref in SUPABASE_URL');
  if (!Object.prototype.hasOwnProperty.call(C.EXPECTED_REFS, coachipEnv)) throw new EnvRefusal('COACHIP_ENV unset or unknown');
  if (dryRun) {
    // A dry run writes nothing anywhere, so any tier may be read; it is the real-data check against prod (COS 06:17Z).
    return { ref, mode: 'read_only', env: coachipEnv };
  }
  const expected = C.EXPECTED_REFS[coachipEnv];
  if (!expected) throw new EnvRefusal(`no expected ref for ${coachipEnv} (from the go package)`);
  if (ref !== expected) throw new EnvRefusal(`ref does not match ${coachipEnv}`);
  if (ref === C.PROD_REF && !C.PROD_WRITES_ALLOWED) throw new EnvRefusal('prod writes are shut in code');
  if (databaseUrl) {
    const dbRef = parseDbRef(databaseUrl);
    if (dbRef !== ref) throw new EnvRefusal('DATABASE_URL is another project');
  }
  if (bucket != null && bucket !== C.CLIP_BUCKETS[coachipEnv]) throw new EnvRefusal('clip bucket is not this environment\'s bucket');
  return { ref, mode: 'write', env: coachipEnv };
}

const WRITE_OPS = ['insert', 'update', 'upsert', 'delete'];

function refuse(op) {
  return () => { throw new Error(`read-only client: ${op} refused in a dry run`); };
}

/** Wraps a supabase-js client so only select reaches it; coachip_* tables are not read either (a dry run computes in memory). */
function readOnlyClient(client) {
  return {
    from(table) {
      if (String(table).startsWith('coachip_')) throw new Error('read-only client: no coachip_ table is read in a dry run');
      const builder = client.from(table);
      return new Proxy(builder, {
        get(target, prop, recv) {
          if (WRITE_OPS.includes(prop)) return refuse(prop);
          return Reflect.get(target, prop, recv);
        },
      });
    },
    rpc: refuse('rpc'),
    storage: undefined,
  };
}

/** Runs fn(dir) with a fresh directory under root and removes everything in it afterwards, error or not. */
async function withPrivateDir(root, fn) {
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'audio-'));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { EnvRefusal, parseRef, parseDbRef, assertEnvironment, readOnlyClient, withPrivateDir };
