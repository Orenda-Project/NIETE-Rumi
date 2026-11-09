// KNOWN DESIGN DEBT (Nov 2026): lesson plans are spread over ~20 tables, one set per product generation
// (K-5 v8/v9, 6-12, GB, legacy). Do NOT add another per-region or per-generation LP table, cache or env
// flag: extend the existing table with the book as the separator, say so in the PR, and ask the operator
// (Hataf) before any new LP table.
// Here: niete_gb_lp_renders is a copy of niete_lp612_renders (same FK, same unique key); it merges back first.
// Why, target model, follow-up (audit planned): docs/lesson-plan-data-model-debt.md
'use strict';
/**
 * gb_lp_author — a GB lesson nobody pregenerated, written at runtime (bd-rj6w0n.14.16.12).
 *
 * Queued by gb-lp-serving.service's requestLesson on a miss (LP_GB_AUTHOR_ENABLED=true). It runs the SAME
 * author (lp612-author.service) and renderer (lp612-render.service) as ICT's 6-12 worker, with the same
 * model, rounds and clock, so a GB lesson takes no longer than an ICT one. Only the storage is GB's own:
 * rows in niete_gb_lp_renders, objects under gb-lp/, waiters through gb_lp_claim_waiters. It never reads
 * or writes niete_lp612_renders or lp612/.
 *
 * Rules carried over from lp612-author.worker:
 *   - SQS is at-least-once: only a row still `authoring`, and only the delivery that stamps picked_up_at.
 *   - A lesson is never lost for being long or for a layout defect (deliveryVerdict); TRUNCATION fails.
 *   - A picture that fails to arrive never holds the lesson back: the page keeps its book-reference card.
 *   - Status first, then claim the waiters, so a teacher tapping mid-flip is re-decided, never dropped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const supabase = require('../shared/config/supabase');
const { logToFile } = require('../shared/utils/logger');
const { logEvent } = require('../shared/utils/structured-logger');
const WhatsAppService = require('../shared/services/whatsapp.service');
const { uploadBuffer } = require('../shared/storage/r2');
const { resolveUx } = require('../shared/config/ux-strings');
const { authorLessonPlan } = require('../shared/services/lp612-author.service');
const { renderLessonPlan } = require('../shared/services/lp612-render.service');
const { deliveryVerdict } = require('../shared/services/lp612-render-policy.service');
const { refsFromDoc, stageFigures } = require('../shared/services/lp612-pagetruth.service');
const { resolveAuthorModel, authorRounds, authorTimeoutMs } = require('../shared/config/lp612-flags');
const { familyForBook } = require('../shared/config/lp612-families');
const GbLane = require('../shared/services/gb-lp-serving.service');

const RENDERS = GbLane.RENDERS;
const SEGMENTS = 'niete_lp612_segments';
const nowIso = () => new Date().toISOString();

async function loadRender(renderId) {
  const { data, error } = await supabase.from(RENDERS).select('id, status, waiters').eq('id', renderId).maybeSingle();
  if (error) logToFile('LP GB worker: render lookup failed', { renderId, error: error.message });
  return data || null;
}

/** One statement: stamp the pickup only on a row still `authoring`. True if this delivery owns the run. */
async function claimPickup(renderId) {
  const { data, error } = await supabase.from(RENDERS)
    .update({ picked_up_at: nowIso(), updated_at: nowIso() })
    .eq('id', renderId).eq('status', 'authoring').select('id').maybeSingle();
  if (error) {
    logToFile('LP GB worker: could not stamp pickup', { renderId, error: error.message });
    return true;
  }
  return Array.isArray(data) ? data.length > 0 : !!data;
}

async function loadSegment(segmentId) {
  const { data, error } = await supabase.from(SEGMENTS).select('*').eq('segment_id', segmentId).maybeSingle();
  if (error) logToFile('LP GB worker: segment lookup failed', { segmentId, error: error.message });
  return data || null;
}

async function patch(renderId, fields) {
  const { error } = await supabase.from(RENDERS).update({ ...fields, updated_at: nowIso() }).eq('id', renderId);
  if (error) logToFile('LP GB worker: row update failed', { renderId, error: error.message }, 'error');
}

const waitersOf = (w) => (Array.isArray(w) ? w : []);

/** Take the audience off the row atomically. Call only AFTER the terminal status is written. */
async function claimWaiters(renderId, fallback) {
  const { data, error } = await supabase.rpc('gb_lp_claim_waiters', { p_render_id: renderId });
  if (error) {
    logToFile('LP GB worker: could not claim the waiter list', { renderId, error: error.message });
    return fallback;
  }
  return waitersOf(data);
}

async function tellAll(waiters, key, lang) {
  for (const w of waiters) {
    if (!w.phone) continue;
    try {
      const ok = await WhatsAppService.sendMessage(w.phone, resolveUx(key, { language: w.ui_lang || lang }));
      if (ok) logEvent('gb_lp.send.sent', { kind: 'text', uxKey: key, userId: w.user_id || null });
    } catch (err) {
      logToFile('LP GB worker: could not message waiter', { key, error: err.message });
    }
  }
}

