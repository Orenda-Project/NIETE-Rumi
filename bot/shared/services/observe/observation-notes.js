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
function appendStep(notes, batch, seen = {}) {
  return (analysis) => {
    const existing = notesOf(analysis);
    if (existing.some((n) => n && n.batch === batch)) return { done: true };
    const room = MAX_NOTES - existing.length;
    if (room <= 0) return { stop: 'full' };
    const before = !analysis[REVIEW_KEY];
    seen.before = before; // eslint-disable-line no-param-reassign
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
 * @returns {Promise<{ok: boolean, added: number, before?: boolean, why?: string}>}  before: saved before the review opened
 */
async function addNotes(sessionId, notes, { batch, quick = false } = {}) {
  const list = Array.isArray(notes) ? notes.filter((n) => n && n.text) : [];
  if (!sessionId || !list.length) return { ok: false, added: 0, why: 'nothing to save' };
  const { patchSession } = require('../coaching/frameworks/fico17-v6/late-write');
  const key = batch || `b:${Date.now()}`;
  const seen = {};
  const step = appendStep(list, key, seen);
  const out = await patchSession(sessionId, step, { sleep: instant, label: 'observation notes' });
  if (!quick && out.ok) {
    patchSession(sessionId, appendStep(list, key), { label: 'observation notes (confirm)' }).catch(() => null);
  }
  return {
    ok: out.ok,
    added: out.written ? Math.min(list.length, MAX_NOTES) : 0,
    ...(seen.before !== undefined ? { before: seen.before } : {}),
    ...(out.ok ? {} : { why: out.why }),
  };
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

// ── WhatsApp: the Observation Notes Flow ────────────────────────────────────
// One screen (docs/flows/observe-notes.json, published per rung, its id in OBSERVE_NOTES_FLOW_ID), opened in navigate
// mode with every word as screen data in the coach's language, so one Flow serves English and Urdu. Its Save completes
// the Flow; the reply (an nfm_reply whose token is obsnotes:<session id>) comes to handleFlowReply.
const FLOW_ID_ENV = 'OBSERVE_NOTES_FLOW_ID';
const TOKEN_PREFIX = 'obsnotes:';
const FLOW_SCREEN = 'NOTES';
const V6 = 'fico17_v6';

function strings(lang) {
  const { observeStrings } = require('./observe-strings');
  return observeStrings(lang === 'ur' ? 'ur' : 'en');
}

const fillN = (tpl, n, lang) => String(tpl || '').replace('{n}', lang === 'ur'
  ? String(n).replace(/[0-9]/g, (d) => URDU_DIGITS[Number(d)])
  : String(n));

/**
 * After the recording's acknowledgement on a v6 /observe visit: the one message that offers the notes Flow, while the
 * switch is on for the coach. Never throws; a failure is logged and the capture goes on.
 * @param {{observerId: string, to: string, session: object, lang?: string, teacherName?: string|null}} args
 * @returns {Promise<{sent: boolean, why?: string}>}
 */
async function offerNotes({ observerId, to, session, lang = 'en', teacherName = null } = {}) {
  try {
    if (!session || session.framework !== V6) return { sent: false, why: 'not_v6' };
    const { isOn } = require('./observation-notes-switch');
    if (!(await isOn(observerId))) return { sent: false, why: 'off' };
    const flowId = process.env[FLOW_ID_ENV] || '';
    if (!flowId) {
      logToFile(`observation-notes: ${FLOW_ID_ENV} is unset — no notes offer on this deployment`, { sessionId: session.id }, 'error');
      return { sent: false, why: 'no_flow_id' };
    }
    const S = strings(lang);
    const WhatsAppService = require('../whatsapp.service');
    await WhatsAppService.sendFlow(to, {
      flowId,
      flowToken: `${TOKEN_PREFIX}${session.id}`,
      screen: FLOW_SCREEN,
      screenData: {
        heading: S.nf_heading,
        who: teacherName || '',
        who_v: !!teacherName,
        help: S.nf_help,
        lbl: S.nf_label,
        helper: S.nf_helper,
        save: S.nf_save,
      },
      body: S.notes_invite,
      buttonText: S.notes_button,
    });
    logToFile('📝 observation-notes: notes Flow offered', { sessionId: session.id, observerId });
    return { sent: true };
  } catch (err) {
    logToFile('❌ observation-notes: the notes offer failed (the capture goes on)', { sessionId: session && session.id, error: err.message }, 'error');
    return { sent: false, why: 'error' };
  }
}

const isNotesToken = (token) => typeof token === 'string' && token.startsWith(TOKEN_PREFIX);

/**
 * The notes Flow's reply. Claims every obsnotes: token (returns true), readable or not, so no other Flow handler sees
 * it. Saves the notes on the visit only when the sender is the visit's coach, and tells her how many were saved.
 * @param {{id: string, preferred_language?: string}} user  the sender
 * @param {string} from  her WhatsApp number
 * @param {string} token  the Flow token (obsnotes:<session id>)
 * @param {object} responseJson  the Flow's completion payload ({ notes })
 * @param {{messageId?: string}} [opts]
 */
async function handleFlowReply(user, from, token, responseJson, { messageId = null } = {}) {
  const sessionId = String(token || '').slice(TOKEN_PREFIX.length);
  try {
    const supabase = require('../../config/supabase');
    const { data: session } = await supabase.from('coaching_sessions')
      .select('id, user_id, observer_user_id, observation_type, status, framework')
      .eq('id', sessionId).maybeSingle();
    const owner = session && (session.observer_user_id || session.user_id);
    if (!session || session.observation_type !== 'leader_observation' || !user || owner !== user.id) {
      logToFile('🚫 observation-notes: notes reply refused — not this coach\'s visit', { sessionId, userId: user && user.id }, 'warn');
      return true;
    }
    let lang = 'en';
    try { lang = await require('./observe-language').languageFor('coach', session); } catch (_) { /* English */ }
    const S = strings(lang);
    const WhatsAppService = require('../whatsapp.service');
    const { TERMINAL_STATUSES } = require('../coaching/session-terminal');
    if (TERMINAL_STATUSES.includes(session.status)) {
      await WhatsAppService.sendMessage(from, S.flow_terminal_refused);
      logToFile('🚫 observation-notes: notes reply for an observation that is over', { sessionId, status: session.status });
      return true;
    }
    const notes = notesFromText(responseJson && responseJson.notes, { source: 'whatsapp' });
    if (!notes.length) return true;
    const out = await addNotes(sessionId, notes, { batch: `wa:${messageId || `${sessionId}:${Date.now()}`}` });
    if (!out.ok) {
      logToFile('❌ observation-notes: notes not saved', { sessionId, why: out.why }, 'error');
      await WhatsAppService.sendMessage(from, S.notes_not_saved);
      return true;
    }
    const count = fillN(notes.length === 1 ? S.notes_count_one : S.notes_count_many, notes.length, lang);
    await WhatsAppService.sendMessage(from, String(out.before === false ? S.notes_saved_late : S.notes_saved).replace('{n}', count));
    logToFile('📝 observation-notes: notes saved from WhatsApp', { sessionId, count: notes.length, added: out.added, beforeReview: out.before !== false });
    runInformedSoon(sessionId);
  } catch (err) {
    logToFile('❌ observation-notes: notes reply failed', { sessionId, error: err.message }, 'error');
  }
  return true;
}

// ── The informed scoring (Phase 1: stored only) ─────────────────────────────
const MAX_INFORMED_RUNS = 3;
const running = new Map();

/** The informed run's step: put this blob in place unless a newer one is already stored. */
function informedStep(blob) {
  const want = JSON.parse(JSON.stringify(blob));
  const { isDeepStrictEqual } = require('util');
  return (analysis) => {
    const have = analysis[INFORMED_KEY];
    if (have && isDeepStrictEqual(have, want)) return { done: true };
    if (have && have.at && want.at && have.at > want.at) return { stop: 'a newer informed scoring is stored' };
    return { next: { ...analysis, [INFORMED_KEY]: want } };
  };
}

/**
 * Score a v6 visit with its notes and store it under analysis_data.dc_informed, once both the notes and the blind
 * analysis exist. Again when notes arrive that the stored scoring did not read (at most MAX_INFORMED_RUNS runs). Never
 * pre-fills the review, never reaches the report. Never throws: a failure is logged under its correlation id and
 * nothing else happens.
 * @returns {Promise<{ran: boolean, why?: string, status?: string}>}
 */
async function runInformed(sessionId) {
  const correlationId = `dc-informed-${sessionId}`;
  const { runWithCorrelation } = require('../../utils/structured-logger');
  return runWithCorrelation(correlationId, async () => {
    try {
      const supabase = require('../../config/supabase');
      const { data: session } = await supabase.from('coaching_sessions')
        .select('id, user_id, observer_user_id, observation_type, status, framework, transcript_text, audio_duration_seconds, analysis_data, autofill_analysis_data')
        .eq('id', sessionId).maybeSingle();
      if (!session || session.observation_type !== 'leader_observation' || session.framework !== V6) return { ran: false, why: 'not_v6' };
      const analysis = session.analysis_data || {};
      const informed = require('../coaching/frameworks/fico17-v6/informed');
      const usable = informed.promptNotes(notesOf(analysis));
      if (!usable.length) return { ran: false, why: 'no_notes' };
      const blind = session.autofill_analysis_data;
      if (!blind || blind.framework !== V6) return { ran: false, why: 'no_blind' };
      if (!session.transcript_text) return { ran: false, why: 'no_transcript' };
      const { isOn } = require('./observation-notes-switch');
      if (!(await isOn(session.observer_user_id || session.user_id))) return { ran: false, why: 'off' };
      const have = analysis[INFORMED_KEY] || null;
      const ids = usable.map((n) => n.id);
      if (have && JSON.stringify(have.note_ids || []) === JSON.stringify(ids)) return { ran: false, why: 'up_to_date' };
      const runs = (have && Number(have.runs)) || 0;
      if (runs >= MAX_INFORMED_RUNS) return { ran: false, why: 'max_runs' };

      const blob = await informed.scoreInformed(session.transcript_text, usable, {
        coachingSessionId: sessionId, duration: session.audio_duration_seconds,
      });
      blob.runs = runs + 1;
      blob.blind_prompt_version = blind.prompt_version || null;
      const { patchSession } = require('../coaching/frameworks/fico17-v6/late-write');
      const stored = await patchSession(sessionId, informedStep(blob), { label: 'dc_informed' });
      logToFile('📝 observation-notes: informed DC scoring stored', {
        sessionId, correlationId, status: blob.status, notes: ids.length, made_up: blob.made_up_note_support,
        cost: blob.usage && blob.usage.cost, stored: stored.ok,
      });
      return { ran: true, status: blob.status };
    } catch (err) {
      logToFile('❌ observation-notes: informed DC scoring failed — nothing stored', { sessionId, correlationId, error: err.message }, 'error');
      return { ran: false, why: 'error' };
    }
  });
}

/** runInformed beside the caller's work, one at a time per visit; a call while one runs shares it. Never throws. */
function runInformedSoon(sessionId) {
  if (!sessionId) return Promise.resolve({ ran: false, why: 'no_session' });
  if (running.has(sessionId)) return running.get(sessionId);
  const job = runInformed(sessionId).finally(() => running.delete(sessionId));
  running.set(sessionId, job);
  return job;
}

module.exports = {
  NOTE_CAP, MAX_NOTES, INTRO_CAP, SOURCES, REVIEW_KEY, NOTES_KEY, INFORMED_KEY, CARRY_KEYS,
  FLOW_ID_ENV, TOKEN_PREFIX, FLOW_SCREEN, MAX_INFORMED_RUNS,
  notesFromText, fromClient, notesOf, addNotes, markReviewOpened, carry, introText,
  offerNotes, isNotesToken, handleFlowReply, runInformed, runInformedSoon,
};
