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
// Additive semantic-event channel (feature.action.result). The prose lines stay; this is the
// name a query can count without a regex over a sentence somebody will improve one day.
const { logEvent } = require('../utils/structured-logger');
const { getClient } = require('./llm-client');
const { fetchPages } = require('./lp612-pagetruth.service');
const { clampLanguage } = require('../config/ux-strings');
const { familyForBook } = require('../config/lp612-families');

// Static, literal requires on purpose: the repo's unresolved-require audit reads the source
// text, and a `require(path.join(...))` is invisible to it — which is how a vendored file that
// stopped existing would reach production as a runtime crash instead of a red gate.
const { lint } = require('../../vendor/lp-v9/lint_lp.js');
const { meetsSubjectMinimum } = require('../../vendor/lp-v9/visual_check.js');
const { validateDoc } = require('../../vendor/lp-v9/lib/validate.js');
// The renderer's OWN pointer resolver and frozen-slot list, so `sanitizeOverlay` cannot
// disagree with `applyOverlay` about what is applicable — one implementation, not two.
const { pointerParent, frozenReason } = require('../../vendor/lp-v9/lib/overlay.js');
// The page caps the RENDERER will actually gate on, so the budget card in the prompt and the
// gate can never state different numbers (bd-vjk68). This module's top-level cost is `fs`,
// `path` and its own libs — `playwright-core` is required lazily inside the launch path — so
// pulling it in here does not drag a browser into the author process.
const { pageCapsFor } = require('../../vendor/lp-v9/render_lp.js');
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
 * banned — and a request for Urdu against an English-medium book is authored in English and
 * carries its Urdu toggle as an `ur_overlay` on the same document.
 *
 * THIS FUNCTION USED TO SAY THE OPPOSITE, AND IT COST EVERY URDU LESSON ITS LANGUAGE (bd-vnyuw).
 *
 * It read: *"the Urdu toggle is built by a separate pass over the finished document. Do NOT emit
 * ur_overlay yourself."* **There is no separate pass.** `git grep ur_overlay` across the repo
 * finds only readers — `applyOverlay`, `lint`, `visual_check`, and `sanitizeOverlay`, which can
 * only DROP one. Nothing has ever written one. So `doc.ur_overlay` was always absent,
 * `applyOverlay` always returned `applied: []`, and the worker always set `overlay_dropped`.
 *
 * Measured on staging 2026-09-05: of the nine English-medium books ever requested in Urdu, ALL
 * SIX that reached `ready` carry `overlay_dropped = true`. Not most — all. A teacher who chose
 * «اردو» received an English lesson under Urdu headings, every time, with no error at any layer.
 *
 * The system prompt was right all along: brief §7b says "Then add an `ur_overlay`" and §7c.7 says
 * "overlay EVERY instruction string you are allowed to". This per-request directive was the one
 * thing contradicting it, and the model obeyed the later, more specific instruction — as it
 * should have. The directive now agrees with the brief and points at it, and
 * `lint_lp.js`'s `OVERLAY_MISSING` asserts the result in code rather than trusting compliance.
 */
function languageDirective(want, medium) {
  if (want === 'ur' && medium !== 'ur') {
    return 'The teacher asked for URDU. This is an English-medium book, so author the lp_doc in ' +
      'ENGLISH exactly as §7 requires, and THEN add the `ur_overlay` that §7b defines: a flat map ' +
      'of RFC-6901 JSON Pointer into this same document -> the Urdu string that replaces the ' +
      'English one at render time. The structure never changes; only instruction strings swap. ' +
      'Overlay EVERY instruction string you are allowed to (§7c.7) — a half-overlaid document ' +
      'serves half-English prose under an Urdu label, and the renderer cannot fix a missing ' +
      'translation. Do NOT overlay /slo/text_verbatim, anything under /page2/exam_bank, or the ' +
      '`text` of any `board` block: those follow the book\'s and the exam\'s language. Without ' +
      'the overlay this teacher receives an English lesson under Urdu headings.';
  }
  if (want === 'en' && medium === 'ur') {
    return 'The teacher asked for ENGLISH, but this is an URDU-MEDIUM book: author the whole ' +
      'lp_doc in Urdu (§7). The book\'s language of instruction wins; a self-translated Urdu ' +
      'lesson in English is law L1d\'s exact failure.';
  }
  // An Urdu-MEDIUM book asked for in Urdu is authored in Urdu ONCE and carries no toggle. Said
  // out loud, because the branch above now demands an overlay in as many words and a model that
  // generalises the wrong way would translate an Urdu lesson into an Urdu lesson (brief §7b, and
  // visual_check V12 fails an Urdu-medium document that carries an ur_overlay at all).
  if (medium === 'ur') {
    return 'Author the whole lp_doc in Urdu — the book\'s own medium (§7b) — and emit NO '
      + 'ur_overlay: an Urdu-medium document has nothing to toggle.';
  }
  return `Author in the book's own medium: ${medium}.`;
}

