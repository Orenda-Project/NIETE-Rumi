/**
 * Voice roll call — a principal says who is away, we tick it for them.
 *
 * THE RULE THAT MAKES THIS SAFE: this service never writes a register. It produces a
 * SELECTION, which the Flow's REVIEW screen shows pre-ticked, and the principal
 * confirms or corrects by tap before the existing LEAVE → CONFIRM → write path runs.
 * A transcription mistake therefore costs a tap, not a wrong record — which is the
 * difference between this and the typed-coordinates channel that was deleted for
 * silently marking the wrong colleague.
 *
 * The second rule: AMBIGUITY REFUSES. "Sana" with two Sanas on staff resolves to
 * nobody and is reported back as unheard, rather than resolved to whichever row the
 * database returned first. A name we decline to place costs one tap on REVIEW; a
 * name we place wrongly marks a colleague absent and nobody notices.
 *
 * Voice was deleted with the rest of attendance on 2026-08-10 because it had never
 * reached a teacher here. It returns on the PRINCIPAL path first, where the roster is
 * a dozen adults the principal names every morning — not forty children whose first
 * names collide.
 */

const { logToFile } = require('../utils/logger');
const ConversationState = require('./conversation-state.service');

/** The register's vocabulary. Anything else is not a status. */
const STATUSES = ['present', 'absent', 'leave'];

// Checked in this order, because the phrases nest: "غیر حاضر" (absent) contains
// "حاضر" (present), so a present-first check reads every absence as attendance.
const LEAVE_WORDS = ['leave', 'on leave', 'chutti', 'chuti', 'چھٹی', 'رخصت', 'ruksat'];
const ABSENT_WORDS = [
  'absent', 'not here', 'missing', 'away', 'nahi', 'nahin',
  'ghair hazir', 'ghairhazir', 'gair hazir', 'غیر حاضر', 'غائب', 'نہیں',
];
const PRESENT_WORDS = ['present', 'here', 'came', 'yes', 'hazir', 'haazir', 'حاضر', 'موجود', 'ہاں', 'جی'];

/** How close a spoken name must be to a roster name before we accept it. */
const FUZZY_FLOOR = 0.8;

/** The conversation-state flow name. One place, so arm/disarm cannot disagree. */
const VOICE_FLOW = 'attendance_voice';

/** A voice note is worth waiting for through a school assembly, not overnight. */
const ARM_TTL_SECONDS = 1800;

/** Long enough to open the Flow the prompt sends, short enough not to haunt tomorrow. */
const RESULT_TTL_SECONDS = 1800;

/**
 * Comparable form of a name: case, spacing, punctuation and Urdu diacritics removed.
 * Soniox returns "ayesha  khan", "Ayesha Khan." and "ayesha khan" for the same
 * three seconds of audio.
 */
function normalise(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, '')       // Arabic/Urdu diacritics
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function personName(p) {
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
  return name || p.student_name || p.phone_number || 'Unnamed';
}

/** Levenshtein distance, iterative and allocation-light — names are short. */
function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

function similarity(a, b) {
  const longest = Math.max(a.length, b.length);
  if (!longest) return 0;
  return 1 - editDistance(a, b) / longest;
}

/**
 * Which of "present", "absent" or "leave" a spoken phrase means.
 *
 * Defaults to ABSENT rather than present, and that is deliberate: marking is by
 * exception, so the only reason a name was said out loud is that something about
 * that person is not the default. Guessing "present" for an unclear status word
 * would silently discard the one thing the principal took the trouble to say.
 */
function readStatus(phrase) {
  const text = normalise(phrase);
  if (!text) return 'absent';
  if (LEAVE_WORDS.some((w) => text.includes(normalise(w)))) return 'leave';
  if (ABSENT_WORDS.some((w) => text.includes(normalise(w)))) return 'absent';
  if (PRESENT_WORDS.some((w) => text.includes(normalise(w)))) return 'present';
  return 'absent';
}

/**
 * The one roster member a spoken name means, or null.
 *
 * Three passes, each stopping the moment it has an answer, so a weaker rule can
 * never overrule a stronger one:
 *
 *   1. the whole name, exactly
 *   2. any WORD of the name, exactly — how a principal actually speaks
 *   3. the whole name, approximately — Soniox spells "Ayesha" four ways
 *
 * A pass that finds MORE THAN ONE candidate returns null and does not fall through:
 * two matches is a refusal, not a reason to try a fuzzier rule that would break the
 * tie by accident. A word every name shares — "test" across a seeded roster — is a
 * refusal by the same rule, which is the behaviour we want rather than a special case.
 *
 * Pass 2 is by WORD and not by field, because a field is often two names: Pakistani
 * first names run "Muhammad Usman" and the principal says "Usman". Matching the whole
 * field only would miss every one of those, and misses a roster whose names carry any
 * kind of suffix.
 */
