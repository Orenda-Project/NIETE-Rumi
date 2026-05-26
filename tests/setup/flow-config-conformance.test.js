/**
 * flow-config conformance — keeps FLOW_CONFIGS, the shipped Flow JSON assets,
 * the env vars the bot actually reads, and the mounted Flow endpoints all in
 * agreement. Regression guard for three real defects:
 *
 *   1. Coverage gap: a Flow JSON ships + the bot reads its *_FLOW_ID, but no
 *      FLOW_CONFIGS entry registers it -> the feature silently never works.
 *   2. Orphan asset: a *-flow.json with no env consumer (tracked, not silent).
 *   3. Endpoint mismatch: endpointPath that doesn't match a route mounted under
 *      /api/flows -> Meta calls a 404 (the original '/flow/...' prefix bug).
 */

const fs = require('fs');
const path = require('path');

const { FLOW_CONFIGS, FLOWS_DIR } = require('../../bot/scripts/setup/flow-configs');

const REPO_ROOT = path.resolve(__dirname, '../..');
const BOT_DIR = path.join(REPO_ROOT, 'bot');
const ROUTES_FILE = path.join(BOT_DIR, 'shared/routes/flow-endpoint.routes.js');

// Flow JSON that ships but is intentionally NOT registered yet (no env consumer
// / not wired). Keep this list short and justified.
const ORPHAN_JSON_ALLOWLIST = new Set([
  // (empty) — quiz-flow.json is now wired: QUIZ_FLOW_ID constant + /api/flows/quiz
  // endpoint + flow-configs entry.
]);

// *_FLOW_ID env vars the bot reads but for which NO Flow JSON ships yet, so they
// can't be registered. Tracked here so the gap is visible, not silently re-broken.
const CONSUMER_WITHOUT_ASSET = new Set([
  // exam-checker reads this but ships no Flow JSON and is intentionally unset on
  // prod (hardcoded fallback IDs) — optional, documented, not registerable here.
  'EXAM_CHECKER_STUDENTS_FLOW_ID',
]);

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

// Every *_FLOW_ID the bot reads via process.env.
function flowIdEnvVarsReadByBot() {
  const found = new Set();
  const re = /process\.env\.([A-Z_]*FLOW_ID[A-Z_]*)/g;
  for (const f of walk(BOT_DIR)) {
    const src = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(src)) !== null) found.add(m[1]);
  }
  return found;
}

describe('flow-config conformance', () => {
  const configEnvVars = new Set(FLOW_CONFIGS.map((c) => c.envVar));

  test('every Flow JSON on disk is registered (or explicitly allowlisted as an orphan)', () => {
    const configured = new Set(FLOW_CONFIGS.map((c) => path.basename(c.jsonPath)));
    const onDisk = fs.readdirSync(FLOWS_DIR).filter((f) => f.endsWith('.json'));
    const unregistered = onDisk.filter(
      (f) => !configured.has(f) && !ORPHAN_JSON_ALLOWLIST.has(f),
    );
    expect(unregistered).toEqual([]);
  });

  test('every FLOW_CONFIGS jsonPath resolves to a real file', () => {
    const missing = FLOW_CONFIGS.filter((c) => !fs.existsSync(c.jsonPath)).map((c) => c.name);
    expect(missing).toEqual([]);
  });

  test('every FLOW_CONFIGS envVar is actually read by the bot', () => {
    const read = flowIdEnvVarsReadByBot();
    const unread = FLOW_CONFIGS.filter((c) => !read.has(c.envVar)).map((c) => c.envVar);
    expect(unread).toEqual([]);
  });

  test('every *_FLOW_ID the bot reads is either registered or a known consumer-without-asset', () => {
    const read = flowIdEnvVarsReadByBot();
    const unaccounted = [...read].filter(
      (v) => !configEnvVars.has(v) && !CONSUMER_WITHOUT_ASSET.has(v),
    );
    expect(unaccounted).toEqual([]);
  });

  test('every endpoint flow points at a route mounted under /api/flows', () => {
    const routesSrc = fs.readFileSync(ROUTES_FILE, 'utf8');
    const mounted = new Set(
      [...routesSrc.matchAll(/router\.post\(\s*['"](\/[a-z0-9-]+)['"]/g)].map((m) => m[1]),
    );
    const broken = FLOW_CONFIGS.filter((c) => c.type === 'endpoint').filter((c) => {
      if (!c.endpointPath || !c.endpointPath.startsWith('/api/flows/')) return true;
      const routePath = c.endpointPath.replace(/^\/api\/flows/, '');
      return !mounted.has(routePath);
    }).map((c) => `${c.name} (${c.endpointPath})`);
    expect(broken).toEqual([]);
  });

  test('navigate flows have no endpointPath; endpoint flows do', () => {
    for (const c of FLOW_CONFIGS) {
      if (c.type === 'navigate') expect(c.endpointPath).toBeUndefined();
      if (c.type === 'endpoint') expect(typeof c.endpointPath).toBe('string');
    }
  });
});
