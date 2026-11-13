'use strict';
/**
 * bd-rj6w0n.14.16.18 — store each seeded GB lesson's traces beside its PDF: gb-lp/<tv>/<lang>/<seg>.{lp.json,
 * card.json,moves.json,html}. R2 only — never a DB row, never an lp612/ key; dry run unless --commit.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => { throw new Error('traces write no DB rows'); } }));

const Traces = require('../../bot/scripts/gb-seed-traces');

const FILES = {
  '/t/a.html': Buffer.from('<!DOCTYPE html><html><body>v9</body></html>'),
  '/t/a.lp.json': Buffer.from('{"lp":1}'),
  '/t/a.card.json': Buffer.from('{"card":1}'),
  '/t/a.moves.json': Buffer.from('{"moves":1}'),
};
const readFile = (p) => { if (!FILES[p]) throw new Error(`ENOENT ${p}`); return FILES[p]; };
const row = (over = {}, files = {}) => ({
  lesson: 'g2_ch7/Urdu_seg5', segment_id: 'nbf_snc_grade_2_urdu.c07.s005', lang: 'ur',
  files: {
    html: '/t/a.html', 'lp.json': '/t/a.lp.json', 'card.json': '/t/a.card.json', 'moves.json': '/t/a.moves.json', ...files,
  },
  ...over,
});
const TV = 'gb_k5_v10';
const BASE = 'gb-lp/gb_k5_v10/ur/nbf_snc_grade_2_urdu.c07.s005';

describe('plan', () => {
  test('one key per trace via keyFor, beside the PDF', () => {
    const { items } = Traces.plan({ rows: [row()] }, TV);
    expect(items.map((i) => i.key).sort()).toEqual(
      [`${BASE}.card.json`, `${BASE}.html`, `${BASE}.lp.json`, `${BASE}.moves.json`],
    );
  });
  test('content types: JSON traces application/json, the v9 page text/html', () => {
    const { items } = Traces.plan({ rows: [row()] }, TV);
    const type = Object.fromEntries(items.map((i) => [i.ext, i.contentType]));
    expect(type).toEqual({
      html: 'text/html', 'lp.json': 'application/json', 'card.json': 'application/json', 'moves.json': 'application/json',
    });
  });
  test('a trace with no file is reported missing, not planned', () => {
    const { items, missing } = Traces.plan({ rows: [row({}, { 'moves.json': null })] }, TV);
    expect(items).toHaveLength(3);
    expect(missing).toEqual([{ segmentId: 'nbf_snc_grade_2_urdu.c07.s005', lang: 'ur', ext: 'moves.json' }]);
  });
  test.each([
    [{ lang: 'fr' }], [{ segment_id: '../lp612/x' }], [{ segment_id: 'grade_7_english.c01.s001' }],
  ])('a bad row %j is refused', (over) => {
    expect(() => Traces.plan({ rows: [row(over)] }, TV)).toThrow();
  });
  test('every key passes assertGbKey: a tv that escapes gb-lp/ is refused', () => {
    expect(() => Traces.plan({ rows: [row()] }, '../lp612')).toThrow(/gb-lp/);
  });
});

describe('verify', () => {
  const item = (ext, path) => ({ ext, path });
  test('readable JSON and HTML pass', () => {
    expect(Traces.verify(item('lp.json', '/t/a.lp.json'), readFile)).toEqual([]);
    expect(Traces.verify(item('html', '/t/a.html'), readFile)).toEqual([]);
  });
  test('unreadable, empty, broken JSON or non-HTML is reported', () => {
    expect(Traces.verify(item('lp.json', '/t/gone'), readFile)[0]).toMatch(/unreadable/);
    expect(Traces.verify(item('card.json', '/x'), () => Buffer.alloc(0))).toEqual(['empty']);
    expect(Traces.verify(item('moves.json', '/x'), () => Buffer.from('{nope'))).toEqual(['not JSON']);
    expect(Traces.verify(item('html', '/x'), () => Buffer.from('%PDF-1.4'))).toEqual(['not HTML']);
  });
});

describe('run', () => {
  test('dry run counts per type and uploads nothing', async () => {
    const upload = jest.fn();
    const out = await Traces.run({
      manifest: { rows: [row(), row({ segment_id: 'nbf_snc_grade_2_urdu.c07.s006' }, { 'card.json': null })] },
      tv: TV, commit: false, readFile, upload,
    });
    expect(out).toMatchObject({
      lessons: 2, planned: 7, bad: 0, uploaded: 0,
      found: { html: 2, 'lp.json': 2, 'card.json': 1, 'moves.json': 2 },
      missing: { html: 0, 'lp.json': 0, 'card.json': 1, 'moves.json': 0 },
    });
    expect(upload).not.toHaveBeenCalled();
  });
  test('commit uploads each trace under gb-lp/ with its type', async () => {
    const upload = jest.fn().mockResolvedValue('url');
    const out = await Traces.run({ manifest: { rows: [row()] }, tv: TV, commit: true, readFile, upload });
    expect(out.uploaded).toBe(4);
    expect(upload).toHaveBeenCalledWith(FILES['/t/a.html'], `${BASE}.html`, 'text/html');
    expect(upload).toHaveBeenCalledWith(FILES['/t/a.card.json'], `${BASE}.card.json`, 'application/json');
    upload.mock.calls.forEach(([, key]) => expect(key.startsWith('gb-lp/')).toBe(true));
  });
  test('re-running writes the same keys with the same bytes (idempotent)', async () => {
    const a = jest.fn().mockResolvedValue('url');
    const b = jest.fn().mockResolvedValue('url');
    await Traces.run({ manifest: { rows: [row()] }, tv: TV, commit: true, readFile, upload: a });
    await Traces.run({ manifest: { rows: [row()] }, tv: TV, commit: true, readFile, upload: b });
    expect(b.mock.calls).toEqual(a.mock.calls);
  });
  test('any bad trace stops the commit before a single upload', async () => {
    const upload = jest.fn();
    const out = await Traces.run({
      manifest: { rows: [row(), row({ segment_id: 'nbf_snc_grade_2_urdu.c07.s006' }, { 'lp.json': '/t/gone' })] },
      tv: TV, commit: true, readFile, upload,
    });
    expect(out).toMatchObject({ bad: 1, uploaded: 0 });
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('countKeys', () => {
  test('counts listed gb-lp/<tv>/ keys per trace type, PDFs too', () => {
    expect(Traces.countKeys([`${BASE}.pdf`, `${BASE}.html`, `${BASE}.lp.json`, `${BASE}.card.json`, `${BASE}.moves.json`,
      'gb-lp/gb_k5_v10/en/nbf_snc_grade_1_english.c01.s001.html']))
      .toEqual({ pdf: 1, html: 2, 'lp.json': 1, 'card.json': 1, 'moves.json': 1 });
  });
});
