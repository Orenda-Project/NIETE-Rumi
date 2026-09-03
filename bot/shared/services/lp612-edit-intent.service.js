/**
 * lp612-edit-intent — what did she mean by that reply?
 *
 * WHY THIS EXISTS, precisely. The 12-cell spike measured what the revision ladder does with an
 * out-of-scope request, and the answer was reassuring in one way and alarming in another. Asked
 * to "write me an exam paper for this whole chapter", it did not write one: `lp_doc` has nowhere
 * to put an exam paper, so the only in-schema expression of the request was one extra MCQ in the
 * existing exam bank plus a reworded summary. Two changed paths, every gate clean.
 *
 * So the schema is a hard containment boundary and abuse cannot produce a harmful artefact.
 * What it CANNOT do is tell her we did not do what she asked. She would have received a lesson
 * plan with one more question in it and no explanation.
 *
 * That makes this classifier an HONESTY layer, not a safety control — a distinction with two
 * consequences that are wired into the code below:
 *
 *   • A cheap model is sufficient. Nothing catastrophic follows from a misread, because the
 *     gates and the schema stand behind it either way.
 *   • ITS FAILURE MUST FALL TOWARD THE ANSWER, NEVER THE EDIT. Every degraded path returns
 *     `question`, so an unreachable model costs her a grounded reply rather than $0.27 and a
 *     mutated document authored on a guess.
 *
 * The verdict set is CLOSED. A model that invents a fifth label gets coerced to `question`,
 * because the caller routes on this value and an unknown label reaching that switch is how a
 * teacher falls through every branch — which is the exact bug this whole feature exists to fix.
 */

const { getClient } = require('./llm-client');
const { logToFile } = require('../utils/logger');

/** The closed set. Anything else is coerced to `question`. */
const EDIT_INTENT_KINDS = ['edit', 'question', 'out_of_scope', 'gratitude'];

/**
 * The model is env-overridable and deliberately cheap: this is a four-way label on one short
 * sentence, and it runs on every post-delivery reply. Nothing here may hardcode a model id in a
 * way an operator cannot change without a deploy.
 */
const DEFAULT_MODEL = 'openai/gpt-4.1-mini';
const MAX_TOKENS = 64;

/**
 * The free path.
 *
 * "thanks" must never cost a model call. At $0.27 an edit attempt and a classifier call on every
 * reply, billing for «شکریہ» is a bug with an invoice attached. Both languages, because the
 * cheapest possible request is the one never sent.
 *
 * Deliberately ANCHORED to the whole message. "thanks, but can you make the homework shorter"
 * is an edit request that opens with thanks, and matching a bare substring would swallow it —
 * the same whole-message anchoring the homework trigger uses, and for the same reason.
 */
const GRATITUDE = new RegExp(
  '^(?:'
  + 'thanks?(?:\\s+you)?(?:\\s+so\\s+much|\\s+a\\s+lot)?'
  + '|thank\\s+u|ty|tysm'
  + '|ok(?:ay)?|k|got\\s+it|great|good|nice|perfect|noted|done'
  + '|شکریہ|بہت\\s+شکریہ|جزاک\\s*اللہ|ٹھیک\\s*ہے|اچھا|بہتر|زبردست'
  + ')'
  + '[\\s!.،۔?؟\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]*$',
  'iu',
);

/** An emoji-only reply ("👍") is an acknowledgement, not an instruction. */
const EMOJI_ONLY = /^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]+$/u;

