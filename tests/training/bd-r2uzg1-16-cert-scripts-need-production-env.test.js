/**
 * bd-r2uzg1.16 — a one-off script that can issue certificates against the PRODUCTION database
 * refuses to run unless NODE_ENV=production.
 *
 * Why: certificate-pdf.service stamps 'NOT A REAL CERTIFICATE' on every PDF rendered outside
 * NODE_ENV=production (certificate-env.rules.js shouldStampTestBanner), and the stamped PDF is
 * cached at training_certificates.pdf_r2_key, so a real teacher downloads it from then on.
 * 2026-10-17 09:34-09:37Z: the I-SAPS held-results release (scripts/release-isaps-held-attempts.js
 * --target prod --apply) was run with --env-file NIETE-Rumi/.env — prod SUPABASE_URL, but
 * NODE_ENV=development — and all 34 I-SAPS Level 1 certificates it issued carry the banner.
 * The project-ref checks passed because the DATABASE was right; only the render environment was not.
 *
 * Operator, 2026-11-13: "that is supposed to be staging and sandbox environments".
 *
 * The rule keys on the database the script will write to (the SUPABASE_URL project ref), not on a
 * flag: production ref → NODE_ENV must be exactly 'production'. Sandbox and staging are untouched
 * (their certificates SHOULD carry the banner).
 *
 * The three scripts that can reach the certificate renderer:
 *   scripts/release-isaps-held-attempts.js  (isaps-held-release → maybeIssueQuizScoreCertificate)
 *   scripts/settle-certificates.js          (loadVisibleLevelsWithProgress → settleCertificates)
 *   scripts/smoke-test-training-flow.js     (handleTeacherTrainingInit → loadVisibleLevelsWithProgress)
 * Each is spawned for real with a production-ref URL on an unresolvable host (.invalid), so a
 * script that does NOT refuse fails on DNS — nothing reaches a real database.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const PROD_REF = 'ihzciabopbttygxxgrkm';
const PROD_URL_NO_NETWORK = `https://${PROD_REF}.supabase.co.invalid`;

describe('assertProductionCertificateEnv', () => {
  // Required per test (not at describe time) so a missing module fails these tests, not the spawn ones.
  const guard = () => require('../../scripts/lib/certificate-issuing-env');
  const assertProductionCertificateEnv = (...a) => guard().assertProductionCertificateEnv(...a);

  test('the production ref is the one the scripts target as prod', () => {
    expect(guard().PRODUCTION_SUPABASE_REF).toBe(PROD_REF);
    expect(require('../../scripts/release-isaps-held-attempts').TARGET_REFS.prod).toBe(PROD_REF);
  });

  test.each([
    ['development (the root .env)', 'development'],
    ['unset', undefined],
    ['empty', ''],
    ['staging', 'staging'],
    ['a near miss', 'prod'],
  ])('production database + NODE_ENV %s → refuses, naming NODE_ENV and the banner', (_label, nodeEnv) => {
    expect(() => assertProductionCertificateEnv({
      supabaseUrl: `https://${PROD_REF}.supabase.co`, nodeEnv, script: 'x.js',
    })).toThrow(/REFUSING[\s\S]*NODE_ENV[\s\S]*NOT A REAL CERTIFICATE/);
  });

  test('production database + NODE_ENV=production → allowed', () => {
    expect(() => assertProductionCertificateEnv({
      supabaseUrl: `https://${PROD_REF}.supabase.co`, nodeEnv: 'production', script: 'x.js',
    })).not.toThrow();
    expect(() => assertProductionCertificateEnv({
      supabaseUrl: `https://${PROD_REF}.supabase.co`, nodeEnv: ' Production ', script: 'x.js',
    })).not.toThrow();
  });

  test.each([
    ['sandbox', 'olvritwoqujtjvwfulbh'],
    ['staging', 'rpqkekcfvumypldbejhp'],
  ])('%s database → allowed whatever NODE_ENV says (the banner is right there)', (_label, ref) => {
    for (const nodeEnv of [undefined, 'development', 'staging', 'production']) {
      expect(() => assertProductionCertificateEnv({
        supabaseUrl: `https://${ref}.supabase.co`, nodeEnv, script: 'x.js',
      })).not.toThrow();
    }
  });
});

describe('every certificate-issuing script refuses a production database without NODE_ENV=production', () => {
  let dir;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-r2uzg1-16-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  // A clean environment: nothing inherited (no real keys, no Axiom shipping), cwd without a .env.
  function run(args, extraEnv) {
    return spawnSync(process.execPath, args, {
      cwd: dir,
      env: { PATH: process.env.PATH, HOME: dir, ...extraEnv },
      encoding: 'utf8',
      timeout: 60000,
    });
  }
  function envFile(nodeEnv) {
    const f = path.join(dir, `env-${nodeEnv}`);
    fs.writeFileSync(f, `SUPABASE_URL=${PROD_URL_NO_NETWORK}\nSUPABASE_SERVICE_ROLE_KEY=not-a-jwt\nNODE_ENV=${nodeEnv}\n`);
    return f;
  }

  test('release-isaps-held-attempts.js --target prod with the root .env (NODE_ENV=development) aborts', () => {
    const r = run([path.join(ROOT, 'scripts/release-isaps-held-attempts.js'),
      '--target', 'prod', '--dry-run', '--env-file', envFile('development')]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/REFUSING[\s\S]*NODE_ENV[\s\S]*development/);
  });

  test('settle-certificates.js --target prod with NODE_ENV=development aborts', () => {
    const r = run([path.join(ROOT, 'scripts/settle-certificates.js'),
      '--target', 'prod', '--env-file', envFile('development')]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/REFUSING[\s\S]*NODE_ENV[\s\S]*development/);
  });

  test('smoke-test-training-flow.js against a production database with NODE_ENV=development aborts', () => {
    const r = run([path.join(ROOT, 'scripts/smoke-test-training-flow.js')], {
      SUPABASE_URL: PROD_URL_NO_NETWORK, SUPABASE_SERVICE_ROLE_KEY: 'not-a-jwt', NODE_ENV: 'development',
    });
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toMatch(/REFUSING[\s\S]*NODE_ENV[\s\S]*development/);
  });
});
