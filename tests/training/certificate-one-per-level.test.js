/**
 * bd-2670 — ONE CERTIFICATE PER (user, level).
 *
 * Reported from the field: the portal listed several certificates against the
 * same training level. It is not a display bug — the rows are really there.
 * Production held 3,113 surplus rows across 830 teachers, the worst single
 * level carrying 56 certificates.
 *
 * Two defects combine into a ratchet, and this file pins both:
 *
 *  1. `issueCertificate` deduped on `attempt_id` alone. Per-attempt idempotency
 *     is not per-level idempotency: every fresh passing attempt at a level the
 *     teacher had already certified minted another certificate.
 *
 *  2. The per-level guard in `maybeIssueQuizScoreCertificate` was a
 *     `.maybeSingle()`. PostgREST answers 406 / PGRST116 when the filter
 *     matches more than one row, so the guard THREW once a duplicate existed,
 *     the error was swallowed, and it failed OPEN — minting yet another. That
 *     is what turns two certificates into fifty-six.
 *
 * The mock below therefore models `maybeSingle()` the way PostgREST actually
 * behaves — erroring on multiple matches — rather than quietly handing back the
 * first row. A mock that returns `rows[0]` cannot reproduce this bug at all,
 * which is precisely how it survived the existing suite.
 */

let issueCertificate;

let tableStates;
let inserts;

/** PostgREST's PGRST116: `.maybeSingle()` on a multi-row match is an error. */
function pgrst116(n) {
  return {
    code: 'PGRST116',
    details: `The result contains ${n} rows`,
    hint: null,
    message: 'Cannot coerce the result to a single JSON object',
  };
}

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { filters: {} };
  const chain = {};

  const matched = () => {
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    const hits = rows.filter((r) =>
      Object.entries(record.filters).every(([col, val]) => r[col] === undefined || r[col] === val));
    if (record.order) {
      const { col, ascending } = record.order;
      hits.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (ascending ? 1 : -1));
    }
    return hits;
  };

  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  chain.in = jest.fn(() => chain);
  // Really sorts — the keep-earliest rule depends on the order the DB applies,
  // so a no-op `.order()` here would let a wrong keep-rule pass the suite.
  chain.order = jest.fn((col, opts = {}) => {
    record.order = { col, ascending: opts.ascending !== false };
    return chain;
  });
  chain.limit = jest.fn((n) => { record.limit = n; return chain; });

  chain.maybeSingle = jest.fn(async () => {
    if (state.error) return { data: null, error: state.error };
    const rows = matched();
    if (rows.length > 1) return { data: null, error: pgrst116(rows.length) };
    return { data: rows[0] || null, error: null };
  });
  chain.single = chain.maybeSingle;

  chain.insert = jest.fn(async (row) => {
    inserts.push({ table: tableName, row });
    return { data: null, error: state.insertError || null };
  });

  chain.then = (resolve, reject) => {
    if (state.error) return Promise.resolve({ data: null, error: state.error }).then(resolve, reject);
    const rows = matched();
    const capped = record.limit ? rows.slice(0, record.limit) : rows;
    return Promise.resolve({ data: capped, error: null }).then(resolve, reject);
  };
  return chain;
}

function makeSupabase() {
  return { from: jest.fn((tbl) => makeChain(tbl)) };
}

const USER = 'user-1';
const LEVEL = 42;
const PROGRAM = 'prog-1';

/** An existing certificate row for USER at LEVEL, from an earlier attempt. */
function existingCert(overrides = {}) {
  return {
    id: 'cert-row-1',
    user_id: USER,
    level_id: LEVEL,
    attempt_id: 'attempt-OLD',
    certificate_code: 'CERT-20260101-AAAAAA',
    teacher_name_snapshot: 'Aisha Khan',
    level_name_snapshot: 'English',
    issued_at: '2026-01-01T00:00:00.000Z',
    pdf_r2_key: null,
    ...overrides,
  };
}

