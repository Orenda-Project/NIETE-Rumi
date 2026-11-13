/**
 * Local-.env target guard: a .env must say which database it points at, and a
 * production one must be opted into per run.
 *
 * Why: a checkout's `.env` once held PRODUCTION Supabase credentials while the
 * docs called it the sandbox .env, so any "sandbox" script run from it wrote to
 * prod. The label lives IN the file (`RUMI_ENV_TARGET=sandbox|staging|production`)
 * so it travels with the credentials; the opt-in (`RUMI_ALLOW_PROD=1`) lives on
 * the command line so it is a decision made for one run, never a standing state.
 *
 * Only credentials that came FROM A FILE are judged. On Railway, in CI, or with
 * `railway run`, the credentials arrive through the process environment and this
 * guard does nothing.
 */

const PRODUCTION_LABELS = new Set(['production', 'prod']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function isLoopback(url) {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function evaluateEnvTarget({ fileVars, env }) {
  const fileUrl = fileVars && fileVars.SUPABASE_URL;
  if (!fileUrl || fileUrl !== env.SUPABASE_URL) return { ok: true, target: null };
  // A database on this machine (the local E2E stack) cannot be a hosted production project.
  if (isLoopback(fileUrl)) return { ok: true, target: 'local' };

  const target = String(fileVars.RUMI_ENV_TARGET || '').trim().toLowerCase();
  if (!target) {
    return {
      ok: false,
      reason:
        'This .env supplies SUPABASE_URL but does not say which database it is. ' +
        'Add RUMI_ENV_TARGET=sandbox (or staging / production) to the file.',
    };
  }

  if (PRODUCTION_LABELS.has(target)) {
    const optedIn = env.RUMI_ALLOW_PROD === '1' && fileVars.RUMI_ALLOW_PROD !== '1';
    if (!optedIn) {
      return {
        ok: false,
        reason:
          'This .env is labelled RUMI_ENV_TARGET=production. To run against production on ' +
          'purpose, prefix this one command with RUMI_ALLOW_PROD=1 (never put it in the file). ' +
          'For sandbox work, use a sandbox .env instead.',
      };
    }
    return { ok: true, target: 'production' };
  }

  return { ok: true, target };
}

function assertEnvTarget({ fileVars, env = process.env, exit = process.exit, write } = {}) {
  if (env.JEST_WORKER_ID && !write) return; // test runs never boot against a real .env
  const out = write || ((s) => process.stderr.write(s));
  const result = evaluateEnvTarget({ fileVars, env });
  if (result.ok) return;
  out(
    [
      '',
      '┌─ Refusing to connect: local .env target check ─────────────────────────',
      '│ ' + result.reason,
      '└────────────────────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  );
  exit(78); // sysexits.h EX_CONFIG
}

module.exports = { evaluateEnvTarget, assertEnvTarget };
