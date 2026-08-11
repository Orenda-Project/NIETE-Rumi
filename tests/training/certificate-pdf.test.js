/**
 * Certificate PDF — render, store, retrieve, deliver.
 *
 * A passed level exam has always written a `training_certificates` ROW and
 * stopped: `pdf_r2_key` was a column nothing read and nothing wrote. These
 * tests lock the contract of the service that fills it in.
 *
 * What is asserted is the CONTRACT, never pixels:
 *   - the R2 key shape the schema comment already prescribes
 *     (`certs/{user_id}/{cert_code}.pdf`)
 *   - the upload carries ContentType `application/pdf`
 *   - the key is persisted back onto the certificate row
 *   - the teacher name / level / vendor / code / date reach the document
 *   - EVERY failure mode is swallowed: a render throw, an upload throw and a
 *     persist error all return null instead of propagating, because a
 *     certificate row with a null `pdf_r2_key` is a permanently valid state
 *     and issuance must never fail for want of a PDF.
 *
 * `pdfkit` and the R2 client live in `bot/`, which CI installs AFTER the root
 * suite runs — so both are mocked virtually.
 */

const { EventEmitter } = require('events');

let svc;
let textCalls;      // every doc.text() string, in order
let imageCalls;     // every doc.image() path
let fontRegs;       // every registerFont(name, path)
let fontUses;       // every doc.font(name)
let uploads;        // every uploadBuffer(buffer, key, contentType)
let updates;        // every supabase .update() payload + filters
let presignCalls;
let sendDocCalls;
let renderShouldThrow;
let uploadShouldThrow;

// ── A PDFDocument stand-in ────────────────────────────────────────────────
// Chainable no-ops for the drawing API, an EventEmitter for the stream API.
function makePdfkitMock() {
  return function PDFDocument() {
    const doc = new EventEmitter();
    const chain = () => doc;
    doc.page = { width: 842, height: 595, margins: { top: 50, bottom: 50, left: 50, right: 50 } };
    doc.x = 0; doc.y = 0;
    doc.registerFont = (name, file) => { fontRegs.push({ name, file }); return doc; };
    doc.font = (name) => { fontUses.push(name); return doc; };
    doc.fontSize = chain;
    doc.fillColor = chain;
    doc.strokeColor = chain;
    doc.lineWidth = chain;
    doc.opacity = chain;
    doc.rect = chain;
    doc.roundedRect = chain;
    doc.moveTo = chain;
    doc.lineTo = chain;
    doc.fill = chain;
    doc.stroke = chain;
    doc.fillAndStroke = chain;
    doc.save = chain;
    doc.restore = chain;
    doc.addPage = chain;
    doc.image = (p) => { imageCalls.push(p); return doc; };
    doc.widthOfString = () => 100;
    doc.heightOfString = () => 12;
    doc.text = (str) => {
      if (renderShouldThrow) throw new Error('boom: renderer exploded');
      textCalls.push(String(str));
      return doc;
    };
    doc.end = () => {
      setImmediate(() => {
        doc.emit('data', Buffer.from('%PDF-1.3 fake'));
        doc.emit('end');
      });
    };
    return doc;
  };
}

function makeSupabase(certRows = []) {
  const chain = {};
  const filters = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn((c, v) => { filters[c] = v; return chain; });
  chain.maybeSingle = jest.fn(async () => ({ data: certRows[0] || null, error: null }));
  chain.single = jest.fn(async () => ({ data: certRows[0] || null, error: null }));
  chain.update = jest.fn((payload) => {
    const upd = { payload, filters: {} };
    updates.push(upd);
    const u = {
      eq: jest.fn((c, v) => { upd.filters[c] = v; return u; }),
      then: (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej),
    };
    return u;
  });
  return { from: jest.fn(() => chain) };
}

