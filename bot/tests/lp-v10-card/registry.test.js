'use strict';
// bd-rj6w0n.14.16.6 — the two runtime v10 jobs: Sonnet 5 unless their own variable says otherwise,
// and parsed whole by the caller (moves.js / author.js safeJsonParse).
const { modelFor, JOBS } = require('../../shared/config/model-registry');

describe('v10 card jobs in the registry', () => {
  const vars = ['LP_V10_MOVES_MODEL', 'LP_V10_CARD_MODEL'];
  let saved;
  beforeEach(() => { saved = vars.map((v) => process.env[v]); vars.forEach((v) => delete process.env[v]); });
  afterEach(() => vars.forEach((v, i) => { if (saved[i] === undefined) delete process.env[v]; else process.env[v] = saved[i]; }));

  test.each([['lp.v10moves', 'LP_V10_MOVES_MODEL'], ['lp.v10card', 'LP_V10_CARD_MODEL']])('%s', (job, env) => {
    expect(JOBS[job]).toMatchObject({ env, default: 'anthropic/claude-sonnet-5' });
    expect(modelFor(job)).toBe('anthropic/claude-sonnet-5');
    process.env[env] = 'anthropic/claude-opus-5';
    expect(modelFor(job)).toBe('anthropic/claude-opus-5');
  });
});