// ── the budget card ─────────────────────────────────────────────────────────
//
// bd-vjk68. THE AUTHOR IS TOLD ITS BUDGET UP FRONT, WHERE IT WILL BE READ.
//
// The operator's complaint, verbatim: *"please make sure author is also aware of page/word
// budget etc, its weird that it only finds out later"*. It was half right and the half that was
// wrong matters. §8 of `brief_author_v3.md` DOES carry the caps on the first pass, in pages —
// but it sits at line ~890 of a 70KB system prompt, and the one sentence that says HOW to spend
// a page ("pages are spent on CARD COUNT… REMOVE WHOLE ITEMS") appears only in the revision
// prompt. So the first draft is written by a model that has been told a number it cannot
// measure and not told the quantity it can.
//
// This card is the fix, and it is deliberately three things and no more:
//
//   1. THE CAPS FOR THIS RENDER'S LANGUAGE, read from the renderer's own `pageCapsFor` — never
//      retyped here. A cap the prompt states and the gate does not enforce (or vice versa) is
//      the contradiction bd-owx8t was: two orders in one prompt, and the wrong one first.
//   2. AIMS IN UNITS THE MODEL CAN COUNT, derived from the corpus rather than invented:
//      `cap_policy_2026-09-04/derive_budget_card.py` over the 62 re-rendered documents (39
//      delivered off staging + the n=24 study's cells). Exam answerables median 6 (p25 6, p75 7);
//      model_answers median 4 (p25 2, p75 5); homework 3-4 with 5 the lint's existing hard stop;
//      whole document median 16,550 minified chars = the measured p50 of 7,690 completion tokens,
//      p90 ~8,300.
//   3. THE HONEST TERMS. Pages are measured after rendering, the model cannot see them, and a
//      long lesson is DELIVERED. Without that last sentence a length note reads as a gate and
//      the model cuts real pedagogy to clear it — which is the exact own-goal PR #597 removed.
//
// WHAT IT IS NOT: a ceiling. FINDING.md swept every candidate card-count ceiling over the whole
// corpus and the best trade anywhere catches 2 over-cap parts and blocks 33 good ones; the
// over-cap documents sit at or BELOW the median on every countable. So nothing here is linted,
// nothing here fails a document, and the numbers are stated as aims from lessons that fit.
//
// EXPECTED EFFECT, STATED HONESTLY SO NOBODY LATER READS MORE INTO IT: small. The one previous
// brief-side volume experiment on this pipeline (bake-off round 4) tightened every aim in §8 and
// measured no reduction at all. This is a change of POSITION and CONTENT, not just wording — it
// moves the budget from line 890 of the system prompt to line 1 of the user turn, and adds the
// countable the model was never given — but the honest prior is that it moves page counts a
// little, and the delivery policy above is what actually removes the failure class.
function budgetCard(lang) {
  const caps = pageCapsFor(lang).max;
  return [
    '## YOUR PAGE BUDGET FOR THIS LESSON — read this before you write anything',
    '',
    `This lesson is laid out on A4 and MEASURED after you write it. For this render the caps are `
      + `**TEACH ≤ ${caps.teach} pages, SUPPORT ≤ ${caps.support} pages**.`,
    '',
    'You cannot count pages — you never see the layout. These you CAN count, and they are what',
    'the paper is actually spent on. Measured over 62 rendered lessons, the ones that FIT carry:',
    '',
    '  · exam_bank — about 6 answerables in total (MCQs + short response + each extended-response',
    '    part counted separately); 7 is the high end.',
    '  · model_answers — about 4 entries; 2 is common and perfectly acceptable.',
    '  · homework — 3 to 4 items (5 is the lint\'s hard stop).',
    '  · the whole lp_doc — a lesson that fits is roughly 7,700 tokens of JSON, and about 8,300',
    '    at the long end. Past that you are writing paper this lesson does not have.',
    '',
    'Those are AIMS taken from lessons that fit, not gates: nothing above is checked, and no',
    'count of items has ever been the difference between a lesson that fits and one that does',
    'not. Write the COMPLETE lesson — completeness beats page count, and cutting a required',
    'property to save space fails the whole document.',
    '',
    'And the honest terms, so you aim rather than fear: the pages are measured after rendering,',
    'a lesson over the cap is STILL DELIVERED to the teacher, and if it runs long it costs one',
    'revision round — never the lesson. Do not compress by writing denser prose, and never drop',
    'the body size.',
    '',
  ].join('\n');
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

/**
 * THE BOOK'S MEDIUM, AS A LANGUAGE CODE — bd-xrv72.
 *
 * `_book.json` and `niete_lp612_segments.medium` both store the human LABEL: `"Urdu"` /
 * `"English"`, never `ur` / `en`. (Measured on staging: 1,000 segments, 694 `medium:"English"`
 * and 306 `medium:"Urdu"`, and not one ISO code among them.) `clampLanguage` is a CODE clamp
 * over `LANGUAGE_OFFER` and returns the `en` FLOOR for anything it does not recognise — so
 * `clampLanguage("Urdu") === "en"`, and every Urdu-medium book in the corpus was handed a
 * prompt opening with, verbatim:
 *
 *     "The teacher asked for URDU. This is an English-medium book, so author the lp_doc in
 *      ENGLISH…"
 *
 * under an identity line that contradicted itself in place: `medium: ur (en)`.
 *
 * The model usually overrode it, because the page-truth in front of it is visibly Urdu — d01
 * came back 77% Urdu and d02 73% — which is exactly why this survived: it looked like
 * "run-to-run variance" rather than a directive. It is a coin flip on a teacher's language, and
 * on d03 (`grade_7_zari_taleem`, a PCTB Urdu book) the coin came up English: an English lesson
 * under Urdu headings, `provenance.medium: "en"`, and `overlay_dropped = FALSE` — because the
 * worker reads the segment's own `language` column and THAT column was right. A clean-looking
 * row on a wrong-language lesson (rule 24(a): a status field is a claim).
 *
 * The fix is a translation at the boundary, not a widening of `clampLanguage`: that function is
 * the shared code clamp for the whole bot and must keep rejecting non-codes. The ISO `language`
 * column is preferred where it exists, because it is already a code; the label is mapped only as
 * the fallback. An unrecognised label still floors to English rather than throwing — this sits
 * on the authoring path and must not fail closed.
 */
const MEDIUM_LABELS = { urdu: 'ur', english: 'en' };
function mediumCode(...candidates) {
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const v = raw.trim();
    if (!v) continue;
    const mapped = MEDIUM_LABELS[v.toLowerCase()] || v;
    // clampLanguage still owns the decision — this only speaks its language.
    const code = clampLanguage(mapped);
    // A recognised value wins outright; an unrecognised one falls through to the next
    // candidate rather than silently claiming the floor on the first junk field it meets.
    if (code === mapped) return code;
  }
  return clampLanguage(null); // the floor, from the one function that owns it
}