// A supabase whose level→vendor lookups resolve, so the vendor line has a value.
function makeLookupSupabase() {
  const tables = {
    // Shaped like the real rows: training_levels carries cpd_level and
    // training_vendors carries the `key` that selects the certificate template.
    training_levels: [{ id: 3, name: 'Aspiring Teacher', vendor_id: 'vend-1', cpd_level: null }],
    training_vendors: [{ id: 'vend-1', key: 'TALEEMABAD', name: 'Institute of Teacher Education' }],
    training_certificates: [],
  };
  return {
    from: jest.fn((t) => {
      const rows = tables[t] || [];
      const chain = {};
      chain.select = jest.fn(() => chain);
      chain.eq = jest.fn(() => chain);
      chain.maybeSingle = jest.fn(async () => ({ data: rows[0] || null, error: null }));
      chain.single = jest.fn(async () => ({ data: rows[0] || null, error: null }));
      chain.update = jest.fn((payload) => {
        const upd = { table: t, payload, filters: {} };
        updates.push(upd);
        const u = {
          eq: jest.fn((c, v) => { upd.filters[c] = v; return u; }),
          then: (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej),
        };
        return u;
      });
      return chain;
    }),
  };
}

beforeEach(() => {
  jest.resetModules();
  textCalls = []; imageCalls = []; fontRegs = []; fontUses = [];
  uploads = []; updates = []; presignCalls = []; sendDocCalls = [];
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
    getPresignedUrl: jest.fn(async (url, expiresIn) => {
      presignCalls.push({ url, expiresIn });
      return `${url}?X-Amz-Signature=deadbeef`;
    }),
  }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendDocumentFromUrl: jest.fn(async (to, url, filename, caption) => {
      sendDocCalls.push({ to, url, filename, caption });
      return true;
    }),
  }));

  svc = require('../../bot/shared/services/training/certificate-pdf.service');
});

const CERT = {
  userId: 'user-abc',
  levelId: 3,
  certificateCode: 'PFX-20260802-A1B2C3',
  teacherName: 'Amina Khan',
  levelName: 'Aspiring Teacher',
  issuedAt: '2026-08-02T10:00:00.000Z',
};

describe('certificatePdfKey — the shape the schema already documents', () => {
  it('is certs/{user_id}/{certificate_code}.pdf', () => {
    expect(svc.certificatePdfKey('user-abc', 'PFX-20260802-A1B2C3'))
      .toBe('certs/user-abc/PFX-20260802-A1B2C3.pdf');
  });

  it('returns null without both parts, so a bad key is never uploaded', () => {
    expect(svc.certificatePdfKey(null, 'PFX-1')).toBeNull();
    expect(svc.certificatePdfKey('user-abc', '')).toBeNull();
  });
});

describe('renderCertificatePdf', () => {
  it('returns a Buffer and puts name, level, issuer, code and date on the page', async () => {
    const buf = await svc.renderCertificatePdf({
      ...CERT,
      vendorName: 'Institute of Teacher Education',
    });
    expect(Buffer.isBuffer(buf)).toBe(true);

    const all = textCalls.join('\n');
    expect(all).toContain('Amina Khan');
    expect(all).toContain('Aspiring Teacher');
    expect(all).toContain('PFX-20260802-A1B2C3');
    expect(all).toMatch(/2026/);
    // The issuing organisation is named in the body sentence, matching the
    // certificate this fork inherited. There is no generic "Content provider"
    // line: each vendor's template names its own issuer, and which template
    // runs is asserted in certificate-vendor-templates.test.js.
    expect(all).toMatch(/National Institute of Excellence in Teacher Education/i);
  });

  it('renders a non-Latin teacher name in the registered Arabic-script font', async () => {
    await svc.renderCertificatePdf({ ...CERT, teacherName: 'محمد عامر خان' });
    // Naskh is registered (Nastaliq's GPOS tables crash fontkit) and actually
    // selected — the bug this guards is registering a font and never calling
    // doc.font() with it, which silently ships Latin-1 mojibake.
    expect(fontRegs.some((f) => /Naskh/i.test(f.file))).toBe(true);
    expect(fontUses).toContain('CertArabic');
  });

  it('does not switch fonts for a Latin name', async () => {
    await svc.renderCertificatePdf(CERT);
    expect(fontUses).not.toContain('CertArabic');
  });
});