const SYSTEM = `You label a teacher's WhatsApp reply about a lesson plan she has just received.

Answer with ONE JSON object and nothing else: {"kind": "<label>"}

The four labels:

"edit"          She wants the LESSON DOCUMENT changed in a STRUCTURAL way — add, remove, shorten,
                lengthen, replace or swap a specific part. Examples: "make the homework shorter",
                "add another activity", "add more practice questions", "replace the activity with
                a group one", "swap the example for one about farming", "اس میں ایک اور سرگرمی
                شامل کریں".

"question"      She is ASKING something about the lesson, or commenting, or chatting. She wants an
                ANSWER, not a new document. Examples: "what does the activity mean?", "how long
                should the group work take?", "is this the right chapter?".

"out_of_scope"  She wants something this feature cannot do. THIS INCLUDES THREE THINGS:
                (a) a different artefact entirely — an exam paper, a test, a worksheet, a
                    presentation, notes, a scheme of work, a question paper;
                (b) a different lesson, grade, subject or chapter — that is a new request, not an
                    edit of this document;
                (c) REWRITING THE WHOLE DOCUMENT'S WORDING, TONE OR REGISTER — "write it in
                    simpler language", "make it more formal", "reword this", "اسے آسان زبان میں
                    لکھیں", "translate it". These are NOT edits in this version: they rewrite
                    every section rather than changing one part, so they are out of scope.

"gratitude"     Thanks or a bare acknowledgement.

Rules:
- Changing ONE named part = "edit". Rewriting the WHOLE document's wording = "out_of_scope".
- If she asks for something we cannot produce, say "out_of_scope" — never guess at an edit.
- If you are unsure between "edit" and "question", answer "question".
- Output the JSON object only. No prose, no code fence.`;

/** Everything degraded returns this shape, so the caller has exactly one thing to check. */
const fallback = (reason) => ({ kind: 'question', degraded: true, reason });

/**
 * Pull `kind` out of a reply that may or may not be JSON, and CLOSE the set.
 *
 * A bare `JSON.parse` is not enough: the model can fence the object, wrap it in prose, or invent
 * a label. Each of those is a `question` — never an `edit`.
 */
function parseKind(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return null;
  const body = raw.startsWith('```')
    ? raw.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```\s*$/, '')
    : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let kind;
  try {
    kind = JSON.parse(body.slice(start, end + 1)).kind;
  } catch (_) {
    return null;
  }
  const k = typeof kind === 'string' ? kind.trim().toLowerCase() : '';
  // The closed set. An invented label is not a near-miss to be salvaged — it is a value the
  // caller's switch has no branch for.
  return EDIT_INTENT_KINDS.includes(k) ? k : null;
}

/**
 * @param {object} args
 * @param {string} args.text          her reply, verbatim
 * @param {'en'|'ur'} [args.language] hers, for the log only — the prompt is bilingual
 * @param {string} [args.correlationId]
 * @param {string} [args.model]
 * @returns {Promise<{kind:string, degraded?:boolean, reason?:string}>}
 */
async function classifyEditIntent({ text, language, correlationId, model } = {}) {
  const msg = String(text == null ? '' : text).trim();

  // ── the free path ────────────────────────────────────────────────────────
  if (!msg) return { kind: 'question', reason: 'empty' };
  if (EMOJI_ONLY.test(msg) || GRATITUDE.test(msg)) {
    return { kind: 'gratitude', reason: 'fast_path' };
  }

  const chosen = model || process.env.LP612_EDIT_INTENT_MODEL || DEFAULT_MODEL;

  let res;
  try {
    res = await getClient().chat.completions.create({
      model: chosen,
      temperature: 0,
      max_tokens: MAX_TOKENS,
      // Same reason as the author service: reasoning bills as completion tokens and, against a
      // 64-token ceiling, would consume the entire budget and return empty content.
      reasoning: { enabled: false },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: msg },
      ],
    });
  } catch (err) {
    logToFile('lp612 edit-intent: classifier call failed — falling back to question', {
      correlationId, language, error: err.message,
    }, 'warn');
    return fallback('llm_failed');
  }

  const content = res && res.choices && res.choices[0] && res.choices[0].message
    ? res.choices[0].message.content
    : '';
  const kind = parseKind(content);

  if (!kind) {
    logToFile('lp612 edit-intent: unusable classifier reply — falling back to question', {
      correlationId, language, raw: String(content || '').slice(0, 200),
    }, 'warn');
    return fallback('unparseable');
  }

  logToFile('lp612 edit-intent classified', {
    correlationId, language, kind, model: chosen, usage: (res && res.usage) || null,
  });

  return { kind };
}

module.exports = {
  classifyEditIntent,
  EDIT_INTENT_KINDS,
  // exported for the suite and for anyone tuning the free path
  __GRATITUDE: GRATITUDE,
  __parseKind: parseKind,
};
