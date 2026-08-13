/**
 * issueCertificate must hand back a PDF — and must survive without one.
 *
 * The rule this file exists to enforce: PDF generation is BEST EFFORT and can
 * never block, slow down or fail the issuance of the certificate row. Today's
 * behaviour (row written, `pdf_r2_key` null) is the permanent fallback, so:
 *
 *   - on the happy path the key is generated, persisted and returned;
 *   - if the PDF service THROWS, the row is still written and the caller
 *     still gets a certificate_code — with pdf_r2_key null;
 *   - if the row INSERT itself failed, no PDF work is attempted (there is no
 *     row to attach it to);
 *   - the idempotent re-issue path returns whatever key the existing row has,
 *     without re-rendering.
 */

let issueCertificate;
let tableStates;
let inserts;
let pdfCalls;
let pdfImpl;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { filters: {} };
  const chain = {};
  const finalize = () => {
    if (state.error) return { data: null, error: state.error };
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: rows[0] || null, error: null };
  };
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  // bd-2670 — per-level idempotency reads a sorted, capped LIST, not an object.
  chain.order = jest.fn((col, opts = {}) => {
    record.order = { col, ascending: opts.ascending !== false };
    return chain;
  });
  chain.limit = jest.fn((n) => { record.limit = n; return chain; });
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
  chain.insert = jest.fn(async (row) => {
    inserts.push({ table: tableName, row });
    return { data: null, error: state.insertError || null };
  });
  chain.then = (res, rej) => {
    if (state.error) return Promise.resolve({ data: null, error: state.error }).then(res, rej);
    const all = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    let rows = all.filter((r) =>
      Object.entries(record.filters).every(([col, val]) => r[col] === undefined || r[col] === val));
    if (record.order) {
      const { col, ascending } = record.order;
      rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (ascending ? 1 : -1));
    }
    if (record.limit) rows = rows.slice(0, record.limit);
    return Promise.resolve({ data: rows, error: null }).then(res, rej);
  };
  return chain;
}

const makeSupabase = () => ({ from: jest.fn((t) => makeChain(t)) });

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  inserts = [];
  pdfCalls = [];
  pdfImpl = async () => 'certs/user-1/GENERATED.pdf';

  delete process.env.CERT_CODE_PREFIX;
  delete process.env.BOT_NAME;
  delete process.env.ORG_NAME;

  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/services/training/certificate-pdf.service', () => ({
    generateAndStoreCertificatePdf: jest.fn(async (supabase, args) => {
      pdfCalls.push(args);
      return pdfImpl(args);
    }),
    certificatePdfKey: (u, c) => (u && c ? `certs/${u}/${c}.pdf` : null),
  }));

  ({ issueCertificate } = require('../../bot/shared/services/training/certificate.service'));
});

const params = { userId: 'user-1', programId: 'prog-1', levelId: 3, attemptId: 'attempt-9' };

function seedFreshIssue() {
  tableStates.training_certificates = { rows: [] };
  tableStates.users = { rows: [{ name: null, first_name: 'Amina', last_name: 'Khan' }] };
  tableStates.training_levels = { rows: [{ name: 'Aspiring Teacher' }] };
}

describe('issueCertificate → PDF', () => {
  it('renders on issuance and returns the stored key', async () => {
    seedFreshIssue();
    const cert = await issueCertificate(makeSupabase(), params);

    expect(pdfCalls).toHaveLength(1);
    expect(pdfCalls[0]).toEqual(expect.objectContaining({
      userId: 'user-1',
      levelId: 3,
      teacherName: 'Amina Khan',
      levelName: 'Aspiring Teacher',
      certificateCode: cert.certificate_code,
    }));
    expect(cert.pdf_r2_key).toBe('certs/user-1/GENERATED.pdf');
  });

  it('still issues the certificate when PDF generation throws', async () => {
    seedFreshIssue();
    pdfImpl = async () => { throw new Error('boom: pdfkit died'); };

    const cert = await issueCertificate(makeSupabase(), params);

    expect(cert.certificate_code).toMatch(/^CERT-\d{8}-[A-Z0-9]{6}$/);
    expect(cert.teacher_name).toBe('Amina Khan');
    expect(cert.pdf_r2_key).toBeNull();
    expect(inserts.find((i) => i.table === 'training_certificates')).toBeDefined();
  });

  it('still issues the certificate when PDF generation returns null', async () => {
    seedFreshIssue();
    pdfImpl = async () => null;
    const cert = await issueCertificate(makeSupabase(), params);
    expect(cert.pdf_r2_key).toBeNull();
    expect(cert.certificate_code).toBeTruthy();
  });

  it('never writes pdf_r2_key into the INSERT — it is a separate, best-effort write', async () => {
    seedFreshIssue();
    await issueCertificate(makeSupabase(), params);
    const ins = inserts.find((i) => i.table === 'training_certificates');
    expect(Object.keys(ins.row)).not.toContain('pdf_r2_key');
  });

  it('skips PDF work entirely when the row insert failed', async () => {
    seedFreshIssue();
    tableStates.training_certificates = { rows: [], insertError: { message: 'duplicate key' } };
    const cert = await issueCertificate(makeSupabase(), params);
    expect(pdfCalls).toHaveLength(0);
    expect(cert.pdf_r2_key).toBeNull();
  });

  it('still issues the certificate when the PDF module cannot even LOAD', async () => {
    // The realistic dashboard case: issueCertificate is shared with the portal,
    // whose process resolves node_modules from dashboard/ — so a `require` from
    // inside bot/ for a bot-only dependency (pdfkit) can throw at load time,
    // not call time. The require therefore has to sit inside the try, and this
    // is the test that keeps it there.
    jest.resetModules();
    tableStates.training_certificates = { rows: [] };
    tableStates.users = { rows: [{ name: 'Amina Khan' }] };
    tableStates.training_levels = { rows: [{ name: 'Aspiring Teacher' }] };

    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/services/training/certificate-pdf.service', () => {
      throw new Error("Cannot find module 'pdfkit'");
    });
    const svc = require('../../bot/shared/services/training/certificate.service');

    const cert = await svc.issueCertificate(makeSupabase(), params);
    expect(cert.certificate_code).toMatch(/^CERT-\d{8}-[A-Z0-9]{6}$/);
    expect(cert.pdf_r2_key).toBeNull();
    expect(inserts.find((i) => i.table === 'training_certificates')).toBeDefined();
  });

  it('re-issue returns the existing row key without re-rendering', async () => {
    tableStates.training_certificates = {
      rows: [{
        certificate_code: 'CERT-20260701-AAAAAA',
        teacher_name_snapshot: 'Amina Khan',
        level_name_snapshot: 'Aspiring Teacher',
        issued_at: '2026-07-01T00:00:00Z',
        pdf_r2_key: 'certs/user-1/CERT-20260701-AAAAAA.pdf',
      }],
    };
    const cert = await issueCertificate(makeSupabase(), params);
    expect(cert.already_issued).toBe(true);
    expect(cert.pdf_r2_key).toBe('certs/user-1/CERT-20260701-AAAAAA.pdf');
    expect(pdfCalls).toHaveLength(0);
  });
});
