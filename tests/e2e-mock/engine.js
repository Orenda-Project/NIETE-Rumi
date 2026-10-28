// The E2E harness is the SHARED engine, borrowed from rumi-agent-home (bd-9157r.1): scripts/qa/link-engine.sh links it
// in at .claude/qa/engine on a developer machine, and CI fetches it with the QA_ENGINE_TOKEN secret. The suites here that
// test engine code read and load it through that link. Without it they SKIP with this reason instead of failing: a
// machine without the engine is a state, not a regression.
const fs = require('fs');
const path = require('path');

const ENGINE_BIN = path.resolve(__dirname, '..', '..', '.claude', 'qa', 'engine', 'bin');
const HAVE_ENGINE = fs.existsSync(path.join(ENGINE_BIN, 'run-suite.sh'));
const WHY = 'no shared E2E engine at .claude/qa/engine (bash scripts/qa/link-engine.sh; CI needs QA_ENGINE_TOKEN)';
if (!HAVE_ENGINE && !global.__e2eEngineWarned) { global.__e2eEngineWarned = true; console.warn('skipping engine suites: ' + WHY); }

module.exports = {
  ENGINE_BIN,
  HAVE_ENGINE,
  describeWithEngine: HAVE_ENGINE ? describe : describe.skip,
  testWithEngine: HAVE_ENGINE ? test : test.skip,
};
