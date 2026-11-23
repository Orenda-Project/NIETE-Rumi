/**
 * bd-r2uzg1.18.3 — a certificate issued while the account had no name says "Teacher"
 * for ever, even after the name is added.
 *
 * Issuance freezes the account's name into training_certificates.teacher_name_snapshot;
 * an account with no name gets the placeholder 'Teacher' (certificate.service.js). The PDF
 * prints that snapshot and is cached at pdf_r2_key, and fetchOrMintCertificatePdf served the
 * cached file on every later download. So when a coach added the teacher's name, the
 * certificate she downloaded again still said "Teacher".
 *
 * The rule, in the one fetch-or-mint path every surface uses (portal, /certificate, the
 * training Flow): when the snapshot is blank or the placeholder and the account now has a
 * real name, re-render with that name (same key, same code, level and date) and store the
 * name as the snapshot. A snapshot that already holds a name stays frozen: this repairs a
 * missing name, it does not rewrite issued certificates.
 */

const { EventEmitter } = require('events');

let svc;
let uploads;
let texts;
let renderShouldThrow;

function makePdfkitMock() {
  return function PDFDocument() {
    const doc = new EventEmitter();
    const chain = () => doc;
    doc.page = { width: 842, height: 595, margins: { top: 50, bottom: 50, left: 50, right: 50 } };
    doc.registerFont = chain; doc.font = chain; doc.fontSize = chain;
    doc.fillColor = chain; doc.strokeColor = chain; doc.lineWidth = chain;
    doc.rect = chain; doc.roundedRect = chain; doc.moveTo = chain; doc.lineTo = chain;
    doc.fill = chain; doc.stroke = chain; doc.fillAndStroke = chain;
    doc.opacity = chain; doc.save = chain; doc.restore = chain;
    doc.translate = chain; doc.rotate = chain;
    doc.image = chain; doc.widthOfString = () => 100; doc.heightOfString = () => 12;
    doc.text = (t) => {
      if (renderShouldThrow) throw new Error('boom: renderer exploded');
      texts.push(String(t));
      return doc;
    };
    doc.end = () => setImmediate(() => { doc.emit('data', Buffer.from('%PDF-1.3')); doc.emit('end'); });
    return doc;
  };
}

/**
 * Supabase stand-in with one row list per table. Reads match every .eq filter; an UPDATE
 * applies to the rows its own .eq filters match and is visible to the next read.
 */
function makeSupabase(tables) {
  const state = {};
  for (const [t, rows] of Object.entries(tables)) state[t] = rows.map((r) => ({ ...r }));
  const updates = [];
  const client = {
    _state: state,
    _updates: updates,
    from: jest.fn((table) => {
      const rows = state[table] || [];
      const filters = {};
      const match = () => rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
      const chain = {};
      chain.select = jest.fn(() => chain);
      chain.eq = jest.fn((c, v) => { filters[c] = v; return chain; });
      chain.order = jest.fn(() => chain);
      chain.maybeSingle = jest.fn(async () => ({ data: match()[0] || null, error: null }));
      chain.update = jest.fn((payload) => {
        const uf = {};
        const u = {};
        const run = () => {
          const hit = rows.filter((r) => Object.entries(uf).every(([k, v]) => r[k] === v));
          updates.push({ table, payload, filters: { ...uf }, matched: hit.length });
          for (const r of hit) Object.assign(r, payload);
          return hit;
        };
        u.eq = jest.fn((c, v) => { uf[c] = v; return u; });
        u.is = jest.fn((c, v) => { uf[c] = v; return u; });
        u.select = jest.fn(() => ({
          then: (res, rej) => Promise.resolve({ data: run().map((r) => ({ id: r.id })), error: null }).then(res, rej),
        }));
        u.then = (res, rej) => Promise.resolve(run()).then(() => ({ data: null, error: null })).then(res, rej);
        return u;
      });
      return chain;
    }),
  };
  return client;
}

