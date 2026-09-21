/**
 * The mock adapter resolves a Flow's endpoint path from the bot's own registry (flow-configs.js).
 * The Teacher Training Flow is not in that registry (it is published by hand), so every training
 * Flow scenario read NO_ENDPOINT_PATH:TEACHER_TRAINING_FLOW_ID. The bot DOES mount the route —
 * flow-endpoint.routes.js has router.post('/teacher-training') — so the adapter falls back to the
 * env var's stem when the routes file declares it, and refuses anything the bot does not mount.
 * Red-first: fails on develop — endpointPathFor is not exported.
 */
// The harness is SHARED: .claude/qa/engine is a gitignored symlink into rumi-agent-home, created by
// scripts/qa/link-engine.sh. A checkout without it (CI, a machine with no workspace) has no adapter
// to test, so these cases announce themselves as skipped rather than failing on a missing module.
const fs = require('fs');
const path = require('path');
const ADAPTER = path.join(__dirname, '..', '..', '.claude', 'qa', 'engine', 'bin', 'mock-api.cjs');
const HAVE_ENGINE = fs.existsSync(ADAPTER);
const endpointPathFor = HAVE_ENGINE ? require(ADAPTER).endpointPathFor : null;
const t = HAVE_ENGINE ? test : test.skip;
const ROUTES = `
router.post('/settings', async (req, res) => {});
router.post('/teacher-training', async (req, res) => {});
router.post('/pakistan-lp', async (req, res) => {});
`;

t('the registry wins when it has the Flow', () => {
  expect(endpointPathFor('SETTINGS_FLOW_ID', { SETTINGS_FLOW_ID: '/api/flows/settings-v2' }, ROUTES)).toBe('/api/flows/settings-v2');
});

t('a Flow missing from the registry resolves to /api/flows/<stem> when the bot mounts that route', () => {
  expect(endpointPathFor('TEACHER_TRAINING_FLOW_ID', {}, ROUTES)).toBe('/api/flows/teacher-training');
  expect(endpointPathFor('PAKISTAN_LP_FLOW_ID', {}, ROUTES)).toBe('/api/flows/pakistan-lp');
});

t('a Flow the bot does not mount stays unresolved — the scenario must say NO_ENDPOINT_PATH, not guess', () => {
  expect(endpointPathFor('READING_ASSESSMENT_FLOW_ID', {}, ROUTES)).toBe(null);
});
