'use strict';

/**
 * bd-ra8xu.60 — Observation Notes into the Digital Coach: the INFORMED v6 scoring (prompt fico17-v6-dc-notes-1).
 *
 * A coach visit on FICO17 v6 is scored twice once the coach has typed Observation Notes:
 *   blind     the v6 scorer on the transcript only, exactly as today. It pre-fills the coach's review, and the coach's
 *             final levels against it are the clean coach-vs-DC eval (autofill_analysis_data).
 *   informed  this module: the same scorer, the same transcript, plus the coach's notes after it. Stored only, under
 *             analysis_data.dc_informed; it never pre-fills the review and never reaches the teacher's report
 *             (Phase 1). The eval compares blind vs coach and informed vs coach, per indicator.
 *
 * What the informed reply may add to the v6 reply:
 *   - evidence that cites a note: { source: 'note', note_id: 'n1', quote: '<exact words from that note>' }. Every such
 *     quote is checked word for word against that note (validateInformed); one that is not in it is dropped and counted
 *     as made-up support (made_up). Transcript evidence is checked exactly as the blind validator checks it.
 *   - notes: one label per note, how the RECORDING relates to it: supports | contradicts | not_in_recording, and the
 *     indicator codes it bears on.
 * The six combined indicators still get no level (design rule, docs/fico17-v6.md): a note can be cited as their
 * evidence, never turned into a level. The blind validator's refusal applies unchanged.
 */

const v6 = require('./index');

const NOTES_PROMPT_VERSION = `fico17-v6-dc-notes-1+${v6.RUBRIC_SHA8}`;
const LABELS = ['supports', 'contradicts', 'not_in_recording'];
const NOTE_PROMPT_CAP = 600; // one note as the Flow and the portal take it
const FINAL_LINE = 'Score Part 1 and report Part 2 for this lesson. Return only the JSON.';

