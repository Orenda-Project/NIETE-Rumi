'use strict';
// Part of assessment-generation.service.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const PROMPTS = require('../ict-prompts.json');
const { configForRequest, ensureCurrent } = require('../../../config/model-settings');
const { resolveModelForJob } = require('../../../config/model-registry');

/** One question, one answer: what this family should run right now. */
function familyModel(family) {
  return resolveModelForJob('assessment.generate', { cfg: configForRequest(), family }).model;
}

/**
 * A board-pattern paper's model and the job it is billed to. Its own job, so it can move without
 * moving plain papers; with nothing set or written for that job (or the kill switch on) it is
 * exactly familyModel, under the plain job's name, as before the job existed.
 */
function patternModel(family) {
  const fde = resolveModelForJob('assessment.generate.fde', { cfg: configForRequest(), family });
  if (fde.inherited || fde.source === 'kill-switch') return { model: familyModel(family), job: 'assessment.generate' };
  return { model: fde.model, job: 'assessment.generate.fde' };
}

/**
 * bd-jntcx — resolved PER REQUEST through the registry, not captured at import.
 *
 * This used to be two `process.env.<NAME> || 'literal'` expressions evaluated once when the module
 * was first required, which fixed the model for the life of the process: no settings row, no
 * changed variable and no incident could move it. Production spend showed this to be the second
 * largest line in NIETE at $11.34/day, and the one job of that size nobody could steer.
 *
 * Getters, so the export stays truthful rather than becoming a second source of truth: reading
 * MODELS.eng asks the registry the same question the call below asks, so a settings row moves
 * both together. With nothing written and neither variable set, both return the same literal
 * they always did.
 *
 * Both slots are still the same model today, as they were upstream, and they stay separate for
 * the same reason as before: the day one language needs a different model, that is a config
 * change and not a code change. That sentence used to be an intention; with the registry behind
 * it, it is now literally true — ASSESSMENT_GEN_MODEL_URDU, or a per-language settings row,
 * moves Urdu alone with no deploy.
 */
const MODELS = {
  get eng() { return familyModel('eng'); },
  get urdu() { return familyModel('urdu'); },
};

// Whatever the caller calls a subject, we answer to one name internally.
const CANON = {
  eng: 'eng', english: 'eng',
  urdu: 'urdu',
  maths: 'maths', math: 'maths', mathematics: 'maths',
  islamiat: 'islamiat',
  science: 'science', gensci: 'science',
  genk: 'genk', general_knowledge: 'genk',
  sst: 'sst', social_studies: 'sst',
};

const SYSTEM_PROMPT = {
  eng: 'eg.ict.eng.system',
  urdu: 'eg.ict.urdu.system',
  maths: 'eg.ict.math.system',
  science: 'eg.ict.science.system',
  sst: 'eg.ict.sst.system',
  islamiat: 'eg.ict.islamiat.system',
  genk: 'eg.ict.genk.system',
};

// Which output-format prompt a subject gets. Not arbitrary:
//   maths     — its own, for the notation.
//   urdu/sst/genk — taught in Urdu, so the format prompt's worked examples are
//                   in Urdu. Getting this wrong yields an English paper for an
//                   Urdu-medium class, which reads as a bug in the model.
//   islamiat  — the restricted format. It has no image-eligible question types,
//               and the unrestricted prompt invites the model to emit "image"
//               keys that then have to be stripped back out.
const FORMAT_PROMPT = {
  maths: 'eg.format.maths',
  urdu: 'eg.format.urdu_exam',
  sst: 'eg.format.urdu_exam',
  genk: 'eg.format.urdu_exam',
  islamiat: 'eg.format.restricted',
};

const URDU_MEDIUM = new Set(['urdu', 'islamiat', 'genk', 'sst']);

