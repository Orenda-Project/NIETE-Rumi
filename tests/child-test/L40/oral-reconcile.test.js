'use strict';
/**
 * bd-s1oo0.50.10, from the first v3 sandbox e2e: for the strong synthetic child the model HEARD the right
 * number for "which is bigger: 287 or 534?" ("534") and for 623/632 ("632") but returned v "w" at conf 0.95,
 * so the items were settled wrong and never reached the coach. A verdict that contradicts its own heard
 * number is the model's mistake; code checks it (root CLAUDE.md rule 24c: assert the contract in code).
 * Only the network boundary is mocked; the real scorer runs on the committed bank.
 */
jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  const fs = jest.requireActual('fs');
  return {
    ...actual,
    execFile: jest.fn((bin, args, opts, cb) => {
      if (args.includes('-hide_banner')) { const e = new Error('no output'); cb(e, '', '  Duration: 00:01:20.00, start: 0'); return; }
      global.__cuts = (global.__cuts || []).concat([[Number(args[args.indexOf('-ss') + 1]), Number(args[args.indexOf('-to') + 1])]]);
      fs.writeFileSync(args[args.length - 1], Buffer.from('clip'));
      cb(null, '', '');
    }),
  };
});
jest.mock('form-data', () => class FormData {
  append(_k, v) { if (v && typeof v.destroy === 'function') { v.on('error', () => {}); v.destroy(); } }
  getHeaders() { return { 'content-type': 'multipart/form-data' }; }
});
const mockCreate = jest.fn();
jest.mock('openai', () => jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a) => mockCreate(...a) } }, audio: { transcriptions: { create: jest.fn(async () => { throw new Error('whisper down'); }) } } })));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const H = require('../L37/harness');
const IB = require('../../../bot/shared/services/child-test/item-bank');
const { scoreTask } = require('../../../bot/shared/services/child-test/scoring');

const AUDIO = path.join(os.tmpdir(), 'l40-note.ogg');
fs.writeFileSync(AUDIO, 'OggS');
beforeEach(() => { jest.clearAllMocks(); process.env.SONIOX_API_KEY = 't'; process.env.OPENROUTER_API_KEY = 't'; });

const spec = IB.getTaskSpec({ grade: 3, set: 'A', task: 'ma.discrimination' });
const reply = (rows) => H.reply({ found: true, items: rows.map(([heard, v], k) => ({ i: k + 1, heard, v, conf: 0.95 })) });

test('a verdict that contradicts the number the model heard is corrected from the answer key', async () => {
  H.sonioxReturns(axios, [[1, 1, 'کون سا بڑا ہے']]);
  const ans = spec.items.map((x) => String(x.answer));
  const rows = ans.map((a) => [a, 'c']);
  rows[1] = [String(spec.items[1].a === spec.items[1].answer ? spec.items[1].b : spec.items[1].a), 'c']; // said the smaller, marked right
  rows[7] = [ans[7], 'w'];                                // heard the right answer, marked wrong
  rows[8] = ['۶۳۲'.replace(/./g, (d) => '0123456789'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)] ?? d) === ans[8] ? '۶۳۲' : ans[8], 'w']; // Urdu digits
  rows[9] = ['', 'n'];                                    // nothing heard: left for the coach
  mockCreate.mockResolvedValue(reply(rows));
  const m = await scoreTask({ task: 'ma.discrimination', spec, media: { file: AUDIO, durationSec: 80 }, lang: 'ur', grade: 3 });
  const v = m.items.map((x) => x.verdict);
  expect(v[1]).toBe('wrong');
  expect(v[7]).toBe('correct');
  expect(v[8]).toBe('correct');
  expect(v[9]).toBe('none');
  expect(m.flags).toContain('verdict_reconciled');
  expect(m.score.correct).toBe(8);
});
