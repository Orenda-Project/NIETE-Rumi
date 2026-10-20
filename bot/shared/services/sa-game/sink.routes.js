'use strict';
/**
 * /api/internal/sagame/s/* — the big flight's sink (sink.js), mounted by routes.js behind the internal key; the edge
 * (dashboard/routes/sa-game.routes.js) forwards /api/sa-game/s/* here path for path. JSON in and out.
 *
 *   POST /session          { t, kid, part, form, lang?, n? } + x-wq-device   → { session_id, st }
 *   POST /batch            { st, session_id, seq_from, seq_to, events[], results[] } → { ok, acked_to }
 *   POST /audio/presign    { st, task_id, item_id?, mime, bytes }          → { url, key }
 *   POST /audio/register   { st, task_id, item_id?, key, bytes, duration_ms } → { ok }
 *   GET  /status?st=       → { status, tasks_done, last_seq }
 *
 * Switch sa_game off → 404 {off:true} before anything is read or parsed (the edge falls through). A body over 512 kB →
 * 413. Never a 500: a throw answers 503 {error:'unavailable'}.
 */
const express = require('express');
const { logToFile } = require('../../utils/logger');

const MAX_BODY = 512 * 1024;

function createSinkRouter({ sink = require('./sink'), flag = require('./flag') } = {}) {
  const router = express.Router();

  router.use(async (req, res, next) => {
    try {
      if (!(await flag.on())) return res.status(404).json({ off: true });
    } catch (_) {
      return res.status(404).json({ off: true });
    }
    if (req.method === 'POST' && Number(req.get('content-length') || 0) > MAX_BODY) return res.status(413).json({ error: 'too_large' });
    return next();
  });
  // a body the app's own parser already read is left as it is
  router.use(express.json({ limit: MAX_BODY }));

  const answer = (name, fn) => async (req, res) => {
    try {
      const out = await fn(req);
      return res.status(out.status).json(out.body);
    } catch (err) {
      logToFile('⚠️ sa game sink: unavailable', { op: name, error: err && String(err.message || err).slice(0, 160) });
      return res.status(503).json({ error: 'unavailable' });
    }
  };
  const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

  router.post('/session', answer('session', (req) => sink.session({ ...body(req), device: req.get('x-wq-device') || undefined })));
  router.post('/batch', answer('batch', (req) => sink.batch(body(req))));
  router.post('/audio/presign', answer('presign', (req) => sink.presign(body(req))));
  router.post('/audio/register', answer('register', (req) => sink.register(body(req))));
  router.get('/status', answer('status', (req) => sink.status({ st: typeof req.query.st === 'string' ? req.query.st : null })));

  // the parser's own refusals: too large → 413, not JSON → 400; anything else → 503
  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) return res.status(413).json({ error: 'too_large' });
    if (err && (err.type === 'entity.parse.failed' || err.status === 400)) return res.status(400).json({ error: 'bad_json' });
    return res.status(503).json({ error: 'unavailable' });
  });
  return router;
}

module.exports = { createSinkRouter, MAX_BODY };
