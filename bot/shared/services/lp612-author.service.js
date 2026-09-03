/**
 * lp612-author.service — segment -> lp_doc (schema 3.0), through the v9 revision ladder.
 *
 * A PORT, not an invention. The control flow below is `lp_author/author_lp.py::author()` from
 * the lesson-plan pipeline, rewritten in Node against this repo's LLM client. The vendored
 * pieces it drives — the author brief, the two schemas, the canon lint — live in
 * `bot/vendor/lp-v9/`; `bot/vendor/lp-v9/SYNC.md` is the record of what came from where and
 * every deliberate divergence.
 *
 * THE SHAPE OF THE LADDER, and why each turn of it is here:
 *
 *   author -> gates -> clean? done : revise -> gates -> better? keep : reject, CONTINUE
 *
 *   • THE GATES RUN IN PROCESS. Schema first, and a schema failure SHORT-CIRCUITS: pedagogy
 *     findings on a broken shape are not trustworthy, so the lint is not even asked. Then the
 *     vendored `lint()` — the deterministic gate of record, no LLM, no judgement.
 *   • THE JUDGE IS NOT HERE AT ALL. Upstream calls an advisory LLM judge; it is out of scope
 *     for this lane and deliberately unported (SYNC.md §3.5). The consequence to know: upstream
 *     can reject a revision round for a judge-score drop as well as a defect-count rise; this
 *     ladder can only see the defect count.
 *   • A BAD ROUND COSTS THE ROUND, NEVER THE LADDER. A candidate that comes back worse is
 *     rejected and the climb CONTINUES from the document we kept. So does a round that fails to
 *     parse after both attempts, and so does one that blows up in transport. One pilot exited
 *     with four fixable defects and two unused rounds because a single unparseable reply ended
 *     the whole climb.
 *   • ONE CALL, ONE RETRY — on the revision call as well as the author call. That asymmetry is
 *     exactly what cost that pilot its rounds.
 */

const fs = require('fs');
const path = require('path');

const { logToFile } = require('../utils/logger');
const { getClient } = require('./llm-client');
const { fetchPages } = require('./lp612-pagetruth.service');
const { clampLanguage } = require('../config/ux-strings');

// Static, literal requires on purpose: the repo's unresolved-require audit reads the source
// text, and a `require(path.join(...))` is invisible to it — which is how a vendored file that
// stopped existing would reach production as a runtime crash instead of a red gate.
const { lint } = require('../../vendor/lp-v9/lint_lp.js');
const { validateDoc } = require('../../vendor/lp-v9/lib/validate.js');
// The schema itself, for the ONE repair that needs to know which top-level keys exist. Read from
// the schema rather than copied into a list here, so a field added upstream is never silently
// deleted by this file.
const docSchema = require('../../vendor/lp-v9/schema/lp_doc.schema.json');

const BRIEF_PATH = path.join(__dirname, '..', '..', 'vendor', 'lp-v9', 'brief_author_v3.md');

// The model is the CALLER's choice, defaulted from the environment so the worker and any
// operator script agree without passing it around. Every call goes through llm-client
// (OpenRouter) — never the pipeline's Python backend picker, never a direct vendor API.
const DEFAULT_AUTHOR_MODEL = 'anthropic/claude-sonnet-5';
const DEFAULT_ROUNDS = 3;
const MAX_TOKENS = 24000;
const TEMPERATURE = 0.2;
const PAGE_TRUTH_MAX_CHARS = 90000;

function resolveAuthorModel() {
  return process.env.LP_AUTHOR_MODEL || DEFAULT_AUTHOR_MODEL;
}

function resolveRounds(explicit) {
  if (Number.isInteger(explicit) && explicit >= 0) return explicit;
  const env = parseInt(process.env.LP612_AUTHOR_ROUNDS, 10);
  if (Number.isInteger(env) && env >= 0) return env;
  return DEFAULT_ROUNDS;
}

let _brief = null;
function authorBrief() {
  if (_brief === null) _brief = fs.readFileSync(BRIEF_PATH, 'utf8');
  return _brief;
}