function matchPerson(spoken, roster) {
  const said = normalise(spoken);
  if (!said || !Array.isArray(roster) || !roster.length) return null;

  const words = (value) => normalise(value).split(' ').filter(Boolean);

  const people = roster.map((p) => ({
    person: p,
    full: normalise(personName(p)),
    words: new Set([...words(p.first_name), ...words(p.last_name)]),
  }));

  const only = (hits) => (hits.length === 1 ? hits[0].person : null);

  // 1. Exact, whole name.
  const exact = people.filter((p) => p.full === said);
  if (exact.length) return only(exact);

  // 2. Exact, on every word the principal said. "Bilal", "Iqbal", "Muhammad Usman".
  const saidWords = said.split(' ').filter(Boolean);
  const byWord = people.filter((p) => saidWords.every((w) => p.words.has(w)));
  if (byWord.length) return only(byWord);

  // 3. Approximate, whole name. Only reached when nothing matched exactly, so it
  //    cannot silently outvote pass 2's refusal.
  const scored = people
    .map((p) => ({ ...p, score: similarity(p.full, said) }))
    .filter((p) => p.score >= FUZZY_FLOOR)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  // A tie is an ambiguity like any other.
  if (scored.length > 1 && scored[1].score === scored[0].score) return null;
  return scored[0].person;
}

/**
 * Spoken entries → the selection the REVIEW screen pre-ticks.
 *
 * @param {Array<{name: string, status?: string}>} entries
 * @param {Array} roster
 * @returns {{absentIds: string[], leaveIds: string[], unmatched: string[],
 *            matched: Array<{id: string, name: string, status: string}>}}
 */
function resolveSpoken(entries, roster) {
  const absent = new Set();
  const leave = new Set();
  const unmatched = [];
  const matched = [];

  for (const entry of entries || []) {
    const spoken = entry && entry.name;
    if (!spoken) continue;

    const person = matchPerson(spoken, roster);
    if (!person) {
      unmatched.push(String(spoken).trim());
      continue;
    }

    const status = STATUSES.includes(entry.status) ? entry.status : readStatus(entry.status);
    // Present is the default for everyone unnamed, so saying it changes nothing.
    if (status === 'present') continue;

    // Leave is the more specific statement and wins if the same person is named
    // twice — the same precedence attendance-write.service applies at write time.
    if (status === 'leave') {
      leave.add(person.id);
      absent.delete(person.id);
    } else if (!leave.has(person.id)) {
      absent.add(person.id);
    }

    matched.push({ id: person.id, name: personName(person), status });
  }

  return {
    absentIds: [...absent],
    leaveIds: [...leave],
    unmatched,
    matched,
  };
}

/** What we ask the model for: names and statuses, nothing interpreted. */
function buildExtractionPrompt(transcript, roster) {
  const names = (roster || []).map(personName).join(', ');
  return [
    'A school principal has recorded a voice note taking attendance for their TEACHERS.',
    'They name only the staff who are NOT present as normal. Everyone unnamed is present.',
    '',
    `Staff on the roster: ${names || '(unknown)'}`,
    '',
    'Transcript (may mix Urdu and English, in either script):',
    `"""${transcript}"""`,
    '',
    'For every person named, return the name AS SPOKEN and one status:',
    '  "absent"  — away, no reason given (absent, ghair hazir, غیر حاضر, nahi aaye)',
    '  "leave"   — away on approved leave (leave, chutti, چھٹی, rukhsat)',
    '  "present" — explicitly said to be present (hazir, حاضر, present)',
    '',
    'Return JSON only, no prose:',
    '{"people":[{"name":"<as spoken>","status":"absent|leave|present"}]}',
    'Return {"people":[]} if nobody was named.',
  ].join('\n');
}