/**
 * bd-bfnsk — answers are ALWAYS asked for.
 *
 * This slot used to hold "ANSWER KEY DISABLED: do NOT include the answer field",
 * appended whenever the teacher had not ticked the answer key. On the last 200
 * NIETE prod papers (30 Sep 2026) that one flag decided everything: 147 of the
 * 148 papers requested without a key carried no answer on any question, while
 * 47 of the 52 requested with one were fully answered — across every model,
 * subject and content source. The paper never prints answers (renderPaper
 * forces them off), so the instruction saved a few output tokens and left every
 * later key — a revised paper, a portal download — with nothing but dashes.
 *
 * The format prompts already require an answer "for EVERY question", but the
 * Urdu-medium ones only say so for objective and brief-answer types, and the
 * residual misses on keyed papers were exactly the shapes they leave out:
 * writing tasks, word-bank items, and comprehension answers written on the
 * passage instead of on each sub-question. So this instruction names them.
 */
const ANSWER_KEY_ON =
  '\n\n🚨 **ANSWER KEY REQUIRED**: EVERY question object MUST carry an "answer" '
  + 'field (a string) — every type, seen and unseen, with no exceptions:\n'
  + '- MCQs: the full text of the correct option exactly as it appears in "options" '
  + '(e.g. "b) 4"); MSQs: every correct option, comma-separated.\n'
  + '- True/False: "True" or "False".\n'
  + '- Fill in the blanks / Missing Letters: the word(s) or letters that fill each blank.\n'
  + '- Match the Column: every correct pair, "left: right", comma-separated.\n'
  + '- Questions with a "words" list (Word Meanings, Word Sentences, word bank): '
  + 'one answer per word — its meaning or a model sentence — as "word: answer" lines.\n'
  + '- Brief/short/long answers and word problems: a concise model answer or worked solution.\n'
  + '- Any writing task (essay, story, letter, application, paragraph, picture '
  + 'description): a short model answer or the key points a good answer must contain.\n'
  + '- Comprehension: put the "answer" inside EACH sub-question object in "questions", '
  + 'not on the passage.';

/**
 * The ceiling on what one paper may write, reasoning included. The call used to
 * set none, so it could run to the model's own maximum, and a low provider
 * balance reserved that maximum on every request. The largest paper measured
 * (30 Sep – 14 Oct 2026) wrote under 21,000 tokens. A reply that reaches the
 * ceiling is a paper too long for one go: TRUNCATED, "try fewer questions".
 */
const MAX_OUTPUT_TOKENS = 32000;

/**
 * An empty reply: nothing written, nothing billed for writing, not cut off.
 * About one call in thirty at peak, and a no-op from the provider rather than
 * bad output, so it is asked once more. A reply that spent tokens and still
 * came back empty is not free to repeat, and is left to BAD_JSON as before.
 */
function _isEmptyReply(response) {
  const choice = response?.choices?.[0] || {};
  const text = choice.message?.content;
  const empty = text == null || String(text).trim() === '';
  return empty && choice.finish_reason !== 'length'
    && (Number(response?.usage?.completion_tokens) || 0) === 0;
}

