/**
 * FEAT-059 — the publish script must push the JSON the endpoint actually serves.
 *
 * The Flow publish is the one irreversible step on go-day, and it is driven by
 * scripts/publish-pakistan-lp-flow.py. That script still hardcoded
 * pakistan-lp-flow-v1.json: running the documented command would have replaced
 * the live Flow with a JSON two versions older than the endpoint, on the same
 * Flow id teachers use — a worse outcome than not publishing at all.
 *
 * "The runbook says publish" is not the same as "the script publishes the right
 * file", so the two are pinned to each other here.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'publish-pakistan-lp-flow.py');
const SERVED_JSON = 'pakistan-lp-flow-v3.json';   // what tests/lp-v8/flow-json.test.js asserts

describe('publish-pakistan-lp-flow.py', () => {
  let src;
  beforeAll(() => { src = fs.readFileSync(SCRIPT, 'utf8'); });

  test('defaults to the Flow JSON the endpoint is built against', () => {
    const m = src.match(/DEFAULT_FLOW_JSON\s*=\s*REPO\s*\/\s*"docs"\s*\/\s*"flows"\s*\/\s*"([^"]+)"/);
    expect(m).not.toBeNull();
    expect(m[1]).toBe(SERVED_JSON);
  });

  test('that file exists', () => {
    expect(fs.existsSync(path.join(REPO, 'docs', 'flows', SERVED_JSON))).toBe(true);
  });

  test('the JSON path is overridable, so a rollback can push the previous version', () => {
    expect(src).toContain('--json');
  });

  test('no stale v1/v2 default is left anywhere in the script', () => {
    expect(src).not.toMatch(/pakistan-lp-flow-v[12]\.json/);
  });
});
