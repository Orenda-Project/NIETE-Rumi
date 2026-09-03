/**
 * E2E cassette — record/replay for the vendor calls that make a coaching E2E run cost 20+ minutes.
 *
 * WHY. On staging the classroom-coaching pipeline spends ~10 min inside Soniox (transcription),
 * the LLM (FICO analysis, reflective question, narrative, commitment card) and ElevenLabs (voice
 * debrief), and the E2E suite re-buys all of it on every run of the SAME 16-minute fixture. None of
 * that time tests our code. This module sits at the three seams and, on staging only, replays the
 * vendor's previous answer for an identical request:
 *
 *   AudioService._transcribeOnce   → key: sha256(audio bytes) + diarization + language + roles
 *   llm-client chat.completions    → key: the full request params (model + messages + …)
 *   ElevenLabsService._postTts     → key: url + body (text, voice settings)
 *
 * The key is the REQUEST, so a changed prompt, fixture or voice is a miss and goes live (then gets
 * recorded) — cassettes make the run fast, never blind. Errors are never recorded. Streaming LLM
 * calls bypass the cassette.
 *
 * Modes (env E2E_CASSETTE): off (default) · record (live, then store) · replay (stored if present,
 * else live-then-store). Whatever the env says, mode is FORCED off when SUPABASE_URL points at the
 * NIETE production project — cassettes are a staging device.
 *
 * Storage: a JSON file per key under E2E_CASSETTE_DIR (default <bot>/temp/e2e-cassettes). When R2 is
 * configured the same object is also mirrored to R2 under e2e-cassettes/<key>.json, so a Railway
 * redeploy (ephemeral disk) does not lose the library; a local miss is checked against R2 first.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROD_PROJECT_REFS = ['ihzciabopbttygxxgrkm'];   // NIETE production Supabase — never cassette here
const R2_PREFIX = 'e2e-cassettes/';

function _log(msg, data) {
  try { require('../utils/logger').logToFile(msg, data); } catch (_) { /* logger optional in tests */ }
}

function mode() {
  const m = String(process.env.E2E_CASSETTE || 'off').toLowerCase();
  if (m !== 'record' && m !== 'replay') return 'off';
  const supa = String(process.env.SUPABASE_URL || '');
  if (PROD_PROJECT_REFS.some(ref => supa.includes(ref))) return 'off';
  return m;
}

/** Deterministic JSON: object keys sorted at every depth, so {a,b} and {b,a} hash the same. */
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Buffer.isBuffer(v)) return JSON.stringify({ __buffer_sha256: sha256(v) });
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}
function sha256(x) { return crypto.createHash('sha256').update(x).digest('hex'); }
function keyFor(kind, keyParts) { return `${kind}-${sha256(stable(keyParts))}`; }

/** Blank per-run tokens inside string leaves so the key follows the request's SUBSTANCE.
 *  The 2026-09-02 record run stored the same reflective-question call twice: the prompt carried a
 *  session UUID and timestamps. UUIDs, ISO timestamps, bare dates and clock times are replaced with
 *  fixed placeholders; everything else (model, roles, transcript, instructions) is untouched. */
const VOLATILE = [
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>'],
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<iso>'],
  [/\b\d{4}-\d{2}-\d{2}\b/g, '<date>'],
  [/\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:AM|PM|am|pm)?\b/g, '<time>'],
];
function normaliseForKey(v) {
  if (typeof v === 'string') return VOLATILE.reduce((acc, [re, rep]) => acc.replace(re, rep), v);
  if (Array.isArray(v)) return v.map(normaliseForKey);
  if (v && typeof v === 'object' && !Buffer.isBuffer(v)) {
    const out = {}; for (const k of Object.keys(v)) out[k] = normaliseForKey(v[k]); return out;
  }
  return v;
}

function dir() {
  return process.env.E2E_CASSETTE_DIR || path.join(__dirname, '..', '..', 'temp', 'e2e-cassettes');
}
function filePath(key) { return path.join(dir(), key + '.json'); }

// ── local store ──────────────────────────────────────────────────────────────
function readLocal(key) {
  try { return JSON.parse(fs.readFileSync(filePath(key), 'utf8')); } catch (_) { return null; }
}
function writeLocal(key, record) {
  fs.mkdirSync(dir(), { recursive: true });
  const tmp = filePath(key) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(record));
  fs.renameSync(tmp, filePath(key));
}

// ── R2 mirror (optional) ─────────────────────────────────────────────────────
function r2Configured() {
  return !!(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME);
}
let _s3 = null;
function s3() {
  if (_s3) return _s3;
  const { S3Client } = require('@aws-sdk/client-s3');
  _s3 = new S3Client({ region: 'auto', endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
  return _s3;
}
async function readR2(key) {
  if (!r2Configured()) return null;
  try {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const res = await s3().send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: R2_PREFIX + key + '.json' }));
    const body = await res.Body.transformToString();
    return JSON.parse(body);
  } catch (_) { return null; }
}
async function writeR2(key, record) {
  if (!r2Configured()) return;
  try {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await s3().send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: R2_PREFIX + key + '.json',
      Body: JSON.stringify(record), ContentType: 'application/json' }));
  } catch (e) { _log('⚠️ e2e-cassette: R2 mirror write failed (local copy kept)', { key, error: e.message }); }
}

