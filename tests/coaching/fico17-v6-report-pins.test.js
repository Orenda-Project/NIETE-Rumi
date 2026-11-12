'use strict';
/**
 * bd-ra8xu.40 — the FICO17 v6 report and debrief branches leave every other prompt exactly as it was.
 *
 * A v6 /observe visit gets its own narrative prompt, target and debrief data block. The V3 ('fico') prompts and the
 * /observe2 ones (v5, and v6, whose analysis is framework 'fico' with its own target and brief) must read byte for byte
 * as they did on origin/sandbox before this change. The hashes below are those prompts, taken on 03532faf4.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const crypto = require('crypto');
const { allPrompts } = require('../fixtures/report-prompt-pins');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const PINNED = {
  'narrative-v3-en': 'ef8ebbaeb692a9e430e5ab327072c2ce014f7998a139df4131b6c4e3b0487cca',
  'narrative-v3-notarget-en': '3db118b1841029f13088c00297e96079428733740033f78c1391e51ac00b0144',
  'narrative-observe2-v6-en': '748a0f00d1c13b39ec2e3c0cfa953ca543e0e129ea3c181e92bdd6b7f37f8eb5',
  'narrative-observe2-v5-en': '2cf9cb84c5fecbeea8ceb55fdd396ebe72c8f651edf385938c802fcc71f699e2',
  'guide-v3-en': '556ddba680c75f3baf369f9681b8ccb868c0222e3b0780940396ca2ddbb30625',
  'guide-fallback-v3-en': 'fa50021879e6dffafaa29b986bc5e549f5450187a806b130459321d7e1363b84',
  'narrative-v3-ur': '2d6e8493ee0c6b1da6a6da6fbf9513fbc3f391d66617e9046bc45fb75284786c',
  'narrative-v3-notarget-ur': 'fbe7662a30489376d2eb343e1f1601d5d584b176893bd44bbf73039f3b522a7b',
  'narrative-observe2-v6-ur': '5acbfa9da276b3c78493e663b308bda0d68b1c2a358ca2114611341ed92f9ae8',
  'narrative-observe2-v5-ur': '7c7c8f350522cdf76283c5ba751b2d138534ef20b4952fb74ce07e1c260d5f56',
  'guide-v3-ur': '33e0f372d05a09620040d726a6b1cae2c3d01e641ed8f8e5ee4783f3b7f76fa4',
  'guide-fallback-v3-ur': 'ae5ff4f528fb1636d04e0340e6ebfb86a00f016f0b206c8a845198ad6d922ee3',
  // staging: FICO V3 specs (sandbox runs V4, whose specs give its V3 target another count/levels; same code path)
  'target-v3': '65b01bfd69e4683e66a6ab67cb22a19a9600d1a8e166a5839d6b23ac79fc7457',
  'target-observe2-v6': '1bcaa2039aa659a78601d98058bac2dbd07fca167069d55de4cc28097a2e4ed5',
  'target-observe2-v5': '9b0dff2b7df674d5d0a04361aaec9fcd52dfc5bec851ab6b82e91558150b74ea',
};

describe('V3 and /observe2 prompts and targets are unchanged by the v6 branches', () => {
  const built = allPrompts();
  test('every pinned prompt is built', () => {
    expect(Object.keys(built).sort()).toEqual(Object.keys(PINNED).sort());
  });
  test.each(Object.keys(PINNED))('%s reads byte for byte as before', (key) => {
    expect(sha(built[key])).toBe(PINNED[key]);
  });
});
