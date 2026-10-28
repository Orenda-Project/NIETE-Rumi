'use strict';
/**
 * COACHIP nightly job, the model stage (bd-sex15q.14; NIGHTLY_JOB §6-§9): one OpenRouter client, the nightly ledger
 * that holds the US$2 cap, and the spend order. Every call is temperature 0 in JSON mode with usage returned, one retry
 * at the same configuration on 429 / 5xx / timeout / empty / unparseable, then `failed` with its class. The API key
 * travels only in the request header; the row never carries it, a quote, or the prompt text.
 */
const fs = require('fs');
const path = require('path');
const C = require('./constants');
const { inputHash } = require('./facts');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const MODELS = Object.freeze({
  gloss: 'openai/gpt-6-luna',
  glossFallback: 'anthropic/claude-haiku-5.5',
  phonics: 'anthropic/claude-haiku-5.5',
  homework: 'openai/gpt-6-luna',
  reference: 'anthropic/claude-opus-5.5',
});

// Per-call p90 in US$ (COST §1). The re-check and gloss drift keys have no measured p90; COST §1 gives "about US$0.01",
// so 0.015 is held until the first week's rows give a real one.
const P90_USD = Object.freeze({
  gloss: 0.00026,
  phonics: 0.0031,
  homework: 0.00017,
  gloss_recheck: 0.015,
  gloss_drift: 0.015,
  phonics_drift: 0.102,
});

const MAX_TOKENS = Object.freeze({ gloss: 1000, homework: 1000, phonics: 6000 });
const TIMEOUT_MS = 120000;
const REUSABLE = new Set(['ok', 'blocked', 'not_applicable']);

// NIGHTLY_JOB §7: what matters most is bought first.
const SPEND_ORDER = Object.freeze(['gloss_s1s2', 'gloss_circle', 'drift_audit', 'recheck', 'phonics_window', 'gloss_listen',
  'homework', 'phonics_backfill']);

const PROMPT_DIR = path.join(__dirname, 'prompts');
const promptCache = new Map();

/** The prompt text without its source header. */
function loadPrompt(name) {
  if (!/^[a-z_]+_v[0-9]+$/.test(name)) throw new Error('loadPrompt: bad prompt name');
  if (!promptCache.has(name)) {
    const raw = fs.readFileSync(path.join(PROMPT_DIR, `${name}.md`), 'utf8');
    promptCache.set(name, raw.replace(/^<!--[\s\S]*?-->\n/, ''));
  }
  return promptCache.get(name);
}

const round5 = (n) => Math.round((Number(n) || 0) * 1e5) / 1e5;

/** The night's spend. Once a call is refused, every later call is refused too (the order inside the cap holds). */
function createLedger({ capUsd = C.NIGHTLY_CAP_USD, p90 = P90_USD } = {}) {
  let spent = 0;
  let capHit = false;
  let pending = 0;
  let held = 0;
  return {
    canStart(analysis) {
      if (capHit) return false;
      const p = p90[analysis];
      if (typeof p !== 'number' || spent + p > capUsd) {
        capHit = true;
        return false;
      }
      return true;
    },
    record(usage) {
      const c = usage && Number(usage.cost);
      if (Number.isFinite(c) && c > 0) spent += c;
    },
    /**
     * Holds `usd` (a call's p90) while the call is in flight, so callers running N at once can count it before the cost is
     * known (bd-sex15q.43). Returns the release; a second release does nothing.
     */
    hold(usd) {
      const amount = Number(usd) || 0;
      held += amount;
      let done = false;
      return () => { if (!done) { done = true; held -= amount; if (held < 1e-9) held = 0; } };
    },
    markPending() { pending += 1; },
    capLine() { return `cap_reached pending=${pending}`; },
    get spent() { return spent; },
    get held() { return held; },
    get isCapHit() { return capHit; },
    get pending() { return pending; },
  };
}

/** A copy of a parsed output with every `quote` key removed at any depth (the coachip_model_runs CHECK). */
function stripQuotes(v) {
  if (Array.isArray(v)) return v.map(stripQuotes);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) if (k !== 'quote') out[k] = stripQuotes(v[k]);
    return out;
  }
  return v;
}

function hasQuoteKey(v) {
  if (Array.isArray(v)) return v.some(hasQuoteKey);
  if (v && typeof v === 'object') return Object.keys(v).some((k) => k === 'quote' || hasQuoteKey(v[k]));
  return false;
}

const runInputHash = (input) => inputHash(input);

function parseContent(content) {
  if (typeof content !== 'string' || !content.trim()) return { cls: 'empty' };
  try {
    const j = JSON.parse(content);
    return j && typeof j === 'object' && !Array.isArray(j) ? { value: j } : { cls: 'unparseable' };
  } catch (_) {
    const a = content.indexOf('{');
    const b = content.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        const j = JSON.parse(content.slice(a, b + 1));
        if (j && typeof j === 'object' && !Array.isArray(j)) return { value: j };
      } catch (_e) { /* falls through */ }
    }
    return { cls: 'unparseable' };
  }
}

