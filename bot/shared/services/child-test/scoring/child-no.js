'use strict';
/**
 * Child test (bd-s1oo0.38, L20) — the child number off a strip photo, read the moment it arrives.
 *
 * The coach writes the child's number on today's list in the strip's "بچہ نمبر / Child no." box;
 * the conversation attaches the photo to that child when this read is confident (CONTRACT §18).
 * It runs before the ack, so it is bounded (CHILD_TEST_CHILD_NO_TIMEOUT_MS, default 8 s) and one
 * attempt only; anything else — slow, failed, null — is "not read" and the caller falls back to
 * list order. Never throws. The prompt names nothing but the box: no child's name reaches a model.
 *
 * Model: Gemini 3.8 Flash. Offline on 60 dirty strips (L20 eval, 3 Oct): 58/60 exact, 53 confident
 * at ≥ 0.8 and none of those wrong; median 2.5 s, p90 5.8 s. Gemini 3.1 Pro read 58/60 too but was
 * confidently wrong twice; Gemini 3 Flash 56/60, confidently wrong 3 times.
 */

const prompts = require('./prompts');
const { modelFor } = require('./models');
const { chatJSON } = require('./llm');
const { asciiDigits } = require('./number-grammar');

const CHILD_NO_BAR = 0.8;
const DEFAULT_TIMEOUT_MS = 8000;

function timeoutMs() {
  const n = Number(process.env.CHILD_TEST_CHILD_NO_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

/** A child number: a whole number ≥ 1 (a leading zero is fine), else null. */
function toChildNo(v) {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  const s = asciiDigits(String(v)).trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 ? n : null;
}

/** @param {{ image: Buffer, mime?: string }} p → { ok, childNo, confidence, model, seconds, cost, timedOut?, error? } */
async function readChildNo({ image, mime = 'image/jpeg' }) {
  const model = modelFor('child_no');
  const started = Date.now();
  let timer;
  const cut = new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs()); });
  try {
    const r = await Promise.race([
      chatJSON({ model, job: 'child_test.child_no', maxTokens: 2000, attempts: 1,
        prompt: prompts.CHILD_NO(), imageDataUrl: `data:${mime};base64,${image.toString('base64')}` }),
      cut,
    ]);
    const seconds = (Date.now() - started) / 1000;
    if (r.timedOut) return { ok: false, childNo: null, confidence: 0, model, seconds, cost: null, timedOut: true };
    if (!r.json) return { ok: false, childNo: null, confidence: 0, model, seconds, cost: r.cost, error: r.error || 'no_json' };
    const childNo = toChildNo(r.json.child_no);
    const confidence = childNo === null ? 0 : Math.max(0, Math.min(1, Number(r.json.confidence) || 0));
    return { ok: true, childNo, confidence, model, seconds, cost: r.cost };
  } catch (err) {
    return { ok: false, childNo: null, confidence: 0, model, seconds: (Date.now() - started) / 1000, cost: null, error: String(err && err.message || err).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { readChildNo, toChildNo, CHILD_NO_BAR };
