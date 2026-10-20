'use strict';
/**
 * Live moves (bd-v0toag.31): asks the fidelity model which unticked moves the latest transcript stretch shows.
 * Any failure (timeout, refusal, junk) ticks nothing and logs live_moves.detect.failed; the screen just waits.
 */
const { buildDetectPrompt, parseDetect } = require('./detector-prompt');
const { modelFor } = require('../../../config/model-registry');
const { logToFile } = require('../../../utils/logger');

const TIMEOUT_MS = 20_000;

/** → Promise<number[]> — the idx of each move the transcript shows done. Never throws. */
async function detectMoves({ window, moves }, deps = {}) {
  if (!String(window || '').trim() || !moves || !moves.length) return [];
  const log = deps.log || logToFile;
  const timeoutMs = deps.timeoutMs || TIMEOUT_MS;
  const { system, user } = buildDetectPrompt({ window, moves });
  let timer;
  try {
    const client = deps.client || require('../../llm-client').getClient();
    const call = client.chat.completions.create({
      model: modelFor('lp.fidelity'),
      job: 'live_moves.detect',
      temperature: 0,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
    });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('detector timed out'), { reason: 'timeout' })), timeoutMs);
    });
    const res = await Promise.race([call, timeout]);
    const content = res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;
    return parseDetect(content || '', moves.map((m) => m.idx));
  } catch (e) {
    log('live_moves.detect.failed', { reason: (e && e.reason) || 'error', message: e && e.message });
    return [];
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { detectMoves, TIMEOUT_MS };
