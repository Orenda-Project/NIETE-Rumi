/**
 * Fetch-or-mint — the ONE implementation of "give me this certificate's PDF".
 *
 * All 12,954 certificates in production have `pdf_r2_key` null (12,952 of them
 * from the July migration import). Bulk-rendering them is wasteful and mostly
 * pointless — the overwhelming majority will never be asked for. So the PDF is
 * minted the first time someone actually requests it, and served from R2 every
 * time after.
 *
 * The key is deterministic (`certs/{user_id}/{cert_code}.pdf`), so even a
 * genuine double-mint from two concurrent requests overwrites the same object
 * rather than orphaning one — there is no cleanup path to get wrong.
 *
 * OWNERSHIP IS CHECKED HERE, NOT ONLY AT THE EDGE. The lookup filters on
 * user_id AND certificate_code together. The caller (the internal HTTP route,
 * the chat command) has already established identity, but a lookup by bare
 * code would mean any leaked certificate code is a working download link for
 * anyone. Two filters, one query, no such hole.
 */

const { EventEmitter } = require('events');

let svc;
let uploads;
let updates;
let presignCalls;
let renderShouldThrow;
let uploadShouldThrow;

function makePdfkitMock() {
  return function PDFDocument() {
    const doc = new EventEmitter();
    const chain = () => doc;
    doc.page = { width: 842, height: 595, margins: { top: 50, bottom: 50, left: 50, right: 50 } };
    doc.registerFont = chain; doc.font = chain; doc.fontSize = chain;
    doc.fillColor = chain; doc.strokeColor = chain; doc.lineWidth = chain;
    doc.rect = chain; doc.roundedRect = chain; doc.moveTo = chain; doc.lineTo = chain;
    doc.fill = chain; doc.stroke = chain; doc.fillAndStroke = chain;
    // bd-60140 — the non-production watermark transforms the canvas.
    doc.save = chain; doc.restore = chain;
    doc.rotate = chain; doc.translate = chain; doc.scale = chain;
    doc.opacity = chain; doc.clip = chain;
    doc.image = chain; doc.widthOfString = () => 100; doc.heightOfString = () => 12;
    doc.text = () => { if (renderShouldThrow) throw new Error('boom: renderer exploded'); return doc; };
    doc.end = () => setImmediate(() => { doc.emit('data', Buffer.from('%PDF-1.3')); doc.emit('end'); });
    return doc;
  };
}

/**
 * Supabase stand-in that models the ONE thing these tests turn on: the
 * certificate row is found only when BOTH user_id and certificate_code match,
 * and an UPDATE to pdf_r2_key is visible to the next read (so a second
 * fetch-or-mint sees the key the first one wrote).
 */
function makeSupabase(rows) {
  const state = { rows: rows.map((r) => ({ ...r })) };
  return {
    _rows: state.rows,
    from: jest.fn((table) => {
      const filters = {};
      const chain = {};
      const match = () => state.rows.filter((r) =>
        Object.entries(filters).every(([k, v]) => r[k] === v));
      chain.select = jest.fn(() => chain);
      chain.eq = jest.fn((c, v) => { filters[c] = v; return chain; });
      chain.order = jest.fn(() => chain);
      chain.maybeSingle = jest.fn(async () => ({ data: match()[0] || null, error: null }));
      chain.single = jest.fn(async () => ({ data: match()[0] || null, error: null }));
      chain.update = jest.fn((payload) => {
        const u = {
          eq: jest.fn((c, v) => { filters[c] = v; return u; }),
          then: (res, rej) => {
            updates.push({ table, payload, filters: { ...filters } });
            for (const r of match()) Object.assign(r, payload);
            return Promise.resolve({ data: null, error: null }).then(res, rej);
          },
        };
        return u;
      });
      chain.then = (res, rej) => Promise.resolve({ data: match(), error: null }).then(res, rej);
      return chain;
    }),
  };
}

const USER = 'user-abc';
const CODE = 'PFX-20260802-A1B2C3';
const KEY = `certs/${USER}/${CODE}.pdf`;

const ROW = {
  id: 'cert-1', user_id: USER, level_id: 3,
  certificate_code: CODE,
  teacher_name_snapshot: 'Amina Khan',
  level_name_snapshot: 'Aspiring Teacher',
  issued_at: '2026-08-02T10:00:00Z',
  pdf_r2_key: null,
};

const OTHER_ROW = {
  id: 'cert-2', user_id: 'someone-else', level_id: 3,
  certificate_code: 'PFX-20260801-OTHER1',
  teacher_name_snapshot: 'Someone Else',
  level_name_snapshot: 'Aspiring Teacher',
  issued_at: '2026-08-01T10:00:00Z',
  pdf_r2_key: 'certs/someone-else/PFX-20260801-OTHER1.pdf',
};

beforeEach(() => {
  jest.resetModules();
  uploads = []; updates = []; presignCalls = [];
  renderShouldThrow = false; uploadShouldThrow = false;

  process.env.R2_BUCKET_NAME = 'test-bucket';
  process.env.R2_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';

  jest.doMock('pdfkit', makePdfkitMock, { virtual: true });
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/storage/r2', () => ({
    uploadBuffer: jest.fn(async (buffer, key, contentType) => {
      if (uploadShouldThrow) throw new Error('boom: R2 rejected the upload');
      uploads.push({ buffer, key, contentType });
      return `https://acct.r2.cloudflarestorage.com/test-bucket/${key}`;
    }),
    buildR2PublicUrl: (key) => `https://acct.r2.cloudflarestorage.com/test-bucket/${key}`,
    getPresignedUrl: jest.fn(async (url, expiresIn, options) => {
      presignCalls.push({ url, expiresIn, options });
      return `${url}?X-Amz-Signature=deadbeef`;
    }),
  }));

  svc = require('../../bot/shared/services/training/certificate-pdf.service');
});