function fail(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

// ── JSON extraction ─────────────────────────────────────────────────────────
//
// Ported from `extract_json` / `repair_backslashes`, plus `_literal_eval_object` — see
// pythonDictToJson below for how that one is done without an `ast.literal_eval` equivalent.

const VALID_ESCAPE = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u']);

// LaTeX/mhchem commands beginning with a letter that is ALSO a legal JSON escape (\b \f \n \r
// \t). Everything else after a backslash — \ce, \left, \sqrt, \alpha … — is already an illegal
// escape and gets doubled unconditionally. This whitelist is why a real "line\nbreak" survives.
const LATEX_AMBIG = [
  'begin', 'bmatrix', 'binom', 'bar', 'boxed', 'bullet', 'because', 'bigg',
  'frac', 'forall', 'fbox', 'frown',
  'nabla', 'neq', 'ne', 'notin', 'nu', 'nonumber', 'newline',
  'rho', 'rightarrow', 'right', 'rangle', 'rm',
  'times', 'text', 'textbf', 'textit', 'to', 'theta', 'tau', 'therefore', 'tan',
  'triangle', 'tfrac', 'top',
];

const isAlpha = (c) => /[A-Za-z]/.test(c);

/**
 * Double every backslash inside a string literal that is not a valid JSON escape.
 *
 * The failure this exists for is silent, not loud: `\f` is a LEGAL JSON escape, so
 * `"\frac{1}{2}"` PARSES — into a form feed followed by "rac{1}{2}" — and the formula is gone
 * with no error anywhere. Three revision passes were lost to that before the repair existed.
 */
function repairBackslashes(s) {
  const out = [];
  let inStr = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (!inStr) {
      out.push(c);
      if (c === '"') inStr = true;
      i += 1;
      continue;
    }
    if (c === '\\') {
      const nxt = i + 1 < s.length ? s[i + 1] : '';
      let keep = VALID_ESCAPE.has(nxt);
      if (keep && 'bfnrt'.includes(nxt)) {
        let run = '';
        let k = i + 1;
        while (k < s.length && isAlpha(s[k])) { run += s[k]; k += 1; }
        if (LATEX_AMBIG.some((cmd) => run.startsWith(cmd))) keep = false;
      }
      if (keep) { out.push(c, nxt); i += 2; continue; }
      out.push('\\\\');
      i += 1;
      continue;
    }
    out.push(c);
    if (c === '"') inStr = false;
    i += 1;
  }
  return out.join('');
}

/**
 * Rescue a reply that came back as a PYTHON dict rather than JSON.
 *
 * Upstream (`_literal_eval_object`) does this with `ast.literal_eval` behind a
 * round-trip guard, because the failure it prevents is expensive and real: a
 * model that answers with single-quoted strings and `True`/`False`/`None` fails
 * every round of the ladder, and the run burns its budget producing nothing.
 *
 * Node has no `literal_eval`, and the obvious substitutes — `eval`, `new
 * Function`, `vm` — all execute a string a model wrote, which is not a trade
 * worth making for a formatting slip. So this is a strict scanner instead. It
 * rewrites only what is unambiguous OUTSIDE a string body:
 *
 *   - a `'` delimiter becomes `"` (and any `"` inside that string is escaped,
 *     any `\'` unescaped);
 *   - the bare words True / False / None become true / false / null, matched on
 *     word boundaries and only outside strings.
 *
 * Nothing inside a string body is ever altered. That clause is the whole point:
 * a repair that corrupts string contents turns a loud parse failure into a
 * lesson plan with silently mangled text, which is strictly worse. `None of the
 * above` stays `None of the above`.
 *
 * Guarded like upstream: the result must parse AND be a plain object. Anything
 * else returns null rather than throwing, so the caller keeps its own error.
 *
 * @returns {string|null} a JSON string, or null if it cannot be safely rescued
 */
function pythonDictToJson(text) {
  const src = String(text == null ? '' : text);
  if (!src.trim()) return null;

  const isWordChar = (c) => c !== undefined && /[A-Za-z0-9_]/.test(c);
  const LITERALS = [['True', 'true'], ['False', 'false'], ['None', 'null']];

  let out = '';
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    // ── double-quoted string: copied verbatim, delimiters included ──────────
    if (ch === '"') {
      out += ch;
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        if (src[i] === '"') { out += '"'; i += 1; break; }
        out += src[i];
        i += 1;
      }
      continue;
    }

    // ── single-quoted string: re-delimited, body preserved ─────────────────
    if (ch === "'") {
      out += '"';
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') {
          // \' is a Python escape that JSON does not allow — unescape it.
          // Everything else (\n, \\, \uXXXX, and the doubled LaTeX backslashes
          // repairBackslashes has already produced) passes through untouched.
          if (src[i + 1] === "'") { out += "'"; i += 2; continue; }
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        // A bare " inside a single-quoted string is legal in Python and must be
        // escaped once it is living inside double quotes.
        if (src[i] === '"') { out += '\\"'; i += 1; continue; }
        if (src[i] === "'") { out += '"'; i += 1; break; }
        out += src[i];
        i += 1;
      }
      continue;
    }

    // ── outside any string: the only place literals are rewritten ──────────
    let matched = false;
    for (const [py, js] of LITERALS) {
      if (src.startsWith(py, i) && !isWordChar(src[i - 1]) && !isWordChar(src[i + py.length])) {
        out += js;
        i += py.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    out += ch;
    i += 1;
  }

  // The round-trip guard, same as upstream's dict check: it must parse, and it
  // must be an object. A list that parses is still not an lp_doc.
  try {
    const parsed = JSON.parse(out);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return out;
  } catch (_) {
    return null;
  }
}

