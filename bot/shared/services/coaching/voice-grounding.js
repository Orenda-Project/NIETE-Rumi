'use strict';

/**
 * Keeps the coaching voice note's examples inside the teacher's own recording.
 *
 * A teacher sent her lesson, got her report, and then heard the voice summary praise her for a classroom
 * activity she never did (ICT DC sheet row 69; bd-r2uzg1.18.10). The voice prompt asked for "one major
 * strength with specific example" and handed the model the whole analysis, with no rule that the example
 * had to be a moment from the recording and nothing that compared the script with the transcript after.
 * Asked for a specific example it had not been given, the model supplied one.
 *
 * This module is the deterministic half of the fix (pure, no LLM, no I/O):
 *   - groundedMoments(): the analysis's own quoted moments (report narrative, strengths, notable moments,
 *     indicator evidence), kept ONLY when the quote is found in the transcript. These are the only
 *     examples the voice prompt offers.
 *   - checkVoiceScript(): reads the finished script and names what it cannot ground:
 *       · an ACTIVITY or MATERIAL (group work, cards, pictures, charts, games, songs, role play,
 *         worksheets, videos, objects …) that neither the transcript, the teacher's photos nor her own
 *         reflection mention. In the growth part and the closing an activity the report itself suggests
 *         is allowed — a suggestion for next time is not a claim about this lesson.
 *     Quoted words are NOT checked: transcripts write English words in Urdu script and scripts quote
 *     method names ("I Do, We Do, You Do"), so a word-for-word quote check flagged about one script in
 *     four on a read-only sample of 250 production scripts, mostly wrongly.
 *   - stripUngrounded(): the last resort — drop the sentences that carry what could not be grounded.
 *
 * The caller (GPT5MiniService.summarizeForVoiceDebrief) regenerates once with the problems named, and
 * strips if the second draft still fails, so what is spoken never carries an example we cannot find in
 * what she sent.
 */

// ---------------------------------------------------------------------------------------------------
// Normalising: the same words compare equal across transcript, analysis and script.
// ---------------------------------------------------------------------------------------------------

const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g; // harakat, superscript alef, Quranic marks, tatweel
const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g; // zero-width and direction marks

