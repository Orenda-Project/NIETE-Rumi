/**
 * A PDF module hosted on R2 must be PRESIGNED before the link is handed to
 * WhatsApp.
 *
 * THE REGRESSION THIS ENCODES: deliverPdfModule passed
 * `module.source_media_url` to sendDocumentByLink verbatim. That was fine while
 * the value was a PUBLIC third-party S3 URL — Meta fetches the link
 * server-side, and an open bucket answers. Once those PDFs moved onto our R2
 * bucket, which is private, the raw URL answers 400 to Meta and the document
 * silently never arrives: the teacher sees the caption ("Read the PDF again…")
 * and the CTA buttons, with no file between them.
 *
 * The video branch already presigns for exactly this reason. The PDF branch
 * did not, because it had never needed to.
 *
 * Note the asymmetry that makes this easy to miss: sendDocumentByLink returns
 * true — our API call to Meta succeeds. The failure happens later, when Meta
 * tries to fetch the link, so nothing in our logs looks wrong.
 */

const R2_HOST = 'https://acct.r2.cloudflarestorage.com';

let sendDocumentByLink;
let ContentDelivery;

beforeEach(() => {
  jest.resetModules();
  process.env.R2_ENDPOINT = R2_HOST;
  process.env.R2_BUCKET_NAME = 'test-bucket';

  sendDocumentByLink = jest.fn(async () => true);

  // CI runs the root suite BEFORE `bot/ npm ci`, so anything this test pulls
  // in transitively must be mocked VIRTUALLY — the real package may not be
  // installed. content-delivery.service requires bot/shared/config/supabase,
  // which requires @supabase/supabase-js at module load.
  jest.doMock('@supabase/supabase-js', () => ({
    createClient: () => ({ from: () => ({}) }),
  }), { virtual: true });

  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn(async () => true),
    sendDocumentByLink,
    sendInteractiveButtons: jest.fn(async () => true),
  }));

  // Presigner stub that mirrors the REAL contract (bot/shared/storage/r2.js):
  // only R2 URLs get signed, everything else passes through untouched. A mock
  // that signs indiscriminately would hide the pass-through behaviour the
  // legacy public-bucket assets depend on.
  const isR2 = (u) => String(u).includes('r2.cloudflarestorage.com');
  jest.doMock('../../bot/shared/storage/r2', () => ({
    getPresignedUrl: jest.fn(async (url) =>
      isR2(url) ? `${url}?X-Amz-Signature=deadbeef` : url
    ),
    isPermanentR2Url: isR2,
    buildR2PublicUrl: (k) => `${R2_HOST}/test-bucket/${k}`,
  }));

  ContentDelivery = require('../../bot/shared/services/training/content-delivery.service');
});

describe('PDF modules on R2 are presigned before delivery', () => {
  test('an R2-hosted PDF is signed, not sent raw', async () => {
    const module = {
      id: 134,
      title: 'Project Based Learning (Reading Resource)',
      video_url: null,
      source_media_url: `${R2_HOST}/test-bucket/training/TALEEMABAD/134/x.pdf`,
    };

    await ContentDelivery.deliverPdfModule('92300000000', module, { userId: 'u1' });

    expect(sendDocumentByLink).toHaveBeenCalledTimes(1);
    const [, url] = sendDocumentByLink.mock.calls[0];
    // Meta fetches this URL server-side; a private R2 object answers 400
    // unless the request carries a signature.
    expect(url).toContain('X-Amz-Signature');
  });

  test('a public non-R2 PDF is still sent as-is', async () => {
    // Legacy assets on the open third-party bucket need no signature, and
    // signing a URL we do not own would be meaningless.
    const module = {
      id: 240,
      title: 'Student AI Toolcheck',
      video_url: null,
      source_media_url: 'https://asset-manager-approved.s3.ap-south-1.amazonaws.com/abc.pdf',
    };

    await ContentDelivery.deliverPdfModule('92300000000', module, { userId: 'u1' });

    const [, url] = sendDocumentByLink.mock.calls[0];
    expect(url).toBe(module.source_media_url);
    expect(url).not.toContain('X-Amz-Signature');
  });
});
