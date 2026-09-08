/**
 * Children lost every audio clip in a curriculum video quiz for over a week —
 * narration, explanation and answer — while every import-level check passed.
 *
 * The clips live in a SEPARATE R2 bucket published on Cloudflare's public
 * `pub-<hash>.r2.dev` alias. Our client is bound to `digital-coach-audio`, so
 * extractKeyFromUrl saw an http(s) URL with no `/bucket/` marker, threw, and the
 * caller turned that throw into a `false`. Measured on production: ~780 failures
 * a day and ZERO successful audio sends.
 *
 * Two things were checked before writing this, because the obvious fix is the
 * wrong one:
 *   - the object is public and healthy: HEAD returns 200, audio/ogg, 12,586 bytes;
 *   - `head-object` for that key in OUR bucket returns 404. So teaching the
 *     extractor that "the r2.dev path is the key" would only swap a throw for a
 *     NoSuchKey. It genuinely is a different bucket we cannot read.
 *
 * So: try the bucket first, and fall back to fetching the public URL over HTTP.
 * The fallback can only fire where the code previously threw, which is what
 * keeps this safe for the seven other callers that share the helper.
 */
const ORIG_BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = 'https://pub-0edccec5d5bd419782ba389c59faecac.r2.dev/'
  + 'quiz-audio-opus/Grade5ScienceMicroorganismsQuestion1QuestionAudio.ogg';

describe('downloadMedia — the bucket first, then the public web', () => {
  let r2, realFetch;

  beforeAll(() => { process.env.R2_BUCKET_NAME = 'digital-coach-audio'; });
  afterAll(() => { process.env.R2_BUCKET_NAME = ORIG_BUCKET; });
  beforeEach(() => {
    jest.resetModules();
    realFetch = globalThis.fetch;
    r2 = require('../../bot/shared/storage/r2');
  });
  afterEach(() => { globalThis.fetch = realFetch; jest.restoreAllMocks(); });

  test('a URL that resolves into our own bucket is downloaded from R2, not the web', async () => {
    const fromR2 = jest.spyOn(r2, 'downloadFromR2').mockResolvedValue(Buffer.from('from-bucket'));
    globalThis.fetch = jest.fn();
    const buf = await r2.downloadMedia(
      'https://acct.r2.cloudflarestorage.com/digital-coach-audio/transcript_quizzes/a/card1.png');
    expect(buf.toString()).toBe('from-bucket');
    expect(fromR2).toHaveBeenCalledWith('transcript_quizzes/a/card1.png');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('a bare key still goes to the bucket', async () => {
    jest.spyOn(r2, 'downloadFromR2').mockResolvedValue(Buffer.from('bare'));
    globalThis.fetch = jest.fn();
    expect((await r2.downloadMedia('feature_videos/quiz_intro_v3_ur.mp4')).toString()).toBe('bare');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('the public r2.dev clip that used to throw is now fetched over HTTP', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      arrayBuffer: async () => new TextEncoder().encode('OggS-audio-bytes').buffer,
    });
    const buf = await r2.downloadMedia(PUBLIC_URL);
    expect(buf.toString()).toBe('OggS-audio-bytes');
    expect(globalThis.fetch).toHaveBeenCalledWith(PUBLIC_URL, expect.anything());
  });

  test('a public URL that 404s fails loudly, naming the URL', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(r2.downloadMedia(PUBLIC_URL)).rejects.toThrow(/404/);
  });

  test('the bucket is preferred even when the key also exists publicly', async () => {
    const fromR2 = jest.spyOn(r2, 'downloadFromR2').mockResolvedValue(Buffer.from('bucket-wins'));
    globalThis.fetch = jest.fn();
    await r2.downloadMedia('quiz-audio-opus/x.ogg');
    expect(fromR2).toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('a bucket miss on a public URL still falls back rather than giving up', async () => {
    // The real shape of this bug: our client CAN parse nothing useful, but even
    // if a key were derived it would 404 in our bucket. Either way the child
    // should get their audio.
    jest.spyOn(r2, 'downloadFromR2').mockRejectedValue(new Error('NoSuchKey'));
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      arrayBuffer: async () => new TextEncoder().encode('recovered').buffer,
    });
    expect((await r2.downloadMedia(PUBLIC_URL)).toString()).toBe('recovered');
  });

  test('a non-URL, non-key input is refused rather than fetched', async () => {
    globalThis.fetch = jest.fn();
    jest.spyOn(r2, 'downloadFromR2').mockRejectedValue(new Error('NoSuchKey'));
    await expect(r2.downloadMedia('')).rejects.toThrow();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