function normalise(text) {
  return String(text || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(ZERO_WIDTH, '')
    .replace(DIACRITICS, '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[هۀۃة]/g, 'ہ')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokens(text) {
  const n = normalise(text);
  return n ? n.split(' ') : [];
}

// An alias is found when it starts at a word boundary; the last word may run on ("group" → "groups",
// "کارڈ" → "کارڈز"). JS \b is ASCII-only, so boundaries are spaces in the normalised text.
function hasAlias(normText, alias) {
  const a = normalise(alias);
  if (!a) return false;
  return (` ${normText}`).includes(` ${a}`);
}

// ---------------------------------------------------------------------------------------------------
// Activities and materials a voice note might name. `say` is what we look for in the SCRIPT (kept tight
// so ordinary praise does not trip it); `heard` widens what counts as the same thing in the RECORDING.
// `except` phrases are removed first (نظم و ضبط is discipline, not a poem).
// ---------------------------------------------------------------------------------------------------

const ACTIVITIES = [
  { id: 'group_work', say: ['group', 'گروپ', 'گروہ', 'ٹولی', 'ٹولیوں', 'ٹولیاں'], heard: ['team', 'ٹیم'] },
  // "pair" alone is also "adjective-noun pairs" / "paired with"; only pair WORK counts on the script side.
  { id: 'pair_work', say: ['in pairs', 'pair work', 'pair discussion', 'pair share', 'think pair share', 'pair up', 'pairs of students', 'partner', 'جوڑی', 'جوڑیوں', 'پیئر', 'پئیر', 'پارٹنر'], heard: ['pair', 'جوڑے', 'ساتھی', 'neighbour', 'neighbor'] },
  { id: 'cards', say: ['card', 'flashcard', 'flash card', 'کارڈ', 'فلیش'], heard: [] },
  { id: 'pictures', say: ['picture', 'pictorial', 'image', 'photo', 'poster', 'visuals', 'visual aid', 'تصویر', 'تصاویر', 'پکچر', 'پوسٹر', 'فوٹو'], heard: ['تصویروں', 'visual'] },
  { id: 'chart', say: ['chart', 'چارٹ'], heard: [] },
  { id: 'worksheet', say: ['worksheet', 'work sheet', 'ورک شیٹ', 'ورکشیٹ'], heard: ['sheet', 'شیٹ'] },
  { id: 'video', say: ['video', 'multimedia', 'projector', 'smart board', 'ویڈیو', 'ملٹی میڈیا', 'پروجیکٹر', 'پروجیکٹر'], heard: ['screen', 'lcd', 'led', 'اسکرین', 'سکرین'] },
  { id: 'song', say: ['song', 'rhyme', 'poem', 'sing', 'گانا', 'گانے', 'گیت', 'ترانہ', 'نغمہ', 'نظم'], heard: ['poetry', 'شعر', 'اشعار', 'پڑھ کر سنا'], except: ['نظم و ضبط', 'نظم وضبط', 'نظم و نسق'] },
  { id: 'game', say: ['game', 'گیم', 'کھیل'], heard: ['play', 'کھیلیں'] },
  { id: 'role_play', say: ['role play', 'roleplay', 'drama', 'skit', 'act out', 'acted out', 'رول پلے', 'ڈرامہ', 'ڈرامے', 'ڈرامائی', 'اداکاری'], heard: ['role', 'کردار', 'act'] },
  { id: 'drawing', say: ['drawing', 'ڈرائنگ'], heard: ['draw', 'ڈرا', 'تصویر بنا', 'بنائیں'] },
  { id: 'story', say: ['story', 'stories', 'storytelling', 'کہانی', 'کہانیاں', 'کہانیوں'], heard: ['قصہ', 'واقعہ'] },
  { id: 'quiz', say: ['quiz', 'کوئز', 'کویز'], heard: ['test', 'ٹیسٹ'] },
  { id: 'puzzle', say: ['puzzle', 'riddle', 'پہیلی', 'پہیلیاں', 'پزل'], heard: [] },
  { id: 'clapping', say: ['clap', 'تالی', 'تالیاں'], heard: [] },
  // "experiment with new strategies" is a verb; only an experiment as a thing counts.
  { id: 'experiment', say: ['an experiment', 'the experiment', 'experiments', 'science experiment', 'ایکسپیریمنٹ'], heard: ['experiment', 'تجربہ', 'تجربے'] },
  { id: 'concrete_objects', say: ['manipulative', 'concrete material', 'concrete object', 'realia', 'real object', 'bottle cap', 'counters', 'beads', 'straws', 'matchstick', 'ڈھکن', 'تیلی', 'تیلیاں', 'تنکے', 'موتی', 'کنکر', 'pebble'], heard: ['object', 'material', 'سامان', 'چیز', 'اشیا', 'cap', 'stick', 'straw', 'bead', 'block', 'بلاک', 'counter', 'پتھر'] },
];

function stripExcepts(normText, concept) {
  let t = normText;
  for (const e of concept.except || []) t = (` ${t} `).split(` ${normalise(e)} `).join(' ');
  return t;
}

/** Concept ids the text names (script side: `say` aliases only). */
function activitiesNamed(text) {
  const n = normalise(text);
  return ACTIVITIES.filter((c) => c.say.some((a) => hasAlias(stripExcepts(n, c), a))).map((c) => c.id);
}

/** True when the corpus mentions the concept at all (any `say` or `heard` alias). */
function activityHeard(id, normCorpus) {
  const c = ACTIVITIES.find((x) => x.id === id);
  if (!c) return true;
  return [...c.say, ...c.heard].some((a) => hasAlias(normCorpus, a));
}

// ---------------------------------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------------------------------

const SPEAKER_PREFIX = /^\s*\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*(?:[\p{L} ]{1,24}(?:\s*\([A-Za-z]{2,3}\))?\s*:)?\s*/u;
const EDGE_QUOTES = /^[\s'"“”‘’«»]+|[\s'"“”‘’«»]+$/g;

function cleanQuote(q) {
  let s = String(q || '');
  for (let i = 0; i < 3; i += 1) s = s.replace(SPEAKER_PREFIX, '').replace(EDGE_QUOTES, '');
  return s.trim();
}

/**
 * Quoted spans in a piece of text: "…", “…”, «…», and '…' when the single quotes sit at word edges
 * (so the apostrophe in "I'll" is not a quote). A span that itself holds "[mm:ss] Speaker: '…'" yields
 * the inner words.
 */
function quotedSpans(text) {
  const s = String(text || '');
  const out = [];
  const push = (raw) => {
    const inner = quotedSpansSingle(raw);
    const q = cleanQuote(inner.length ? inner[0] : raw);
    if (q && q.replace(/[^\p{L}\p{N}]/gu, '').length >= 2) out.push(q);
  };
  const dbl = /"([^"]{2,}?)"|“([^”]{2,}?)”|«([^»]{2,}?)»/g;
  let m;
  const taken = [];
  while ((m = dbl.exec(s))) { push(m[1] || m[2] || m[3]); taken.push([m.index, dbl.lastIndex]); }
  const rest = taken.reduceRight((acc, [a, b]) => acc.slice(0, a) + ' '.repeat(b - a) + acc.slice(b), s);
  for (const q of quotedSpansSingle(rest)) {
    const c = cleanQuote(q);
    if (c && c.replace(/[^\p{L}\p{N}]/gu, '').length >= 2) out.push(c);
  }
  return out;
}

function quotedSpansSingle(text) {
  const out = [];
  const re = /(?:^|[\s:(\[،,])['‘]([^'’]{2,}?)['’](?=$|[\s.,;:)\]!?،۔؟])/gu;
  let m;
  while ((m = re.exec(String(text || '')))) out.push(m[1]);
  return out;
}

/**
 * Is this quote something that was said in the recording? Exact (normalised) containment, piece by
 * piece across an ellipsis; otherwise at least 80% of its words on ONE transcript line (transcription
 * and the analysis can differ by a word or a spelling).
 */
function quoteInTranscript(quote, transcriptIndex) {
  const { norm, lines } = transcriptIndex;
  if (!norm) return false;
  const pieces = String(quote || '').split(/\.\.\.|…/).map(normalise).filter((p) => p.length >= 2);
  if (!pieces.length) return false;
  if (pieces.every((p) => (` ${norm} `).includes(` ${p}`))) return true;
  const words = tokens(quote).filter((w) => w.length >= 2);
  if (words.length < 3) return false;
  return lines.some((set) => words.filter((w) => set.has(w)).length / words.length >= 0.8);
}

function indexTranscript(transcript) {
  const text = String(transcript || '');
  return {
    norm: normalise(text),
    lines: text.split(/\n+/).map((l) => new Set(tokens(l))).filter((s) => s.size),
  };
}

// ---------------------------------------------------------------------------------------------------
// Grounded moments: the analysis's own quotes that the transcript confirms.
// ---------------------------------------------------------------------------------------------------

const MAX_MOMENTS = 8;
const MAX_ABOUT = 220;

function short(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > MAX_ABOUT ? `${s.slice(0, MAX_ABOUT - 1)}…` : s;
}

function candidates(analysis) {
  const a = analysis || {};
  const out = [];
  const narrative = a.report_narrative && Array.isArray(a.report_narrative.moments) ? a.report_narrative.moments : [];
  for (const m of narrative) {
    if (m && m.quote) out.push({ quote: cleanQuote(m.quote), about: short([m.title, m.why].filter(Boolean).join(': ')) });
  }
  for (const s of Array.isArray(a.strengths) ? a.strengths : []) {
    if (!s || typeof s !== 'object') continue;
    for (const q of quotedSpans(s.evidence)) out.push({ quote: q, about: short(s.title || s.area || '') });
  }
  for (const n of Array.isArray(a.notable_moments) ? a.notable_moments : []) {
    if (!n || typeof n !== 'object') continue;
    for (const q of quotedSpans(n.what_happened)) out.push({ quote: q, about: short(n.what_happened) });
  }
  for (const d of Object.values(a.domains || {})) {
    for (const ind of (d && Array.isArray(d.indicators) ? d.indicators : [])) {
      if (!ind || !(Number(ind.score) >= 2)) continue;
      for (const q of quotedSpans(ind.evidence || ind.evidence_summary)) out.push({ quote: q, about: short(ind.name || '') });
    }
  }
  return out;
}

/**
 * @param {object} analysis - the analysis the voice is built from
 * @param {string} transcript - the lesson transcript
 * @returns {{quote: string, about: string}[]} at most MAX_MOMENTS moments whose quote is in the transcript
 */
function groundedMoments(analysis, transcript) {
  const idx = indexTranscript(transcript);
  if (!idx.norm) return [];
  const seen = new Set();
  const out = [];
  for (const c of candidates(analysis)) {
    const key = normalise(c.quote);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!quoteInTranscript(c.quote, idx)) continue;
    out.push(c);
    if (out.length >= MAX_MOMENTS) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The check on a finished script
// ---------------------------------------------------------------------------------------------------

function textOf(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (e) { return ''; }
}

// What she sent besides the audio: classroom photos (and their readings) and her own reflection.
function sentByHer(analysis) {
  const a = analysis || {};
  return ['photo_evidence', 'photo_reads', 'photo_vision', 'photo_analysis', 'debrief_reflection']
    .map((k) => textOf(a[k])).join('\n');
}

// What the report itself suggests for next time — the growth part may repeat these.
function reportSuggestions(analysis) {
  const a = analysis || {};
  return [a.growth_opportunities, a.recommendations, a.focus_area, a.prioritized_action]
    .map(textOf).join('\n');
}

// Where the script makes claims about THIS lesson: the greeting and the strength. The growth part and the
// closing suggest things to try next time, so there an activity the report itself suggests is allowed.
const CLAIM_SECTIONS = ['greeting', 'strength'];

/**
 * @param {object} sections - { greeting, strength, growth, closing } (or { body } for unsectioned text)
 * @param {object} ctx - { transcript, analysis }
 * @returns {{ ok: boolean, problems: {section: string, kind: 'activity', what: string}[] }}
 */
function checkVoiceScript(sections, ctx = {}) {
  const heardCorpus = normalise(`${ctx.transcript || ''}\n${sentByHer(ctx.analysis)}`);
  const suggested = normalise(reportSuggestions(ctx.analysis));
  const problems = [];
  for (const [section, text] of Object.entries(sections || {})) {
    if (!text) continue;
    const claim = CLAIM_SECTIONS.includes(section);
    for (const id of activitiesNamed(text)) {
      if (activityHeard(id, heardCorpus)) continue;
      if (!claim && activityHeard(id, suggested)) continue;
      problems.push({ section, kind: 'activity', what: id });
    }
  }
  return { ok: problems.length === 0, problems };
}

/** Sentences, each with its end mark (. ! ? ۔ ؟ or a line break). */
function sentences(text) {
  return String(text || '').match(/[^.!?۔؟\n]+[.!?۔؟]*\s*|\n+/g) || [];
}

/**
 * Drop every sentence that names an activity the check could not ground.
 * @returns {object} sections with the offending sentences removed
 */
function stripUngrounded(sections, problems) {
  const out = {};
  for (const [section, text] of Object.entries(sections || {})) {
    const ids = (problems || []).filter((p) => p.section === section).map((p) => p.what);
    if (!ids.length || !text) { out[section] = text; continue; }
    const kept = sentences(text).filter((sentence) => !activitiesNamed(sentence).some((id) => ids.includes(id)));
    out[section] = kept.join('').replace(/[ \t]{2,}/g, ' ').trim();
  }
  return out;
}

const SECTION_ORDER = ['greeting', 'strength', 'growth', 'closing', 'body'];

/** The spoken script: the sections in order, a blank line between them. */
function joinSections(sections) {
  return SECTION_ORDER.map((k) => (sections && typeof sections[k] === 'string' ? sections[k].trim() : ''))
    .filter(Boolean).join('\n\n');
}

/**
 * The model's reply as sections. JSON {greeting, strength, growth, closing} is the contract; anything
 * else is kept whole as `body` (checked like the growth part, since it cannot be told apart) — nothing is lost.
 */
function parseSections(reply) {
  const raw = String(reply || '').trim();
  try {
    const j = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    if (j && typeof j === 'object' && ['greeting', 'strength', 'growth', 'closing'].some((k) => typeof j[k] === 'string')) {
      const s = {};
      for (const k of ['greeting', 'strength', 'growth', 'closing']) if (typeof j[k] === 'string') s[k] = j[k];
      return s;
    }
  } catch (e) { /* not JSON: whole text below */ }
  return { body: raw };
}

module.exports = {
  ACTIVITIES,
  normalise,
  activitiesNamed,
  quotedSpans,
  groundedMoments,
  checkVoiceScript,
  stripUngrounded,
  parseSections,
  joinSections,
};
