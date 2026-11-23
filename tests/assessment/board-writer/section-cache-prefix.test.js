'use strict';
/** bd-i9yhrz: every section call of one board paper shares a byte-identical cached prefix (system + book). No network. */
jest.mock('../../../bot/shared/services/assessment/fde-layout', () => ({ applyLayout: () => { throw new Error('no'); } }));
const A = '../../../bot/shared/services/assessment/';
const { writeBoardPaper } = require(`${A}board-writer`);
const { _sectionMessages } = require(`${A}assessment-generation.service`);
const ssc1 = require(`${A}patterns/board/fbise-ssc1`);
const { makeDeps } = require('./helpers/fake-deps');

const TOS = { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 };
const row = { code: 'physics', grade: 9, band: '9_10', medium: 'en', rtl: false, prompt_key: 'eg.ict.physics.9_10.system', tos_default: TOS, board_mode: 'board' };
const variant = ssc1.subjects.physics.variants.find((v) => v.variant_id === '50pct');

async function paperCalls() {
  const { d } = makeDeps({ grade: 9, row, levels: TOS.levels, style: 'analytic_points' });
  const seen = [];
  const inner = d.writeSection;
  d.sectionMessages = (a) => _sectionMessages({ ...a, model: 'anthropic-direct/test' });
  d.writeSection = (a) => { seen.push(a); return inner(a); };
  await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'fbise_ssc1_2027', P: ssc1.subjects.physics, variant, requestId: 'r' }, d);
  return seen.map((a) => a.messages);
}

// The bytes up to and including the cache_control breakpoint: the system block and the user block marked for caching.
const prefix = (m) => JSON.stringify([m[0].content, m[1].content[0]]);

test('two sections of one paper share a byte-identical cached prefix', async () => {
  const calls = await paperCalls();
  expect(calls.length).toBeGreaterThan(1);
  expect(calls[0][1].content[0].cache_control).toBeTruthy();
  const keys = new Set(calls.map(prefix));
  expect(keys.size).toBe(1);
});

test('the per-section task still reaches the model, after the breakpoint', async () => {
  const calls = await paperCalls();
  calls.forEach((m) => {
    const tail = m[1].content[1].text;
    expect(tail).toMatch(/### TASK: WRITE ONE SECTION/);
    expect(tail).toMatch(/Slots, in order/);
    expect(tail).toMatch(/Return JSON/);
    expect(m[0].content[0].text).not.toMatch(/TASK: WRITE ONE SECTION/);
  });
  const tasks = new Set(calls.map((m) => m[1].content[1].text));
  expect(tasks.size).toBeGreaterThan(1);
});
