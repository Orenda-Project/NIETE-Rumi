'use strict';
/**
 * bd-nu8svu — "Certificate insert failed — reporting NOT issued" on NIETE production.
 *
 * Every one of the 41 rows logged 2 Nov – 17 Nov (32 teacher/level pairs, levels 18, 19, 27, 31, 32) carried
 * `duplicate key value violates unique constraint "training_certificates_user_level_uniq"`, most of them two to
 * four times in the same millisecond for the same teacher. issueCertificate reads "already issued?" and then
 * inserts; two calls for the same (user, level) both read "no", both insert, the database keeps one and refuses
 * the other. The loser logged an error and answered { issued: false } — but the certificate it was asked for
 * DOES exist: the unique violation is the proof. And callers that read the fields without checking `issued`
 * (the WhatsApp grand-quiz and capstone congratulations) would have sent "Certificate code: undefined".
 *
 * The rule: a unique violation on (user, level) is "already issued", answered with the row that won.
 */
jest.mock('../../shared/services/training/certificate-pdf.service', () => ({
  generateAndStoreCertificatePdf: jest.fn(async () => null),
}));
jest.mock('../../shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logEvent: jest.fn(),
}));

const logger = require('../../shared/utils/logger');
const { issueCertificate } = require('../../shared/services/training/certificate.service');

const USER = 'u-race';
const WINNER = {
  certificate_code: 'NIETE-20261117-WIN001', teacher_name_snapshot: 'Ayesha', level_name_snapshot: 'Level 3',
  issued_at: '2026-11-17T17:13:33.600Z', pdf_r2_key: 'certs/win.pdf',
};

/**
 * A client in which another request wins the race: the first certificate read finds nothing, the insert is
 * refused with Postgres' unique violation, and any later read finds the winner's row.
 */
function racingClient({ insertError }) {
  let certReads = 0;
  const builder = (table) => {
    const q = {
      select() { return q; }, eq() { return q; }, order() { return q; },
      limit() {
        if (table !== 'training_certificates') return Promise.resolve({ data: [], error: null });
        certReads += 1;
        return Promise.resolve({ data: certReads === 1 ? [] : [WINNER], error: null });
      },
      maybeSingle() {
        if (table === 'users') return Promise.resolve({ data: { name: 'Ayesha' }, error: null });
        if (table === 'training_levels') return Promise.resolve({ data: { name: 'Level 3' }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      insert() { return Promise.resolve({ data: null, error: insertError }); },
    };
    return q;
  };
  return { from: jest.fn(builder) };
}

const UNIQUE = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "training_certificates_user_level_uniq"',
};

beforeEach(() => jest.clearAllMocks());

describe('bd-nu8svu: a lost insert race is "already issued", not a failure', () => {
  test('the unique violation answers with the certificate that won', async () => {
    const res = await issueCertificate(racingClient({ insertError: UNIQUE }), {
      userId: USER, programId: 'p1', levelId: 31, attemptId: null,
    });

    expect(res.issued).not.toBe(false);
    expect(res).toMatchObject({
      certificate_code: WINNER.certificate_code,
      teacher_name: 'Ayesha',
      level_name: 'Level 3',
      issued_at: WINNER.issued_at,
      already_issued: true,
      pdf_r2_key: 'certs/win.pdf',
    });
  });

  test('a lost race is not logged as an error', async () => {
    await issueCertificate(racingClient({ insertError: UNIQUE }), {
      userId: USER, programId: 'p1', levelId: 31, attemptId: null,
    });

    const msgs = logger.logError.mock.calls.map((c) => c[0]);
    expect(msgs).not.toContain('Certificate insert failed — reporting NOT issued');
  });

  test('any other insert failure is still reported as NOT issued, at error level', async () => {
    const res = await issueCertificate(racingClient({ insertError: { code: '23502', message: 'null value in column' } }), {
      userId: USER, programId: 'p1', levelId: 31, attemptId: null,
    });

    expect(res).toEqual({ issued: false, reason: 'insert_failed' });
    expect(logger.logError).toHaveBeenCalledWith('Certificate insert failed — reporting NOT issued', expect.any(Object));
  });
});