/** @throws Error with .code 'UNPARSEABLE' */
function extractJson(text) {
  let t = String(text || '').trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```\s*$/, '');
  }
  // Repair BEFORE parsing — see repairBackslashes: a "successful" parse is the bad outcome.
  t = repairBackslashes(t);
  try {
    return JSON.parse(t);
  } catch (_) { /* fall through to the brace scan */ }

  const start = t.indexOf('{');
  if (start < 0) throw fail('UNPARSEABLE', 'no JSON object in model output');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const slice = t.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch (e) {
          // Last resort before failing the round: the reply may be a Python
          // dict rather than JSON. Costs one scan; saves the whole ladder.
          const rescued = pythonDictToJson(slice);
          if (rescued) return JSON.parse(rescued);
          throw fail('UNPARSEABLE', `JSON object in model output does not parse: ${e.message}`);
        }
      }
    }
  }
  throw fail('UNPARSEABLE', 'unbalanced JSON in model output');
}

// ── the LLM call ────────────────────────────────────────────────────────────

/**
 * One completion. Returns { text, usage }.
 *
 * REASONING IS OFF, and the spelling is per ENDPOINT, not per vendor. This client speaks to
 * OpenRouter, whose spelling is `reasoning: {enabled:false}`. Reasoning bills as completion
 * tokens and, at max_tokens, truncates the JSON before it is closed — a judge call once burned
 * all 5,999 of its budget on reasoning and returned `content: ""`.
 *
 * @throws Error with .code 'LLM_FAILED'
 */
async function callLlm({ system, user, model, correlationId, stage }) {
  let res;
  try {
    res = await getClient().chat.completions.create({
      model,
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
      reasoning: { enabled: false },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
  } catch (e) {
    throw fail('LLM_FAILED', `${stage}: LLM call failed — ${e.message}`, { cause: e });
  }

  const message = (res && res.choices && res.choices[0] && res.choices[0].message) || {};
  const text = message.content || '';
  if (!String(text).trim()) {
    // An empty `content` beside `reasoning_content` is a NAMED failure, not a "no JSON" death
    // four layers later beside a 0-byte artefact. The message says which it was and how much
    // of the budget went on reasoning.
    const reasoning = message.reasoning_content || message.reasoning;
    const spent = (res && res.usage && res.usage.completion_tokens) || 0;
    if (reasoning) {
      throw fail('LLM_FAILED',
        `${stage}: the model returned empty content with reasoning_content present — ` +
        `${spent} completion tokens went on reasoning. Reasoning must be disabled for this endpoint.`);
    }
    throw fail('LLM_FAILED', `${stage}: the model returned empty content`);
  }

  logToFile('lp612 author LLM call', {
    correlationId, stage, model,
    chars: String(text).length,
    usage: res.usage || null,
  });

  return { text: String(text), usage: (res && res.usage) || {} };
}

/**
 * One call, ONE retry when the reply carries no JSON. The raw text of each attempt is logged
 * (upstream keeps `<stem>.raw.txt` beside the doc; a worker has no such directory) so a failure
 * explains itself without paying for the call again.
 *
 * @throws Error with .code 'UNPARSEABLE' | 'LLM_FAILED' — the CALLER decides what that costs,
 *         and for a revision round the answer is: that round, never the ladder.
 */
async function callWithRetry({ system, user, model, correlationId, stage, usageSink }) {
  let lastErr = null;
  for (const attempt of [1, 2]) {
    try {
      const { text, usage } = await callLlm({ system, user, model, correlationId, stage: `${stage}.a${attempt}` });
      usageSink(usage);
      try {
        return extractJson(text);
      } catch (e) {
        lastErr = e;
        logToFile('lp612 author: reply carried no JSON', {
          correlationId, stage, attempt, error: e.message,
          raw: String(text).slice(0, 4000),
        }, 'warn');
      }
    } catch (e) {
      lastErr = e;
      logToFile('lp612 author: LLM call failed', { correlationId, stage, attempt, error: e.message }, 'warn');
    }
  }
  throw lastErr;
}

// ── the prompt ──────────────────────────────────────────────────────────────

/** Page-truth as compact, ordered, readable text — cheaper and clearer than raw JSON. */
function compactPageTruth(pages, maxChars = PAGE_TRUTH_MAX_CHARS) {
  const lines = [];
  const j = (o) => JSON.stringify(o);
  for (const pg of pages) {
    lines.push(`\n===== PRINTED PAGE ${pg.printed_page_number} (pdf ${pg.pdf_page_index}, ${pg.page_type}) =====`);
    for (const b of pg.blocks || []) {
      switch (b.t) {
        case 'heading': lines.push(`[HEADING] ${b.text}`); break;
        case 'prose': lines.push(`[PROSE] ${b.text}`); break;
        case 'list':
          lines.push(`[LIST] ${b.title || ''}`);
          for (const it of b.items || []) lines.push(`  - ${it}`);
          break;
        case 'note': lines.push(`[NOTE] ${b.text}`); break;
        case 'worked': lines.push(`[WORKED EXAMPLE] ${j(b)}`); break;
        case 'table':
          lines.push(`[TABLE] ${b.caption || ''}`);
          if ((b.columns || []).length) lines.push('  cols: ' + b.columns.join(' | '));
          for (const row of (b.rows || []).slice(0, 25)) lines.push('  ' + row.join(' | '));
          break;
        case 'illus':
          // `decoration` is the page-truth's own marker for a border, a mascot, a rule — a
          // figure with nothing to teach. Upstream drops those; so do we.
          if (b.role === 'decoration' || b.decoration) break;
          lines.push(`[FIGURE] ${b.desc}`);
          if (b.text_in_image) lines.push(`  labels in figure: ${b.text_in_image}`);
          if (b.role) lines.push(`  role: ${b.role}`);
          break;
        case 'formula': lines.push(`[FORMULA] ${j(b)}`); break;
        case 'mcq': lines.push(`[MCQ IN BOOK] ${j(b)}`); break;
        case 'cols2': lines.push(`[TWO-COLUMN] ${j(b)}`); break;
        case 'dua': lines.push(`[DUA — reproduce exactly, never alter] ${b.text}`); break;
        default: lines.push(`[${String(b.t).toUpperCase()}] ${j(b)}`);
      }
    }
  }
  const out = lines.join('\n');
  return out.length <= maxChars ? out : `${out.slice(0, maxChars)}\n…[truncated]`;
}

/**
 * `--lang` states the language of instruction, BUT THE BOOK'S OWN MEDIUM ALWAYS WINS. An
 * Urdu-medium book is authored in Urdu whatever the caller asks for — self-translation is
 * banned — and a request for Urdu against an English-medium book authors in English and leaves
 * the toggle to a separate pass over the finished document.
 */
function languageDirective(want, medium) {
  if (want === 'ur' && medium !== 'ur') {
    return 'The teacher asked for URDU. This is an English-medium book, so author the lp_doc in ' +
      'ENGLISH exactly as §7 requires — the Urdu toggle is built by a separate pass over the ' +
      'finished document. Do NOT emit ur_overlay yourself.';
  }
  if (want === 'en' && medium === 'ur') {
    return 'The teacher asked for ENGLISH, but this is an URDU-MEDIUM book: author the whole ' +
      'lp_doc in Urdu (§7). The book\'s language of instruction wins; a self-translated Urdu ' +
      'lesson in English is law L1d\'s exact failure.';
  }
  return `Author in the book's own medium: ${medium}.`;
}

