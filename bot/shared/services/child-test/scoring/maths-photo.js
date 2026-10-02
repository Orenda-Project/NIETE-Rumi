'use strict';
/**
 * Child test (bd-s1oo0.5) — the written maths strip from its photo.
 *
 * Gemini 3.1 Pro vision (PLAN §6). The model is shown the printed sums but NOT
 * the answers: it transcribes what the child wrote, and the verdict is decided
 * here against the key. A model shown the key can "read" the right answer into
 * an illegible scrawl; a model asked only to read cannot.
 *
 * The corner form code is read too, so a photo of the wrong strip (another
 * child's, or the other form) is caught: every confidence then drops below the
 * bar and the coach checks it.
 */

const prompts = require('./prompts');
const { modelFor } = require('./models');
const { chatJSON } = require('./llm');
const { asciiDigits } = require('./number-grammar');

const WRONG_STRIP_CONFIDENCE = 0.2;

function expectedCode(spec, grade, form) {
  // L2 prints `G3-A` in the strip corner (render/html.js formCode)
  return (spec && spec.strip_code) || `G${grade}-${form}`;
}

function normCode(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

/** @param {Buffer} image */
async function scoreStrip({ spec, grade, form, image, mime = 'image/jpeg', calls }) {
  const written = spec.written || [];
  const wp = spec.word_problem || null;
  const code = expectedCode(spec, grade, form);
  const model = modelFor('vision');
  const r = await chatJSON({
    model, job: 'child_test.vision', maxTokens: 2000,
    prompt: prompts.STRIP({ written, wordProblem: wp, expectedCode: code }),
    imageDataUrl: `data:${mime};base64,${image.toString('base64')}`,
  });
  calls.push({ job: 'vision', model, cost: r.cost, seconds: r.seconds, error: r.error });
  if (!r.json) return { ok: false, error: r.error || 'no_json' };

  const read = new Map((r.json.items || []).filter((x) => x && x.id).map((x) => [x.id, x]));
  const formCodeOk = r.json.form_code == null ? null : normCode(r.json.form_code) === normCode(code);
  const judge = (id, answer) => {
    const x = read.get(id);
    if (!x) return { read_answer: '', verdict: 'unreadable', confidence: 0 };
    const digits = asciiDigits(String(x.read || '')).replace(/[^\d-]/g, '');
    let verdict;
    if (x.status === 'blank' || (x.status === 'written' && !digits)) verdict = 'blank';
    else if (x.status === 'unreadable') verdict = 'unreadable';
    else verdict = Number(digits) === Number(answer) ? 'correct' : 'wrong';
    let confidence = Math.max(0, Math.min(1, Number(x.confidence) || 0));
    if (formCodeOk === false) confidence = Math.min(confidence, WRONG_STRIP_CONFIDENCE);
    return { read_answer: verdict === 'blank' ? '' : digits, verdict, confidence: Math.round(confidence * 100) / 100 };
  };

  const part = { written: written.map((w) => ({ id: w.id, ...judge(w.id, w.answer) })) };
  if (wp) {
    const j = judge(wp.id, wp.answer);
    part.word_problem = { verdict: j.verdict === 'correct' ? 'correct' : (j.verdict === 'wrong' ? 'wrong' : 'none'), read_answer: j.read_answer, confidence: j.confidence, photo_verdict: j.verdict };
  }
  return { ok: true, part, formCode: r.json.form_code || null, formCodeOk, expectedCode: code, modelVersion: model };
}

module.exports = { scoreStrip, expectedCode };