function certInserts() {
  return inserts.filter((i) => i.table === 'training_certificates');
}

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  inserts = [];
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  // The PDF step is irrelevant here and must not reach R2 from a test.
  jest.doMock('../../bot/shared/services/training/certificate-pdf.service', () => ({
    generateAndStoreCertificatePdf: jest.fn(async () => null),
  }), { virtual: true });
  ({ issueCertificate } = require('../../bot/shared/services/training/certificate.service'));

  tableStates.users = { rows: [{ name: 'Aisha Khan', first_name: 'Aisha', last_name: 'Khan' }] };
  tableStates.training_levels = { rows: [{ name: 'English' }] };
});

afterEach(() => { jest.resetModules(); });

describe('bd-2670 — issueCertificate is idempotent per (user, level), not just per attempt', () => {
  it('does NOT mint a second certificate when the level is already certified by an earlier attempt', async () => {
    tableStates.training_certificates = { rows: [existingCert()] };

    const res = await issueCertificate(makeSupabase(), {
      userId: USER,
      programId: PROGRAM,
      levelId: LEVEL,
      attemptId: 'attempt-NEW',   // a different, newer passing attempt
    });

    expect(certInserts()).toHaveLength(0);
    expect(res.already_issued).toBe(true);
    // The teacher keeps the certificate they first earned.
    expect(res.certificate_code).toBe('CERT-20260101-AAAAAA');
  });

  it('returns the FIRST-earned certificate when several already exist (keep-rule: earliest)', async () => {
    tableStates.training_certificates = {
      rows: [
        existingCert({ id: 'c2', attempt_id: 'a2', certificate_code: 'CERT-20260305-CCCCCC', issued_at: '2026-03-05T00:00:00.000Z' }),
        existingCert({ id: 'c1', attempt_id: 'a1', certificate_code: 'CERT-20260101-AAAAAA', issued_at: '2026-01-01T00:00:00.000Z' }),
        existingCert({ id: 'c3', attempt_id: 'a3', certificate_code: 'CERT-20260210-BBBBBB', issued_at: '2026-02-10T00:00:00.000Z' }),
      ],
    };

    const res = await issueCertificate(makeSupabase(), {
      userId: USER, programId: PROGRAM, levelId: LEVEL, attemptId: 'attempt-NEW',
    });

    expect(certInserts()).toHaveLength(0);
    expect(res.certificate_code).toBe('CERT-20260101-AAAAAA');
  });

  it('THE RATCHET: pre-existing duplicates must not fail the guard open', async () => {
    // Exactly the production state: this level already carries duplicates.
    // A `.maybeSingle()` guard 406s here, the error is swallowed, and the
    // service mints certificate number three.
    tableStates.training_certificates = {
      rows: [
        existingCert({ id: 'c1', attempt_id: 'a1', certificate_code: 'CERT-A', issued_at: '2026-01-01T00:00:00.000Z' }),
        existingCert({ id: 'c2', attempt_id: 'a2', certificate_code: 'CERT-B', issued_at: '2026-02-01T00:00:00.000Z' }),
      ],
    };

    await issueCertificate(makeSupabase(), {
      userId: USER, programId: PROGRAM, levelId: LEVEL, attemptId: 'attempt-NEW',
    });

    expect(certInserts()).toHaveLength(0);
  });

  it('still mints for a level the teacher has NOT yet certified', async () => {
    tableStates.training_certificates = { rows: [existingCert({ level_id: 999 })] };

    const res = await issueCertificate(makeSupabase(), {
      userId: USER, programId: PROGRAM, levelId: LEVEL, attemptId: 'attempt-NEW',
    });

    expect(certInserts()).toHaveLength(1);
    expect(certInserts()[0].row).toMatchObject({ user_id: USER, level_id: LEVEL, attempt_id: 'attempt-NEW' });
    expect(res.already_issued).toBe(false);
  });

  it('keeps per-attempt idempotency: the same attempt never mints twice', async () => {
    tableStates.training_certificates = { rows: [existingCert({ attempt_id: 'attempt-SAME' })] };

    const res = await issueCertificate(makeSupabase(), {
      userId: USER, programId: PROGRAM, levelId: LEVEL, attemptId: 'attempt-SAME',
    });

    expect(certInserts()).toHaveLength(0);
    expect(res.already_issued).toBe(true);
  });
});