/** Printed learning outcomes the page-truth found, for the verbatim SLO quote. */
function printedOutcomes(pages) {
  const hits = [];
  const RE = /(learning outcomes?|students will be able to|by the end of this|سیکھنے کے نتائج|طلبہ اس قابل)/i;
  for (const pg of pages) {
    for (const b of pg.blocks || []) {
      const text = b.text || b.title || '';
      const items = (b.items || []).join(' ');
      if (RE.test(`${text} ${items}`)) {
        hits.push({ printed_page: pg.printed_page_number, text: `${text} ${items}`.trim().slice(0, 1400) });
      }
    }
  }
  return hits;
}

function buildUserPrompt({ segment, bundle, lang, video }) {
  const book = bundle.book || {};
  // clampLanguage rather than an inline `|| 'en'` floor: the book's medium is a
  // language decision like any other, and every one of them belongs to the one
  // function that owns them.
  const medium = clampLanguage(book.medium || segment.medium);
  const outcomes = printedOutcomes(bundle.pages);
  const ocTxt = outcomes.length
    ? outcomes.map((o) => `- (p.${o.printed_page}) ${o.text}`).join('\n')
    : '(none printed on these pages — author the objective from the SLO below and say so)';

  const videoTxt = video
    ? `A curated video has ALREADY been chosen for this lesson and is inserted mechanically after ` +
      `you answer. Put NO "video" key in your output — whatever you write there is discarded.\n` +
      `  url: ${video.url}\n  title: ${video.title}`
    : 'No video is available for this lesson. Emit NO "video" key — an unvalidated link must ' +
      'never reach a teacher, so anything you write there is discarded.';

  return `# LESSON TO AUTHOR

## LANGUAGE
${languageDirective(lang, medium)}

lesson_id: ${segment.segment_id}
book_stem: ${segment.book_stem}  ·  ${book.title || ''}
grade: ${book.grade != null ? book.grade : segment.grade}  ·  subject: ${book.subject || segment.subject}  ·  medium: ${book.language || segment.language} (${medium})
chapter: ${segment.chapter_number != null ? `${segment.chapter_number} — ${segment.chapter_title || ''}` : '(none)'}
section: ${segment.section_ref || '(none)'}
topic: ${segment.subtopic_title || segment.menu_title || segment.chapter_title || ''}
printed pages: ${bundle.pages.map((p) => p.printed_page_number).join(', ')}   (pdf offset ${book.offset})
period: ${segment.period_minutes || 40} minutes
suggested lp_type: ${segment.lp_type || '(unset)'}  — confirm or override, and say why
skill type: ${segment.skill_type || '(unset)'}  ·  day ${segment.day_number != null ? segment.day_number : '(unset)'} of the chapter
where this sits: previous ${segment.prev_segment_id || '(none)'} · next ${segment.next_segment_id || '(none)'}

## THE SLO THIS SEGMENT CARRIES (quote it verbatim into slo.text_verbatim)
${segment.slo_text || '(none recorded on the segment — take one verbatim from the page-truth below)'}

## SEGMENT NOTES (operator/reviewer instructions — obey these over your own instincts)
${segment.notes || '(none)'}

## VIDEO
${videoTxt}

## PRINTED LEARNING OUTCOMES found in the page-truth
${ocTxt}

## PAGE-TRUTH — the printed pages, block by block. Everything you write must trace to this.
${compactPageTruth(bundle.pages)}

---
Return ONE JSON object conforming to lp_doc schema_version 3.0. No prose, no markdown fence.
`;
}