function fail(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function canonical(subject) {
  return CANON[String(subject || '').trim().toLowerCase()] || null;
}

/**
 * The system prompt, in the order the original assembled it: subject, final
 * task, output format, answer-key instruction, safety policies. The order is
 * load-bearing — safety goes last so nothing after it can soften it.
 *
 * `includeAnswerKey` is still accepted and no longer changes the prompt: it
 * decides whether a key is SENT, not whether one can be made (bd-bfnsk).
 */
// eslint-disable-next-line no-unused-vars
function buildSystemPrompt({ subject, includeAnswerKey }) {
  const key = canonical(subject) || 'eng';
  const parts = [
    PROMPTS[SYSTEM_PROMPT[key] || SYSTEM_PROMPT.eng],
    PROMPTS['eg.task.ict_final'],
    PROMPTS[FORMAT_PROMPT[key] || 'eg.format.exam'],
    ANSWER_KEY_ON,
    PROMPTS['eg.safety.policies'],
  ];
  return parts.join('');
}

function _count(t) {
  return Math.max(1, parseInt(t.count, 10) || 1);
}

/** `target` questions spread over the same types, the remainder to the earlier
 * ones, so a paper opens with its fullest section (mirrors QuestionTypes.withCounts). */
function _rescale(types, target) {
  if (!types.length || target <= 0) return [];
  const base = Math.floor(target / types.length);
  let spare = target - base * types.length;
  return types.map((t) => {
    const count = base + (spare > 0 ? 1 : 0);
    if (spare > 0) spare -= 1;
    return { ...t, count: Math.max(1, count) };
  });
}

/**
 * The number a teacher types is the size of her paper — all of it. Until
 * It once sized only the unseen half, and "a mix of both" then added every
 * exercise in the chapter on top, so a request for 20 came back as 64.
 *
 *   unseen  → all `total` are new questions, types as given.
 *   both    → at most half are lifted from the book (seenTarget = floor(total/2)),
 *             the rest are new, and the types are re-spread over that rest.
 *   seen    → exactly `total` lifted from the book, no new ones.
 *
 * Jobs queued before the count travelled with them carry only the types, whose
 * counts summed to the number she typed — so the total is derived from those.
 */
function planCounts({ contentSource = 'unseen', questionCount, questionTypes = [], seenCount = null }) {
  const typed = questionTypes.reduce((s, t) => s + _count(t), 0);
  const total = Number(questionCount) > 0 ? Number(questionCount) : typed;
  if (contentSource === 'seen') {
    return { total, seenTarget: total, unseenTarget: 0, questionTypes: [] };
  }
  // Both, with the Seen number she typed on its own screen. Her Unseen counts
  // are HERS — used as given, never re-spread — and the paper is the two added
  // together. The number travels explicitly rather than being inferred from
  // total − types, because that inference cannot tell this job from an older
  // one whose types happen to sum short of its total.
  const seen = Number(seenCount);
  if (contentSource === 'both' && Number.isInteger(seen) && seen > 0) {
    return { total: seen + typed, seenTarget: seen, unseenTarget: typed, questionTypes };
  }
  // Both, queued before the Seen count existed: the old half-and-half split.
  if (contentSource === 'both') {
    const seenTarget = Math.floor(total / 2);
    const unseenTarget = total - seenTarget;
    return { total, seenTarget, unseenTarget, questionTypes: _rescale(questionTypes, unseenTarget) };
  }
  return { total, seenTarget: 0, unseenTarget: total, questionTypes };
}

/**
 * The types a child DRAWS, from text, on the answer sheet. The paper prints no
 * figure, so left to itself the model writes "complete the mind map below" and
 * the child looks for a figure that is not there. Named only when one of them
 * is asked for, so every other prompt stays exactly as it was.
 */
const DRAWN_BY_THE_CHILD = new Set(['Mind Map', 'Flow Chart', 'Graphs & Geometric Problems']);
const DRAW_IT_LINE = '• For Mind Map / Flow Chart / Graphs & Geometric Problems: give the topic or the '
  + 'data as text; the child draws it on the answer sheet; never refer to boxes, branches, arrows or a '
  + 'figure printed on the paper.';

/**
 * A topic paper's skills (spec §2): each ticked skill as "code — description", and the rule that every question
 * tests one of them. Empty for any other paper, so its prompt is the string it always was.
 */
function sloBlock(slos) {
  if (!Array.isArray(slos) || !slos.length) return '';
  const list = slos.map((s) => `  - ${s.code} — ${s.description}`).join('\n');
  return `
• This paper covers only these skills:
${list}
• Every question must test one of these skills and carry \`"slo": "<code>"\` with that skill's code. Do not write a question about the chapter's story or about anything that is not one of these skills
• The counts in this message override any counts in the instructions`;
}

module.exports = {
  DRAWN_BY_THE_CHILD, DRAW_IT_LINE, MAX_OUTPUT_TOKENS, MODELS, URDU_MEDIUM, _count, _isEmptyReply,
  buildSystemPrompt, canonical, fail, familyModel, patternModel, planCounts, sloBlock,
};
