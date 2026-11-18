'use strict';
/**
 * bd-ehz254.15 — a transcript-quiz digest that fails on the provider names the provider's cause.
 *
 * Prod 16 Nov: two digests failed on `400 Provider returned error` (OpenRouter's wrapper message).
 * The log kept only err.message, so which upstream refused, and why, was lost. OpenRouter puts that
 * on the error body: `{ error: { code, message, metadata: { provider_name, raw } } }`, which the
 * OpenAI SDK exposes as `err.error`, with the HTTP status on `err.status`.
 */
const fs = require('fs');
const path = require('path');
const { digestFailureDetail } = require('../../shared/services/quiz/digest-failure-detail');

describe('digestFailureDetail (bd-ehz254.15)', () => {
  test('an OpenRouter provider error yields its status, provider and raw cause', () => {
    const err = Object.assign(new Error('400 Provider returned error'), {
      status: 400,
      error: { code: 400, message: 'Provider returned error', metadata: { provider_name: 'Google', raw: '{"error":{"message":"Request contains an invalid argument."}}' } },
    });
    expect(digestFailureDetail(err)).toEqual({
      status: 400,
      provider: 'Google',
      providerError: '{"error":{"message":"Request contains an invalid argument."}}',
    });
  });

  test('the raw cause is cut to 200 characters', () => {
    const err = { status: 400, error: { metadata: { raw: 'x'.repeat(500) } } };
    expect(digestFailureDetail(err).providerError).toHaveLength(200);
  });

  test('an object raw cause is written as JSON', () => {
    const err = { status: 502, error: { metadata: { provider_name: 'Anthropic', raw: { type: 'overloaded_error' } } } };
    expect(digestFailureDetail(err)).toEqual({ status: 502, provider: 'Anthropic', providerError: '{"type":"overloaded_error"}' });
  });

  test('an error with no provider body gives nulls, never throws', () => {
    expect(digestFailureDetail(new Error('bad JSON'))).toEqual({ status: null, provider: null, providerError: null });
    expect(digestFailureDetail(null)).toEqual({ status: null, provider: null, providerError: null });
  });

  test('both digest-failed log lines carry the detail', () => {
    const dir = path.join(__dirname, '../../shared/services/quiz');
    for (const file of ['transcript-quiz-offer.service.js', 'transcript-quiz-generate.service.js']) {
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      const line = src.split('\n').find((l) => l.includes("'❌ transcript quiz: digest failed"));
      expect(line).toContain('...digestFailureDetail(err)');
    }
  });
});