function buildUserPrompt({ segment, bundle, lang, video }) {
  const book = bundle.book || {};
  // The book's medium is a language decision like any other, so it goes through the one
  // function that owns them — via `mediumCode`, which speaks the corpus's labels as well as
  // its codes (bd-xrv72). Order: the book record's own code, then its label, then the
  // segment's.
  const medium = mediumCode(book.language, book.medium, segment.language, segment.medium);
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

  // THE BUDGET CARD IS THE FIRST THING IN THE TURN, above even the lesson's identity. It is
  // here rather than appended to the brief because §8 of the brief is line ~890 of a 70KB
  // system prompt, and "it only finds out later" is the operator's whole complaint.
  return `${budgetCard(lang)}
# LESSON TO AUTHOR

## LANGUAGE
${languageDirective(lang, medium)}

lesson_id: ${segment.segment_id}
book_stem: ${segment.book_stem}  ·  ${book.title || ''}
grade: ${book.grade != null ? book.grade : segment.grade}  ·  subject: ${book.subject || segment.subject}  ·  medium: ${book.medium || segment.medium || medium} (${medium})
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

// bd-owx8t: THE PREAMBLE NO LONGER ORDERS A WORD CUT.
//
// It used to read "Fix EVERY listed defect, including every word-budget line: when a budget says
// CUT N words, actually delete that much text from that section rather than rewording it, and
// OVERSHOOT the cut by about 10%". That was written when BUDGET was a gate. It has not been one
// since 2026-09-03 (bd-wbvtb, `ADVISORY_CODES`), and leaving the sentence behind left the model
// under two contradictory orders in one prompt — this one, first and amplified, and the
// page-count block below saying in as many words that shortening sentences will NOT remove a page.
//
// Measured over 62 real lp_docs on 2026-09-04 (39 delivered off staging since the Urdu caps went
// live, plus the n=24 study's cells) replayed through the shipped lint: BUDGET fires on 59 of the
// 62 — on the documents teachers actually received — 119 lines against 8 from every other lint
// code combined, with whole-document counts of 1,290-1,830 words against a 1,200 ceiling. A rule
// that fires on 95% of a corpus carries no information about the 5%. And it is not even aimed at
// the right quantity: word count scores r = 0.375 against the renderer's own measured content
// height and r = 0.18 against printed pages.
//
// So every round spent real text — 10% more than asked — on a ceiling nothing has ever met, for a
// number that does not decide the page count being revised for. The defect is still computed,
// returned and stored on the row; it is drafting feedback, not an order.
const REVISION_PREAMBLE =
  'Your previous lp_doc is below, followed by every defect found by the schema validator and ' +
  'the deterministic lint.\n\n' +
  'Return the COMPLETE corrected lp_doc JSON — the whole document, not a patch, not a diff. ' +
  'Fix EVERY listed defect. Change nothing else. Keep every fact traceable to the same ' +
  'page-truth.\n\n';

/**
 * THE VISUAL CONTRACT IS LISTED FIRST, AND IT IS LISTED AS A THING TO FIX.
 *
 * Measured across the n=24 study's 118 revision rounds, the defect lines the model was handed
 * were: `PAGE COUNT` **158 times**, `OVERFLOW` 7, `FIGURE TOO SMALL` 4 — and `VISUALS` once, in
 * 24 runs. Every sustained instruction in the ladder said DELETE, and the page-count block below
 * says it in as many words ("REMOVE WHOLE ITEMS", "Shortening sentences will NOT remove a page").
 * A diagram costs page height. Under five rounds of that, with nothing pulling the other way, the
 * cheapest surviving figure wins — which is how the corpus arrived at 1.77 diagrams a lesson
 * against its own stated floor of 2, and 83.5% of them the three types that cost the least space.
 *
 * So ordering here is not cosmetic. Two things fix it, and both are needed:
 *
 *   • the page cap is SOFT (see the cap policy) — length yields, the visual floor does not;
 *   • and the list the model reads puts the visual defects at the top, under a heading that says
 *     to ADD the missing figure, so it cannot be read as one more thing to cut.
 *
 * `VISUAL:` lines are hoisted out of the lint block rather than reordered inside it, because a
 * heading is the part the model actually acts on — the same reason the page-count block exists at
 * all instead of a bare "it is too long".
 */
const isVisual = (d) => String(d).startsWith('VISUAL:');

function buildRevisionPrompt({ doc, gates, originalUser, notes, lang }) {
  // ADVISORY defects are recorded, not chased (see ADVISORY_CODES). A defect the ladder will not
  // spend a round on must not spend the model's attention either: showing it under "Fix EVERY
  // listed defect" is an order to act on something we have decided does not matter.
  const kept = gates.lint.filter((d) => !isAdvisory(d));
  const visual = kept.filter(isVisual);
  const lint = kept.filter((d) => !isVisual(d));
  const warns = gates.warns.filter((d) => !isAdvisory(d));
  // The SAME card the first pass opened with, first again — above the defect lists, not buried
  // under them. `originalUser` carries a copy too, but it is appended LAST, ~40k tokens down,
  // which is exactly the position the operator objected to. Restating it costs ~250 tokens
  // against a 40,211-token revision prompt whose duration is explained (R² 0.91) by OUTPUT
  // volume alone, with a NEGATIVE input coefficient — so this is free in latency terms.
  return budgetCard(clampLanguage(lang)) + '\n' + REVISION_PREAMBLE +
    (notes ? `=== THE OPERATOR'S NAMED DEFECTS — THESE OUTRANK EVERYTHING BELOW ===\n${notes}\n\n` : '') +
    (visual.length
      ? '=== THE VISUAL CONTRACT (§4b) — FIX THESE FIRST, BY ADDING A FIGURE ===\n'
        + 'These are missing PICTURES, and the fix is always to put one in — never to delete '
        + 'something else to make room, and never to satisfy a later page-count note by dropping '
        + 'a diagram. Page length is soft here; this floor is not. Emit the exact spec shape from '
        + 'brief §4b.4 for the type named, and put it beside the beat it explains.\n'
        + visual.join('\n') + '\n\n'
      : '') +
    '=== PREVIOUS lp_doc ===\n' + JSON.stringify(doc, null, 1) +
    '\n\n=== SCHEMA ERRORS ===\n' + (gates.schema.join('\n') || '(none)') +
    '\n\n=== LINT ERRORS ===\n' + (lint.join('\n') || '(none)') +
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
        + 'missing required property fails the whole document and wastes the round. '
        // The diagram is the FIRST thing a length instruction reaches for — it is the biggest
        // single object on the page and the easiest to justify dropping. It is also the thing
        // §4b makes mandatory, and the thing the corpus proves does not survive five rounds of
        // "make it shorter". Naming it is the counter-pressure.
        + 'AND DO NOT REMOVE A DIAGRAM: the visual contract in §4b is a floor, the page count is '
        + 'not — a lesson that comes in one page over with its figures intact is served, and a '
        + 'lesson that fits by dropping its figures is not. If a figure is genuinely too tall, '
        + 'make it smaller (a `flow` with direction "lr" instead of "tb", fewer branches, shorter '
        + 'labels) rather than deleting it.'
      : '') +
    '\n\n=== LINT WARNINGS ===\n' + (warns.join('\n') || '(none)') +
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
 *
 * ── AND A POINTER THAT CANNOT BE APPLIED IS DROPPED TOO (bd-vnyuw, 2026-09-05) ──────────────
 *
 * Found by running the fix rather than by reading it. Once `languageDirective` stopped
 * forbidding the overlay, the very first authoring call for `grade_8_mathematics.c01.p006-009`
 * came back with 55 pointers — and EIGHT of them addressed blocks the model had not written:
 *
 *   ur_overlay: pointer targets nothing: /sections/1/blocks/2/legend
 *   ur_overlay: pointer does not resolve: /sections/1/blocks/3/steps/0
 *
 * `applyOverlay` collects those as `errors`, and `render_lp.js` **throws `OVERLAY_INVALID` and
 * refuses the whole document** the moment `errors` is non-empty. So the fix for "she receives an
 * English lesson" had, on its own, manufactured "she receives NO lesson" — the exact failure
 * class this lane exists to remove, and the same shape as the `SCHEMA INVALID … /ur_overlay must
 * be object` incident this function was written for in the first place.
 *
 * A pointer that resolves to nothing replaces nothing: dropping it cannot lose one character,
 * and keeping it loses the lesson. A FROZEN pointer is dropped for the same reason — it is an
 * error in the same list and equally fatal. Both are mechanically decidable, which is the whole
 * test for whether a repair belongs here.
 *
 * The signal is NOT lost, which is what makes this a repair rather than a cover-up: every
 * dropped pointer lowers the overlay's coverage, and `lint_lp.js`'s `OVERLAY_MISSING` blocks
 * below half and names the pointers still missing. The ladder is told to write them properly;
 * the teacher is not told nothing.
 *
 * The resolver and the frozen list are imported from `lib/overlay.js` — the renderer's own —
 * so this function and `applyOverlay` cannot drift apart about what "applicable" means.
 */