const USER = '00000000-0000-4000-8000-000000000001';
const CODE = 'PFX-20261027-AB12CD';
const KEY = `certs/${USER}/${CODE}.pdf`;
const NAME = 'Test Teacher Alpha';

const CERT = {
  id: 'cert-1', user_id: USER, level_id: 27,
  certificate_code: CODE,
  teacher_name_snapshot: 'Teacher',
  level_name_snapshot: 'Level 1',
  issued_at: '2026-10-27T06:30:00Z',
  pdf_r2_key: KEY,
};

beforeEach(() => {
  jest.resetModules();
  uploads = []; texts = []; renderShouldThrow = false;
  process.env.R2_BUCKET_NAME = 'test-bucket';
  process.env.R2_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';

  jest.doMock('pdfkit', makePdfkitMock, { virtual: true });
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/storage/r2', () => ({
    uploadBuffer: jest.fn(async (buffer, key, contentType) => {
      uploads.push({ buffer, key, contentType });
      return `https://acct.r2.cloudflarestorage.com/test-bucket/${key}`;
    }),
    buildR2PublicUrl: (key) => `https://acct.r2.cloudflarestorage.com/test-bucket/${key}`,
    getPresignedUrl: jest.fn(async (url) => `${url}?X-Amz-Signature=deadbeef`),
  }));

  svc = require('../../bot/shared/services/training/certificate-pdf.service');
});

describe('a placeholder-name certificate whose account now has a name', () => {
  it('re-renders the cached PDF with the account name, at the same key', async () => {
    const supabase = makeSupabase({
      training_certificates: [CERT],
      users: [{ id: USER, name: NAME }],
    });

    const out = await svc.fetchOrMintCertificatePdf(supabase, { userId: USER, certificateCode: CODE });

    expect(uploads).toHaveLength(1);
    expect(uploads[0].key).toBe(KEY);
    expect(texts).toContain(NAME);
    expect(texts).not.toContain('Teacher');
    expect(out.teacher_name).toBe(NAME);
    expect(out.pdf_r2_key).toBe(KEY);
    expect(out.minted).toBe(true);
    // Code, level and date are the certificate's own, unchanged.
    expect(out.certificate_code).toBe(CODE);
    expect(out.level_name).toBe('Level 1');
    expect(out.issued_at).toBe('2026-10-27T06:30:00Z');
  });

  it('stores the name as the snapshot, so the next download is served from the cache', async () => {
    const supabase = makeSupabase({
      training_certificates: [CERT],
      users: [{ id: USER, name: NAME }],
    });

    await svc.fetchOrMintCertificatePdf(supabase, { userId: USER, certificateCode: CODE });
    const row = supabase._state.training_certificates[0];
    expect(row.teacher_name_snapshot).toBe(NAME);
    expect(row.pdf_r2_key).toBe(KEY);
    expect(row.certificate_code).toBe(CODE);
    expect(row.level_name_snapshot).toBe('Level 1');
    expect(row.issued_at).toBe('2026-10-27T06:30:00Z');

    uploads = []; texts = [];
    const again = await svc.fetchOrMintCertificatePdf(supabase, { userId: USER, certificateCode: CODE });
    expect(uploads).toHaveLength(0);
    expect(again.minted).toBe(false);
    expect(again.teacher_name).toBe(NAME);
  });

  it('treats a blank snapshot the same way, on a first mint too', async () => {
    const supabase = makeSupabase({
      training_certificates: [{ ...CERT, teacher_name_snapshot: '  ', pdf_r2_key: null }],
      users: [{ id: USER, name: `  ${NAME} ` }],
    });

    const out = await svc.fetchOrMintCertificatePdf(supabase, { userId: USER, certificateCode: CODE });

    expect(uploads).toHaveLength(1);
    expect(texts).toContain(NAME);
    expect(out.teacher_name).toBe(NAME);
    expect(supabase._state.training_certificates[0].teacher_name_snapshot).toBe(NAME);
  });

  it('repairs a NULL snapshot too', async () => {
    const supabase = makeSupabase({
      training_certificates: [{ ...CERT, teacher_name_snapshot: null }],
      users: [{ id: USER, name: NAME }],
    });

    const out = await svc.fetchOrMintCertificatePdf(supabase, { userId: USER, certificateCode: CODE });

    expect(texts).toContain(NAME);
    expect(out.teacher_name).toBe(NAME);
    expect(supabase._state.training_certificates[0].teacher_name_snapshot).toBe(NAME);
  });

  it('keeps serving the stored PDF (and keeps the placeholder) when the re-render fails', async () => {
    const supabase = makeSupabase({
      training_certificates: [CERT],
      users: [{ id: USER, name: NAME }],
    });
    renderShouldThrow = true;

    const out = await svc.fetchOrMintCertificatePdf(supabase, { userId: USER, certificateCode: CODE });

    expect(out.pdf_r2_key).toBe(KEY);
    expect(out.download_url).toContain(KEY);
    expect(out.minted).toBe(false);
    // Not marked as fixed, so the next download tries again.
    expect(supabase._state.training_certificates[0].teacher_name_snapshot).toBe('Teacher');
  });
});