const REVISION_PREAMBLE =
  'Your previous lp_doc is below, followed by every defect found by the schema validator and ' +
  'the deterministic lint.\n\n' +
  'Return the COMPLETE corrected lp_doc JSON — the whole document, not a patch, not a diff. ' +
  'Fix EVERY listed defect, including every word-budget line: when a budget says CUT N words, ' +
  'actually delete that much text from that section rather than rewording it, and OVERSHOOT the ' +
  'cut by about 10% — word counters differ slightly, and landing even a few words over a ceiling ' +
  'costs another full revision round. Change nothing else. Keep every fact traceable to the same ' +
  'page-truth.\n\n';

function buildRevisionPrompt({ doc, gates, originalUser, notes }) {
  return REVISION_PREAMBLE +
    (notes ? `=== THE OPERATOR'S NAMED DEFECTS — THESE OUTRANK EVERYTHING BELOW ===\n${notes}\n\n` : '') +
    '=== PREVIOUS lp_doc ===\n' + JSON.stringify(doc, null, 1) +
    '\n\n=== SCHEMA ERRORS ===\n' + (gates.schema.join('\n') || '(none)') +
    '\n\n=== LINT ERRORS ===\n' + (gates.lint.join('\n') || '(none)') +
    // The renderer's own words, verbatim. "Make it shorter" and "support needs 6 pages; the cap
    // is 4" are different instructions, and only the second one tells the model how much to cut
    // and from WHICH part of the document.
    '\n\n=== PAGE / LAYOUT ERRORS (the rendered page refused these) ===\n'
      + ((gates.render || []).join('\n') || '(none)') +
    // MEASURED, not guessed: page2 held 658 words across 6 A4 pages — about 110 words a page.
    // The support page is built from CARDS, each with fixed chrome at the 18px body floor the
    // renderer enforces, so pages are spent on CARD COUNT and barely at all on prose length.
    // The first render-gated run proved the point: told only "it is too long", the model
    // shortened sentences and moved 6 pages to 5. It has to be told to delete whole items.
    ((gates.render || []).some((d) => /PAGE COUNT/.test(d))
      ? '\n\nHOW TO FIX A PAGE-COUNT ERROR: pages are spent on CARD COUNT, not on word count — '
        + 'each exam_bank item, model_answers entry, mistakes row and differentiation row is a '
        + 'box with its own heading and padding. Shortening sentences will NOT remove a page. '
        + 'REMOVE WHOLE ITEMS instead, fewest-value first — drop exam_bank questions and '
        + 'model_answers entries until the part fits, and keep the ones that carry the lesson. '
        // The first valid end-to-end run obeyed the instruction above and then deleted a
        // REQUIRED key out of page2.differentiation, so the document died on schema instead of
        // page count. exam_bank and model_answers are LISTS, where dropping an entry is free;
        // differentiation and the coaching corner are OBJECTS with required keys, where dropping
        // one is a broken document. Saying what to cut without saying what is structural is what
        // cost that run.
        + 'NEVER REMOVE A REQUIRED PROPERTY to save space: cut only from the LISTS (exam_bank, '
        + 'model_answers, mistakes rows). page2.differentiation must keep stuck, barrier and '
        + 'early; every other required field stays. Shorten those in place if you must, but a '
        + 'missing required property fails the whole document and wastes the round.'
      : '') +
    '\n\n=== LINT WARNINGS ===\n' + (gates.warns.join('\n') || '(none)') +
    '\n\n=== THE ORIGINAL TASK (same page-truth, unchanged) ===\n' + originalUser;
}

