'use strict';

/**
 * /observe2 — every moment's quote, checked against the transcript before the coach sees it
 * (bd-eal7zn.3; pilot sheet R5, R15). Deterministic: no model.
 *
 * The moments prompt asks for the transcript's own words; this is where the code makes sure. The
 * 15 Oct audit of 1,391 prod moments found the quotes themselves faithful (98.4% verbatim), but 12.1%
 * were one or two words that show nothing, 44 of 325 "child" moments quoted a line the transcript gives
 * to the teacher, and the same words were reused for two moments. Each check, in order:
 *
 *   too_short          under MIN_WORDS words (generic praise is exempt: "shabash" is the evidence)
 *   not_in_transcript  no line, line pair, or run of lines holds the words (fuzzy, MATCH_KEEP)
 *   speaker            a type a child does whose words are all the teacher's, or the reverse
 *   duplicate          the same words as a moment already kept
 *
 * A quote that matches one line closely but not exactly is replaced by that line's own words
 * (repaired). The minute becomes the start of the line the quote begins in; one more than 30 s
 * outside that line's turn is counted as fixed.
 *
 * A question and its answer come as two parts joined by " — ", each matched on its own; the parts
 * must follow each other in the transcript.
 */

const MATCH_KEEP = 0.85;
const MATCH_EXACT = 0.97;
const MIN_WORDS = 3;
const MINUTE_SLACK_S = 30;
const PART_GAP_LINES = 3;
const SHORT_OK = new Set(['praise_generic']);
const CHILD_TYPES = new Set(['reasoning', 'long_answer', 'beyond', 'content_q', 'proc_q', 'beyond_q', 'wrong_fixed', 'hedged', 'unprompted']);
const TEACHER_TYPES = new Set([
  'open_q_one', 'open_q_choral', 'probe', 'wrong_reason', 'wrong_ignored', 'strategy', 'praise_effort', 'praise_generic',
  'mistake_useful', 'disagree', 'content_error', 'term_defined', 'why_explained', 'life_link',
]);
const LINE_RX = /^\[(\d{1,3}):(\d{2})\]\s+([^:(]+?)\s*(?:\([A-Za-z-]{2,5}\))?:\s?(.*)$/;
const PART_SPLIT = /\s+(?:—|–|--)\s+/;

/** The words of a text, as the check compares them: no diacritics, no punctuation, one form per letter. */
function norm(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/[ً-ٰٟۖ-ۭ]/g, '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[هەة]/g, 'ہ')
    .replace(/[أإ]/g, 'ا')
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0))
    .replace(/[​-‏⁦-⁩]/g, '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const words = (s) => norm(s).split(' ').filter(Boolean);

function lev(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let cur = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

const clock = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
const seconds = (mmss) => {
  const m = /^\[?(\d{1,3}):(\d{2})\]?$/.exec(String(mmss || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const role = (speaker) => (/^teacher/i.test(speaker) ? 'teacher' : /^student|^child/i.test(speaker) ? 'child' : null);

/** The transcript's lines, each with its tokens and which raw word each token came from. */
function parseTranscript(transcript) {
  const lines = [];
  for (const raw of String(transcript || '').split('\n')) {
    const m = LINE_RX.exec(raw.trim());
    if (!m) continue;
    const rawWords = m[4].split(/\s+/).filter(Boolean);
    const toks = [];
    const owner = [];
    rawWords.forEach((w, i) => { for (const t of words(w)) { toks.push(t); owner.push(i); } });
    lines.push({ sec: Number(m[1]) * 60 + Number(m[2]), speaker: m[3], role: role(m[3]), rawWords, toks, owner });
  }
  lines.forEach((l, i) => { l.end = i + 1 < lines.length ? lines[i + 1].sec : l.sec + 120; });
  return lines;
}

// How closely `q` (tokens) is found in `toks`: 1 when it is there word for word; otherwise the best
// edit-distance ratio over windows the size of the quote (±1 word) that start on a word the quote has.
function scoreIn(q, toks) {
  const qs = q.join(' ');
  const joined = toks.join(' ');
  if (` ${joined} `.includes(` ${qs} `)) {
    const start = toks.findIndex((_, s) => toks.slice(s, s + q.length).join(' ') === qs);
    return { score: 1, start, len: q.length };
  }
  const qset = new Set(q);
  let top = { score: 0, start: -1, len: 0 };
  for (let s = 0; s < toks.length; s += 1) {
    if (!qset.has(toks[s]) && !(s + 1 < toks.length && qset.has(toks[s + 1]))) continue;
    for (const w of [q.length - 1, q.length, q.length + 1]) {
      if (w < 1 || s + w > toks.length) continue;
      const ws = toks.slice(s, s + w).join(' ');
      if (Math.abs(ws.length - qs.length) / Math.max(ws.length, qs.length) > 1 - MATCH_KEEP) continue;
      const sc = 1 - lev(qs, ws) / Math.max(qs.length, ws.length);
      if (sc > top.score) top = { score: sc, start: s, len: w };
    }
  }
  return top;
}

// Where one part of a quote is: the best line, or failing that the best pair of lines (a sentence the
// transcriber split). Of equally good lines, the one nearest the model's minute.
function locate(part, lines, near) {
  const q = words(part);
  if (!q.length) return null;
  let best = null;
  const consider = (hit) => {
    if (!best || hit.score > best.score + 1e-9
      || (Math.abs(hit.score - best.score) <= 1e-9 && near != null && Math.abs(lines[hit.line].sec - near) < Math.abs(lines[best.line].sec - near))) best = hit;
  };
  lines.forEach((l, i) => {
    const r = scoreIn(q, l.toks);
    if (r.score >= MATCH_KEEP) consider({ line: i, span: 1, ...r });
  });
  if (!best || best.score < MATCH_EXACT) {
    for (let i = 0; i + 1 < lines.length; i += 1) {
      const r = scoreIn(q, [...lines[i].toks, ...lines[i + 1].toks]);
      if (r.score >= MATCH_KEEP && (!best || r.score > best.score + 1e-9)) best = { line: i, span: 2, ...r };
    }
  }
  return best;
}

// The transcript's own words for a single-line match.
function wordsOf(line, hit) {
  const first = line.owner[hit.start];
  const last = line.owner[hit.start + hit.len - 1];
  return line.rawWords.slice(first, last + 1).join(' ');
}

/** Find a whole quote: as written, or as a question — answer pair whose parts follow each other. */
function find(quote, lines, near) {
  const whole = locate(quote, lines, near);
  if (whole) return { parts: [{ text: quote, hit: whole }] };
  const parts = String(quote).split(PART_SPLIT).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const found = [];
  let after = null;
  for (const text of parts) {
    const hit = locate(text, after == null ? lines : lines.slice(after), after == null ? near : null);
    if (!hit) return null;
    const line = hit.line + (after || 0);
    if (after != null && line - after > PART_GAP_LINES) return null;
    found.push({ text, hit: { ...hit, line } });
    after = line;
  }
  return { parts: found };
}

// Who said the words a quote was found in.
function rolesFound(found, lines) {
  return new Set(found.parts.flatMap(({ hit }) => (hit.span === 2 ? [lines[hit.line], lines[hit.line + 1]] : [lines[hit.line]]).map((l) => l.role)));
}

/**
 * The speaker rule: a type a child does needs a child's words, a type the teacher does the teacher's.
 * A transcript whose speakers are neither (none known) cannot rule a moment out.
 */
function speakerAllows(type, roles) {
  if (![...roles].some(Boolean)) return true;
  if (CHILD_TYPES.has(type) && !roles.has('child')) return false;
  if (TEACHER_TYPES.has(type) && !roles.has('teacher')) return false;
  return true;
}

/** Who said a quote's words in this transcript ('teacher', 'child'); empty when the quote is not found. */
function rolesOf(quote, lines) {
  const found = find(quote, lines, null);
  return found ? rolesFound(found, lines) : new Set();
}

/** The transcript lines around where a quote was found, for a reader who needs the context. */
function contextOf(quote, lines, around = 2) {
  const found = find(quote, lines, null);
  if (!found) return [];
  const first = found.parts[0].hit.line;
  const last = found.parts[found.parts.length - 1].hit.line + (found.parts[found.parts.length - 1].hit.span === 2 ? 1 : 0);
  return lines.slice(Math.max(0, first - around), Math.min(lines.length, last + around + 1));
}

/**
 * @param {Array<{moment,type,minute,quote}>} moments  what the model returned
 * @param {string} transcript                          the timed transcript the model read
 * @returns {{moments: Array, stats: {returned, kept, repaired, minute_fixed, dropped: {not_in_transcript, too_short, speaker, duplicate}}}}
 */
function checkQuotes(moments, transcript) {
  const lines = parseTranscript(transcript);
  const stats = { returned: 0, kept: 0, repaired: 0, minute_fixed: 0, dropped: { not_in_transcript: 0, too_short: 0, speaker: 0, duplicate: 0 } };
  const kept = [];
  const seen = [];
  for (const m of Array.isArray(moments) ? moments : []) {
    stats.returned += 1;
    const quote = String((m && m.quote) || '').trim();
    const type = String((m && m.type) || '');
    if (words(quote).length < MIN_WORDS && !SHORT_OK.has(type)) { stats.dropped.too_short += 1; continue; }

    const found = find(quote, lines, seconds(m && m.minute));
    if (!found) { stats.dropped.not_in_transcript += 1; continue; }

    if (!speakerAllows(type, rolesFound(found, lines))) {
      stats.dropped.speaker += 1;
      continue;
    }

    let repaired = false;
    const text = found.parts.map(({ text: t, hit }) => {
      if (hit.span === 1 && hit.score < MATCH_EXACT) { repaired = true; return wordsOf(lines[hit.line], hit); }
      return t;
    }).join(' — ');
    const key = words(text).join(' ');
    if (seen.some((s) => s === key || (key.length && (s.includes(key) || key.includes(s))))) { stats.dropped.duplicate += 1; continue; }
    seen.push(key);

    const line = lines[found.parts[0].hit.line];
    const at = seconds(m && m.minute);
    if (at == null || at < line.sec - MINUTE_SLACK_S || at > line.end + MINUTE_SLACK_S) stats.minute_fixed += 1;
    if (repaired) stats.repaired += 1;
    kept.push({ ...m, quote: text, minute: clock(line.sec) });
  }
  stats.kept = kept.length;
  return { moments: kept, stats };
}

module.exports = {
  checkQuotes, norm, parseTranscript, speakerAllows, rolesOf, contextOf, clock,
  MATCH_KEEP, MATCH_EXACT, MIN_WORDS, CHILD_TYPES, TEACHER_TYPES,
};
