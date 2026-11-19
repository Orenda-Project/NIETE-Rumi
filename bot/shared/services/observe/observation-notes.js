'use strict';

/**
 * bd-ra8xu.60 — Observation Notes: what the coach saw in the room, typed during an /observe visit on FICO17 v6.
 *
 * Phase 1 is an experiment (queue #127, operator 13 Nov): the notes are kept, shown back to the coach on her review,
 * and given to a SECOND Digital Coach scoring that is stored only. They change nothing the teacher sees and nothing the
 * review is pre-filled with; that is Phase 2, if the numbers say so.
 *
 * Where they are kept (no new table or column, Rule 15), on the visit's coaching_sessions row:
 *   analysis_data.observation_notes                    [{ id, text, typed_at, rec_time, source, typed_before_review, batch }]
 *       id                  n1, n2 … in the order they were saved (the informed prompt cites them by it)
 *       rec_time            the recording clock when it was typed (portal Record), else null
 *       source              'whatsapp' (the notes Flow) | 'portal_record' | 'portal_check'
 *       typed_before_review true while the coach had not yet opened Rumi's review form: the clean comparison uses
 *                           only these, since a note typed after seeing Rumi's levels is shaped by them
 *       batch               one save (a Flow reply's message id, a portal upload): a save delivered twice adds once
 *   analysis_data.observation_notes_review_opened_at   when the review form was first opened (WhatsApp INIT, portal)
 *   analysis_data.dc_informed                          the informed scoring (fico17-v6/informed.js), stored only
 *
 * Every write is fico17-v6/late-write.js patchSession (a read-modify-write guarded by updated_at), so a writer that got
 * in between is never overwritten; the whole-blob writers (the analysis step, the review submit) carry these keys
 * over from a fresh read (carry()).
 */

const { logToFile } = require('../../utils/logger');

const NOTE_CAP = 600;
const MAX_NOTES = 40;
const INTRO_CAP = 1500;
const SOURCES = ['whatsapp', 'portal_record', 'portal_check'];
const REVIEW_KEY = 'observation_notes_review_opened_at';
const NOTES_KEY = 'observation_notes';
const INFORMED_KEY = 'dc_informed';
const CARRY_KEYS = [NOTES_KEY, REVIEW_KEY, INFORMED_KEY];
const REC_TIME_RE = /^\d{1,3}:\d{2}$/;

const clip = (s, n) => Array.from(String(s || '')).slice(0, n).join('');
const isoOr = (v, now) => {
  const d = typeof v === 'string' ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : now.toISOString();
};
const mmss = (seconds) => {
  const s = Math.max(0, Math.floor(Number(seconds)));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** A box of text (the WhatsApp Flow) as notes: one per line, blank lines dropped, each capped. */
function notesFromText(text, { source = 'whatsapp', now = new Date() } = {}) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_NOTES)
    .map((l) => ({ text: clip(l, NOTE_CAP), rec_time: null, source, typed_at: now.toISOString() }));
}

/**
 * Notes as the portal sends them with an upload: [{ text, rec_time 'MM:SS' | recTime seconds, source, typed_at }].
 * Anything that is not a note with text is dropped; the source is one the portal can be; at most MAX_NOTES.
 */
function fromClient(raw, { now = new Date() } = {}) {
  const out = [];
  for (const n of Array.isArray(raw) ? raw : []) {
    if (!n || typeof n !== 'object' || typeof n.text !== 'string' || !n.text.trim()) continue;
    let rec = null;
    if (typeof n.rec_time === 'string' && REC_TIME_RE.test(n.rec_time)) rec = n.rec_time;
    else if (Number.isFinite(Number(n.recTime)) && n.recTime !== null && n.recTime !== '') rec = mmss(n.recTime);
    out.push({
      text: clip(n.text.trim(), NOTE_CAP),
      rec_time: rec,
      source: ['portal_record', 'portal_check'].includes(n.source) ? n.source : 'portal_check',
      typed_at: isoOr(n.typed_at, now),
    });
    if (out.length >= MAX_NOTES) break;
  }
  return out;
}

const notesOf = (analysis) => (Array.isArray((analysis || {})[NOTES_KEY]) ? analysis[NOTES_KEY] : []);