describe('what stays as it was', () => {
  it.each([
    ['no name', null],
    ['a blank name', '   '],
    ['the placeholder itself', 'teacher'],
  ])('an account with %s: the cached PDF is served, nothing re-rendered', async (_label, accountName) => {
    const supabase = makeSupabase({
      training_certificates: [CERT],
      users: [{ id: USER, name: accountName }],
    });

    const out = await svc.fetchOrMintCertificatePdf(supabase, { userId: USER, certificateCode: CODE });

    expect(uploads).toHaveLength(0);
    expect(out.minted).toBe(false);
    expect(out.pdf_r2_key).toBe(KEY);
    expect(supabase._updates.filter((u) => u.table === 'training_certificates')).toHaveLength(0);
  });

  it('a certificate issued with a name stays frozen when the account name changes later', async () => {
    const supabase = makeSupabase({
      training_certificates: [{ ...CERT, teacher_name_snapshot: 'Test Teacher Beta' }],
      users: [{ id: USER, name: NAME }],
    });

    const out = await svc.fetchOrMintCertificatePdf(supabase, { userId: USER, certificateCode: CODE });

    expect(uploads).toHaveLength(0);
    expect(out.teacher_name).toBe('Test Teacher Beta');
    expect(supabase.from).not.toHaveBeenCalledWith('users');
  });
});

describe('certificate-name.rules', () => {
  const rules = () => require('../../bot/shared/services/training/certificate-name.rules');

  it('a blank or "Teacher" snapshot is the placeholder; a name is not', () => {
    const { isPlaceholderTeacherName } = rules();
    for (const v of [null, undefined, '', '   ', 'Teacher', ' teacher ', 'TEACHER']) {
      expect(isPlaceholderTeacherName(v)).toBe(true);
    }
    for (const v of [NAME, 'Teachers Union', 'ٹیسٹ استاد']) {
      expect(isPlaceholderTeacherName(v)).toBe(false);
    }
  });

  it('nameToRepair gives the trimmed account name only for a placeholder snapshot', () => {
    const { nameToRepair } = rules();
    expect(nameToRepair('Teacher', `  ${NAME}  `)).toBe(NAME);
    expect(nameToRepair('', NAME)).toBe(NAME);
    expect(nameToRepair('Teacher', null)).toBe(null);
    expect(nameToRepair('Teacher', 'Teacher')).toBe(null);
    expect(nameToRepair('Test Teacher Beta', NAME)).toBe(null);
    expect(nameToRepair('Teacher', 'x'.repeat(300))).toHaveLength(255);
  });
});
