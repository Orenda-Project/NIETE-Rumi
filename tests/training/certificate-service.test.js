/**
 * Shared certificate issuance service — bot/shared/services/training/
 * certificate.service.js. Used by both the WhatsApp grand-quiz grader and
 * the portal level-exam submit.
 *
 * Covers: env-driven code prefix (no hardcoded deployment names), code
 * format, per-attempt idempotency, snapshot fallbacks, and insert row shape.
 */

let issueCertificate;
let generateCertificateCode;
let certCodePrefix;

let tableStates;
let inserts;

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
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
  chain.insert = jest.fn(async (row) => {
    inserts.push({ table: tableName, row });
    return { data: null, error: state.insertError || null };
  });
  chain.then = (resolve, reject) => Promise.resolve({ data: (state.rows || []), error: state.error || null }).then(resolve, reject);
  return chain;
}

function makeSupabase() {
  return { from: jest.fn((tbl) => makeChain(tbl)) };
}

const ENV_KEYS = ['CERT_CODE_PREFIX', 'BOT_NAME', 'ORG_NAME'];
let savedEnv;

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  inserts = [];
  savedEnv = {};
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }

  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  ({ issueCertificate, generateCertificateCode, certCodePrefix } =
    require('../../bot/shared/services/training/certificate.service'));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  jest.resetModules();
});

describe('certCodePrefix — env-driven, never a hardcoded deployment name', () => {
  it('falls back to the neutral CERT prefix when no env is set', () => {
    expect(certCodePrefix()).toBe('CERT');
  });

  it('prefers CERT_CODE_PREFIX, then BOT_NAME, then ORG_NAME', () => {
    process.env.ORG_NAME = 'Org Name';
    expect(certCodePrefix()).toBe('ORGNAME');
    process.env.BOT_NAME = 'MyBot';
    expect(certCodePrefix()).toBe('MYBOT');
    process.env.CERT_CODE_PREFIX = 'Deploy-01';
    expect(certCodePrefix()).toBe('DEPLOY01');
  });

  it('sanitizes to uppercase alphanumeric, max 12 chars', () => {
    process.env.CERT_CODE_PREFIX = 'my very long prefix name!!';
    const p = certCodePrefix();
    expect(p).toMatch(/^[A-Z0-9]{1,12}$/);
  });
});

describe('generateCertificateCode', () => {
  it('formats <PREFIX>-<YYYYMMDD>-<6 chars>', () => {
    process.env.CERT_CODE_PREFIX = 'TESTPFX';
    const code = generateCertificateCode(new Date('2026-07-19T12:00:00Z'));
    expect(code).toMatch(/^TESTPFX-20260719-[A-Z0-9]{6}$/);
  });
});

describe('issueCertificate', () => {
  const params = { userId: 'user-1', programId: 'prog-1', levelId: 3, attemptId: 'attempt-9' };

  it('inserts a training_certificates row with snapshots and returns the code', async () => {
    tableStates.training_certificates = { rows: [] };
    tableStates.users = { rows: [{ name: null, first_name: 'Amina', last_name: 'Khan' }] };
    tableStates.training_levels = { rows: [{ name: 'Foundations' }] };

    const supabase = makeSupabase();
    const cert = await issueCertificate(supabase, params);

    expect(cert.already_issued).toBe(false);
    expect(cert.teacher_name).toBe('Amina Khan');
    expect(cert.level_name).toBe('Foundations');
    expect(cert.certificate_code).toMatch(/^CERT-\d{8}-[A-Z0-9]{6}$/);

    const ins = inserts.find(i => i.table === 'training_certificates');
    expect(ins.row).toEqual(expect.objectContaining({
      user_id: 'user-1',
      program_id: 'prog-1',
      level_id: 3,
      attempt_id: 'attempt-9',
      certificate_code: cert.certificate_code,
      teacher_name_snapshot: 'Amina Khan',
      level_name_snapshot: 'Foundations',
    }));
  });

  it('is idempotent per attempt — an existing cert row is returned, not duplicated', async () => {
    tableStates.training_certificates = {
      rows: [{
        certificate_code: 'CERT-20260701-AAAAAA',
        teacher_name_snapshot: 'Amina Khan',
        level_name_snapshot: 'Foundations',
        issued_at: '2026-07-01T00:00:00Z',
      }],
    };
    const supabase = makeSupabase();
    const cert = await issueCertificate(supabase, params);

    expect(cert.already_issued).toBe(true);
    expect(cert.certificate_code).toBe('CERT-20260701-AAAAAA');
    expect(inserts).toHaveLength(0);
  });

  it('falls back to "Teacher" / "Level" snapshots when lookups return nothing', async () => {
    tableStates.training_certificates = { rows: [] };
    tableStates.users = { rows: [] };
    tableStates.training_levels = { rows: [] };

    const supabase = makeSupabase();
    const cert = await issueCertificate(supabase, params);
    expect(cert.teacher_name).toBe('Teacher');
    expect(cert.level_name).toBe('Level');
  });
});
