'use strict';
/**
 * bd-qyi45h.1 option (c), the writer side. Every check run of a G6-12 board paper logs one
 * '[assessment] board level split' line (attempt number, per-level have/target/reach, tolerance, pass, no person
 * ids). The final PATTERN_SHORT_SLOT throw carries `detail` naming the hard rules; the user-facing message is
 * unchanged. Fictional replies, no LLM, no database.
 */
jest.mock('../../../bot/shared/services/assessment/fde-layout', () => ({
  applyLayout: () => { throw new Error('applyLayout must never be called by the board writer'); },
}));
const A = '../../../bot/shared/services/assessment/';
const { writeBoardPaper } = require(`${A}board-writer`);
const { leavesOf } = require(`${A}board-6-12/tree`);
const Checks = require(`${A}board-checks`);
const LL = require(`${A}board-6-12/level-log`);
const { makeDeps } = require('./helpers/fake-deps');
const { fictionalVariant, fictionalEntry } = require('./helpers/fictional-cell');

const TOS = { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 };
const row = { code: 'physics', grade: 9, band: '9_10', medium: 'en', rtl: false, prompt_key: 'eg.ict.physics.9_10.system', tos_default: TOS, board_mode: 'board' };
const ctx = { grade: 9, row, levels: TOS.levels, style: 'holistic_bands', ur: false };

async function write(checksRun) {
  const { d } = makeDeps(ctx);
  const logs = [];
  d.logToFile = (msg, data) => logs.push({ msg, data });
  if (checksRun) d.checks = { run: checksRun };
  const res = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'p', P: fictionalEntry(), variant: fictionalVariant(), requestId: 'req-1' }, d).catch((e) => e);
  return { res, logs: logs.filter((l) => l.msg === '[assessment] board level split') };
}

/** The real checks, plus one hard D16 KEY_LEAK on the first A.Q1 item of every non-probe run: the paper never clears. */
const alwaysHard = (ex, c) => {
  const r = Checks.run(ex, c);
  const first = leavesOf(ex).find((l) => String(l.id).startsWith('A.Q1#'));
  if (first) {
    r.shortfall.push({ slot: 'A.Q1', reason: 'D16', items: [first.id], item_refs: [first.id], hard: true });
    r.record.hard += 1;
    r.record.hard_rules = { ...(r.record.hard_rules || {}), 'D16 KEY_LEAK': 1 };
  }
  return r;
};

describe('board level split log line', () => {
  test('a clean paper logs one line per check run, numbered from 1, with the pattern and request id', async () => {
    const { res, logs } = await write();
    expect(res.examJson).toBeDefined();
    expect(logs.length).toBeGreaterThanOrEqual(1);
    logs.forEach((l, i) => expect(l.data.attempt).toBe(i + 1));
    const line = logs[0].data;
    expect(line).toMatchObject({ requestId: 'req-1', pattern: 'p', grade: 9, subject: 'physics', tolerance_pp: 5 });
    expect(Object.keys(line.levels).sort()).toEqual(['A', 'K', 'U']);
    expect(line.levels.U).toEqual({ have: expect.any(Number), target: 50, reach: expect.any(Number) });
    expect(typeof line.pass).toBe('boolean');
    expect(line).not.toHaveProperty('userId');
  });

  test('a paper that never clears logs every attempt and throws with the hard rules in detail', async () => {
    const { res, logs } = await write(alwaysHard);
    expect(res.code).toBe('PATTERN_SHORT_SLOT');
    expect(res.message).toBe('A section is still short of questions after one more try.');
    expect(res.detail).toMatch(/D16 KEY_LEAK x1/);
    expect(logs.length).toBeGreaterThan(1);
    expect(logs.map((l) => l.data.attempt)).toEqual(logs.map((_, i) => i + 1));
  });
});

describe('hardDetail', () => {
  test('names each hard rule with its count, then the checks', () => {
    const got = LL.hardDetail({ hard: 3, hard_rules: { 'D12 LEVEL_OVER': 2, 'D16 KEY_LEAK': 1 }, per_check: { 'blueprint-qa': { hard: 2 }, 'key-leak': { hard: 1 }, 'tag-split': { hard: 0 } } });
    expect(got).toBe('hard rules: D12 LEVEL_OVER x2, D16 KEY_LEAK x1; checks: blueprint-qa=2, key-leak=1');
  });

  test('null for a record with no hard issue', () => {
    expect(LL.hardDetail({ hard: 0, per_check: {} })).toBeNull();
    expect(LL.hardDetail(undefined)).toBeNull();
  });
});
