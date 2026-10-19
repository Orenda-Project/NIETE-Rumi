'use strict';
/**
 * Live moves (bd-v0toag.31): the record the live screen sends with her upload, stored as
 * coaching_sessions.analysis_data.live_moves. Only the named fields are kept; a malformed
 * record is DROPPED (the caller logs it at warn), never refused — the recording is the valuable part.
 */

const MAX_MOVES = 60;
const MAX_TAPS = 200;
const CHOICES = new Set(['did', 'did_not']);
const LIVE_STATES = new Set(['ticked', 'unticked']);

const idx = (v) => Number.isInteger(v) && v >= 0;
const text = (v) => typeof v === 'string' && v.trim() !== '';
const count = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function validTap(t) {
  return Boolean(t) && idx(t.idx) && CHOICES.has(t.choice) && typeof t.at === 'string' && LIVE_STATES.has(t.live_state);
}

function validMove(m) {
  return Boolean(m) && idx(m.idx) && Array.isArray(m.covers) && m.covers.every((c) => typeof c === 'string')
    && (m.tickedAtMs === null || count(m.tickedAtMs));
}

/** → { record } (null when none was sent) | { bad: reason } */
function liveRecord(raw) {
  if (raw == null) return { record: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { bad: 'not an object' };
  if (!text(raw.lessonId) || !text(raw.liveId)) return { bad: 'lessonId or liveId missing' };
  if (!Array.isArray(raw.moves) || raw.moves.length > MAX_MOVES || !raw.moves.every(validMove)) return { bad: 'moves' };
  if (!Array.isArray(raw.taps)) return { bad: 'taps' };
  if (!count(raw.drops) || !count(raw.bytesSent)) return { bad: 'counters' };
  return {
    record: {
      lessonId: raw.lessonId,
      stamp: typeof raw.stamp === 'string' ? raw.stamp : null,
      liveId: raw.liveId,
      moves: raw.moves.map((m) => ({ idx: m.idx, covers: m.covers, tickedAtMs: m.tickedAtMs })),
      taps: raw.taps.filter(validTap).slice(-MAX_TAPS)
        .map((t) => ({ idx: t.idx, choice: t.choice, at: t.at, live_state: t.live_state })),
      drops: raw.drops,
      bytesSent: raw.bytesSent,
    },
  };
}

module.exports = { liveRecord, validTap, MAX_MOVES, MAX_TAPS };
