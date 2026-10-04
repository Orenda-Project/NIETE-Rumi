'use strict';
/**
 * L37 test helpers (not a test file). The network boundary is mocked in each test file with jest.mock
 * (openai SDK = OpenRouter, axios = Soniox, child_process = ffmpeg, @aws-sdk/client-s3 = R2); these
 * helpers build the replies and the Soniox transcripts. Synthetic: no child, no names.
 */
const { tokensFrom } = require('../L5/fixtures/transcripts');

const reply = (obj, cost = 0.004) => ({ choices: [{ message: { content: JSON.stringify(obj) } }], usage: { cost, prompt_tokens: 10, completion_tokens: 10 } });
const promptOf = (req) => { const c = req.messages[0].content; return typeof c === 'string' ? c : c[0].text; };
const hasAudio = (req) => Array.isArray(req.messages[0].content) && req.messages[0].content.some((x) => x.type === 'input_audio');

/** Soniox over axios: the transcript for `script` lines [speaker, startSec, text]. */
function sonioxReturns(axios, script) {
  const tokens = tokensFrom(script);
  axios.post.mockImplementation(async (url) => {
    if (url.includes('api.soniox.com/v1/files')) return { data: { id: 'file-1' } };
    if (url.includes('api.soniox.com/v1/transcriptions')) return { data: { id: 'tr-1' } };
    return { data: {} };
  });
  axios.get.mockImplementation(async (url) => {
    if (url.endsWith('/transcript')) return { data: { text: tokens.map((t) => t.text).join(''), tokens } };
    if (url.includes('/v1/transcriptions/')) return { data: { status: 'completed' } };
    return { data: {} };
  });
  axios.delete.mockResolvedValue({ data: {} });
}

/** An item reply: verdict letters ('c','w','n','s') per item, in order. */
const items = (vs, { conf = 0.95, found = true, extra = {} } = {}) => reply({ found, ...extra, items: [...vs].map((v, k) => ({ i: k + 1, heard: v === 'c' ? 'ok' : (v === 'w' ? 'x' : ''), v, conf: Array.isArray(conf) ? conf[k] : conf })) });
const rows = (rowsV) => reply({ found: true, rows: rowsV.map((v, k) => ({ row: k + 1, heard: '', v: [...v], conf: 0.9 })) });
const words = (vs) => reply({ words: [...vs].map((v, k) => ({ i: k + 1, w: `w${k + 1}`, v: { c: 'correct', w: 'wrong', s: 'skipped' }[v] })), words_correct: 0, words_attempted: 0, notes: '' });
const rep = (s, n) => s.repeat(n);

module.exports = { reply, promptOf, hasAudio, sonioxReturns, items, rows, words, rep, tokensFrom };