describe('generateAndStoreCertificatePdf', () => {
  it('uploads as application/pdf under the certs/ key and persists it on the row', async () => {
    const supabase = makeLookupSupabase();
    const key = await svc.generateAndStoreCertificatePdf(supabase, CERT);

    expect(key).toBe('certs/user-abc/PFX-20260802-A1B2C3.pdf');
    expect(uploads).toHaveLength(1);
    expect(uploads[0].key).toBe(key);
    expect(uploads[0].contentType).toBe('application/pdf');
    expect(Buffer.isBuffer(uploads[0].buffer)).toBe(true);

    const certUpdate = updates.find((u) => u.table === 'training_certificates');
    expect(certUpdate).toBeDefined();
    expect(certUpdate.payload).toEqual({ pdf_r2_key: key });
    expect(certUpdate.filters).toEqual({ certificate_code: 'PFX-20260802-A1B2C3' });
  });

  it('resolves level → vendor so the right vendor TEMPLATE is chosen', async () => {
    // The lookup exists to pick a template, not to print a line: a vendor key
    // resolved wrongly prints one party's accreditation on another's
    // certificate. TALEEMABAD → the NIETE template.
    await svc.generateAndStoreCertificatePdf(makeLookupSupabase(), CERT);
    const all = textCalls.join('\n');
    expect(all).toMatch(/Aga Khan University/i);
    expect(all).toContain('Sabeena Abbasi');
  });

  it('returns null (never throws, never persists) when rendering explodes', async () => {
    renderShouldThrow = true;
    const key = await svc.generateAndStoreCertificatePdf(makeLookupSupabase(), CERT);
    expect(key).toBeNull();
    expect(uploads).toHaveLength(0);
    expect(updates.filter((u) => u.table === 'training_certificates')).toHaveLength(0);
  });

  it('returns null (never throws, never persists) when the upload explodes', async () => {
    uploadShouldThrow = true;
    const key = await svc.generateAndStoreCertificatePdf(makeLookupSupabase(), CERT);
    expect(key).toBeNull();
    expect(updates.filter((u) => u.table === 'training_certificates')).toHaveLength(0);
  });

  it('returns null when there is no certificate code to key on', async () => {
    const key = await svc.generateAndStoreCertificatePdf(makeLookupSupabase(), { ...CERT, certificateCode: null });
    expect(key).toBeNull();
    expect(uploads).toHaveLength(0);
  });
});

describe('certificatePdfUrl — retrieval', () => {
  it('presigns the stored key', async () => {
    const url = await svc.certificatePdfUrl('certs/user-abc/PFX-1.pdf');
    expect(presignCalls[0].url).toBe('https://acct.r2.cloudflarestorage.com/test-bucket/certs/user-abc/PFX-1.pdf');
    expect(url).toContain('X-Amz-Signature');
  });

  it('returns null for a null key rather than presigning garbage', async () => {
    expect(await svc.certificatePdfUrl(null)).toBeNull();
    expect(presignCalls).toHaveLength(0);
  });
});

describe('sendCertificateDocument — WhatsApp delivery', () => {
  it('sends the stored PDF as a document named after the certificate code', async () => {
    const ok = await svc.sendCertificateDocument('923001234567', {
      pdf_r2_key: 'certs/user-abc/PFX-20260802-A1B2C3.pdf',
      certificate_code: 'PFX-20260802-A1B2C3',
      level_name: 'Aspiring Teacher',
    });
    expect(ok).toBe(true);
    expect(sendDocCalls).toHaveLength(1);
    expect(sendDocCalls[0].to).toBe('923001234567');
    expect(sendDocCalls[0].filename).toBe('PFX-20260802-A1B2C3.pdf');
    expect(sendDocCalls[0].url).toContain('certs/user-abc/PFX-20260802-A1B2C3.pdf');
  });

  it('is a no-op returning false when the certificate has no PDF', async () => {
    const ok = await svc.sendCertificateDocument('923001234567', {
      pdf_r2_key: null,
      certificate_code: 'PFX-1',
    });
    expect(ok).toBe(false);
    expect(sendDocCalls).toHaveLength(0);
  });

  it('never throws when delivery fails', async () => {
    const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
    WhatsAppService.sendDocumentFromUrl.mockRejectedValueOnce(new Error('meta 500'));
    await expect(svc.sendCertificateDocument('923001234567', {
      pdf_r2_key: 'certs/u/PFX-1.pdf', certificate_code: 'PFX-1',
    })).resolves.toBe(false);
  });
});

// Keeps the mock-only supabase helper live so the file has no dead fixture.
describe('generateAndStoreCertificatePdf — vendor lookup is optional', () => {
  it('still renders and stores when the level/vendor lookup finds nothing', async () => {
    const supabase = makeSupabase([]);
    const key = await svc.generateAndStoreCertificatePdf(supabase, CERT);
    expect(key).toBe('certs/user-abc/PFX-20260802-A1B2C3.pdf');
    expect(uploads).toHaveLength(1);
  });
});