/** Tolerant JSON read — models fence their output, and a fence is not a failure. */
function parseExtraction(raw) {
  const text = String(raw || '').replace(/```(?:json)?/gi, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return [];

  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    const list = parsed.people || parsed.students || parsed.teachers || [];
    return Array.isArray(list)
      ? list.filter((e) => e && e.name).map((e) => ({ name: String(e.name), status: e.status }))
      : [];
  } catch (error) {
    logToFile('⚠️ Voice attendance: could not parse the extraction', { error: error.message });
    return [];
  }
}

/** Ask the model who was named. Returns [] on any failure — never throws. */
async function extract(transcript, roster) {
  if (!transcript || !String(transcript).trim()) return [];

  try {
    const { getClient, getDefaultModel } = require('./llm-client');
    const response = await getClient().chat.completions.create({
      model: getDefaultModel(),
      temperature: 0,
      messages: [{ role: 'user', content: buildExtractionPrompt(transcript, roster) }],
    });
    return parseExtraction(response?.choices?.[0]?.message?.content);
  } catch (error) {
    logToFile('❌ Voice attendance extraction failed', { error: error.message }, 'error');
    return [];
  }
}

/**
 * Audio in, selection out.
 *
 * @param {string} audioPath  WAV/OGG on local disk
 * @param {Array}  roster     the staff this register covers
 * @returns {Promise<{ok: boolean, transcript: string, absentIds: string[],
 *                    leaveIds: string[], unmatched: string[], matched: Array,
 *                    reason?: string}>}
 */
async function processVoiceAttendance(audioPath, roster, options = {}) {
  const AudioService = require('./audio.service');
  const empty = { absentIds: [], leaveIds: [], unmatched: [], matched: [] };

  let transcription;
  try {
    transcription = await AudioService.transcribe(audioPath, false, options.language || null);
  } catch (error) {
    logToFile('❌ Voice attendance: transcription failed', { error: error.message }, 'error');
    return { ok: false, transcript: '', reason: 'transcription_failed', ...empty };
  }

  const transcript = (transcription && transcription.text ? transcription.text : '').trim();
  if (!transcript) {
    return { ok: false, transcript: '', reason: 'nothing_heard', ...empty };
  }

  const spoken = await extract(transcript, roster);
  const resolved = resolveSpoken(spoken, roster);

  logToFile('🎙️ Voice attendance resolved', {
    transcriptLength: transcript.length,
    named: spoken.length,
    absent: resolved.absentIds.length,
    leave: resolved.leaveIds.length,
    unmatched: resolved.unmatched.length,
  });

  return { ok: true, transcript, ...resolved };
}

// ─── The wait ────────────────────────────────────────────────────────────────
// A voice note arrives as its own webhook, so "I am expecting one" has to outlive
// the message that asked. It lives in conversation state (Postgres) rather than
// Redis because the NIETE Redis has no persistent volume and a restart would drop
// every principal mid-roll-call.

/** Expect a voice note from this principal. */
async function arm(userId, { schoolId }) {
  return ConversationState.setState(userId, {
    flow: VOICE_FLOW,
    step: 'awaiting_voice',
    payload: { schoolId },
    ttlSeconds: ARM_TTL_SECONDS,
  });
}

/** Are we waiting on a voice note from them? → the armed payload, or null. */
async function armed(userId) {
  const state = await ConversationState.getState(userId);
  if (!state || state.flow !== VOICE_FLOW || state.step !== 'awaiting_voice') return null;
  return state.payload || {};
}

/** Hold the extraction until the Flow opens and REVIEW asks for it. */
async function stashResult(userId, { schoolId, absentIds, leaveIds, transcript, unmatched }) {
  return ConversationState.setState(userId, {
    flow: VOICE_FLOW,
    step: 'awaiting_review',
    payload: {
      schoolId,
      absentIds: absentIds || [],
      leaveIds: leaveIds || [],
      transcript: transcript || '',
      unmatched: unmatched || [],
    },
    ttlSeconds: RESULT_TTL_SECONDS,
  });
}

/** What the voice note said, for the REVIEW screen. Read-only; REVIEW may re-render. */
async function pendingResult(userId) {
  const state = await ConversationState.getState(userId);
  if (!state || state.flow !== VOICE_FLOW || state.step !== 'awaiting_review') return null;
  return state.payload || {};
}

/** Done with the voice branch, however it ended. */
async function disarm(userId) {
  return ConversationState.clearState(userId, { flow: VOICE_FLOW });
}

module.exports = {
  processVoiceAttendance,
  resolveSpoken,
  matchPerson,
  readStatus,
  extract,
  buildExtractionPrompt,
  parseExtraction,
  normalise,
  personName,
  arm,
  armed,
  stashResult,
  pendingResult,
  disarm,
  VOICE_FLOW,
  STATUSES,
};
