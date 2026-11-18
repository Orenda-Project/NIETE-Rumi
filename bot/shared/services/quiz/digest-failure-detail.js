'use strict';

/**
 * WHAT the provider said when a transcript-quiz digest call was refused (bd-ehz254.15).
 * OpenRouter wraps an upstream refusal as `400 Provider returned error` and puts the cause on the body
 * (`err.error.metadata.provider_name` / `.raw`, exposed by the OpenAI SDK as `err.error`); err.message
 * alone names neither, so the 16 Nov prod failures could not be explained.
 *
 * @param {Error} err what the digest threw
 * @returns {{status: number|null, provider: string|null, providerError: string|null}}
 */
function digestFailureDetail(err) {
  const meta = (err && err.error && err.error.metadata) || {};
  const raw = meta.raw == null ? null : (typeof meta.raw === 'string' ? meta.raw : JSON.stringify(meta.raw));
  return {
    status: (err && typeof err.status === 'number') ? err.status : null,
    provider: meta.provider_name || null,
    providerError: raw == null ? null : raw.slice(0, 200),
  };
}

module.exports = { digestFailureDetail };