// ── the video slot ──────────────────────────────────────────────────────────

/**
 * The segment's `yt` is the authority for the development section's video slot, and the ONLY
 * one. The brief asks the model for a video because upstream had an agent picking and
 * live-validating one; here the link is curated data on the segment, so it is written in
 * mechanically and anything the model invented is DELETED.
 *
 * Why delete rather than leave: a model-authored YouTube URL is unvalidated by construction, and
 * an unvalidated link on a lesson plan is a teacher standing in front of a class with a dead
 * video or someone else's content. This is the routing rule the pipeline states for itself —
 * anything mechanically decidable is repaired mechanically, and nothing judgement-shaped ever
 * is. A key is mechanical.
 */
function parseYt(yt) {
  if (!yt) return null;
  let v = yt;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { return null; }
  }
  if (!v || typeof v !== 'object') return null;
  const url = typeof v.url === 'string' ? v.url.trim() : '';
  const title = typeof v.title === 'string' ? v.title.trim() : '';
  if (!/^https?:\/\//.test(url) || title.length < 3) return null;
  const out = { url, title };
  for (const k of ['channel', 'duration', 'why', 'checked_at']) {
    if (typeof v[k] === 'string' && v[k].trim()) out[k] = v[k].trim();
  }
  return out;
}

/**
 * Repair `ur_overlay` before the schema wall, or drop it.
 *
 * The field is optional, and for an English-medium book asked for in Urdu the brief tells the
 * model in as many words: "Do NOT emit ur_overlay yourself." It emitted one anyway, and not as
 * an object — so the renderer refused the whole document with
 * `SCHEMA INVALID … /ur_overlay must be object`, on staging, AFTER a full authoring run. The
 * lesson was written and it was fine; it died at the last gate on a field nothing needed.
 *
 * This is the "assert the prompt's contract in code" rule: the model complies almost always and
 * freestyles the rest, and a schema is a wall rather than a repair. So the repair happens first.
 *
 * Deliberately narrow — DROP what cannot be valid, never invent. The schema says an overlay is a
 * map of JSON-Pointer (`^/`) to replacement STRING; anything else is not a lossy overlay, it is
 * not an overlay, and every document renders correctly without one. An overlay left with nothing
 * valid is removed rather than left as `{}`, so that "did the model write one?" stays answerable.
 */
function sanitizeOverlay(doc) {
  if (!doc || !Object.prototype.hasOwnProperty.call(doc, 'ur_overlay')) return doc;

  const ov = doc.ur_overlay;
  const isPlainObject = ov && typeof ov === 'object' && !Array.isArray(ov);
  if (!isPlainObject) {
    delete doc.ur_overlay;
    return doc;
  }

  const kept = {};
  for (const [pointer, value] of Object.entries(ov)) {
    if (pointer.startsWith('/') && typeof value === 'string') kept[pointer] = value;
  }
  if (Object.keys(kept).length) doc.ur_overlay = kept;
  else delete doc.ur_overlay;
  return doc;
}

/**
 * Drop top-level keys `lp_doc` does not define.
 *
 * Measured on staging twice in one morning, on two different segments:
 *
 *   SCHEMA INVALID — / must NOT have additional properties ('provenance_note')
 *   SCHEMA INVALID — /ur_overlay must be object
 *
 * Both are the same failure. The model adds something the schema forbids and a lesson that is
 * otherwise finished — 265 s and three revision rounds in — is discarded at the last gate. The
 * teacher waits four minutes and gets an apology for a document that was fine.
 *
 * The root schema is `additionalProperties: false`, so an unknown key is BY DEFINITION one the
 * renderer can never read: dropping it cannot lose anything, while keeping it loses the whole
 * lesson. That makes this a mechanical repair of a mechanically-decidable defect, not a
 * judgement call being automated — the same routing rule `parseYt` follows.
 *
 * ONLY the top level. A nested additionalProperties failure is a real shape defect that the
 * revision ladder should be told about and fix, not something to paper over.
 *
 * The allowed set is read FROM THE SCHEMA. A hardcoded list would silently start deleting real
 * fields the day someone adds one.
 */
