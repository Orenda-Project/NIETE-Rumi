'use strict';
/**
 * bd-s0ccn5.2.3 — GET /fln/plan/:id/pdf → { url }: a presigned link to the plan's pre-rendered PDF (text and
 * pictures; a PDF cannot play sound). Same gate and rules as the plan route: no-store, 404 for a malformed, unknown
 * or hidden plan, 503 while the corpus loads. 404 too when no PDF was rendered for this corpus version, so the
 * app shows its button only when a download will work. Hands out a link only: no open is recorded and no feedback
 * or lesson_plans row is written.
 */
const express = require('express');
const { requireFln } = require('../lib/fln-access');
const Corpus = require('../services/fln-corpus.service');
const PdfSign = require('../services/fln-pdf-sign');

const ID_RX = /^\d{1,9}$/;
const VER_RX = /^[A-Za-z0-9._-]{1,64}$/;

function createFlnPdfRouter({ corpus = Corpus, sign = PdfSign } = {}) {
  const router = express.Router();
  router.get('/fln/plan/:id/pdf', ...requireFln.lessons, async (req, res) => {
    const id = String(req.params.id || '');
    if (!ID_RX.test(id)) return res.status(404).json({ error: 'not_found' });
    if (!(await corpus.ensure())) return res.status(503).json({ error: 'unavailable' });
    if (!corpus.plan(id) || corpus.isHidden(id)) return res.status(404).json({ error: 'not_found' });
    const version = String(corpus.version() || '');
    if (!VER_RX.test(version) || version.includes('..')) return res.status(404).json({ error: 'not_found' });
    const url = await sign.pdfUrl(`fln/pdf/${version}/${id}.pdf`, `FLN lesson ${id}.pdf`);
    if (!url) return res.status(404).json({ error: 'not_found' });
    return res.json({ url });
  });
  return router;
}

module.exports = { createFlnPdfRouter };
