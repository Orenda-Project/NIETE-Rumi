/**
 * The republish tool must not be able to surprise anyone.
 *
 * It writes to Meta, and the only thing separating staging from production is an
 * env var nobody can see while running it. The WABA that serves +92 322 2482222
 * and the one that serves the live NIETE number are two API calls apart, and a
 * mis-pointed .env would publish a half-finished screen to real teachers.
 *
 * So the guards are asserted at source level rather than trusted: dry-run must be
 * the default, the target must be named before anything is written, a mismatch
 * between the flow's WABA and the configured WABA must refuse, and the live asset
 * must be backed up before it is replaced.
 */

const fs = require('fs');

const SRC_PATH = require.resolve('../../bot/scripts/setup/republish-flow.js');
const RAW = fs.readFileSync(SRC_PATH, 'utf8');
// Comments stripped: the invariant is what the code DOES. The source documents
// the failure modes on purpose and should not be punished for naming them.
const CODE = RAW
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('republish-flow — writes are opt-in', () => {
  it('requires an explicit --yes before publishing', () => {
    expect(CODE).toMatch(/includes\(\s*'--yes'\s*\)/);
  });

  it('returns before any upload when --yes is absent', () => {
    // The dry-run early-return must sit BEFORE the upload call, or "dry run"
    // would print reassuringly and publish anyway.
    const guardIndex = CODE.search(/if\s*\(\s*!\s*write\s*\)/);
    const uploadIndex = CODE.search(/uploadFlowJson\s*\(/);
    expect(guardIndex).toBeGreaterThan(-1);
    expect(uploadIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(uploadIndex);
  });
});

describe('republish-flow — the target is named and checked', () => {
  it('resolves the WABA phone numbers, so the operator can see the environment', () => {
    // "Which environment is this?" is the only question that matters here, and the
    // answer is not visible in the command line.
    expect(CODE).toMatch(/phone_numbers/);
  });

  it('refuses when the flow does not belong to the configured WABA', () => {
    expect(CODE).toMatch(/Refusing/);
    expect(CODE).toMatch(/whatsapp_business_account/);
  });

  it('refuses before uploading, not after', () => {
    const refuseIndex = CODE.search(/Refusing/);
    const uploadIndex = CODE.search(/uploadFlowJson\s*\(/);
    expect(refuseIndex).toBeLessThan(uploadIndex);
  });
});

describe('republish-flow — the previous version is recoverable', () => {
  it('backs the live asset up before replacing it', () => {
    const backupIndex = CODE.search(/writeFileSync/);
    const uploadIndex = CODE.search(/uploadFlowJson\s*\(/);
    expect(backupIndex).toBeGreaterThan(-1);
    expect(backupIndex).toBeLessThan(uploadIndex);
  });

  it('verifies by re-fetching the published asset, not by trusting the response', () => {
    // A 200 from publish means Meta accepted the call, not that the screen a
    // teacher sees now contains the change.
    const publishIndex = CODE.search(/publishFlow\s*\(/);
    const refetch = CODE.lastIndexOf('fetchPublishedJson');
    expect(refetch).toBeGreaterThan(publishIndex);
  });
});

describe('republish-flow — backups stay out of git', () => {
  it('the backup directory is gitignored', () => {
    // These are per-environment dumps of what Meta was serving. Committing them
    // would put one environment's published state into a public repo.
    const ignore = fs.readFileSync(require('path').join(__dirname, '../../.gitignore'), 'utf8');
    expect(ignore).toMatch(/bot\/scripts\/setup\/assets\/backups/);
  });
});