/** What of the request is kept in the record so a MISS can be diagnosed (why did the key change?).
 *  Long strings are truncated; nothing secret lives in these params (keys are headers, not body). */
function requestForRecord(keyParts) {
  const trim = v => typeof v === 'string' && v.length > 4000 ? v.slice(0, 4000) + `…(+${v.length - 4000})` : v;
  const walk = v => Array.isArray(v) ? v.map(walk) : (v && typeof v === 'object' && !Buffer.isBuffer(v)) ? Object.fromEntries(Object.keys(v).map(k => [k, walk(v[k])])) : trim(v);
  try { return walk(keyParts); } catch (_) { return null; }
}

// ── the one primitive ────────────────────────────────────────────────────────
/**
 * Run `fn` through the cassette.
 * @param {string} kind        'asr' | 'llm' | 'tts' — namespaces the key
 * @param {object} keyParts    everything that determines the vendor's answer
 * @param {Function} fn        async () => value  — the live call
 * @param {object} [opts]      serialize(value)→JSON-safe · deserialize(stored)→value (Buffers etc.)
 */
async function wrap(kind, keyParts, fn, opts = {}) {
  const m = mode();
  if (m === 'off') return fn();
  const key = keyFor(kind, keyParts);
  const deser = opts.deserialize || (x => x);
  const ser = opts.serialize || (x => x);

  if (m === 'replay') {
    let rec = readLocal(key);
    if (!rec) { rec = await readR2(key); if (rec) { try { writeLocal(key, rec); } catch (_) {} } }
    if (rec && rec.value !== undefined) {
      _log('📼 e2e-cassette: replay hit', { kind, key: key.slice(0, 20), recordedAt: rec.recordedAt });
      return deser(rec.value);
    }
    _log('📼 e2e-cassette: replay MISS — going live and recording', { kind, key: key.slice(0, 20) });
  }

  const t0 = Date.now();
  const value = await fn();                       // a throw propagates; nothing is stored
  const record = { kind, key, recordedAt: new Date().toISOString(), liveMs: Date.now() - t0, request: requestForRecord(keyParts), value: ser(value) };
  try { writeLocal(key, record); } catch (e) { _log('⚠️ e2e-cassette: local write failed', { key, error: e.message }); }
  await writeR2(key, record);
  return value;
}

/** Wrap an OpenAI-SDK-shaped client so every non-streaming chat completion goes through the cassette. */
function wrapChatCompletions(client) {
  const original = client.chat.completions.create.bind(client.chat.completions);
  client.chat.completions.create = (params, options) => {
    if (!params || params.stream) return original(params, options);
    return wrap('llm', normaliseForKey(params), () => original(params, options));
  };
  return client;
}

/** wrap() for a function that returns a Buffer (or null): audio survives JSON as base64, and a
 *  null/undefined result is passed through without being recorded (a provider that returned
 *  nothing is not an answer worth replaying). */
async function wrapBuffer(kind, keyParts, fn) {
  const m = mode();
  if (m === 'off') return fn();
  const key = keyFor(kind, keyParts);
  if (m === 'replay') {
    let rec = readLocal(key);
    if (!rec) { rec = await readR2(key); if (rec) { try { writeLocal(key, rec); } catch (_) {} } }
    if (rec && typeof rec.b64 === 'string') {
      _log('📼 e2e-cassette: replay hit', { kind, key: key.slice(0, 20), recordedAt: rec.recordedAt });
      return Buffer.from(rec.b64, 'base64');
    }
    _log('📼 e2e-cassette: replay MISS — going live and recording', { kind, key: key.slice(0, 20) });
  }
  const t0 = Date.now();
  const buf = await fn();
  if (buf == null || !Buffer.isBuffer(buf) || buf.length === 0) return buf;
  const record = { kind, key, recordedAt: new Date().toISOString(), liveMs: Date.now() - t0, request: requestForRecord(keyParts), b64: buf.toString('base64') };
  try { writeLocal(key, record); } catch (e) { _log('⚠️ e2e-cassette: local write failed', { key, error: e.message }); }
  await writeR2(key, record);
  return buf;
}

/** Key parts for an audio file: its bytes, not its path (temp paths change every run). */
function audioKey(audioPath, extra) {
  let fileSha = null;
  try { fileSha = sha256(fs.readFileSync(audioPath)); } catch (_) { fileSha = 'unreadable:' + path.basename(audioPath); }
  return { fileSha, ...extra };
}

module.exports = { mode, keyFor, wrap, wrapBuffer, wrapChatCompletions, audioKey, normaliseForKey, requestForRecord, stable, sha256, dir, PROD_PROJECT_REFS };