describe('listCertificates', () => {
  it('returns the user\'s certificates with has_pdf, and never mints', async () => {
    const supabase = makeSupabase([ROW, { ...OTHER_ROW }]);
    const list = await svc.listCertificates(supabase, USER);

    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(expect.objectContaining({
      certificate_code: CODE,
      level_name: 'Aspiring Teacher',
      teacher_name: 'Amina Khan',
      issued_at: '2026-08-02T10:00:00Z',
      has_pdf: false,
    }));
    // The whole point of listing separately from minting.
    expect(uploads).toHaveLength(0);
    expect(presignCalls).toHaveLength(0);
  });

  it('reports has_pdf true for an already-minted certificate', async () => {
    const supabase = makeSupabase([{ ...ROW, pdf_r2_key: KEY }]);
    const [c] = await svc.listCertificates(supabase, USER);
    expect(c.has_pdf).toBe(true);
  });

  it('returns [] for a user with none', async () => {
    expect(await svc.listCertificates(makeSupabase([OTHER_ROW]), USER)).toEqual([]);
  });
});

describe('fetchOrMintCertificatePdf — MINT path (key is null)', () => {
  it('renders, uploads as application/pdf, persists the key and returns a signed url', async () => {
    const supabase = makeSupabase([ROW]);
    const out = await svc.fetchOrMintCertificatePdf(supabase, { userId: USER, certificateCode: CODE });

    expect(out.minted).toBe(true);
    expect(out.pdf_r2_key).toBe(KEY);
    expect(out.download_url).toContain('X-Amz-Signature');
    expect(out.certificate_code).toBe(CODE);
    expect(out.level_name).toBe('Aspiring Teacher');

    expect(uploads).toHaveLength(1);
    expect(uploads[0].key).toBe(KEY);
    expect(uploads[0].contentType).toBe('application/pdf');

    const persisted = updates.find((u) => u.table === 'training_certificates');
    expect(persisted.payload).toEqual({ pdf_r2_key: KEY });
  });

  it('presigns as an attachment named after the certificate code', async () => {
    await svc.fetchOrMintCertificatePdf(makeSupabase([ROW]), { userId: USER, certificateCode: CODE });
    expect(presignCalls).toHaveLength(1);
    expect(presignCalls[0].options).toEqual({ disposition: 'attachment', filename: `${CODE}.pdf` });
  });
});

describe('fetchOrMintCertificatePdf — FETCH path (key already stored)', () => {
  it('does not re-render; it just signs the stored key', async () => {
    const supabase = makeSupabase([{ ...ROW, pdf_r2_key: KEY }]);
    const out = await svc.fetchOrMintCertificatePdf(supabase, { userId: USER, certificateCode: CODE });

    expect(out.minted).toBe(false);
    expect(out.pdf_r2_key).toBe(KEY);
    expect(uploads).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('a SECOND request after a mint does not re-mint', async () => {
    const supabase = makeSupabase([ROW]);
    const first = await svc.fetchOrMintCertificatePdf(supabase, { userId: USER, certificateCode: CODE });
    const second = await svc.fetchOrMintCertificatePdf(supabase, { userId: USER, certificateCode: CODE });

    expect(first.minted).toBe(true);
    expect(second.minted).toBe(false);
    expect(second.pdf_r2_key).toBe(KEY);
    expect(uploads).toHaveLength(1);         // rendered exactly once
  });
});

describe('fetchOrMintCertificatePdf — refusals', () => {
  it('throws not_found for a certificate belonging to someone else', async () => {
    const supabase = makeSupabase([OTHER_ROW]);
    await expect(
      svc.fetchOrMintCertificatePdf(supabase, { userId: USER, certificateCode: OTHER_ROW.certificate_code }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(uploads).toHaveLength(0);
  });

  it('throws not_found for an unknown code', async () => {
    await expect(
      svc.fetchOrMintCertificatePdf(makeSupabase([ROW]), { userId: USER, certificateCode: 'NOPE-1' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('throws bad_request without a userId or a code', async () => {
    const supabase = makeSupabase([ROW]);
    await expect(svc.fetchOrMintCertificatePdf(supabase, { userId: null, certificateCode: CODE }))
      .rejects.toMatchObject({ code: 'bad_request' });
    await expect(svc.fetchOrMintCertificatePdf(supabase, { userId: USER, certificateCode: '' }))
      .rejects.toMatchObject({ code: 'bad_request' });
  });

  it('throws mint_failed — loudly, never a silent success — when rendering dies', async () => {
    renderShouldThrow = true;
    await expect(
      svc.fetchOrMintCertificatePdf(makeSupabase([ROW]), { userId: USER, certificateCode: CODE }),
    ).rejects.toMatchObject({ code: 'mint_failed' });
  });

  it('throws mint_failed when the upload dies', async () => {
    uploadShouldThrow = true;
    await expect(
      svc.fetchOrMintCertificatePdf(makeSupabase([ROW]), { userId: USER, certificateCode: CODE }),
    ).rejects.toMatchObject({ code: 'mint_failed' });
  });

  it('throws mint_failed when the object stored but the presign returned nothing', async () => {
    const r2 = require('../../bot/shared/storage/r2');
    r2.getPresignedUrl.mockResolvedValueOnce(null);
    await expect(
      svc.fetchOrMintCertificatePdf(makeSupabase([ROW]), { userId: USER, certificateCode: CODE }),
    ).rejects.toMatchObject({ code: 'mint_failed' });
  });
});