const squash = (s) => String(s || '').toLowerCase().replace(/[\s"'“”‘’.,!?؟،۔…:;()\-–—]+/g, ' ').trim();

/** The notes the model reads: the ones with text, in the order they were typed, each with its id. */
function promptNotes(notes) {
  return (Array.isArray(notes) ? notes : [])
    .filter((n) => n && typeof n.text === 'string' && n.text.trim() && n.id)
    .map((n) => ({ id: String(n.id), text: Array.from(n.text.trim()).slice(0, NOTE_PROMPT_CAP).join(''), rec_time: n.rec_time || null }));
}

const NOTES_RULES = `OBSERVATION NOTES. After the transcript you are given the coach's Observation Notes: what the coach saw in the
room, typed during or just after the lesson. A recording cannot see the board, group work, or who stayed quiet;
a note can tell you that. Each note has an id (n1, n2, ...) and sometimes the recording time it was typed at.
- When a note bears on a Part 1 indicator, you may use it as evidence. Cite it as
  {"source": "note", "note_id": "n1", "quote": "exact words copied from that note"}. Transcript evidence stays
  {"time": "MM:SS", "quote": "exact words from the transcript"}. Never put words in a note quote that the note does not have.
- Part 2 stays evidence only: a note may be cited in a Part 2 indicator's items, but it never gives that indicator a
  level, and its result stays null, "NA" or "IE".
- A note does not silently overrule the transcript. When the transcript clearly shows the opposite of a note, choose
  the level the whole evidence supports and say so in "because".
- For EVERY note, add one entry to a top-level "notes" list:
  {"note_id": "n1", "codes": ["C1"], "label": "supports" | "contradicts" | "not_in_recording"}
  where the label says how the TRANSCRIPT relates to the note: supports (the transcript shows the same thing),
  contradicts (the transcript shows otherwise), not_in_recording (the transcript cannot show it, e.g. the board).
  "codes" lists the indicators (any of the 17) the note bears on; [] when none.`;

let _cached = null;

function getInformedSystemPrompt() {
  if (_cached && _cached.version === NOTES_PROMPT_VERSION) return _cached.prompt;
  const fw = require('../fico17-v6-framework');
  const prompt = `${fw.getSystemPrompt()}

${NOTES_RULES}
Return only JSON matching the schema above, with the "notes" list added at the top level.`;
  _cached = { version: NOTES_PROMPT_VERSION, prompt };
  return prompt;
}

function renderNotesBlock(notes) {
  const lines = promptNotes(notes).map((n) => `[${n.id}] ${n.rec_time ? `(${n.rec_time}) ` : ''}${n.text.replace(/\s*\n\s*/g, ' ')}`);
  return `OBSERVATION NOTES (typed by the coach in the room; not part of the transcript):\n${lines.join('\n')}`;
}

/** The per-lesson prompt: the blind v6 prompt with the notes after the transcript, before the closing instruction. */
function buildInformedPrompt(transcript, metadata, notes) {
  const fw = require('../fico17-v6-framework');
  const { retry, ...rest } = metadata || {};
  const base = fw.buildAnalysisPrompt(transcript, rest);
  const block = renderNotesBlock(notes);
  const closing = 'Score Part 1 and report Part 2 for this lesson, using the notes as described. Return only the JSON.';
  const i = base.lastIndexOf(FINAL_LINE);
  const prompt = i >= 0 ? `${base.slice(0, i)}${block}\n\n${closing}` : `${base}\n\n${block}\n\n${closing}`;
  return retry ? `${prompt}\n\n${fw.RETRY_NOTE}` : prompt;
}

const isNoteItem = (it) => !!it && typeof it === 'object' && (it.source === 'note' || it.note_id !== undefined);

/**
 * Checks an informed reply in place. Transcript evidence goes through the blind validator unchanged; note evidence is
 * kept only when its quote is in that note word for word. Returns the blind validator's { ok, errors, dropped,
 * warnings } plus note_evidence (kept note quotes), made_up ([{code, note_id, quote, why}]) and unlabeled (note ids).
 */
function validateInformed(analysis, transcript, notes) {
  const fw = require('../fico17-v6-framework');
  const a = analysis || {};
  const byId = new Map(promptNotes(notes).map((n) => [n.id, n]));
  const madeUp = [];
  const held = []; // [{ row, key, code, items }]

  const takeNotes = (code, row, key) => {
    if (!row || !Array.isArray(row[key])) return;
    const items = row[key].filter(isNoteItem);
    if (!items.length) return;
    row[key] = row[key].filter((it) => !isNoteItem(it));
    held.push({ row, key, code, items });
  };
  if (a.levels && typeof a.levels === 'object') for (const [code, row] of Object.entries(a.levels)) takeNotes(code, row, 'evidence');
  if (a.combined_evidence && typeof a.combined_evidence === 'object') {
    for (const [code, row] of Object.entries(a.combined_evidence)) takeNotes(code, row, 'items');
  }

  const base = fw.validate(a, transcript);

  let kept = 0;
  for (const { row, key, code, items } of held) {
    const good = [];
    for (const it of items) {
      const id = String(it.note_id || '');
      const quote = typeof it.quote === 'string' ? it.quote : '';
      const note = byId.get(id);
      if (!note) { madeUp.push({ code, note_id: id, quote, why: 'unknown_note' }); continue; }
      const q = squash(quote);
      if (!q || !squash(note.text).includes(q)) { madeUp.push({ code, note_id: id, quote, why: 'not_in_note' }); continue; }
      good.push({ source: 'note', note_id: id, quote });
    }
    kept += good.length;
    if (Array.isArray(row[key])) row[key] = [...row[key], ...good];
    if (key === 'items' && Array.isArray(row.items)) row.items = row.items.slice(0, 5);
  }

  const warnings = [...base.warnings];
  const labels = [];
  const seen = new Set();
  for (const l of Array.isArray(a.notes) ? a.notes : []) {
    const id = l && String(l.note_id || '');
    if (!id || !byId.has(id) || seen.has(id) || !LABELS.includes(l.label)) {
      warnings.push(`notes: label dropped ${JSON.stringify(l)}`.slice(0, 200));
      continue;
    }
    seen.add(id);
    labels.push({ note_id: id, codes: (Array.isArray(l.codes) ? l.codes : []).filter((c) => v6.CODES.includes(c)), label: l.label });
  }
  a.notes = labels;
  const unlabeled = [...byId.keys()].filter((id) => !seen.has(id));

  return { ...base, warnings, note_evidence: kept, made_up: madeUp, unlabeled };
}

/** The v6 scorer with the notes: the same interface and name, so analyzePedagogy runs it like the blind one. */
function informedVariant(notes) {
  const fw = require('../fico17-v6-framework');
  return {
    ...fw,
    promptVersion: NOTES_PROMPT_VERSION,
    informed: true,
    getSystemPrompt: getInformedSystemPrompt,
    buildAnalysisPrompt: (transcript, metadata) => buildInformedPrompt(transcript, metadata, notes),
    validate: (analysis, transcript) => validateInformed(analysis, transcript, notes),
  };
}

/**
 * One informed scoring: the transcript gate first ('broken' → no call), then the production DC call (same model and
 * settings as the blind v6 read) with one retry, the informed validator, and the v6 totals. Never fills a default
 * level: a reply that fails validation is stored as 'invalid'. Throws only when the model call itself fails twice
 * (the caller logs it and stores nothing).
 * @returns {Promise<object>} the blob for analysis_data.dc_informed
 */
async function scoreInformed(transcript, notes, metadata = {}) {
  const fw = require('../fico17-v6-framework');
  const at = new Date().toISOString();
  const usable = promptNotes(notes);
  const head = { rubric: v6.RUBRIC_KEY, prompt_version: NOTES_PROMPT_VERSION, at, note_ids: usable.map((n) => n.id) };
  if (!usable.length) return { status: 'no_notes', ...head };

  const gate = require('../../../observe/transcript-quality');
  const seconds = Number(metadata && metadata.duration);
  const quality = gate.assess({ transcript, periodMinutes: seconds > 0 ? seconds / 60 : null });
  const transcript_quality = gate.stored(quality);
  if (quality.status === 'broken') return { status: 'broken', ...head, transcript_quality };

  const GPT5MiniService = require('../../../gpt5-mini.service');
  const variant = informedVariant(usable);
  const keep = ['coachingSessionId', 'duration', 'language', 'transcriptLanguage', 'grade', 'subject'];
  const ask = { ...Object.fromEntries(keep.filter((k) => metadata[k] !== undefined).map((k) => [k, metadata[k]])), transcriptQuality: quality };
  let res;
  try {
    res = await GPT5MiniService.analyzePedagogy(transcript, ask, null, variant);
  } catch (first) {
    res = await GPT5MiniService.analyzePedagogy(transcript, /JSON pars/i.test(first.message) ? { ...ask, retry: true } : ask, null, variant);
  }
  const analysis = res && res.analysis;
  const usage = (res && res.usage) || null;
  const check = validateInformed(analysis, transcript, usable);
  if (!check.ok) return { status: 'invalid', ...head, transcript_quality, errors: check.errors.slice(0, 20), usage };
  const labels = analysis.notes;
  const scored = fw.computeScores(analysis, false, transcript);
  return {
    status: 'ok',
    ...head,
    levels: scored.levels,
    combined_evidence: scored.combined_evidence,
    notes: labels,
    unlabeled_notes: check.unlabeled,
    scores: { ...scored.scores, overall_max_possible: fw.maxMarks },
    transcript_quality,
    dropped_evidence: check.dropped,
    note_evidence: check.note_evidence,
    made_up_note_support: check.made_up.length,
    made_up: check.made_up.slice(0, 20),
    ...(check.warnings.length ? { warnings: check.warnings.slice(0, 20) } : {}),
    usage,
  };
}

module.exports = {
  NOTES_PROMPT_VERSION, LABELS,
  promptNotes, renderNotesBlock, buildInformedPrompt, getInformedSystemPrompt,
  validateInformed, informedVariant, scoreInformed,
};
