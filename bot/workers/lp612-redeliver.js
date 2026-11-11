'use strict';
/**
 * bd-s8mi25 — finish a delivery that a dead container left half done.
 *
 * Called by the worker when SQS redelivers a job whose render is already `ready`. Reads who the
 * first run claimed (lp612-owed.store), skips everyone the deliveries ledger says already has this
 * render, and sends the rest the stored PDF exactly as the first run would have. A teacher who got
 * the summary text before the kill gets it again with the PDF — a repeat line beats a missing file.
 *
 * Returns null when nothing is remembered, so the caller skips exactly as it always has.
 */

const supabase = require('../shared/config/supabase');
const { logToFile } = require('../shared/utils/logger');
const Serving = require('../shared/services/lp612-serving.service');
const Deliveries = require('../shared/services/lp612-deliveries.store');
const Owed = require('../shared/services/lp612-owed.store');

const ROW_COLUMNS = 'id, status, segment_id, r2_key, one_screen, overlay_dropped, render_degraded';

async function redeliverOwed({ renderId, segmentId, lang, templateVersion, correlationId }, { loadSegment }) {
  const owed = await Owed.recall(renderId);
  if (owed.length === 0) return null;

  const { data: row, error } = await supabase
    .from('niete_lp612_renders').select(ROW_COLUMNS).eq('id', renderId).maybeSingle();
  const segment = row && row.r2_key ? await loadSegment(row.segment_id || segmentId) : null;
  if (error || !row || !row.r2_key || !segment) {
    // Keep the memory: the next redelivery may read what this one could not.
    logToFile('LP 6-12 worker: owed teachers remembered but the lesson could not be loaded', {
      renderId, error: error && error.message, correlationId,
    });
    return { status: 'redeliver_unavailable', owed: owed.length };
  }

  const out = { status: 'redelivered', delivered: 0, deliveryFailures: 0, alreadyHad: 0, selfServe: 0 };
  for (const w of owed) {
    // eslint-disable-next-line no-await-in-loop
    if (w.user_id && await Deliveries.claimsRender(renderId, w.user_id)) { out.alreadyHad += 1; continue; }
    if (!w.phone) {
      out.selfServe += 1;
      if (w.surface === 'portal' && w.user_id) {
        // eslint-disable-next-line no-await-in-loop
        await Deliveries.record({
          userId: w.user_id, renderId, segmentId: segment.segment_id, lang, templateVersion, surface: 'portal',
        });
      }
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await Serving.deliverRender({
        phone: w.phone,
        userId: w.user_id,
        r2Key: row.r2_key,
        segment,
        lang,
        oneScreen: row.one_screen,
        overlayDropped: row.overlay_dropped === true,
        renderDegraded: row.render_degraded === true,
        renderId,
        askedAt: w.requested_at,
        correlationId: w.correlation_id,
      });
      out.delivered += 1;
    } catch (err) {
      out.deliveryFailures += 1;
      logToFile('LP 6-12 worker: redelivery failed for one waiter', { renderId, error: err.message, correlationId });
    }
  }
  await Owed.forget(renderId);
  logToFile('LP 6-12 worker: finished a delivery a dead run left half done', { renderId, ...out, correlationId });
  return out;
}

module.exports = { redeliverOwed };