function sanitizeUnknownTopLevel(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return doc;
  const allowed = (docSchema && docSchema.properties) ? Object.keys(docSchema.properties) : null;
  // No schema, no opinion — never guess at what is allowed.
  if (!allowed || !allowed.length) return doc;
  for (const k of Object.keys(doc)) {
    if (!allowed.includes(k)) delete doc[k];
  }
  return doc;
}

function applyVideo(doc, video) {
  if (!doc || !Array.isArray(doc.sections)) return doc;
  for (const s of doc.sections) {
    if (s && s.id === 'development') {
      if (video) s.video = { ...video };
      else delete s.video;
    } else if (s && s.video) {
      // The schema says DEVELOPMENT ONLY. A video parked on the activity section would be a
      // schema failure the author then burns a round on; drop it here instead.
      delete s.video;
    }
  }
  return doc;
}

// ── the gates ───────────────────────────────────────────────────────────────

/**
 * Schema, then the vendored canon lint — both IN PROCESS, neither writing a file.
 *
 * A schema failure SHORT-CIRCUITS, exactly as `lint()` does internally: findings about pedagogy
 * on a document with a broken shape are not trustworthy, and half of them would be crashes.
 */
/**
 * Schema, then the vendored canon lint, then — if the caller supplied one — THE RENDERER.
 *
 * The render gate is here because leaving it downstream is what made every English lesson fail
 * on staging. `PAGE COUNT: support needs 6 pages; the cap is 4` is decided by the packer, which
 * ran only after the ladder had finished; the ladder saw a lint-clean document, stopped, and
 * handed back something that could not be turned into a PDF. Three rounds were spent polishing
 * prose that was never going to fit.
 *
 * Rendering is attempted only once the SHAPE is valid — the renderer throws on a schema-invalid
 * document, and a crash is not a defect list.
 *
 * A renderer that BLOWS UP is not the document's fault (a browser that would not launch), so it
 * is swallowed: the run falls back to exactly the old behaviour rather than losing the lesson.
 */
async function runGates(doc, renderCheck) {
  const v = validateDoc(doc);
  // The `SCHEMA:` prefix is the lint's own vocabulary for the same finding — worth matching so
  // a caller (and the revision prompt) reads one consistent list of coded defects.
  if (!v.ok) return { schema: v.errors.map((e) => `SCHEMA: ${e}`), lint: [], render: [], warns: [] };
  // `docPath` is unused by lint() — it takes it for its CLI's sake. Nothing here writes.
  const r = lint(doc, null, {});

  let render = [];
  if (typeof renderCheck === 'function') {
    try {
      render = (await renderCheck(doc)) || [];
    } catch (e) {
      logToFile('lp612 author: render gate threw, continuing on lint alone', { error: e.message }, 'warn');
      render = [];
    }
  }

  return {
    schema: [],
    lint: r.fails.slice(),
    render,
    warns: r.warns.slice(),
  };
}

const gateCost = (g) => g.schema.length + g.lint.length + (g.render ? g.render.length : 0);
const gateFails = (g) => [...g.schema, ...g.lint, ...(g.render || [])];

// ── the ladder ──────────────────────────────────────────────────────────────

/**
 * @param {object} args
 * @param {object} args.segment  a niete_lp612_segments row (snake_case, as in the segmentation contract)
 * @param {'en'|'ur'} [args.lang]
 * @param {string} [args.model]  OpenRouter model id; defaults to resolveAuthorModel()
 * @param {number} [args.rounds] max revision rounds; defaults to LP612_AUTHOR_ROUNDS or 3
 * @param {string} [args.correlationId]
 * @returns {Promise<{lpDoc:object, lintClean:boolean, fails:string[], warns:string[],
 *                    rounds:number, model:string, usage:object}>}
 * @throws Error with .code in {'AUTHOR_LLM_FAILED','AUTHOR_UNPARSEABLE','PAGE_TRUTH_MISSING'}
 */
/**
 * @param {function} [args.renderCheck] async (doc) -> string[] of RENDER defects. Optional, and
 *   optional on purpose: the pure-authoring callers (scripts, tests) have no browser. When it is
 *   supplied the ladder gates on it too, which is the only way a page-count defect can ever be
 *   fixed — see runGates.
 */
