/**
 * bd-c2iiq3 — the v8 uploader must never make an empty or non-PDF file a teacher's lesson.
 *
 * On 17 Aug a 0-byte render of grade_5_urdu_ch1_seg2 went up as the current asset
 * (source_sha1 da39a3ee… = sha1 of nothing) and was sent 114 times to 82 teachers.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/storage/r2', () => ({ uploadBuffer: jest.fn().mockResolvedValue(true) }));

const supabase = require('../../shared/config/supabase');
const r2 = require('../../shared/storage/r2');
const { pdfProblem } = require('../../scripts/lp-v8-pdf-guard');
const uploader = require('../../scripts/upload-lp-v8-to-r2');

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2000, 0x20), Buffer.from('\n%%EOF\n')]);

describe('pdfProblem', () => {
  test('a real-looking PDF passes', () => {
    expect(pdfProblem(PDF)).toBeNull();
  });

  test('a PDF with leading whitespace before the header still passes', () => {
    expect(pdfProblem(Buffer.concat([Buffer.from('\n'), PDF]))).toBeNull();
  });

  test.each([
    ['empty buffer', Buffer.alloc(0), /empty/],
    ['missing buffer', undefined, /empty/],
    ['not a PDF', Buffer.from('<html>error</html>'.padEnd(2000, ' ')), /not a PDF/],
    ['header only, far too small', Buffer.from('%PDF-1.7\n%%EOF'), /too small/],
  ])('%s is refused', (_label, buf, why) => {
    expect(pdfProblem(buf)).toMatch(why);
  });

  test('after compression only empty / non-PDF is refused, not small', () => {
    expect(pdfProblem(Buffer.from('%PDF-1.7\n%%EOF'), { minBytes: 1 })).toBeNull();
    expect(pdfProblem(Buffer.alloc(0), { minBytes: 1 })).toMatch(/empty/);
  });
});

describe('persistAssetRow refuses a bad buffer before touching R2 or the table', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  const call = (buffer) => uploader.persistAssetRow({
    item: { lesson_id: 'grade_5_urdu_ch1_seg2', version_stamp: 'v8', asset_kind: 'lesson' },
    plan: { action: 'first', upload: true, supersede: ['old-row'], r2_key: 'lp-cache/v8/grade_5_urdu_ch1_seg2/da39a3ee5e6b.pdf' },
    hash: 'da39a3ee5e6b',
    buffer,
    sourceBytes: 0,
    pdfPath: '/nowhere.pdf',
    commit: true,
    deps: {},
  });

  test('a 0-byte buffer throws, uploads nothing and supersedes nothing', async () => {
    await expect(call(Buffer.alloc(0))).rejects.toThrow(/grade_5_urdu_ch1_seg2.*empty/);
    expect(r2.uploadBuffer).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test('a non-PDF buffer throws the same way', async () => {
    await expect(call(Buffer.from('x'.repeat(5000)))).rejects.toThrow(/not a PDF/);
    expect(r2.uploadBuffer).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
