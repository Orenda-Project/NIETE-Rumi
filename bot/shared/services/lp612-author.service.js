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
const { familyForBook } = require('../config/lp612-families');

// Static, literal requires on purpose: the repo's unresolved-require audit reads the source
// text, and a `require(path.join(...))` is invisible to it — which is how a vendored file that
// stopped existing would reach production as a runtime crash instead of a red gate.
const { lint } = require('../../vendor/lp-v9/lint_lp.js');
const { validateDoc } = require('../../vendor/lp-v9/lib/validate.js');
// The schema itself, for the ONE repair that needs to know which top-level keys exist. Read from
// the schema rather than copied into a list here, so a field added upstream is never silently
// deleted by this file.
const docSchema = require('../../vendor/lp-v9/schema/lp_doc.schema.json');

const VENDOR_DIR = path.join(__dirname, '..', '..', 'vendor', 'lp-v9');
const BRIEF_PATH = path.join(VENDOR_DIR, 'brief_author_v3.md');

// The model is the CALLER's choice, defaulted from the environment so the worker and any
// operator script agree without passing it around. Every call goes through llm-client
// (OpenRouter) — never the pipeline's Python backend picker, never a direct vendor API.
const DEFAULT_ROUNDS = 3;
const MAX_TOKENS = 24000;
const TEMPERATURE = 0.2;
const PAGE_TRUTH_MAX_CHARS = 90000;

/**
 * ONE resolver, in `lp612-flags.js`.
 *
 * This file used to carry its own private copy reading `LP_AUTHOR_MODEL`
 * directly. Because the worker calls authorLessonPlan() WITHOUT a model, that
 * private copy was the one that actually decided the production model — so a
 * family-aware resolver added to lp612-flags.js would have been dead code while
 * every unit test on it passed. Re-exported below so existing callers and tests
 * are unaffected.
 */
const { resolveAuthorModel, authorTierFor } = require('../config/lp612-flags');

function resolveRounds(explicit) {
  if (Number.isInteger(explicit) && explicit >= 0) return explicit;
  const env = parseInt(process.env.LP612_AUTHOR_ROUNDS, 10);
  if (Number.isInteger(env) && env >= 0) return env;
  return DEFAULT_ROUNDS;
}

/**
 * The system brief, by tier and subject family.
 *
 * `standard` is the v3 brief and is the path that serves teachers today — it
 * ignores the family entirely, so the current production prompt is byte-identical
 * to what it was before the pilot.
 *
 * `flash` resolves a per-family brief. Each family file carries the whole v3
 * brief VERBATIM plus its own preamble (upstream `build_flash_brief.py` asserts
 * that and fails on drift), so the flash tier is a superset of the canon rather
 * than a fork of it.
 *
 * Cached per resolved file, not globally: a worker authors many segments across
 * families in one process, and re-reading ~100 KB per lesson is pure waste.
 */
