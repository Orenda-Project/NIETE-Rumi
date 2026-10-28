'use strict';
/**
 * The School card's WhatsApp door: read `/school card [EMIS or school name]` and pick the page its link opens.
 *
 * The decision (who gets the door) and the send live in app-redirect.service.js openSchoolCard; this module only
 * reads the words and picks the school, so the text handler (which cannot be booted cheaply) holds one line of it.
 *
 *   parseSchoolCardCommand(text) → { query } when the message IS the command, else null. `query` is the rest of the
 *     message as she typed it (case kept), '' when there is none.
 *   pickSchool(userId, query) → { target, school, match }:
 *     - an exact EMIS among HER schools (leader_schools) wins                         match 'emis'
 *     - else the school search (school-search.service), kept to her EMIS list:
 *         exactly one of hers                                                          match 'name'
 *         several of hers                                                              match 'several'
 *         none of hers                                                                 match 'no_match'
 *     - no query                                                                       match 'no_query'
 *     - she has no schools (or they could not be read)                                 match 'no_schools'
 *     A single school is `coach_school:<EMIS>` with her name for it (what My schools shows); anything else is My
 *     schools (`coach_schools`) with no name. Never a list, never a question back: one link, always.
 * Never throws.
 */

const { logToFile } = require('../../utils/logger');
const { COACH_SCHOOLS, coachSchoolTarget } = require('../coach-school-target');

/** The coach's keyed reference for a log line, never the raw users.id (web-quiz-kid tk); null without a key. */
const teacherRef = (id) => { try { return id ? require('../quiz/web-quiz-kid').tk(id) : null; } catch (_) { return null; } };

// Bidi controls a copied or isolated command carries (as slash-command.js strips them): LRM/RLM, embeddings, isolates, BOM.
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩﻿]/g;
// "/school card", "school card", "/schoolcard", any case; then nothing, or a separator and her query. "school cardiff"
// and "school cards" are other words, not the command.
const COMMAND = /^\/?\s*school\s*card(?![\p{L}\p{N}_])[\s:,.\-]*([\s\S]*)$/iu;
const MAX_QUERY = 120;
// The search is asked for every hit so the cut to her schools happens after it, not before (her school could rank
// below a top-N of all schools).
const SEARCH_LIMIT = 1000;

/** `{ query }` when `text` is the School card command, else null. */
function parseSchoolCardCommand(text) {
  if (typeof text !== 'string') return null;
  const m = COMMAND.exec(text.replace(BIDI_CONTROLS, '').trim());
  if (!m) return null;
  return { query: m[1].replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY) };
}

/**
 * A leader_schools row's EMIS the way the coach app reads it (dashboard/services/coach-v2.service.js: `emis`, else the
 * part of `school_ext_id` after its last ':'), so the link opens the page the app knows the school by.
 */
function emisOfRow(row) {
  if (!row) return null;
  if (row.emis !== null && row.emis !== undefined && String(row.emis).trim()) return String(row.emis).trim();
  const ext = row.school_ext_id ? String(row.school_ext_id) : '';
  const code = ext.includes(':') ? ext.slice(ext.lastIndexOf(':') + 1) : ext;
  return code.trim() || null;
}

/** Her schools as { emis, name, target }, only those whose EMIS is a safe page key. [] when there are none. */
async function mySchools(userId) {
  // leader-source reads leader_schools and answers [] on a failed read (logged there).
  const { _schools } = require('../observe/assignment/leader-source');
  const rows = await _schools(userId);
  const out = [];
  const seen = new Set();
  for (const r of rows || []) {
    const emis = emisOfRow(r);
    const target = coachSchoolTarget(emis);
    if (!target || seen.has(target)) continue;
    seen.add(target);
    out.push({ emis, name: String(r.school_name || '').trim() || `EMIS ${emis}`, target });
  }
  return out;
}

/** "947", "EMIS 947", "emis: 947" → "947" (case folded), for comparing with her EMIS list. */
function emisOfQuery(query) {
  return String(query || '').replace(/^emis\s*[:#-]?\s*/i, '').trim().toLowerCase();
}

const SCHOOLS = (match) => ({ target: COACH_SCHOOLS, school: null, match });
const ONE = (s, match) => ({ target: s.target, school: s.name, match });

async function pickSchool(userId, query) {
  const q = String(query || '').trim();
  let mine;
  try {
    mine = await mySchools(userId);
  } catch (err) {
    logToFile('⚠️ School card: her schools could not be read — My schools', { tk: teacherRef(userId), error: err?.message }, 'warn');
    return SCHOOLS('no_schools');
  }
  if (!q) return SCHOOLS('no_query');
  if (!mine.length) return SCHOOLS('no_schools');

  const typed = emisOfQuery(q);
  const exact = mine.find((s) => s.emis.toLowerCase() === typed);
  if (exact) return ONE(exact, 'emis');

  let hits = [];
  try {
    hits = await require('./school-search.service').searchSchools(q, { limit: SEARCH_LIMIT });
  } catch (err) {
    logToFile('⚠️ School card: school search failed — My schools', { tk: teacherRef(userId), error: err?.message }, 'warn');
    return SCHOOLS('no_match');
  }
  const byEmis = new Map(mine.map((s) => [s.emis.toLowerCase(), s]));
  const found = new Map();
  for (const h of hits || []) {
    const s = byEmis.get(String(h && h.emis != null ? h.emis : '').trim().toLowerCase());
    if (s) found.set(s.target, s);
  }
  if (found.size === 1) return ONE([...found.values()][0], 'name');
  return SCHOOLS(found.size > 1 ? 'several' : 'no_match');
}

module.exports = { parseSchoolCardCommand, pickSchool };
