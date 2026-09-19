// tenant.cjs — Node face of bin/tenants_lite.py (bd-9157r). ONE python call per repo root, cached.
//
// The runner and the mock driver used to resolve the repo as `path.resolve(__dirname, '..', '..', '..')` and
// hardcode `bot/…`, `niete_*_db.py` and `NIETE_SANDBOX_SUPABASE_*`. Vendored at .claude/qa/engine/bin that
// arithmetic lands in .claude/, and none of those names hold for another tenant. Everything comes from
// .claude/qa/config/tenants.yaml instead:
//
//   const T = require('./tenant.cjs').load();       // CLAUDE_PROJECT_DIR › cwd's ancestors › engine's parent
//   T.root T.command T.specDir T.driversDir T.botRoot T.e2eScripts T.db T.keys T.tenantTools T.tenants
//   T.tenant('tz')        → { id, region_code, phone_number_id, driver, features, chrome, …, copy }
//   T.defaultTenant()     → E2E_TENANT or the manifest's first tenant
//   T.tool('training_db') → absolute path of the per-repo tool, or null when unconfigured / absent
//   T.dbEnv()             → { url, key, prefix } from <db.env_prefix>_URL / _SERVICE_ROLE_KEY
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const MANIFEST = path.join('.claude', 'qa', 'config', 'tenants.yaml');
const cache = new Map();

function hasManifest(d) { return !!d && fs.existsSync(path.join(d, MANIFEST)); }

function findRoot(start) {
  if (start && hasManifest(path.resolve(start))) return path.resolve(start);   // explicit guarded repo wins
  const env = (process.env.CLAUDE_PROJECT_DIR || '').trim();
  if (hasManifest(env)) return env;
  let d = path.resolve(start || process.cwd());
  for (;;) {
    if (hasManifest(d)) return d;
    const p = path.dirname(d);
    if (p === d) break;
    d = p;
  }
  const eng = path.resolve(__dirname, '..', '..', '..', '..');   // <repo>/.claude/qa/engine/bin → <repo>
  if (hasManifest(eng)) return eng;
  throw new Error('tenant.cjs: no ' + MANIFEST + ' above ' + (start || process.cwd()) + ' (CLAUDE_PROJECT_DIR=' + JSON.stringify(env) + ')');
}

function copyFor(root, id) {
  const p = path.join(root, '.claude', 'qa', 'fixtures', 'whatsapp', id, 'copy.yaml');
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(execFileSync('python3', ['-c',
      'import sys,json; sys.path.insert(0, sys.argv[1]); import yaml_lite; print(json.dumps(yaml_lite.safe_load(open(sys.argv[2], encoding="utf-8")) or {}))',
      __dirname, p], { encoding: 'utf8' }));
  } catch (_) { return {}; }
}

function load(root) {
  const r = hasManifest(root) ? path.resolve(root) : findRoot(root);
  if (cache.has(r)) return cache.get(r);
  const j = JSON.parse(execFileSync('python3', [path.join(__dirname, 'tenants_lite.py'), '--root', r, '--json'], { encoding: 'utf8' }));
  const T = {
    root: r, repo: j.repo, command: j.command, specSuite: j.spec_suite, specDir: j.spec_dir, driversDir: j.drivers_dir,
    agentsDir: j.agents_dir, commandDoc: j.command_doc, botRoot: j.bot_root, e2eScripts: j.e2e_scripts, branches: j.branches,
    keys: j.keys || {}, db: j.db || {}, tenantTools: j.tenant_tools || {}, multi: !!j.multi, tenants: j.tenants,
    tenantIds() { return Object.keys(j.tenants); },
    tenant(id) {
      const t = j.tenants[id];
      if (!t) throw new Error('tenant.cjs: unknown tenant ' + id + ' (known: ' + Object.keys(j.tenants).join(', ') + ')');
      return Object.assign({ id }, t, { copy: copyFor(r, id) });
    },
    defaultTenant() { return this.tenant((process.env.E2E_TENANT || '').trim() || Object.keys(j.tenants)[0]); },
    tool(name) {
      const p = (j.tenant_tools || {})[name];
      if (!p) return null;
      const full = path.join(r, p);
      return fs.existsSync(full) ? full : null;
    },
    dbEnv() {
      const prefix = (j.db && j.db.env_prefix) || 'E2E_SUPABASE';
      return { url: process.env[prefix + '_URL'], key: process.env[prefix + '_SERVICE_ROLE_KEY'], prefix };
    },
  };
  cache.set(r, T);
  return T;
}

module.exports = { load, findRoot };