const _briefs = new Map();
function authorBrief(tier = 'standard', family = null) {
  const file = tier === 'flash' && family
    ? `brief_author_v3_flash_${family}.md`
    : 'brief_author_v3.md';
  if (!_briefs.has(file)) {
    _briefs.set(file, fs.readFileSync(path.join(VENDOR_DIR, file), 'utf8'));
  }
  return _briefs.get(file);
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
  const payload = {
    model,
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
    reasoning: { enabled: false },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };

  let res;
  try {
    try {
      res = await getClient().chat.completions.create(payload);
    } catch (e) {
      // Some reasoning-native models REFUSE to have it turned off and answer HTTP
      // 400 "Reasoning is mandatory for this endpoint and cannot be disabled".
      // Dropping a model over a payload flag would silently shrink the pilot to
      // whichever models happen to share our defaults, so retry once WITHOUT the
      // flag and let it think. The post-call check below then reports what that
      // cost, so an expensive model cannot hide inside the fallback.
      if (!/reasoning is mandatory/i.test(String(e && e.message))) throw e;
      logToFile('lp612 author: model mandates reasoning — retrying with it enabled', {
        correlationId, stage, model,
      }, 'warn');
      const { reasoning, ...withoutReasoning } = payload;
      res = await getClient().chat.completions.create(withoutReasoning);
    }
  } catch (e) {
    throw fail('LLM_FAILED', `${stage}: LLM call failed — ${e.message}`, { cause: e });
  }

  // ASSERT THE CONTRACT, DO NOT TRUST THE FLAG.
  //
  // Measured 2026-09-03, provider-pinned on OpenRouter for deepseek-v4-flash:
  // with no flag, StreamLake spent 2,680 reasoning tokens and Baidu 6,320, while
  // Azure and DeepInfra spent none. `reasoning:{enabled:false}` took all four to
  // zero; `thinking:{type:"disabled"}` — the DIRECT api.deepseek.com spelling — was
  // silently IGNORED by OpenRouter and left StreamLake at 2,788.
  //
  // OpenRouter load-balances, so which upstream serves a request is not ours to
  // choose. Reasoning bills as completion tokens and truncates the JSON at
  // max_tokens, so a provider that ignored the flag would cost ~60 s and a broken
  // document, silently. This turns that into a named, queryable signal.
  const reasoningTokens =
    (res && res.usage && res.usage.completion_tokens_details
      && res.usage.completion_tokens_details.reasoning_tokens) || 0;
  if (reasoningTokens > 0) {
    logToFile('lp612 author: reasoning was NOT disabled by the provider', {
      correlationId, stage, model, reasoningTokens,
      completionTokens: (res.usage && res.usage.completion_tokens) || 0,
    }, 'warn');
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

  // NEVER A SILENT BITE.
  //
  // This used to return `out.slice(0, maxChars) + '…[truncated]'` — no throw, no log, no message.
  // A long chapter lost its tail and the lesson was authored from a book that stopped
  // mid-sentence, at roughly 44 pages in English and 29 in Urdu, and nothing at any layer said
  // so. That is a textbook regression mask: the defect is invisible exactly where it would be
  // reported.
  //
  // A backstop, not the primary guard — fetchPages refuses over MAX_SEGMENT_PAGES before we get
  // here. This catches the other shape: a page range inside the cap whose pages are unusually
  // dense. It REFUSES for the same reason the cap does, and carries a distinct code so the worker
  // can persist which of the two happened.
  if (out.length > maxChars) {
    logToFile('lp612 page-truth exceeds the character bound, refusing', {
      chars: out.length, cap: maxChars, pages: (pages || []).length,
    }, 'error');
    const err = new Error(
      `page-truth is ${out.length} characters against a bound of ${maxChars}. `
      + 'Truncating it would author the lesson from an incomplete book.',
    );
    err.code = 'PAGE_TRUTH_TOO_LARGE';
    err.chars = out.length;
    err.cap = maxChars;
    throw err;
  }
  return out;
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
position in the chapter (INTERNAL corpus ids — ordering context only; these are NOT
titles and must NEVER appear in your output, least of all in \`sequence\`, which a
teacher reads on page 1): comes after [${segment.prev_segment_id || 'nothing'}], comes
before [${segment.next_segment_id || 'nothing'}]. In \`sequence.previous\` and
\`sequence.next\` write the TOPIC NAME of those lessons in the teacher's language, or
null if you do not know it.

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
/**
 * Internal corpus ids must never reach the sequence strip (bd-w56zx).
 *
 * The strip is rendered verbatim under the masthead on page 1, so a leaked id is
 * printed on a lesson a teacher carries into a classroom. It happened on the first
 * native-Urdu render: `sequence.previous = "grade_10_urdu.p1c01.r990"`.
 *
 * The prompt has been fixed to stop labelling internal ids with the output field's
 * own names, which is what invited the copy-through. This is the half that does not
 * depend on the model obeying: a prompt instruction is not an input contract (root
 * CLAUDE.md rule 24c), so the check runs in CODE, before the gates, on the first
 * parse and on every revision round — exactly where sanitizeOverlay runs.
 *
 * It never invents. The three NULLABLE fields are dropped. `this` is required with
 * minLength 3, so nulling it would make the document schema-invalid and cost the
 * whole round — a worse outcome than the leak — and it is instead replaced with the
 * segment's own human title, which we already hold on the row.
 *
 * @returns {string[]} notes, empty when the document was already clean
 */
function sanitizeSequence(doc, segment = {}) {
  const notes = [];
  const seq = doc && doc.sequence;
  if (!seq || typeof seq !== 'object') return notes;

  // The ids we actually handed the model. Exact matches need no heuristic.
  const known = [segment.segment_id, segment.prev_segment_id, segment.next_segment_id]
    .filter((v) => typeof v === 'string' && v.length > 0);

  // Backstop for an id the model INVENTED, which a teacher cannot tell from a real
  // one. Deliberately tight: <book_stem>.<chapter_key>.<locator>, all lowercase,
  // no spaces. A human title has spaces or capitals or non-Latin script, so
  // "Section 1.2 — Physical quantities" and "Ch. 3 assessment (day 12)" do not match.
  const ID_SHAPE = /\b[a-z][a-z0-9_]*\.[a-z0-9_]+\.[a-z0-9_-]+\b/;

  const looksLikeId = (v) =>
    typeof v === 'string' && (known.some((id) => v.includes(id)) || ID_SHAPE.test(v));

  for (const field of ['previous', 'next', 'checkpoint']) {
    if (looksLikeId(seq[field])) {
      notes.push(`sequence.${field}: dropped an internal segment id (${seq[field]})`);
      seq[field] = null;
    }
  }

  if (looksLikeId(seq.this)) {
    const title = segment.subtopic_title || segment.menu_title || segment.chapter_title;
    if (title) {
      notes.push(`sequence.this: replaced an internal segment id with the segment title`);
      seq.this = title;
    }
    // With no title on the row there is nothing truthful to substitute, so the id
    // stays and the schema gate reports it. Inventing a lesson name would be worse.
  }

  return notes;
}

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

/**
 * ADVISORY defect codes — real findings, recorded and returned, but they do not gate DELIVERY
 * and therefore may not buy a revision round on their own.
 *
 * `BUDGET` is here on measured evidence (bd-wbvtb, n=24, 2026-09-03):
 *
 *   • It does not gate delivery. The worker marks the row `ready` and sends the PDF whenever
 *     the final render is inside both page caps; `lint_clean` is RECORDED on that row and is
 *     never consulted. A lesson with a BUDGET defect reaches the teacher either way.
 *   • It is not satisfiable in this lane. Across the study's 23 saved documents the whole
 *     document ran 1,352-1,725 words against a 1,200 ceiling — the MINIMUM was 152 words over
 *     — and the pipeline's own v9 golden fixture measures 1,380 and fails it too. The ceiling
 *     was calibrated before `docWords` was widened to count section-level extras and the whole
 *     support page (~250 words a plan); the count moved and the number did not follow.
 *   • It points the wrong way. BUDGET says CUT WORDS; pages are spent on CARD COUNT, which is
 *     what the render defect says. The two instructions pulled against each other in one prompt.
 *
 * The cost of treating it as blocking: 23 of 24 lessons burned all five rounds, ~2 extra
 * minutes and ~$0.35 each, ~$3,900 across the corpus, for zero measured improvement — every
 * gate trajectory in the study was flat from round 2 or 3 onward.
 *
 * THE CEILING ITSELF IS NOT CHANGED HERE. The word budgets belong to the operator; this only
 * stops an unsatisfiable advisory defect from buying revision rounds. If the budget is ever
 * re-derived against today's word count, delete `BUDGET` from this set and the ladder chases it
 * again with no other change.
 *
 * Matching is on the lint's own `CODE: message` shape (lint_lp.js builds every fail as
 * `${code}: ${msg}`), so this is exact rather than a substring search that could catch the word
 * "budget" inside someone's prose.
 */
const ADVISORY_CODES = ['BUDGET'];
const isAdvisory = (d) => ADVISORY_CODES.some((c) => String(d).startsWith(`${c}:`));

/** The defects that actually decide whether the teacher gets a lesson. */
const blockingFails = (g) => gateFails(g).filter((d) => !isAdvisory(d));
const blockingCost = (g) => blockingFails(g).length;

/**
 * Is `a` an acceptable replacement for `b`? Lexicographic: fewer BLOCKING defects always wins,
 * and only on a tie there does total defect count decide (`<=`, so an equal-cost candidate is
 * still taken, which is the long-standing behaviour).
 *
 * The ordering matters. Under a flat count a candidate carrying one PAGE COUNT defect and no
 * BUDGET (cost 1) would displace a kept document that renders inside both caps and merely runs
 * long (cost 2) — trading a lesson that ships for one that does not.
 */
const notWorse = (a, b) =>
  (blockingCost(a) !== blockingCost(b) ? blockingCost(a) < blockingCost(b) : gateCost(a) <= gateCost(b));

/**
 * How many consecutive rounds may reduce no blocking defect before the ladder gives up.
 *
 * FOUR, and the number is measured rather than chosen. Replaying the new stop rule over the
 * n=24 study's own recorded per-round render gates:
 *
 *   threshold | revision rounds | lessons delivered | median wall
 *   ----------|-----------------|-------------------|------------
 *   none      |   118 -> 90     |     11 / 24       | 376s -> 356s
 *   >= 4      |   118 -> 85     |     11 / 24       | 376s -> 313s
 *   >= 3      |   118 -> 76     |     10 / 24  LOSES ONE
 *   >= 2      |   118 -> 59     |     10 / 24  LOSES ONE
 *
 * Cell c09 is what sets it, and it is worth knowing before anyone tunes this down. Its defect
 * list read "support needs 5 pages; the cap is 4" for FOUR consecutive rounds — one defect,
 * never fewer — while the document really was shrinking underneath (teach went 5 pages to 4 at
 * round 4), and the support part finally came inside the cap at round 5. Progress was real and
 * completely invisible to the defect list; it is invisible to page-overage and to total page
 * count too, both of which were also flat across those rounds. A threshold of 3 stops that
 * lesson one round before it succeeds and the teacher gets nothing.
 *
 * So: this guard is a bound on the pathological case, not the main saving. The main saving is
 * ADVISORY_CODES above — that is what takes 118 rounds to 90 without risking a single lesson.
 * If the round cap is ever raised above 5 this number matters much more; re-derive it against a
 * fresh sample rather than tightening it on intuition.
 */
const STALE_ROUNDS = 4;

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

  // The subject family drives BOTH the model (the maths/physics pilot) and, on the
  // flash tier, which preamble the model is given. Derived from book_stem, which
  // niete_lp612_segments carries NOT NULL, so it never needs a second lookup.
  const family = familyForBook(segment.book_stem);
  const chosenModel = model || resolveAuthorModel(family);
  const tier = authorTierFor(chosenModel);
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
  const system = authorBrief(tier, family);
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
  sanitizeSequence(doc, segment);

  let gates = await runGates(doc, renderCheck);
  let spent = 0;
  // Consecutive rounds that have reduced no BLOCKING defect. See STALE_ROUNDS.
  let stale = 0;

  for (let rnd = 0; rnd < maxRounds; rnd++) {
    // The climb ends when nothing that gates delivery is left — NOT when the defect list is
    // empty. An advisory defect (today: BUDGET) is reported and served, never chased.
    if (blockingCost(gates) === 0) break;
    if (stale >= STALE_ROUNDS) {
      logToFile('lp612 author ladder stopped — no blocking progress', {
        correlationId, segmentId: segment.segment_id, roundsUsed: spent, of: maxRounds,
        staleRounds: stale, blocking: blockingCost(gates),
        blockingFails: blockingFails(gates).slice(0, 5),
      });
      break;
    }
    spent = rnd + 1;
    const blockingBefore = blockingCost(gates);
    logToFile('lp612 author revision round', {
      correlationId, segmentId: segment.segment_id, round: spent, of: maxRounds,
      defects: gateCost(gates), blocking: blockingBefore,
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
      // It counts as a stale round — it improved nothing, and a transport that failed twice in
      // one round is not evidence the next one will land.
      stale += 1;
      logToFile('lp612 author revision unusable — kept previous, continuing', {
        correlationId, segmentId: segment.segment_id, round: spent, error: e.message,
      }, 'warn');
      continue;
    }

    applyVideo(candidate, video);
    sanitizeUnknownTopLevel(candidate);
    sanitizeOverlay(candidate);
    sanitizeSequence(candidate, segment);
    const g2 = await runGates(candidate, renderCheck);
    if (notWorse(g2, gates)) {
      doc = candidate;
      gates = g2;
    } else {
      // Upstream keeps the rejected candidate on disk — "was worse" with no numbers and no
      // artefact is unreviewable. A worker has nowhere to put it, so the numbers go to the log
      // and the document itself is dropped. Then CONTINUE, not break.
      logToFile('lp612 author revision was worse — kept previous, continuing', {
        correlationId, segmentId: segment.segment_id, round: spent,
        defectsCandidate: gateCost(g2), defectsKept: gateCost(gates),
        blockingCandidate: blockingCost(g2), blockingKept: blockingCost(gates),
        candidateFails: gateFails(g2).slice(0, 10),
      }, 'warn');
    }

    // Progress is measured on the BLOCKING list only. A round that shaved a word off an
    // advisory defect has not moved the lesson any closer to a teacher.
    if (blockingCost(gates) < blockingBefore) stale = 0;
    else stale += 1;
  }

  const fails = gateFails(gates);
  logToFile('lp612 author finished', {
    correlationId, segmentId: segment.segment_id, model: chosenModel,
    family, tier,
    rounds: spent, lintClean: fails.length === 0, fails: fails.slice(0, 10), usage,
  });

  return {
    lpDoc: doc,
    lintClean: fails.length === 0,
    fails,
    warns: gates.warns,
    rounds: spent,
    model: chosenModel,
    // Reported so the render row records WHICH harness produced the document. A
    // bake-off row that does not know its own tier is a mislabelled cell, which is
    // what made the first bake-off run unreadable.
    family,
    tier,
    usage,
  };
}

// ── the edit lane ───────────────────────────────────────────────────────────

/**
 * Her sentence, framed so the model treats it as an instruction to obey rather than prose to
 * fold in — and bounded, because the preamble it lands inside says "change nothing else" about
 * DEFECTS, not about how far her authority extends.
 */
function teacherInstructionNote(instruction) {
  return [
    'A TEACHER HAS ASKED FOR ONE CHANGE TO THIS LESSON. Apply it exactly and change nothing else.',
    '',
    `HER REQUEST: "${String(instruction).trim()}"`,
    '',
    'Rules for applying it:',
    '  - Apply ONLY this change. Every other section, item and sentence stays as it is.',
    '  - Keep every fact traceable to the same page-truth. Do not introduce content the printed',
    '    pages do not support.',
    '  - Keep the document valid: never remove a required property to satisfy her, and keep each',
    '    part inside its page cap.',
    '  - If her request cannot be satisfied without breaking one of those rules, apply the closest',
    '    version that does not, and leave the rest untouched.',
  ].join('\n');
}

/**
 * The repair round's note.
 *
 * It must NOT repeat her instruction. Re-asking for "shorter homework" against an already-
 * shortened document is how a lesson gets cut twice — and repair rounds are the common path, not
 * the corner case: 7 of the 12 measured cells needed one.
 */
const REPAIR_NOTE =
  "A teacher's edit has ALREADY been applied to the document below and must be PRESERVED. "
  + 'Fix ONLY the listed defects that edit introduced. Do not undo the edit, and do not apply it '
  + 'a second time.';

/**
 * Apply ONE teacher instruction to a lesson she already has.
 *
 * WHAT MAKES THIS CHEAP: there is no authoring call. The document we already paid for is the
 * starting point, and her sentence enters through the same `notes` channel `buildRevisionPrompt`
 * already renders above every gate finding. Measured across 12 cells: ~$0.27 an attempt against
 * ~$0.97 to author, and ~122s against ~376s.
 *
 * WHAT MAKES IT SAFE — and this is the part that must never be softened:
 *
 *   **A REJECTED EDIT RETURNS HER ORIGINAL.** To let a second round repair what the first one
 *   broke, the loop keeps climbing from the candidate — so on a final rejected round the working
 *   document is the broken one. Returning that with `accepted: false` beside it (which the
 *   prototype did) hands a caller the exact document the gates just refused, one careless
 *   `if (out.lpDoc)` away from sending it. So the original is captured up front and returned
 *   unchanged on every failure path: rejection, transport, unparseable, schema.
 *
 * ACCEPTANCE IS ABSOLUTE, NOT RELATIVE. `notWorse()` on the authoring ladder compares two
 * candidates chasing the same target. Here the incumbent is a document she ALREADY HAS and which
 * already renders, so the bar is "introduces no NEW blocking defect" — an edit is not entitled to
 * cost her a working lesson just by being an improvement on its own last attempt.
 *
 * `rounds` is a REPAIR budget, not an edit budget: round 1 applies her instruction, and any
 * further round exists only to fix what that broke.
 *
 * @param {object} args
 * @param {object} args.doc          the persisted lp_doc she was sent
 * @param {string} args.instruction  her words, verbatim
 * @param {object} args.segment      the segment row, for page-truth and the original task
 * @param {'en'|'ur'} [args.lang]
 * @param {string} [args.model]
 * @param {number} [args.rounds=2]   total rounds: 1 edit + (rounds-1) repair
 * @param {function} [args.renderCheck] async (doc) -> string[] of RENDER defects
 * @returns {Promise<{lpDoc:object, accepted:boolean, gatesBefore:object, gatesAfter:object,
 *                    rejectedFails:string[], rounds:number, usage:object, model:string}>}
 */
async function reviseLessonPlan({
  doc, instruction, segment, lang, model, rounds = 2, correlationId, renderCheck,
} = {}) {
  if (!doc || typeof doc !== 'object') {
    throw fail('REVISE_INPUT', 'reviseLessonPlan needs the document to edit');
  }
  if (!instruction || !String(instruction).trim()) {
    throw fail('REVISE_INPUT', 'reviseLessonPlan needs a teacher instruction');
  }
  if (!segment || !segment.book_stem) {
    throw fail('REVISE_INPUT', 'reviseLessonPlan needs a segment with a book_stem');
  }

  // HERS. Captured before anything can mutate it, deep-copied because the sanitisers below
  // mutate in place and would otherwise reach into the document we promised to hand back.
  const original = JSON.parse(JSON.stringify(doc));

  const chosenModel = model || resolveAuthorModel();
  const language = clampLanguage(lang || segment.medium);

  const bundle = await fetchPages({
    bookStem: segment.book_stem,
    pages: segment.pages_covered && segment.pages_covered.length
      ? segment.pages_covered
      : rangeOf(segment.printed_page_start, segment.printed_page_end),
    correlationId,
  });

  const video = parseYt(segment.yt);
  const system = authorBrief();
  const originalUser = buildUserPrompt({ segment, bundle, lang: language, video });

  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0 };
  const addUsage = (u) => {
    usage.calls += 1;
    usage.prompt_tokens += (u && u.prompt_tokens) || 0;
    usage.completion_tokens += (u && u.completion_tokens) || 0;
    usage.total_tokens += (u && u.total_tokens) || 0;
  };

  // The bar. Her document's own defect count — an edit may not raise it.
  const gatesBefore = await runGates(original, renderCheck);
  const bar = blockingCost(gatesBefore);

  let current = original;
  let gates = gatesBefore;
  let accepted = false;
  let spent = 0;

  for (let rnd = 0; rnd < Math.max(1, rounds); rnd++) {
    spent = rnd + 1;
    const notes = rnd === 0 ? teacherInstructionNote(instruction) : REPAIR_NOTE;
    const fixUser = buildRevisionPrompt({ doc: current, gates, originalUser, notes });

    let candidate;
    try {
      candidate = await callWithRetry({
        system, user: fixUser, model: chosenModel, correlationId,
        stage: `edit${spent}`, usageSink: addUsage,
      });
    } catch (e) {
      // Both attempts unusable, or the transport died. That costs the round, and — if it was the
      // last one — the edit. Never her lesson.
      logToFile('lp612 edit: round unusable, keeping the previous document', {
        correlationId, segmentId: segment.segment_id, round: spent, error: e.message,
      }, 'warn');
      continue;
    }

    applyVideo(candidate, video);
    sanitizeUnknownTopLevel(candidate);
    sanitizeOverlay(candidate);
    sanitizeSequence(candidate, segment);

    const g2 = await runGates(candidate, renderCheck);

    if (blockingCost(g2) <= bar) {
      current = candidate;
      gates = g2;
      accepted = true;
      break;                       // clean enough to ship; further rounds buy nothing
    }

    // Not acceptable YET. Climb from it anyway so the next round can repair what it broke —
    // but `accepted` stays false, and the return below is what guarantees that a run which ends
    // here hands back the original rather than this.
    logToFile('lp612 edit: candidate introduced blocking defects', {
      correlationId, segmentId: segment.segment_id, round: spent,
      bar, candidate: blockingCost(g2), fails: blockingFails(g2).slice(0, 5),
    }, 'warn');
    current = candidate;
    gates = g2;
    accepted = false;
  }

  // THE CONTRACT. Accepted → the edit. Anything else → hers, untouched.
  const lpDoc = accepted ? current : original;
  const rejectedFails = accepted ? [] : blockingFails(gates);

  logToFile('lp612 edit finished', {
    correlationId, segmentId: segment.segment_id, model: chosenModel,
    accepted, rounds: spent, bar, rejectedFails: rejectedFails.slice(0, 5), usage,
  });

  return {
    lpDoc,
    accepted,
    gatesBefore,
    gatesAfter: gates,
    rejectedFails,
    rounds: spent,
    usage,
    model: chosenModel,
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
  compactPageTruth,
  PAGE_TRUTH_MAX_CHARS,
  sanitizeOverlay,
  sanitizeSequence,
  sanitizeUnknownTopLevel,
  buildUserPrompt,
  pythonDictToJson,
  __extractJsonForTests: extractJson,
  authorLessonPlan,
  reviseLessonPlan,
  resolveAuthorModel,
  // exported for the suite and for anyone porting a fix back upstream
  extractJson,
  repairBackslashes,
  parseYt,
};
