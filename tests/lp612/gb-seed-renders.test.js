'use strict';
/**
 * bd-rj6w0n.14.16.11 — seed the built GB v9 plans into GB's own lane: each PDF to gb-lp/<tv>/<lang>/<seg>.pdf,
 * its niete_gb_lp_renders row ready. Never an lp612/ key or row; dry run unless --commit.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => { throw new Error('use the injected db'); } }));

const crypto = require('crypto');
const Seed = require('../../bot/scripts/gb-seed-renders');

const PDF = Buffer.from('%PDF-1.4 hello');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const row = (over = {}) => ({
  lesson: 'g2_ch7/Urdu_seg5', segment_id: 'nbf_snc_grade_2_urdu.c07.s005', lang: 'ur',
  pdf: '/x/a.pdf', bytes: PDF.length, sha256: sha(PDF), ...over,
});
const readFile = () => PDF;

function fakeDb() {
  const calls = [];
  return {
    calls,
    from: (table) => ({
      upsert: (payload, opts) => { calls.push({ table, payload, opts }); return Promise.resolve({ error: null }); },
    }),
  };
}

describe('plan', () => {
  test('keys are gb-lp/<tv>/<lang>/<segment>.pdf', () => {
    const [p] = Seed.plan({ rows: [row()] }, 'gb_k5_v9');
    expect(p.key).toBe('gb-lp/gb_k5_v9/ur/nbf_snc_grade_2_urdu.c07.s005.pdf');
  });
  test.each([
    [{ lang: 'fr' }], [{ segment_id: '../lp612/x' }], [{ segment_id: 'grade_7_english.c01.s001' }],
  ])('a bad row %j is refused', (over) => {
    expect(() => Seed.plan({ rows: [row(over)] }, 'gb_k5_v9')).toThrow();
  });
});

describe('verify', () => {
  test('a PDF whose bytes match passes', () => {
    expect(Seed.verify(row(), readFile)).toEqual([]);
  });
  test('a changed or non-PDF file is reported', () => {
    expect(Seed.verify(row({ sha256: 'f'.repeat(64) }), readFile)).toEqual(['sha256 differs']);
    expect(Seed.verify(row({ bytes: 3, sha256: sha(Buffer.from('abc')) }), () => Buffer.from('abc'))).toEqual(['not a PDF']);
  });
});

describe('run', () => {
  test('dry run uploads and writes nothing', async () => {
    const upload = jest.fn();
    const db = fakeDb();
    const out = await Seed.run({ manifest: { rows: [row()] }, tv: 'gb_k5_v9', commit: false, readFile, upload, db });
    expect(out).toMatchObject({ planned: 1, bad: 0, written: 0 });
    expect(upload).not.toHaveBeenCalled();
    expect(db.calls).toHaveLength(0);
  });
  test('commit uploads under gb-lp/ and marks the GB row ready, never an lp612 table', async () => {
    const upload = jest.fn().mockResolvedValue('url');
    const db = fakeDb();
    const out = await Seed.run({ manifest: { rows: [row()] }, tv: 'gb_k5_v9', commit: true, readFile, upload, db });
    expect(out.written).toBe(1);
    expect(upload).toHaveBeenCalledWith(PDF, 'gb-lp/gb_k5_v9/ur/nbf_snc_grade_2_urdu.c07.s005.pdf', 'application/pdf');
    expect(db.calls[0].table).toBe('niete_gb_lp_renders');
    expect(db.calls[0].opts).toEqual({ onConflict: 'segment_id,lang,template_version' });
    expect(db.calls[0].payload).toMatchObject({
      segment_id: 'nbf_snc_grade_2_urdu.c07.s005', lang: 'ur', template_version: 'gb_k5_v9', status: 'ready',
      r2_key: 'gb-lp/gb_k5_v9/ur/nbf_snc_grade_2_urdu.c07.s005.pdf', waiters: [],
    });
  });
  test('any bad file stops the commit before a single upload', async () => {
    const upload = jest.fn();
    const out = await Seed.run({
      manifest: { rows: [row(), row({ sha256: 'f'.repeat(64) })] }, tv: 'gb_k5_v9', commit: true, readFile, upload, db: fakeDb(),
    });
    expect(out).toMatchObject({ bad: 1, written: 0 });
    expect(upload).not.toHaveBeenCalled();
  });
});
