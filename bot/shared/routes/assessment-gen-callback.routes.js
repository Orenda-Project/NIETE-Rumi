'use strict';
/**
 * Assessment Generator callback endpoint.
 *
 *   POST /webhooks/assessment-generator
 *
 * The UG_EG service POSTs here when an async /api/v2/generate-exam job
 * finishes (~45–60s after submission). We:
 *   1. Parse the callback body (completed / failed).
 *   2. Look up the teacher via the job link stored at submit time (Redis).
 *   3. Render data.exam_paper (HTML) → PDF via htmlToPdf.
 *   4. Upload the PDF to R2 and send via WhatsApp sendDocumentFromUrl.
 *
 * Auth: this endpoint takes the callback verbatim. UG_EG only sends to URLs it
 * was configured with, and the callback contains the job_id which we cross-check
 * against Redis. Any callback whose job_id we don't recognise is ack'd + logged
 * (so UG_EG doesn't retry forever) but nothing is delivered.
 */

const express = require('express');
const { logToFile } = require('../utils/logger');
const { runWithCorrelation, generateCorrelationId } = require('../utils/structured-logger');
const AssessmentGenClient = require('../services/assessment-generator-client.service');
const {
  _readJobLink,
  _clearJobLink,
} = require('./assessment-gen-endpoint');
const supabase = require('../config/supabase');
const WhatsAppService = require('../services/whatsapp.service');
const { htmlToPdf } = require('../utils/html-to-pdf');
const r2 = require('../storage/r2');

const router = express.Router();

router.post('/assessment-generator', async (req, res) => {
  const correlationId = generateCorrelationId();
  return runWithCorrelation(correlationId, async () => {
    // Ack immediately — do the heavy work off the callback thread. UG_EG only
    // needs a 2xx to consider the callback delivered; retrying costs us + them.
    let parsed;
    try {
      parsed = AssessmentGenClient.parseCallback(req.body || {});
    } catch (err) {
      logToFile('[assessment-gen-cb] parse failed', { err: err.message });
      return res.status(400).json({ error: 'invalid callback body' });
    }

    logToFile('[assessment-gen-cb] callback received', {
      status: parsed.status,
      jobId: parsed.jobId,
    });

    // Ack right away.
    res.status(200).json({ ok: true });

    // Fire-and-forget delivery.
    setImmediate(() => _deliver(parsed).catch((err) => {
      logToFile('[assessment-gen-cb] deliver crashed', { err: err.message, stack: err.stack });
    }));
  });
});

async function _deliver(parsed) {
  if (!parsed || !parsed.jobId) {
    logToFile('[assessment-gen-cb] no jobId in callback — dropping');
    return;
  }

  const link = await _readJobLink(parsed.jobId);
  if (!link || !link.userId) {
    logToFile('[assessment-gen-cb] no job link found — dropping', { jobId: parsed.jobId });
    return;
  }

  // Load teacher phone.
  const { data: user, error } = await supabase
    .from('users')
    .select('phone_number, preferred_language')
    .eq('id', link.userId)
    .single();
  if (error || !user || !user.phone_number) {
    logToFile('[assessment-gen-cb] user lookup failed', {
      jobId: parsed.jobId, userId: link.userId, err: error?.message,
    });
    return;
  }
  const phone = user.phone_number;

  if (parsed.status === 'failed') {
    logToFile('[assessment-gen-cb] generation failed', {
      jobId: parsed.jobId, error: parsed.error,
    });
    await WhatsAppService.sendMessage(
      phone,
      "Sorry — we couldn't build that assessment. Please try /assessment again in a minute.",
    );
    await _clearJobLink(parsed.jobId);
    return;
  }

  if (parsed.status !== 'completed' || !parsed.data) {
    logToFile('[assessment-gen-cb] unexpected status', { status: parsed.status, jobId: parsed.jobId });
    return;
  }

  const examHtml = parsed.data.exam_paper;
  if (!examHtml || typeof examHtml !== 'string') {
    logToFile('[assessment-gen-cb] missing exam_paper HTML in callback', { jobId: parsed.jobId });
    await WhatsAppService.sendMessage(
      phone,
      "Sorry — the assessment came back empty. Please try /assessment again.",
    );
    await _clearJobLink(parsed.jobId);
    return;
  }

  // Render HTML → PDF.
  let pdfBuffer;
  try {
    pdfBuffer = await htmlToPdf(examHtml, { timeout: 45000 });
  } catch (err) {
    logToFile('[assessment-gen-cb] htmlToPdf failed', { jobId: parsed.jobId, err: err.message });
    await WhatsAppService.sendMessage(
      phone,
      "Sorry — we couldn't render your assessment PDF. Please try again.",
    );
    return;
  }

  // Upload to R2. Reuse the exam buffer helper (buckets exams by userId).
  let key;
  try {
    const filename = `assessment-${link.jobId}.pdf`;
    key = await r2.uploadExamBuffer({
      buffer: pdfBuffer,
      userId: link.userId,
      examId: parsed.jobId,
      filename,
    });
  } catch (err) {
    logToFile('[assessment-gen-cb] R2 upload failed', { jobId: parsed.jobId, err: err.message });
    await WhatsAppService.sendMessage(
      phone,
      "Sorry — we couldn't save your assessment file. Please try again.",
    );
    return;
  }

  // Build a public URL for WhatsApp document delivery.
  const publicUrl = _publicUrlForKey(key);

  const grade = link.grade;
  const subject = link.subject;
  const filename = `Grade${grade}_${_subjectFileTag(subject)}_${link.generationType === 'class_assessment' ? 'Practice' : 'Exam'}.pdf`;
  const caption = `Grade ${grade} ${subject} — ${link.generationType === 'class_assessment' ? 'classroom practice' : 'exam'} · Pages ${link.pageRanges}`;

  try {
    const okReady = await WhatsAppService.sendMessage(phone, 'Your assessment is ready 👇');
    const okDoc = await WhatsAppService.sendDocumentFromUrl(phone, publicUrl, filename, caption);
    if (!okReady || !okDoc) {
      logToFile('[assessment-gen-cb] delivery returned false', {
        jobId: parsed.jobId, okReady, okDoc, phone,
      });
    } else {
      logToFile('[assessment-gen-cb] delivered ok', { jobId: parsed.jobId, key, phone });
    }
  } catch (err) {
    logToFile('[assessment-gen-cb] deliver threw', { jobId: parsed.jobId, err: err.message });
  }

  await _clearJobLink(parsed.jobId);
}

/**
 * R2 keys are internal; construct the public URL that WhatsApp can fetch.
 * Prefer the presign helper for private buckets; fall back to the R2 public
 * endpoint if configured.
 */
function _publicUrlForKey(key) {
  // The existing storage/r2 module exports getPresignedUrl for full URLs. Here
  // we have a bare key — build the private URL first, then presign.
  const endpoint = process.env.R2_ENDPOINT || '';
  const bucket = process.env.R2_BUCKET_NAME || '';
  if (!endpoint || !bucket) {
    // Fall back to whatever the storage module thinks is public.
    return `https://${bucket}.r2.dev/${key}`;
  }
  return `${endpoint.replace(/\/+$/, '')}/${bucket}/${key}`;
}

function _subjectFileTag(subject) {
  return String(subject || 'Subject').replace(/[^A-Za-z0-9]/g, '');
}

module.exports = router;
module.exports._deliver = _deliver; // exported for tests
