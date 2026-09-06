/**
 * bd-2676 — a certificate must be VIEWABLE, not only savable.
 *
 * REPORTED (ICT priority sheet, row 9, Medium: App, all vendors):
 *   "certificates are now viewable but user is redirected to browser first and
 *    the certificate is downloading in the background. Expected Behavior: The
 *    certificates should be accessible directly."
 *
 * Two independent causes, and fixing either alone leaves the report standing:
 *
 *   1. THIS FILE — the presigned URL signs `Content-Disposition: attachment`,
 *      so whatever opens it saves the file instead of rendering it. The bot's
 *      presigner supported `attachment` and NOTHING ELSE: buildPresignOverrides
 *      returned {} for any other disposition, so there was no way to ask for a
 *      viewable URL even though the dashboard's presigner has defaulted to
 *      `inline` all along. Certificates were the one artefact on the wrong side
 *      of that split, which is exactly why they were the one artefact that
 *      downloaded.
 *
 *   2. The portal anchor's target="_blank" ejects the Capacitor WebView to
 *      external Chrome before disposition even matters — pinned separately in
 *      tests/portal/bd-2676-certificate-view-and-download.test.js.
 *
 * WHAT IS DELIBERATELY *NOT* CHANGED: attachment mode itself. The teacher gets
 * BOTH affordances — View (inline) and Download (attachment) — so the existing
 * attachment path stays live and stays tested (r2-presign-attachment.test.js).
 * This is additive; the old behaviour is now one of two choices rather than the
 * only one.
 *
 * WHY `inline` MUST ALSO ASSERT A CONTENT-TYPE: `Content-Disposition: inline`
 * with `application/octet-stream` downloads anyway — the browser has nothing to
 * render. Asserting inline without the type would look correct and fix nothing.
 * The dashboard presigner already carries that lesson in a comment; this is the
 * same rule, enforced.
 */

const R2_HOST = 'https://acct.r2.cloudflarestorage.com';
const BUCKET = 'test-bucket';

let commandInputs;
let r2;

beforeEach(() => {
  jest.resetModules();
  commandInputs = [];

  process.env.R2_ENDPOINT = R2_HOST;
  process.env.R2_BUCKET_NAME = BUCKET;
  process.env.R2_ACCESS_KEY_ID = 'test-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';

  jest.doMock('@aws-sdk/client-s3', () => ({
    S3Client: jest.fn(function S3Client() {}),
    PutObjectCommand: jest.fn(function PutObjectCommand(i) { this.input = i; }),
    DeleteObjectCommand: jest.fn(function DeleteObjectCommand(i) { this.input = i; }),
    GetObjectCommand: jest.fn(function GetObjectCommand(input) {
      commandInputs.push(input);
      this.input = input;
    }),
  }), { virtual: true });

  jest.doMock('@aws-sdk/s3-request-presigner', () => ({
    // Serialises the command input into the query string like a real presigner,
    // so a test can prove the overrides are INSIDE the signed URL rather than
    // concatenated after signing (which R2 answers with 403).
    getSignedUrl: jest.fn(async (_client, command, opts) => {
      const input = command.input || {};
      const qs = new URLSearchParams({
        'X-Amz-Expires': String((opts && opts.expiresIn) || 0),
        'X-Amz-Signature': 'deadbeef',
      });
      if (input.ResponseContentDisposition) qs.set('response-content-disposition', input.ResponseContentDisposition);
      if (input.ResponseContentType) qs.set('response-content-type', input.ResponseContentType);
      return `${R2_HOST}/${BUCKET}/${input.Key}?${qs.toString()}`;
    }),
  }), { virtual: true });

  r2 = require('../../bot/shared/storage/r2');
});

const URL_FOR = (key) => `${R2_HOST}/${BUCKET}/${key}`;
const KEY = 'certs/user-abc/PFX-20260802-A1B2C3.pdf';