async function fail(renderId, snapshot, lang, code, detail, model = null) {
  await patch(renderId, {
    status: 'failed', error_code: code || 'UNKNOWN', error_detail: String(detail || '').slice(0, 2000),
    ...(model ? { model_used: model } : {}), completed_at: nowIso(),
  });
  await tellAll(await claimWaiters(renderId, snapshot), 'lp612Failed', lang);
  logEvent('gb_lp.author.failed', { renderId, code: code || 'UNKNOWN' });
  return { status: 'failed', errorCode: code || 'UNKNOWN' };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`GB authoring exceeded ${ms}ms`), { code: 'AUTHOR_TIMEOUT' })), ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Render for delivery; a PDF that is only long or only uglier is still delivered (lp612's rule). */
async function renderForDelivery(args) {
  try {
    return { rendered: await renderLessonPlan(args), degraded: false };
  } catch (e) {
    const hasPdf = typeof e.pdfPath === 'string' && e.pdfPath.length > 0;
    const verdict = deliveryVerdict(e && e.problems, { hasPdf, infra: e && e.infra });
    if (!verdict.deliverable || !Array.isArray(e.problems) || e.problems.length === 0) throw e;
    return { rendered: { pdfPath: e.pdfPath, pageCount: e.pageCount ?? null }, degraded: true, problems: e.problems };
  }
}

async function process(payload) {
  const { renderId, segmentId, lang, templateVersion, correlationId } = payload || {};
  const startedAt = Date.now();

  const render = await loadRender(renderId);
  if (!render) return { status: 'skipped', reason: 'render_missing' };
  if (render.status !== 'authoring') return { status: 'skipped', reason: `status_${render.status}` };
  if (!await claimPickup(renderId)) return { status: 'skipped', reason: 'pickup_lost' };
  const snapshot = waitersOf(render.waiters);

  const segment = await loadSegment(segmentId);
  if (!segment) return fail(renderId, snapshot, lang, 'SEGMENT_MISSING', `segment ${segmentId} not found`);

  const model = resolveAuthorModel(familyForBook(segment.book_stem));
  let tmpDir;
  try {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gb-lp-'));
    const { authored, rendered, degraded, problems } = await withTimeout((async () => {
      const authored = await authorLessonPlan({ segment, lang, model, rounds: authorRounds(), correlationId });
      const refs = refsFromDoc(authored.lpDoc);
      if (refs.length) {
        // A missing picture never holds the lesson back: the page falls back to its book-reference card.
        try {
          await stageFigures({ refs, outDir: tmpDir, correlationId, segmentId, renderId });
        } catch (err) {
          logToFile('LP GB worker: pictures did not arrive, sending without them', { renderId, error: err.message }, 'warn');
        }
      }
      const out = await renderForDelivery({
        lpDoc: authored.lpDoc, lang, stem: segmentId.replace(/[^A-Za-z0-9._-]/g, '_'),
        outDir: tmpDir, correlationId, segmentId, renderId, phase: 'final',
      });
      return { authored, ...out };
    })(), authorTimeoutMs());

    const r2Key = GbLane.assertGbKey(GbLane.keyFor(segmentId, lang, templateVersion));
    await uploadBuffer(await fs.promises.readFile(rendered.pdfPath), r2Key, 'application/pdf');
    try {
      const docKey = GbLane.assertGbKey(GbLane.keyFor(segmentId, lang, templateVersion, 'lp.json'));
      await uploadBuffer(Buffer.from(JSON.stringify(authored.lpDoc, null, 1), 'utf8'), docKey, 'application/json');
    } catch (err) {
      logToFile('LP GB worker: could not store the authored document', { renderId, error: err.message });
    }

    const readyAt = nowIso();
    await patch(renderId, {
      status: 'ready', r2_key: r2Key, page_count: rendered.pageCount ?? null, model_used: authored.model || model,
      lint_fails: degraded ? problems : null, timings: { total_ms: Date.now() - startedAt }, completed_at: readyAt,
    });

    const waiters = await claimWaiters(renderId, snapshot);
    let delivered = 0;
    for (const w of waiters) {
      if (!w.phone) continue;
      try {
        await GbLane.deliver({
          phone: w.phone, userId: w.user_id, r2Key, segment, lang,
          askedAt: w.asked_at, generatedAt: readyAt, correlationId: w.correlation_id,
        });
        delivered += 1;
      } catch (err) {
        logToFile('LP GB worker: delivery to a waiter failed', { renderId, error: err.message }, 'error');
        await tellAll([w], 'lp612Failed', lang);
      }
    }
    logEvent('gb_lp.author.ready', {
      renderId, segmentId, lang, templateVersion, degraded, delivered, ms: Date.now() - startedAt, correlationId,
    });
    return { status: 'ready', r2Key, delivered };
  } catch (err) {
    logToFile('LP GB worker: authoring failed', { renderId, segmentId, code: err.code, error: err.message }, 'error');
    return fail(renderId, snapshot, lang, err.code || 'AUTHOR_FAILED', err.message, model);
  } finally {
    if (tmpDir) fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { process };