/** One HTTP attempt → { value } or { cls, retry }, plus the usage it cost. */
async function attempt(body, { fetch, apiKey, timeoutMs = TIMEOUT_MS }) {
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(ac ? { signal: ac.signal } : {}),
    });
    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    const usage = (data && data.usage) || null;
    if (!res.ok) return { cls: 'http', retry: res.status === 429 || res.status >= 500, usage };
    if (!data || data.error) return { cls: 'http', retry: true, usage };
    const ch = Array.isArray(data.choices) ? data.choices[0] : null;
    const content = ch && ch.message ? ch.message.content : null;
    const parsed = parseContent(content);
    if (parsed.value) return { value: parsed.value, usage };
    const cls = parsed.cls === 'unparseable' && ch && ch.finish_reason === 'length' ? 'truncated' : parsed.cls;
    return { cls, retry: true, usage };
  } catch (e) {
    return { cls: e && (e.name === 'AbortError' || e.name === 'TimeoutError') ? 'timeout' : 'http', retry: true, usage: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function baseRow({ model, analysis, target, purpose, sessionId, promptVersion, hash, jobRunId }) {
  return {
    session_id: sessionId,
    job_run_id: jobRunId == null ? null : jobRunId,
    analysis,
    target: target || '-',
    purpose: purpose || 'primary',
    model,
    prompt_version: promptVersion,
    input_hash: hash,
    status: 'pending',
    failure_class: null,
    output: null,
    tokens_in: 0,
    tokens_out: 0,
    cost_usd: 0,
  };
}

/**
 * One model call → { row, output, reused }. `row` has the coachip_model_runs columns (minus id and timestamps); `output`
 * is the parsed answer, in memory only (quotes kept for grounding). deps: { fetch, apiKey, ledger?, findRun?, log?,
 * jobRunId?, timeoutMs? }. `costKey` names the p90 the ledger checks (default: the analysis).
 */
async function callModel({ model, prompt, input, userMessage, purpose = 'primary', analysis, target = '-', sessionId, promptVersion,
  costKey, deps }) {
  const d = deps || {};
  const hash = runInputHash(input);
  const row = baseRow({ model, analysis, target, purpose, sessionId, promptVersion, hash, jobRunId: d.jobRunId });

  if (typeof d.findRun === 'function') {
    const prior = await d.findRun({ session_id: sessionId, analysis, target: row.target, model, prompt_version: promptVersion, input_hash: hash, purpose: row.purpose });
    if (prior && REUSABLE.has(prior.status)) return { row: prior, output: prior.output == null ? null : prior.output, reused: true };
  }

  const ledger = d.ledger;
  if (ledger && !ledger.canStart(costKey || analysis)) {
    ledger.markPending();
    if (ledger.pending === 1 && typeof d.log === 'function') d.log(ledger.capLine());
    return { row: { ...row, status: 'pending', failure_class: 'cap_reached' }, output: null, reused: false };
  }

  const body = {
    model,
    temperature: 0,
    max_tokens: MAX_TOKENS[analysis] || 1000,
    response_format: { type: 'json_object' },
    usage: { include: true },
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: userMessage != null ? userMessage : `${JSON.stringify(input)}\n\nReturn the JSON.` },
    ],
  };

  let last = null;
  for (let i = 0; i < 2; i += 1) {
    last = await attempt(body, { fetch: d.fetch, apiKey: d.apiKey, timeoutMs: d.timeoutMs });
    if (last.usage) {
      row.tokens_in += Number(last.usage.prompt_tokens) || 0;
      row.tokens_out += Number(last.usage.completion_tokens) || 0;
      row.cost_usd += Number(last.usage.cost) || 0;
      if (ledger) ledger.record(last.usage);
    }
    if (last.value || !last.retry) break;
  }
  row.cost_usd = round5(row.cost_usd);

  if (last.value) {
    return { row: { ...row, status: 'ok', output: stripQuotes(last.value) }, output: last.value, reused: false };
  }
  if (typeof d.log === 'function') d.log(`model_failed analysis=${analysis} class=${last.cls}`);
  return { row: { ...row, status: 'failed', failure_class: last.cls }, output: null, reused: false };
}

/** A row for a call that was never made (input missing, not needed): the same key, no usage. */
function rowFor({ model, analysis, target = '-', purpose = 'primary', sessionId, promptVersion, input, jobRunId = null }, status, failureClass = null) {
  const row = baseRow({ model, analysis, target, purpose, sessionId, promptVersion, hash: runInputHash(input), jobRunId });
  return { ...row, status, failure_class: failureClass };
}

/** The gloss call: gpt-6-luna, then Haiku stamped `fallback` when the primary fails. Returns { row, output, rows }. */
async function callGlossModel(args) {
  const first = await callModel({ ...args, model: MODELS.gloss, purpose: args.purpose || 'primary' });
  if (first.row.status !== 'failed') return { ...first, rows: [first.row] };
  const second = await callModel({ ...args, model: MODELS.glossFallback, purpose: 'fallback' });
  return { ...second, rows: [first.row, second.row] };
}

/** Work items sorted by NIGHTLY_JOB §7's order; newest first inside a kind. Unknown kinds go last. */
function orderWork(items) {
  const rank = (k) => { const i = SPEND_ORDER.indexOf(k); return i < 0 ? SPEND_ORDER.length : i; };
  const time = (it) => { const t = it && it.recorded_at ? Date.parse(it.recorded_at) : NaN; return Number.isFinite(t) ? t : -Infinity; };
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => rank(a.it.kind) - rank(b.it.kind) || time(b.it) - time(a.it) || a.i - b.i)
    .map((x) => x.it);
}

module.exports = {
  OPENROUTER_URL, MODELS, P90_USD, SPEND_ORDER, loadPrompt, createLedger, callModel, callGlossModel, orderWork, stripQuotes,
  hasQuoteKey, runInputHash, rowFor,
};