/** The patchSession step that appends one save's notes (once per batch). */
function appendStep(notes, batch) {
  return (analysis) => {
    const existing = notesOf(analysis);
    if (existing.some((n) => n && n.batch === batch)) return { done: true };
    const room = MAX_NOTES - existing.length;
    if (room <= 0) return { stop: 'full' };
    const before = !analysis[REVIEW_KEY];
    const added = notes.slice(0, room).map((n, i) => ({
      id: `n${existing.length + i + 1}`,
      text: n.text,
      typed_at: n.typed_at,
      rec_time: n.rec_time || null,
      source: SOURCES.includes(n.source) ? n.source : 'whatsapp',
      typed_before_review: before,
      batch,
    }));
    return { next: { ...analysis, [NOTES_KEY]: [...existing, ...added] } };
  };
}

const instant = () => Promise.resolve();

/**
 * Save notes on a visit. The first passes run back to back (the coach is told at once whether they were saved); then,
 * unless `quick`, the normal passes run in the background so a whole-blob writer that read before this write and wrote
 * after it cannot lose them.
 * @returns {Promise<{ok: boolean, added: number, why?: string}>}
 */
async function addNotes(sessionId, notes, { batch, quick = false } = {}) {
  const list = Array.isArray(notes) ? notes.filter((n) => n && n.text) : [];
  if (!sessionId || !list.length) return { ok: false, added: 0, why: 'nothing to save' };
  const { patchSession } = require('../coaching/frameworks/fico17-v6/late-write');
  const key = batch || `b:${Date.now()}`;
  const step = appendStep(list, key);
  const out = await patchSession(sessionId, step, { sleep: instant, label: 'observation notes' });
  if (!quick && out.ok) {
    patchSession(sessionId, step, { label: 'observation notes (confirm)' }).catch(() => null);
  }
  return { ok: out.ok, added: out.written ? Math.min(list.length, MAX_NOTES) : 0, ...(out.ok ? {} : { why: out.why }) };
}

/** Stamp the first time the coach opened Rumi's review form. Never throws. */
async function markReviewOpened(sessionId, { now = new Date(), quick = false } = {}) {
  if (!sessionId) return { ok: false };
  try {
    const { patchSession } = require('../coaching/frameworks/fico17-v6/late-write');
    const at = now.toISOString();
    return await patchSession(sessionId, (analysis) => (analysis[REVIEW_KEY] ? { done: true } : { next: { ...analysis, [REVIEW_KEY]: at } }),
      { label: 'observation notes: review opened', ...(quick ? { sleep: instant } : {}) });
  } catch (err) {
    logToFile('observation-notes: review-opened stamp failed', { sessionId, error: err.message }, 'warn');
    return { ok: false };
  }
}

/** The Observation Notes keys of a fresh analysis_data, for a writer that replaces the whole blob. */
function carry(fresh) {
  const out = {};
  if (!fresh || typeof fresh !== 'object') return out;
  for (const k of CARRY_KEYS) if (fresh[k] !== undefined && fresh[k] !== null) out[k] = fresh[k];
  return out;
}

const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const urduClock = (t) => `⁦${String(t).replace(/[0-9]/g, (d) => URDU_DIGITS[Number(d)])}⁩`;

/**
 * The coach's notes as a review intro screen shows them: one per line, word for word, the recording clock first when
 * there is one (Urdu digits, isolated, in Urdu). Cut to fit one screen ('…' when cut). '' when there are none.
 */
function introText(analysis, lang = 'en') {
  const lines = notesOf(analysis)
    .filter((n) => n && typeof n.text === 'string' && n.text.trim())
    .map((n) => {
      const t = n.rec_time && REC_TIME_RE.test(n.rec_time) ? `${lang === 'ur' ? urduClock(n.rec_time) : n.rec_time}  ` : '';
      return `${t}${n.text.trim()}`;
    });
  let out = '';
  for (const l of lines) {
    const next = out ? `${out}\n${l}` : l;
    if (Array.from(next).length > INTRO_CAP - 1) {
      out = `${Array.from(out || l).slice(0, INTRO_CAP - 1).join('').trimEnd()}…`;
      return out;
    }
    out = next;
  }
  return out;
}

module.exports = {
  NOTE_CAP, MAX_NOTES, INTRO_CAP, SOURCES, REVIEW_KEY, NOTES_KEY, INFORMED_KEY, CARRY_KEYS,
  notesFromText, fromClient, notesOf, addNotes, markReviewOpened, carry, introText,
};
