/**
 * bd-60170 — a certificate that was not written is not "issued".
 *
 * Reported from sandbox: "i clicked on Receive Cert and it gave me a toast but
 * nothing anywhere on the certificates."
 *
 * Two bugs, and the second is the one that made the first invisible:
 *
 *  1. `training_certificates.program_id` is NOT NULL, and the portal picked
 *     the programme with `.limit(1).maybeSingle()` over EVERY active
 *     assignment. A teacher on three programmes (Primary, Middle, I-SAPS
 *     pilot — a real account) got an arbitrary one, or null. The insert then
 *     failed on the not-null constraint.
 *
 *  2. issueCertificate LOGGED that failure and carried on, returning
 *     `issued: true` with a freshly generated code. So the API reported a
 *     certificate, the UI announced it by name, and no row existed anywhere.
 *
 * (2) is the important one to keep fixed: a silent write failure that reports
 * success is worse than a loud one, because nobody goes looking.
 */

const MODULE = '../../bot/shared/services/training/certificate.service';

function makeSupabase({ insertError = null, rows = {} }) {
  return {
    from(table) {
      let data = rows[table] ? rows[table].slice() : [];
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        in() { return chain; },
        order() { return chain; },
        limit() { return chain; },
        maybeSingle() { return Promise.resolve({ data: data[0] || null, error: null }); },
        single() { return Promise.resolve({ data: data[0] || null, error: null }); },
        insert() {
          return Promise.resolve({ data: null, error: insertError });
        },
        then(res) { return Promise.resolve({ data, error: null }).then(res); },
      };
      return chain;
    },
  };
}

function load() {
  jest.resetModules();
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../bot/shared/services/training/certificate-pdf.service', () => ({
    generateAndStoreCertificatePdf: jest.fn().mockResolvedValue(null),
  }), { virtual: false });
  return require(MODULE);
}

const BASE_ROWS = {
  training_certificates: [],
  users: [{ name: 'Hataf' }],
  training_levels: [{ name: 'Level 1: Novice' }],
};

describe('bd-60170 — certificate honesty', () => {
  afterEach(() => jest.resetModules());

  const ARGS = { userId: 'u-1', programId: 'p-1', levelId: 26, attemptId: null };

  test('a FAILED insert reports issued:false — no code for a row that does not exist', async () => {
    const { issueCertificate } = load();
    const sb = makeSupabase({
      rows: BASE_ROWS,
      insertError: { message: 'null value in column "program_id" violates not-null constraint' },
    });
    const out = await issueCertificate(sb, ARGS);
    expect(out.issued).toBe(false);
    expect(out.reason).toBe('insert_failed');
    expect(out.certificate_code).toBeUndefined();
  });

  test('a successful insert still reports its code', async () => {
    const { issueCertificate } = load();
    const sb = makeSupabase({ rows: BASE_ROWS, insertError: null });
    const out = await issueCertificate(sb, ARGS);
    expect(out.certificate_code).toMatch(/-\d{8}-/);
  });
});
