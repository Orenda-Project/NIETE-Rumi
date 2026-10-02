'use strict';
/**
 * Child test (bd-s1oo0.5) — one model call that returns JSON, never throws.
 *
 * Goes through llm-client (OpenRouter), which records spend. Returns
 * { json, cost, seconds, model, error } so the orchestrator can put per-call
 * cost and latency in ai_marks.meta and carry on when one call fails.
 */

const { getClient } = require('../../llm-client');

function parseJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_) { /* fall through */ }
  try { const { jsonrepair } = require('jsonrepair'); return JSON.parse(jsonrepair(m[0])); } catch (_) { return null; }
}

/**
 * @param {object} p
 * @param {string} p.model
 * @param {string} p.prompt
 * @param {{data: string, format: 'mp3'|'wav'}} [p.audio]  base64 audio
 * @param {string} [p.imageDataUrl]
 * @param {string} p.job        e.g. 'child_test.story'
 * @param {number} [p.maxTokens]
 */
async function chatJSON({ model, prompt, audio, imageDataUrl, job, maxTokens = 6000, attempts = 2 }) {
  const content = [{ type: 'text', text: prompt }];
  if (audio) content.push({ type: 'input_audio', input_audio: { data: audio.data, format: audio.format || 'mp3' } });
  if (imageDataUrl) content.push({ type: 'image_url', image_url: { url: imageDataUrl } });
  const started = Date.now();
  let lastErr = null; let cost = 0;
  for (let a = 0; a < attempts; a += 1) {
    try {
      const resp = await getClient().chat.completions.create({
        model, temperature: 0, max_tokens: maxTokens, job,
        messages: [{ role: 'user', content: content.length === 1 ? prompt : content }],
      });
      const u = (resp && resp.usage) || {};
      if (Number.isFinite(u.cost)) cost += u.cost;
      const text = resp && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
      const json = parseJson(text);
      if (json) return { json, cost, seconds: (Date.now() - started) / 1000, model, error: null };
      lastErr = 'no_json';
    } catch (e) {
      lastErr = String(e && e.message || e).slice(0, 200);
    }
  }
  return { json: null, cost, seconds: (Date.now() - started) / 1000, model, error: lastErr };
}

module.exports = { chatJSON, parseJson };
