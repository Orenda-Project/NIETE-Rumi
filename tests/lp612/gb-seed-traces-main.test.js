'use strict';
/**
 * bd-rj6w0n.14.16.18 — the command line of gb-seed-traces.js: argv parsing, dry run vs --commit, --list, the
 * log lines an operator reads, and the exit code on a bad file. R2 is mocked; no DB row is ever written.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => { throw new Error('traces write no DB rows'); } }));
jest.mock('../../bot/shared/storage/r2', () => ({ listKeys: jest.fn(), uploadBuffer: jest.fn() }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const r2 = require('../../bot/shared/storage/r2');
const Traces = require('../../bot/scripts/gb-seed-traces');

const SEG = 'nbf_snc_grade_2_urdu.c07.s005';
let dir;
let logs;
const write = (name, body) => { const p = path.join(dir, name); fs.writeFileSync(p, body); return p; };
const manifest = (over = {}, files = {}) => write('manifest.json', JSON.stringify({
  template_version: 'gb_k5_v10',
  rows: [{
    segment_id: SEG, lang: 'ur',
    files: {
      html: write('a.html', '<html><body>v9</body></html>'), 'lp.json': write('a.lp.json', '{"lp":1}'),
      'card.json': write('a.card.json', '{"c":1}'), 'moves.json': write('a.moves.json', '{"m":1}'), ...files,
    },
  }],
  ...over,
}));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-traces-'));
  logs = [];
  jest.spyOn(console, 'log').mockImplementation((m) => logs.push(m));
  r2.listKeys.mockReset();
  r2.uploadBuffer.mockReset().mockResolvedValue('url');
  process.exitCode = undefined;
  delete process.env.LP_GB_TEMPLATE_VERSION;
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exitCode = undefined;
});

describe('main', () => {
  test('no manifest and no --list is a usage error', async () => {
    await expect(Traces.main([])).rejects.toThrow(/usage: gb-seed-traces\.js/);
  });

  test('dry run reads the manifest tv, uploads nothing and prints the summary', async () => {
    const out = await Traces.main([manifest()]);
    expect(out).toMatchObject({ lessons: 1, planned: 4, bad: 0, uploaded: 0 });
    expect(r2.uploadBuffer).not.toHaveBeenCalled();
    expect(logs.at(-1)).toBe('DRY RUN tv=gb_k5_v10: 1 lessons, 4 traces planned, '
      + 'found {"html":1,"lp.json":1,"card.json":1,"moves.json":1}, '
      + 'missing {"html":0,"lp.json":0,"card.json":0,"moves.json":0}, 0 bad, 0 uploaded');
    expect(process.exitCode).toBeUndefined();
  });

  test('--commit uploads every trace to R2 and logs each key', async () => {
    const out = await Traces.main([manifest(), '--commit']);
    expect(out.uploaded).toBe(4);
    expect(r2.uploadBuffer).toHaveBeenCalledWith(
      Buffer.from('{"lp":1}'), `gb-lp/gb_k5_v10/ur/${SEG}.lp.json`, 'application/json',
    );
    expect(logs).toContain(`ok gb-lp/gb_k5_v10/ur/${SEG}.html`);
    expect(logs.at(-1)).toMatch(/^COMMIT tv=gb_k5_v10: .* 4 uploaded$/);
  });

  test('--tv overrides the manifest, and its value is not read as the manifest path', async () => {
    const file = manifest();
    await Traces.main(['--tv', 'gb_k5_v11', file, '--commit']);
    expect(r2.uploadBuffer).toHaveBeenCalledWith(expect.any(Buffer), `gb-lp/gb_k5_v11/ur/${SEG}.html`, 'text/html');
  });

  test('a manifest with no tv falls back to the lane default', async () => {
    process.env.LP_GB_TEMPLATE_VERSION = 'gb_k5_v99';
    await Traces.main([manifest({ template_version: undefined })]);
    expect(logs.at(-1)).toMatch(/^DRY RUN tv=gb_k5_v99:/);
  });

  test('a bad file logs BAD with its problem, sets exit code 1 and uploads nothing', async () => {
    const out = await Traces.main([manifest({}, { 'card.json': write('bad.card.json', '{nope') }), '--commit']);
    expect(out).toMatchObject({ bad: 1, uploaded: 0 });
    expect(logs).toContain(`BAD ${SEG} card.json: not JSON (${path.join(dir, 'bad.card.json')})`);
    expect(r2.uploadBuffer).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test('a missing trace logs MISSING with segment, lang and type', async () => {
    await Traces.main([manifest({}, { 'moves.json': null })]);
    expect(logs).toContain(`MISSING ${SEG} ur moves.json`);
  });

  test('--list counts the keys under gb-lp/<tv>/ by type', async () => {
    r2.listKeys.mockResolvedValue([`gb-lp/gb_k5_v10/ur/${SEG}.pdf`, `gb-lp/gb_k5_v10/ur/${SEG}.html`]);
    const counts = await Traces.main(['--list', '--tv', 'gb_k5_v10']);
    expect(r2.listKeys).toHaveBeenCalledWith('gb-lp/gb_k5_v10/');
    expect(counts).toEqual({ pdf: 1, html: 1, 'lp.json': 0, 'card.json': 0, 'moves.json': 0 });
    expect(logs.at(-1)).toBe(`R2 gb-lp/gb_k5_v10/: ${JSON.stringify(counts)}`);
  });

  test('--list without --tv uses the lane default', async () => {
    process.env.LP_GB_TEMPLATE_VERSION = 'gb_k5_v99';
    r2.listKeys.mockResolvedValue([]);
    await Traces.main(['--list']);
    expect(r2.listKeys).toHaveBeenCalledWith('gb-lp/gb_k5_v99/');
  });
});

describe('plan and countKeys edges', () => {
  test('a bad row names the segment or the lang in its error', () => {
    expect(() => Traces.plan({ rows: [{ segment_id: 'x', lang: 'ur' }] }, 'gb_k5_v10'))
      .toThrow('not a GB grade 1-5 segment: x');
    expect(() => Traces.plan({ rows: [{ segment_id: SEG, lang: 'fr' }] }, 'gb_k5_v10'))
      .toThrow(`bad lang for ${SEG}: fr`);
  });
  test('a manifest with no rows plans nothing; a row with no files is all missing', () => {
    expect(Traces.plan({}, 'gb_k5_v10')).toEqual({ items: [], missing: [] });
    expect(Traces.plan({ rows: [{ segment_id: SEG, lang: 'en' }] }, 'gb_k5_v10').missing).toHaveLength(4);
  });
  test('keys that are not a pdf or a trace are not counted', () => {
    expect(Traces.countKeys(['gb-lp/gb_k5_v10/ur/x.png', 'gb-lp/gb_k5_v10/ur/x.json']))
      .toEqual({ pdf: 0, html: 0, 'lp.json': 0, 'card.json': 0, 'moves.json': 0 });
  });
  test('a bad file lists every problem joined by a comma', async () => {
    const log = jest.fn();
    await Traces.run({
      manifest: { rows: [{ segment_id: SEG, lang: 'ur', files: { html: '/x' } }] },
      tv: 'gb_k5_v10', commit: false, readFile: () => Buffer.from('%PDF'), log,
    });
    expect(log).toHaveBeenCalledWith(`BAD ${SEG} html: not HTML (/x)`);
  });
});
