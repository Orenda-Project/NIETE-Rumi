'use strict';
/**
 * The pick (bd-gzfdu9, SPEC §3.5): ONE completeJson call on the bot's own LLM path, under its own job
 * name (coaching.videoReco, model-registry), and the validation every answer passes before it is stored.
 * The teacher-facing reason comes from the model; this code only checks it.
 */
const { modelFor, JOBS } = require('../../../config/model-registry');

const JOB = 'coaching.videoReco';
const LLM_TIMEOUT_MS = 45000; // lead-converge 18:48Z: measured 22–33 s at the default effort; the report itself never waits on it

/** The job's reasoning effort: VIDEO_RECO_REASONING, else the registry default ('low'). */
function reasoningEffort(env = process.env) {
  const r = (JOBS[JOB] && JOBS[JOB].reasoning) || {};
  return String((r.env && env[r.env]) || r.default || '').trim() || undefined;
}

async function pick({ prompt, deps = {}, timeoutMs = LLM_TIMEOUT_MS }) {
  const call = deps.completeJson
    || ((p, o) => require('../../gpt5-mini.service').completeJson(p, o)); // eslint-disable-line global-require
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`videoReco LLM timeout after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    // 4000 = completeJson's own default: gpt-5-mini spends its budget on hidden reasoning before the answer, and at 700
    // the first real call came back finish_reason=length with empty content (evals, 18:16Z).
    const res = await Promise.race([call(prompt, { job: JOB, maxTokens: 4000, label: 'videoReco', reasoningEffort: reasoningEffort(deps.env) }), timeout]);
    const result = (res && res.result) || null;
    const empty = !result || typeof result !== 'object' || !Object.keys(result).length;
    return { pick: result, usage: (res && res.usage) || {}, model: modelFor(JOB), truncated: (res && res.finishReason === 'length') || empty };
  } finally {
    clearTimeout(timer);
  }
}

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/u;

function norm(text) {
  return String(text || '').toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function bigrams(s) {
  const out = new Map();
  const cps = [...s.replace(/ /g, '')];
  for (let i = 0; i < cps.length - 1; i++) {
    const g = cps[i] + cps[i + 1];
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

function dice(a, b) {
  const A = bigrams(a);
  const Bm = bigrams(b);
  let na = 0;
  let nb = 0;
  let both = 0;
  for (const v of A.values()) na += v;
  for (const v of Bm.values()) nb += v;
  for (const [g, v] of A) both += Math.min(v, Bm.get(g) || 0);
  return na + nb ? (2 * both) / (na + nb) : 0;
}

// A leading excerpt-line prefix the model copied with the quote: "[04:17] Teacher:" (§3.5 [v1.3] b).
const LINE_PREFIX = /^\s*\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*[^:\n]{0,40}:\s*/;

/** The quote appears in one excerpt line, allowing for spacing, punctuation and case (Dice ≥ 0.8). */
function quoteFound(quote, excerpts) {
  const q = norm(String(quote || '').replace(LINE_PREFIX, '').replace(/\[a student\]/gi, ' '));
  const qw = q.split(' ').filter(Boolean);
  if (qw.length < 2 && [...q].length < 6) return false;
  for (const line of excerpts || []) {
    const l = norm(line);
    if (l.includes(q)) return true;
    const lw = l.split(' ');
    for (let size = Math.max(1, qw.length - 1); size <= qw.length + 1; size++) {
      for (let i = 0; i + size <= lw.length; i++) {
        if (dice(q, lw.slice(i, i + size).join(' ')) >= 0.8) return true;
      }
    }
  }
  return false;
}

/** A teacher-facing line must not carry the teacher's own name (red-team H8; child names: the prompt rule). */
function namesIn(text, name) {
  const words = new Set(norm(text).split(' '));
  return norm(name).split(' ').some((w) => [...w].length >= 3 && words.has(w));
}

/** Arabic-script share of the letters, after removing quoted text and [a student] (§3.5 [v1.3] a: English terms are the prompt's rule 3). */
function arabicShare(text) {
  const rest = String(text || '').replace(/"[^"]*"|“[^”]*”|«[^»]*»/g, ' ').replace(/\[a student\]/gi, ' ');
  const letters = rest.match(/\p{L}/gu) || [];
  if (!letters.length) return 0;
  return letters.filter((c) => ARABIC.test(c)).length / letters.length;
}

/**
 * @param {object} opts {stepIndicator, indicators, source, catalog, teacherName, scorerQuote, textRoute}
 * @returns {{ok:boolean, none:null|'llm_none'|'validation', confidence:number, momentSource:'transcript'|'scorer'|null}}
 */
function validate(p, shortlist, excerpts, opts) {
  const { stepIndicator = null, indicators = null, source = null, catalog = null, teacherName = null, scorerQuote = '', textRoute = false } = opts || {};
  const bad = (none = 'validation') => ({ ok: false, none, confidence: 0, momentSource: null });
  try {
    if (!p || typeof p !== 'object') return bad();
    const c = Number(p.confidence);
    const confidence = Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0;
    if (p.seg_id === null || p.seg_id === undefined || p.seg_id === '') return { ...bad('llm_none'), confidence };
    const cand = ((shortlist && shortlist.candidates) || []).find((x) => x.seg_id === String(p.seg_id));
    if (!cand) return bad();
    const quote = p.moment && p.moment.quote;
    let momentSource = null;
    if (quote && quoteFound(quote, excerpts)) momentSource = 'transcript';
    else if (quote && scorerQuote && quoteFound(quote, [scorerQuote])) momentSource = 'scorer';
    if (!momentSource) return bad();
    if (namesIn(p.moment.quote, teacherName) || namesIn(p.reason_en, teacherName) || namesIn(p.reason_ur, teacherName)) return bad();
    const en = [...String(p.reason_en || '').trim()].length;
    if (en < 20 || en > 400) return bad();
    if (arabicShare(p.reason_ur) < 0.6) return bad();
    // Indicator path: every candidate is for the step; a pick outside the step's chapters is refused (SPEC v1.2 §3.5).
    // When the step-text route ran (label / hole / unknown / empty target, v1.3 R4) any listed candidate is valid.
    if ((source === 'step' || source === 'card') && stepIndicator && !textRoute) {
      const hit = catalog && catalog.segment(cand.seg_id);
      const ids = hit ? [...(hit.segment.fico || []).map((f) => f.indicator), ...(hit.segment.fico_main37 || [])] : [];
      const step = indicators && indicators.length ? indicators : [stepIndicator];
      if (!step.includes(cand.indicator) && !step.some((id) => ids.includes(id))) return bad();
    }
    return { ok: true, none: null, confidence, momentSource };
  } catch (e) {
    return bad();
  }
}

module.exports = { pick, validate, quoteFound, reasoningEffort, JOB, LLM_TIMEOUT_MS };