function sanitizeOverlay(doc) {
  if (!doc || !Object.prototype.hasOwnProperty.call(doc, 'ur_overlay')) return doc;

  const ov = doc.ur_overlay;
  const isPlainObject = ov && typeof ov === 'object' && !Array.isArray(ov);
  if (!isPlainObject) {
    delete doc.ur_overlay;
    return doc;
  }

  /** Exactly `pointerSet`'s precondition, and `frozenReason`'s veto, asked without mutating. */
  const applicable = (pointer) => {
    if (frozenReason(doc, pointer)) return false;
    let loc;
    try {
      loc = pointerParent(doc, pointer);
    } catch (_) {
      return false; // not a well-formed pointer at all
    }
    if (!loc) return false;
    const k = Array.isArray(loc.parent) ? Number(loc.key) : loc.key;
    return loc.parent[k] !== undefined;
  };

  const kept = {};
  for (const [pointer, value] of Object.entries(ov)) {
    if (!pointer.startsWith('/') || typeof value !== 'string') continue;
    if (!applicable(pointer)) continue;
    kept[pointer] = value;
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
 *
 * `meta` is optional context (correlationId/segmentId/round) for the telemetry line below — it
 * changes nothing about the gate decision, only what a schema failure can be traced back to.
 */
async function runGates(doc, renderCheck, meta = {}) {
  const v = validateDoc(doc);
  // The `SCHEMA:` prefix is the lint's own vocabulary for the same finding — worth matching so
  // a caller (and the revision prompt) reads one consistent list of coded defects.
  if (!v.ok) {
    // Visibility on how often the model hands back a document that cannot even be lint-checked,
    // let alone rendered — bd-jddcu was found only because a human read one render-service log
    // line by hand. This is the counter that answers "how often" without that.
    logEvent('lp612.author.schema_invalid', {
      correlationId: meta.correlationId || null,
      segmentId: meta.segmentId || null,
      round: typeof meta.round === 'number' ? meta.round : null,
      errorCount: v.errors.length,
      errors: v.errors.slice(0, 5),
    });
    return { schema: v.errors.map((e) => `SCHEMA: ${e}`), lint: [], render: [], warns: [] };
  }
  // `docPath` is unused by lint() — it takes it for its CLI's sake. Nothing here writes.
  //
  // `lang` is the language THE TEACHER ASKED FOR, and it has to be passed because the document
  // cannot state it: an English-medium book authored in English looks identical whether it was
  // requested in English or in Urdu. That is precisely why a missing `ur_overlay` was invisible
  // to every gate for the whole life of this lane (bd-vnyuw).
  const r = lint(doc, null, { lang: meta.lang || null });

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
 * Did this candidate even reach lint/render? See `runGates`: a schema failure short-circuits,
 * so `g.schema` is non-empty ONLY on that path — a schema-valid document always has `schema: []`
 * (its findings, if any, live in `lint`/`render` instead).
 */
const schemaOk = (g) => g.schema.length === 0;

/**
 * Is `a` an acceptable replacement for `b`?
 *
 * SCHEMA VALIDITY IS A HARD TIER, ABOVE THE DEFECT COUNT — bd-jddcu. `runGates` short-circuits
 * on a schema failure, so a schema-invalid gate result carries ONLY schema errors: lint and the
 * render probe never ran on it, and never got the chance to add their own defects to its count.
 * A schema-valid candidate, by contrast, has been scored on the FULL gate set. Comparing the two
 * on raw defect count is therefore comparing an undercount to a real count, and it can only ever
 * favour the broken document — which is exactly what happened: a candidate that failed schema
 * with one error read as "cheaper" than a valid candidate carrying three lint/render defects, so
 * `notWorse` preferred it, and a document the renderer cannot even open reached the renderer.
 *
 * A schema-invalid document is not "a bit worse" than a valid one — it cannot be turned into a
 * PDF at all, regardless of how few nominal defects it lists. So this is not a matter of
 * reweighting the count (there is no number of lint/render defects that should make a broken
 * document win); it is a categorical ordering. Hence a tier check ahead of the existing
 * lexicographic comparison, rather than folding schema into `gateCost`/`blockingCost` — doing the
 * latter would let a valid document with enough accumulated lint noise still lose to a
 * schema-invalid one on the numbers, which is the same bug with extra steps.
 *
 * Only once both sides are on the same side of that line does the existing rule decide: fewer
 * BLOCKING defects wins, and only on a tie there does total defect count decide (`<=`, so an
 * equal-cost candidate is still taken — long-standing behaviour, unchanged).
 */
const notWorse = (a, b) => {
  const aOk = schemaOk(a);
  const bOk = schemaOk(b);
  if (aOk !== bOk) return aOk; // valid beats invalid outright; invalid never beats valid
  return (blockingCost(a) !== blockingCost(b) ? blockingCost(a) < blockingCost(b) : gateCost(a) <= gateCost(b));
};

/**
 * THE REWARD SIDE OF THE VISUAL CONTRACT.
 *
 * `lint_lp.js` has FOUR ways to fail because a diagram is present — `FIGURE` (a label under the
 * 13.5px floor), `DIAGRAM_OVERLAP`, `DIAGRAM_DEGENERATE`, `DUPLICATE_DIAGRAM` — and, before
 * §4b was wired in, exactly zero ways to be rewarded for one. All four can only fire ON a
 * figure, and the ones they fire on are the dense subject-specific types: a `circuit`, a
 * `ray_diagram`, a `punnett`, a `labelled_figure` is what trips label size and collisions.
 * `flow`, `mindmap` and `panels` have short labels by construction. The gradient ran one way,
 * and `notWorse` — which decides on defect COUNT alone — pointed the same way: a candidate that
 * dropped its dense figure lost every defect that figure could have caused, and won.
 *
 * So the count is no longer the only thing compared. Meeting the subject's §4b.2 minimum is a
 * TIER above it, in the same shape as the schema tier above: a candidate that satisfies its
 * subject's minimum is not "a bit better" than one that dodged it — a Chemistry lesson with no
 * molecule in it is not a Chemistry lesson, however few defects it lists.
 *
 * Deliberately narrower than it could be, in two ways:
 *
 *   • It only ever protects a candidate that MEETS the minimum. When neither side meets it (the
 *     common case mid-ladder) or both do, the existing comparison decides exactly as before, so
 *     this cannot slow the climb on any document where the contract is not the live question.
 *   • It is a tier, not a weight. Folding "+1 for a subject figure" into `blockingCost` would
 *     let a document with enough other defects still lose its figures to the numbers — the same
 *     bug with extra steps, which is the reasoning `schemaOk` records above.
 *
 * Ordering: schema validity outranks it. A schema-invalid document cannot be rendered at all, so
 * a beautiful figure inside one buys nothing.
 */
const notWorseVisual = (a, b, aDoc, bDoc) => {
  const aOk = schemaOk(a);
  const bOk = schemaOk(b);
  if (aOk !== bOk) return aOk;
  if (aOk && bOk) {
    const aMeets = meetsSubjectMinimum(aDoc);
    const bMeets = meetsSubjectMinimum(bDoc);
    // Never take a candidate that gave up a minimum the document we already hold was meeting.
    if (aMeets !== bMeets) return aMeets;
  }
  return notWorse(a, b);
};

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

/**
 * PAGE-COUNT OVERFLOW BUYS AT MOST ONE REVISION ROUND (bd-vjk68).
 *
 * Operator, 2026-09-04: *"we will stop cancelling or delaying lesson plans now because of the
 * length issue"*. This is the "delaying" half; the worker owns the "cancelling" half.
 *
 * THE ARITHMETIC. A round costs ~60s and that is essentially all of it —
 * `latency_breakdown_2026-09-04/BREAKDOWN.md` measures authoring as (1 + rounds) × ~60s + 15s,
 * with 99.0% of the wall clock inside LLM calls, because every revision re-emits the WHOLE
 * ~7,900-token document ("the COMPLETE corrected lp_doc JSON — not a patch"), and duration is
 * 6.3s per 1k OUTPUT tokens at R² 0.91. Against that, a page-count-only round succeeds 92% of
 * the time on the first attempt, 50% on the second and 18% on the third. Rounds 3-5 therefore
 * spend three minutes of a teacher's wait buying a coin-flip that is already losing — and,
 * since bd-vjk68, buying it for a document that will be DELIVERED either way.
 *
 * WHAT THIS COSTS, NAMED RATHER THAN HIDDEN: the study's cell c09 (see STALE_ROUNDS above) came
 * inside its cap only at round 5, after four rounds whose defect list never moved. Under this
 * rule c09 stops at round 1 and prints one page over. That is not a lost lesson any more — it
 * is a delivered lesson with `over_cap` on its row. Trading a 6-page lesson she gets in two
 * minutes against a 5-page lesson she gets in six is the trade the operator made.
 *
 * SCOPED TO LENGTH, DELIBERATELY. Every other blocking defect — schema, lint, OVERFLOW,
 * TRUNCATION, RENDER_INFRA — keeps today's behaviour exactly, bounded by `STALE_ROUNDS` and the
 * round cap. Those are broken documents; this one is only a long one.
 */
const PAGE_COUNT_ROUND_BUDGET = 1;

/**
 * Is this defect the renderer's page-cap finding?
 *
 * Matched on the renderer's own emitted prefix (`render_lp.js`: `PAGE COUNT: ${part} needs ...`),
 * the same way `isAdvisory` matches the lint's `CODE: message` shape — not on a substring search
 * that could catch the words "page count" inside someone's prose, and not on a paraphrase this
 * file would have to keep in sync by hand.
 *
 * NOTE what this deliberately does NOT match: `TRUNCATION:` (the PDF is SHORTER than the layout
 * — pages of the lesson are missing from the file, the most expensive defect the renderer can
 * ship) and `OVERFLOW on ...` (content clipped off the bottom of a page). Both are broken
 * documents, not long ones, and neither may ever be delivered under this policy.
 */
const isPageCountDefect = (d) => String(d).startsWith('PAGE COUNT:');

/** True when the ONLY things standing between this document and a teacher are page counts. */
const isPageCountOnly = (g) => {
  const blocking = blockingFails(g);
  return blocking.length > 0 && blocking.every(isPageCountDefect);
};

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
  const startedAt = Date.now();
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

  let gates = await runGates(doc, renderCheck, { correlationId, segmentId: segment.segment_id, round: 0, lang: language });
  let spent = 0;
  // Consecutive rounds that have reduced no BLOCKING defect. See STALE_ROUNDS.
  let stale = 0;
  // Rounds ENTERED with nothing blocking but page counts. See PAGE_COUNT_ROUND_BUDGET.
  let pageOnlyRounds = 0;

  for (let rnd = 0; rnd < maxRounds; rnd++) {
    // The climb ends when nothing that gates delivery is left — NOT when the defect list is
    // empty. An advisory defect (today: BUDGET) is reported and served, never chased.
    if (blockingCost(gates) === 0) break;
    // ▶ THE DECISION POINT: page-count-only defect set → ≤1 revision round, then deliver.
    //   (Length is the ONLY soft defect. Everything else — schema, lint, the visual contract,
    //   OVERFLOW, TRUNCATION — is hard and unchanged; see PAGE_COUNT_ROUND_BUDGET.)
    //
    // LENGTH IS NOT WORTH A SECOND ROUND (bd-vjk68). The document is delivered over cap by the
    // worker, so every round past the first is pure wait for a diminishing chance — and this
    // exit is what makes "we will stop DELAYING lesson plans because of the length issue" true
    // rather than aspirational. Note it is checked BEFORE the stale guard on purpose: a
    // page-count-only ladder is the exact shape that used to reach `stale >= 4`, four rounds
    // and ~four minutes later.
    if (isPageCountOnly(gates) && pageOnlyRounds >= PAGE_COUNT_ROUND_BUDGET) {
      logToFile('lp612 author ladder stopped — page count only, budget spent', {
        correlationId, segmentId: segment.segment_id, roundsUsed: spent, of: maxRounds,
        pageOnlyRounds, blockingFails: blockingFails(gates).slice(0, 5),
      });
      logEvent('lp612.author.page_budget_spent', {
        correlationId: correlationId || null,
        segmentId: segment.segment_id || null,
        lang: language,
        roundsUsed: spent,
        of: maxRounds,
        fails: blockingFails(gates).slice(0, 4),
      });
      break;
    }
    if (isPageCountOnly(gates)) pageOnlyRounds += 1;
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

    const fixUser = buildRevisionPrompt({ doc, gates, originalUser: user, notes: segment.notes, lang: language });
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
    const g2 = await runGates(candidate, renderCheck, { correlationId, segmentId: segment.segment_id, round: spent, lang: language });
    if (notWorseVisual(g2, gates, candidate, doc)) {
      doc = candidate;
      gates = g2;
    } else {
      // Upstream keeps the rejected candidate on disk — "was worse" with no numbers and no
      // artefact is unreviewable. A worker has nowhere to put it, so the numbers go to the log
      // and the document itself is dropped. Then CONTINUE, not break.
      const schemaTiered = !schemaOk(g2) && schemaOk(gates);
      logToFile('lp612 author revision was worse — kept previous, continuing', {
        correlationId, segmentId: segment.segment_id, round: spent,
        defectsCandidate: gateCost(g2), defectsKept: gateCost(gates),
        blockingCandidate: blockingCost(g2), blockingKept: blockingCost(gates),
        candidateFails: gateFails(g2).slice(0, 10),
        // Distinguishes "lost on the numbers" from "discarded outright for being unrenderable" —
        // the latter would otherwise look like an ordinary defect-count loss in this log line.
        reason: schemaTiered ? 'schema_invalid' : 'higher_cost',
      }, 'warn');
      if (schemaTiered) {
        // bd-jddcu's specific case: the candidate that came back could not even be lint-checked,
        // while the document we already had could. Counted separately from the generic
        // schema_invalid line above (which fires on every schema failure, kept or not) so this
        // one answers "how often did that failure actually cost a round", not just "how often did
        // it happen".
        logEvent('lp612.author.schema_candidate_rejected', {
          correlationId: correlationId || null,
          segmentId: segment.segment_id || null,
          round: spent,
          errorCount: g2.schema.length,
          lane: 'author',
        });
      }
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
  logEvent('lp612.author.completed', {
    correlationId: correlationId || null,
    segmentId: segment.segment_id || null,
    lang: language,
    model: chosenModel,
    family,
    tier,
    rounds: spent,
    lintClean: fails.length === 0,
    outcome: 'authored',
    elapsedMs: Date.now() - startedAt,
    // The count, not the strings: the strings are already in the prose line above, and a defect
    // list on an event is a cardinality problem, not a metric.
    failCount: fails.length,
    tokens: usage.total_tokens,
    calls: usage.calls,
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
  const gatesBefore = await runGates(original, renderCheck, { correlationId, segmentId: segment.segment_id, round: 0, lang: language });
  const bar = blockingCost(gatesBefore);
  // bd-jddcu applies here too: her document already renders (schemaOk is true in the only case
  // this lane is called for), so a defect-count comparison ALONE could accept an edit that comes
  // back schema-invalid — undercounted for the same reason `notWorse` was, because a schema
  // failure short-circuits lint/render (see `runGates`). An edit is never allowed to trade a
  // working lesson for one the renderer would refuse, no matter how low its nominal count reads.
  const beforeSchemaOk = schemaOk(gatesBefore);

  let current = original;
  let gates = gatesBefore;
  let accepted = false;
  let spent = 0;

  for (let rnd = 0; rnd < Math.max(1, rounds); rnd++) {
    spent = rnd + 1;
    const notes = rnd === 0 ? teacherInstructionNote(instruction) : REPAIR_NOTE;
    const fixUser = buildRevisionPrompt({ doc: current, gates, originalUser, notes, lang: language });

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

    const g2 = await runGates(candidate, renderCheck, { correlationId, segmentId: segment.segment_id, round: spent, lang: language });
    const schemaTiered = beforeSchemaOk && !schemaOk(g2);

    if (!schemaTiered && blockingCost(g2) <= bar) {
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
      reason: schemaTiered ? 'schema_invalid' : 'higher_cost',
    }, 'warn');
    if (schemaTiered) {
      logEvent('lp612.author.schema_candidate_rejected', {
        correlationId: correlationId || null,
        segmentId: segment.segment_id || null,
        round: spent,
        errorCount: g2.schema.length,
        lane: 'edit',
      });
    }
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
  // Exported for the suite: the budget card's POSITION is the whole point of bd-vjk68, and a
  // test that cannot see the assembled revision prompt cannot assert it is above the defects.
  // Same reason the visual block's position is asserted (bd-q2jr1).
  buildRevisionPrompt,
  budgetCard,
  __notWorseVisualForTests: (a, b, ad, bd) => notWorseVisual(a, b, ad, bd),
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
