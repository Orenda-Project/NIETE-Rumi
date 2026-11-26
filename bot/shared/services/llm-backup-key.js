/**
 * A second OpenRouter key for when the first one cannot spend. bd-9xnyql.
 *
 * On 25 Nov 2026 the production key hit its spend cap (403 "Key limit exceeded") for 40 minutes
 * and about 150 coaching reports, assessments, own plans and quiz digests failed. The vendor
 * fallback in llm-client could not help: it tries another MODEL on the SAME key.
 *
 * `withBackupKey(client, build)` wraps an OpenRouter client so that a request the KEY could not pay
 * for (401 revoked, 402 no credit, 403 over its limit) is sent once more, unchanged, on
 * OPENROUTER_API_KEY_FALLBACK. Read per call: setting or removing the variable needs no code change,
 * and with it unset (or LLM_FALLBACK_OFF=1) the client behaves exactly as before.
 *
 * A 403 that is not about money (a moderation flag) and every other failure are left alone: a
 * different key cannot answer them.
 */

const BACKUP_ENV = 'OPENROUTER_API_KEY_FALLBACK';

function isKeyOutOfBudget(e) {
  if (!e) return false;
  const status = e.status != null ? e.status : e.statusCode;
  if (status === 401 || status === 402) return true;
  return status === 403 && /limit|credit/i.test(String(e.message || ''));
}

function backupKey() {
  if (String(process.env.LLM_FALLBACK_OFF || '').trim() === '1') return null;
  const backup = String(process.env[BACKUP_ENV] || '').trim();
  const primary = String(process.env.OPENROUTER_API_KEY || '').trim();
  return backup && backup !== primary ? backup : null;
}

function withBackupKey(client, buildClient) {
  const primaryCreate = client.chat.completions.create.bind(client.chat.completions);
  let backup = null; // { key, client } — rebuilt only if the variable changes

  client.chat.completions.create = async (params, options) => {
    try {
      return await primaryCreate(params, options);
    } catch (primaryErr) {
      const key = isKeyOutOfBudget(primaryErr) ? backupKey() : null;
      if (!key) throw primaryErr;

      const status = primaryErr.status != null ? primaryErr.status : primaryErr.statusCode;
      const reason = String(primaryErr.message || 'unknown').slice(0, 300);
      // Required at call time, like llm-client's own fallback: a top-level logger require from
      // this low in the tree has broken the circular-deps suite before.
      // eslint-disable-next-line global-require
      const { logEvent } = require('../utils/structured-logger');
      // eslint-disable-next-line global-require
      const { logToFile } = require('../utils/logger');
      const event = { model: params && params.model, status: status == null ? null : status, reason };
      logEvent('llm.key_fallback', event);
      logToFile('llm-backup-key: the OpenRouter key cannot spend, retrying on the backup key', event, 'warn');

      if (!backup || backup.key !== key) backup = { key, client: buildClient(key) };
      let res;
      try {
        res = await backup.client.chat.completions.create(params, options);
      } catch (backupErr) {
        backupErr.cause = backupErr.cause || primaryErr;
        backupErr.message = `${backupErr.message} (on the backup key, after the first key failed: ${reason})`;
        throw backupErr;
      }
      if (res && typeof res === 'object') res.usage = { ...(res.usage || {}), key_fallback: true };
      return res;
    }
  };
  return client;
}

module.exports = { withBackupKey, isKeyOutOfBudget, BACKUP_ENV };