describe('bd-2676 — the bot presigner can sign an INLINE (viewable) url', () => {
  it('signs Content-Disposition: inline for a pdf', async () => {
    const url = await r2.getPresignedUrl(URL_FOR(KEY), 3600, { disposition: 'inline' });

    expect(commandInputs[0].ResponseContentDisposition).toBe('inline');

    // and it is IN the signed url, not bolted on after signing
    expect(url).toContain('response-content-disposition=inline');
    expect(url).toContain('X-Amz-Signature');
  });

  it('asserts application/pdf alongside inline — inline+octet-stream downloads anyway', async () => {
    await r2.getPresignedUrl(URL_FOR(KEY), 3600, { disposition: 'inline' });
    expect(commandInputs[0].ResponseContentType).toBe('application/pdf');
  });

  it('never puts a filename= in an inline disposition', async () => {
    // filename belongs to attachment. Carrying one on inline is meaningless at
    // best, and some browsers read it as a save hint — the very behaviour the
    // teacher reported.
    await r2.getPresignedUrl(URL_FOR(KEY), 3600, {
      disposition: 'inline', filename: 'PFX-20260802-A1B2C3.pdf',
    });
    expect(commandInputs[0].ResponseContentDisposition).toBe('inline');
    expect(commandInputs[0].ResponseContentDisposition).not.toContain('filename');
  });

  it('overrides NOTHING for an extension it cannot type', async () => {
    // Deliberately stricter than attachment mode. `inline` + an unknown type
    // downloads anyway, so emitting a lone inline header would look like a fix
    // and change nothing observable. Better to leave the object's own stored
    // metadata in charge and keep the failure honest.
    await r2.getPresignedUrl(URL_FOR('certs/u/thing.weird'), 3600, { disposition: 'inline' });
    expect(commandInputs[0]).toEqual({ Bucket: BUCKET, Key: 'certs/u/thing.weird' });
  });

  it('leaves attachment mode exactly as it was', async () => {
    // The regression that would undo the Download button.
    await r2.getPresignedUrl(URL_FOR(KEY), 3600, {
      disposition: 'attachment', filename: 'PFX-20260802-A1B2C3.pdf',
    });
    expect(commandInputs[0].ResponseContentDisposition)
      .toBe('attachment; filename="PFX-20260802-A1B2C3.pdf"');
    expect(commandInputs[0].ResponseContentType).toBe('application/pdf');
  });

  it('still signs a bare { Bucket, Key } for callers that pass no options', async () => {
    await r2.getPresignedUrl(URL_FOR(KEY), 3600);
    expect(commandInputs[0]).toEqual({ Bucket: BUCKET, Key: KEY });
  });

  it('ignores an unknown disposition rather than inventing a header', async () => {
    await r2.getPresignedUrl(URL_FOR(KEY), 3600, { disposition: 'sideways' });
    expect(commandInputs[0]).toEqual({ Bucket: BUCKET, Key: KEY });
  });
});

describe('bd-2676 — fetchOrMintCertificatePdf honours the requested disposition', () => {
  const USER = 'user-abc';
  const CODE = 'PFX-20260802-A1B2C3';
  let presignCalls;
  let svc;

  beforeEach(() => {
    jest.resetModules();
    presignCalls = [];

    // NOT virtual: r2.js is a real module, and { virtual: true } would leave the
    // real one in place — the mock silently would not apply and presignCalls
    // would stay empty.
    jest.doMock('../../bot/shared/storage/r2', () => ({
      buildR2PublicUrl: (key) => `${R2_HOST}/${BUCKET}/${key}`,
      getPresignedUrl: async (url, expiresIn, options) => {
        presignCalls.push({ url, expiresIn, options });
        return `${url}?X-Amz-Signature=deadbeef`;
      },
      uploadBuffer: async () => true,
    }));

    svc = require('../../bot/shared/services/training/certificate-pdf.service');
  });

  /** A certificate row that already has a rendered PDF, so nothing mints. */
  function supabaseWithStoredPdf() {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'row-1',
                  user_id: USER,
                  level_id: 'level-1',
                  certificate_code: CODE,
                  teacher_name_snapshot: 'Test Teacher',
                  level_name_snapshot: 'Primary Level 1',
                  issued_at: '2026-08-02T00:00:00Z',
                  pdf_r2_key: `certs/${USER}/${CODE}.pdf`,
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    };
  }

  it('defaults to attachment when no disposition is asked for', async () => {
    // Every pre-existing caller (WhatsApp `/certificate`, the Flow) relies on
    // this default. Changing it would silently alter WhatsApp delivery.
    await svc.fetchOrMintCertificatePdf(supabaseWithStoredPdf(), {
      userId: USER, certificateCode: CODE,
    });
    expect(presignCalls[0].options).toEqual({
      disposition: 'attachment', filename: `${CODE}.pdf`,
    });
  });

  it('presigns inline, with no filename, when disposition: inline is asked for', async () => {
    const out = await svc.fetchOrMintCertificatePdf(supabaseWithStoredPdf(), {
      userId: USER, certificateCode: CODE, disposition: 'inline',
    });
    expect(presignCalls[0].options).toEqual({ disposition: 'inline' });
    expect(out.download_url).toContain('X-Amz-Signature');
  });

  it('rejects a disposition it does not know instead of passing it through', async () => {
    // Fail closed. An unrecognised value reaching the presigner yields {} and a
    // URL whose behaviour comes from stored metadata — unpredictable, and it
    // would read as "the fix did not work" with nothing in the logs.
    await expect(svc.fetchOrMintCertificatePdf(supabaseWithStoredPdf(), {
      userId: USER, certificateCode: CODE, disposition: 'sideways',
    })).rejects.toMatchObject({ code: 'bad_request' });
  });
});
