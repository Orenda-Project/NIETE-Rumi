/**
 * bd-oak77.18 — find the cached lessons whose `.lp.json` sidecar is missing.
 *
 * The worker uploads the PDF, then the document that made it, and swallows a failure of the second
 * upload on purpose (the PDF is the product). So a `ready` row can point at a PDF with no document
 * beside it — 3 of 79 v9.1 PDFs were found that way. A missing sidecar costs a full re-authoring on
 * the next template bump (the reuse lane reads it) and leaves any diagnosis working from a raster.
 *
 * Detection only. Nothing can rebuild a lost sidecar deterministically: the ready row clears its
 * checkpoint, and the PDF cannot be parsed back into an lp_doc. The script must therefore never
 * write — no upload, no row patch.
 *
 * Two layers: (A) the pure pieces directly; (B) `main()` with supabase and R2 doubled at their
 * network boundaries and the real serving-service key helpers underneath.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../bot/shared/config/supabase', () => {
  const state = { rows: [], eqs: [], limits: [], writes: 0 };
  const builder = () => {
    const q = {
      select: () => q,
      eq: (col, val) => { state.eqs.push([col, val]); return q; },
      order: () => q,
      limit(n) {
        state.limits.push(n);
        return Promise.resolve({ data: state.rows.slice(0, n), error: null });
      },
      update: () => { state.writes += 1; return q; },
      insert: () => { state.writes += 1; return q; },
    };
    return q;
  };
  return { from: jest.fn(builder), rpc: jest.fn(), __state: state };
});
jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn(),
  uploadBuffer: jest.fn(),
  getPresignedUrl: jest.fn(),
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const r2 = require('../../bot/shared/storage/r2');
const Audit = require('../../bot/scripts/lp612-sidecar-audit');

const row = (segment_id, lang = 'en', tv = 'v9.1') => ({
  id: `r-${segment_id}-${lang}`, segment_id, lang, template_version: tv, status: 'ready',
  r2_key: `lp612/${tv}/${lang}/${segment_id}.pdf`,
});
const noSuchKey = () => Object.assign(new Error('The specified key does not exist.'), {
  name: 'NoSuchKey', $metadata: { httpStatusCode: 404 },
});

let dir;
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(supabase.__state, { rows: [], eqs: [], limits: [], writes: 0 });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-sidecar-audit-'));
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(() => { process.stdout.write.mockRestore(); });

// ── (A) the pure pieces ─────────────────────────────────────────────────────

describe('classifyProbeError', () => {
  test('an S3 NoSuchKey, or any 404, is a missing sidecar', () => {
    expect(Audit.classifyProbeError(noSuchKey())).toBe('missing');
    expect(Audit.classifyProbeError({ $metadata: { httpStatusCode: 404 } })).toBe('missing');
  });
  test('anything else is unreadable — a transport error has not proven the sidecar absent', () => {
    expect(Audit.classifyProbeError(new Error('socket hang up'))).toBe('unreadable');
    expect(Audit.classifyProbeError({ name: 'AccessDenied', $metadata: { httpStatusCode: 403 } })).toBe('unreadable');
  });
});

describe('parseArgs', () => {
  test('defaults, and the flags it knows', () => {
    expect(Audit.parseArgs([])).toMatchObject({ limit: 1000, out: Audit.DEFAULT_OUT });
    expect(Audit.parseArgs(['--template-version', 'v9.1', '--limit', '79', '--out', 'x.json']))
      .toMatchObject({ templateVersion: 'v9.1', limit: 79, out: 'x.json' });
  });
  test('an unknown flag is refused, not ignored — there is no --live or --backfill', () => {
    expect(() => Audit.parseArgs(['--backfill'])).toThrow(/unknown flag/);
    expect(() => Audit.parseArgs(['--limit', '0'])).toThrow(/positive integer/);
  });
});

describe('exitCodeFor', () => {
  test('clean is 0, a missing sidecar is 1, an unreadable probe is 2', () => {
    expect(Audit.exitCodeFor({ missing: [], unreadable: [] })).toBe(0);
    expect(Audit.exitCodeFor({ missing: [{}], unreadable: [] })).toBe(1);
    expect(Audit.exitCodeFor({ missing: [{}], unreadable: [{}] })).toBe(2);
  });
});

// ── (B) the real walk ───────────────────────────────────────────────────────

describe('main() walks ready renders and names each PDF without its document', () => {
  test('present, missing and unreadable are told apart; nothing is written anywhere', async () => {
    supabase.__state.rows = [row('seg.a'), row('seg.b', 'ur'), row('seg.c')];
    r2.downloadFromR2.mockImplementation(async (key) => {
      if (key === 'lp612/v9.1/en/seg.a.lp.json') return Buffer.from('{"sections":{}}');
      if (key === 'lp612/v9.1/ur/seg.b.lp.json') throw noSuchKey();
      throw new Error('socket hang up');
    });
    const out = path.join(dir, 'audit.json');

    const res = await Audit.main({ argv: ['--template-version', 'v9.1', '--out', out] });

    expect(supabase.__state.eqs).toEqual(expect.arrayContaining([['status', 'ready'], ['template_version', 'v9.1']]));
    const s = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(s).toMatchObject({ scanned: 3, present: 1 });
    expect(s.missing).toEqual([expect.objectContaining({
      renderId: 'r-seg.b-ur', segmentId: 'seg.b', lang: 'ur', templateVersion: 'v9.1',
      pdfKey: 'lp612/v9.1/ur/seg.b.pdf', docKey: 'lp612/v9.1/ur/seg.b.lp.json',
    })]);
    expect(s.unreadable).toEqual([expect.objectContaining({ segmentId: 'seg.c', error: 'socket hang up' })]);
    expect(res.exitCode).toBe(2);

    // detection only
    expect(r2.uploadBuffer).not.toHaveBeenCalled();
    expect(supabase.__state.writes).toBe(0);
  });

  test('a row whose PDF key is not the canonical cache key is skipped, not probed at a guessed key', async () => {
    supabase.__state.rows = [{ ...row('seg.a'), r2_key: 'lp612/v9.1/en/edits/seg.a/abc.pdf' }, row('seg.b')];
    r2.downloadFromR2.mockResolvedValue(Buffer.from('{"sections":{}}'));
    const out = path.join(dir, 'audit.json');

    const res = await Audit.main({ argv: ['--out', out] });

    const s = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(s).toMatchObject({ scanned: 2, present: 1, missing: [], unreadable: [] });
    expect(s.skipped).toEqual([expect.objectContaining({ segmentId: 'seg.a', reason: 'non_canonical_r2_key' })]);
    expect(r2.downloadFromR2).toHaveBeenCalledTimes(1);
    expect(res.exitCode).toBe(0);
  });
});
