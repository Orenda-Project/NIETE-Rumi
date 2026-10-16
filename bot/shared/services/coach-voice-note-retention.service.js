'use strict';
/**
 * bd-v0toag.67: a teacher's voice note for her coach (v10 coaching test, kept in R2 at
 * coach-visit-notes/<request id>.<ext> by dashboard/services/coach-visit-request.js) is deleted 30 days after
 * it was saved, when the coach has not marked the visit done first ("I have visited" still deletes it at once).
 *
 * The note is put straight after its row is inserted, so the row's created_at is when the note was saved.
 * Bounded (oldest first, `limit` per run) and idempotent: the key is nulled only after R2 confirms the delete,
 * and only while it still holds the key that was deleted, so a failed delete is retried on the next run and
 * concurrent runs on two replicas cannot clobber each other. Never throws; returns counts.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

// Each real module is loaded only when the caller did not hand one in, so a test that fakes the boundaries
// never boots the Supabase client.
const DEFAULTS = {
  supabase: () => require('../config/supabase'),
  deleteKey: () => require('../storage/r2').deleteKey,
  logToFile: () => require('../utils/logger').logToFile,
  logEvent: () => require('../utils/structured-logger').logEvent,
  correlationId: () => require('../utils/structured-logger').generateCorrelationId,
};
const resolve = (deps) => Object.fromEntries(Object.entries(DEFAULTS).map(([k, load]) => [k, deps[k] || load()]));

async function sweepExpiredVoiceNotes({ maxAgeDays = 30, limit = 200, now = Date.now(), deps = {} } = {}) {
  const d = resolve(deps);
  const correlationId = d.correlationId();
  const out = { checked: 0, deleted: 0, failed: 0 };
  try {
    const cutoff = new Date(now - maxAgeDays * DAY_MS).toISOString();
    const { data, error } = await d.supabase.from('coach_visit_requests')
      .select('id, voice_note_key')
      .not('voice_note_key', 'is', null)
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) {
      d.logToFile('⚠️ coach voice-note sweep: read failed', { error: error.message, correlationId }, 'error');
      return out;
    }
    for (const row of data || []) {
      out.checked += 1;
      let gone = false;
      try { gone = await d.deleteKey(row.voice_note_key); } catch (_) { gone = false; }
      if (!gone) { out.failed += 1; continue; }
      const { error: upErr } = await d.supabase.from('coach_visit_requests')
        .update({ voice_note_key: null, updated_at: new Date(now).toISOString() })
        .eq('id', row.id)
        .eq('voice_note_key', row.voice_note_key);
      if (upErr) {
        out.failed += 1;
        d.logToFile('⚠️ coach voice-note sweep: key not nulled', { requestId: row.id, error: upErr.message, correlationId }, 'error');
      } else {
        out.deleted += 1;
      }
    }
  } catch (e) {
    d.logToFile('⚠️ coach voice-note sweep threw', { error: e && e.message, correlationId }, 'error');
  }
  d.logEvent('coach_visit.voice_notes_swept', { ...out, maxAgeDays, correlationId });
  return out;
}

module.exports = { sweepExpiredVoiceNotes };