async function authorLessonPlan({ segment, lang, model, rounds, correlationId, renderCheck } = {}) {
  if (!segment || !segment.book_stem) {
    throw fail('AUTHOR_LLM_FAILED', 'authorLessonPlan needs a segment with a book_stem');
  }

  const chosenModel = model || resolveAuthorModel();
  const maxRounds = resolveRounds(rounds);
  // clampLanguage, not an inline `=== 'ur' ? 'ur' : 'en'`. That inline form was
  // written 23 separate times in this codebase before it was collapsed into one
  // function, and a conformance guard now fails the build on the 24th. It also
  // does the right thing here for free: an unoffered `lang` falls to the floor
  // rather than being keyed into an R2 cache path as junk.
  const language = clampLanguage(lang || segment.medium);

  // PAGE_TRUTH_MISSING propagates untouched — a lesson we cannot ground is not a lesson we
  // spend a model call on.
  const bundle = await fetchPages({
    bookStem: segment.book_stem,
    pages: segment.pages_covered && segment.pages_covered.length
      ? segment.pages_covered
      : rangeOf(segment.printed_page_start, segment.printed_page_end),
    correlationId,
  });

  const video = parseYt(segment.yt);
  const system = authorBrief();
  const user = buildUserPrompt({ segment, bundle, lang: language, video });

  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0 };
  const addUsage = (u) => {
    usage.calls += 1;
    usage.prompt_tokens += (u && u.prompt_tokens) || 0;
    usage.completion_tokens += (u && u.completion_tokens) || 0;
    usage.total_tokens += (u && u.total_tokens) || 0;
  };

  let doc;
  try {
    doc = await callWithRetry({
      system, user, model: chosenModel, correlationId, stage: 'author', usageSink: addUsage,
    });
  } catch (e) {
    throw fail(
      e.code === 'UNPARSEABLE' ? 'AUTHOR_UNPARSEABLE' : 'AUTHOR_LLM_FAILED',
      `authoring ${segment.segment_id || segment.book_stem} failed: ${e.message}`,
      { cause: e }
    );
  }
  applyVideo(doc, video);
  sanitizeUnknownTopLevel(doc);
  sanitizeOverlay(doc);

  let gates = await runGates(doc, renderCheck);
  let spent = 0;

  for (let rnd = 0; rnd < maxRounds; rnd++) {
    if (gateCost(gates) === 0) break;
    spent = rnd + 1;
    logToFile('lp612 author revision round', {
      correlationId, segmentId: segment.segment_id, round: spent, of: maxRounds,
      defects: gateCost(gates),
    });

    const fixUser = buildRevisionPrompt({ doc, gates, originalUser: user, notes: segment.notes });
    let candidate;
    try {
      candidate = await callWithRetry({
        system, user: fixUser, model: chosenModel, correlationId,
        stage: `revision${spent}`, usageSink: addUsage,
      });
    } catch (e) {
      // BOTH attempts unusable, or the transport blew up. That costs THIS ROUND, never the
      // ladder: the next round starts from the document we kept, with the same defect list.
      logToFile('lp612 author revision unusable — kept previous, continuing', {
        correlationId, segmentId: segment.segment_id, round: spent, error: e.message,
      }, 'warn');
      continue;
    }

    applyVideo(candidate, video);
    sanitizeUnknownTopLevel(candidate);
    sanitizeOverlay(candidate);
    const g2 = await runGates(candidate, renderCheck);
    if (gateCost(g2) <= gateCost(gates)) {
      doc = candidate;
      gates = g2;
    } else {
      // Upstream keeps the rejected candidate on disk — "was worse" with no numbers and no
      // artefact is unreviewable. A worker has nowhere to put it, so the numbers go to the log
      // and the document itself is dropped. Then CONTINUE, not break.
      logToFile('lp612 author revision was worse — kept previous, continuing', {
        correlationId, segmentId: segment.segment_id, round: spent,
        defectsCandidate: gateCost(g2), defectsKept: gateCost(gates),
        candidateFails: gateFails(g2).slice(0, 10),
      }, 'warn');
    }
  }

  const fails = gateFails(gates);
  logToFile('lp612 author finished', {
    correlationId, segmentId: segment.segment_id, model: chosenModel,
    rounds: spent, lintClean: fails.length === 0, fails: fails.slice(0, 10), usage,
  });

  return {
    lpDoc: doc,
    lintClean: fails.length === 0,
    fails,
    warns: gates.warns,
    rounds: spent,
    model: chosenModel,
    usage,
  };
}

/** printed_page_start..printed_page_end, inclusive — the fallback when pages_covered is empty. */
function rangeOf(start, end) {
  if (!Number.isInteger(start)) return [];
  const last = Number.isInteger(end) ? end : start;
  const out = [];
  for (let n = start; n <= last; n++) out.push(n);
  return out;
}

module.exports = {
  sanitizeOverlay,
  sanitizeUnknownTopLevel,
  pythonDictToJson,
  __extractJsonForTests: extractJson,
  authorLessonPlan,
  resolveAuthorModel,
  // exported for the suite and for anyone porting a fix back upstream
  extractJson,
  repairBackslashes,
  parseYt,
};
