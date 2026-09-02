'use strict';
/**
 * A chapter of textbook in, exam questions out.
 *
 * Almost all of the quality here lives in the prompts, not the code — thirteen
 * of them in `ict-prompts.json`, carried over unchanged from the service this
 * replaces and checked byte-identical against what it serves in production.
 * They are the part that took years of teacher feedback to get right.
 *
 * What is left for this file is assembly, and assembly is where it can quietly
 * go wrong: the right subject prompt, the right output-format prompt, in the
 * right order, with the answer-key instruction appended or not. Get any of that
 * wrong and the model still answers — just worse, in ways nobody reading one
 * paper would spot. Hence the tests on ordering rather than only on output.
 *
 * Not ported, deliberately: image generation, the bilingual translator, and the
 * AI reviewer. The caller never switched any of them on.
 */

const { getClient } = require('../llm-client');
const { logToFile } = require('../../utils/logger');
const { extractJsonFromResponse } = require('./assessment-json.util');

const PROMPTS = require('./ict-prompts.json');

// Both slots are the same model today, as they were upstream. They stay separate
// because the day one language needs a different model, that is a config change
// and not a code change.
const MODELS = {
  eng: process.env.ASSESSMENT_GEN_MODEL_ENG || 'google/gemini-3.1-pro-preview',
  urdu: process.env.ASSESSMENT_GEN_MODEL_URDU || 'google/gemini-3.1-pro-preview',
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

const ANSWER_KEY_OFF =
  '\n\n🚨 **ANSWER KEY DISABLED**: Do NOT include the "answer" field in any '
  + 'question object. Omit it entirely from the JSON output.';

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
 */
function buildSystemPrompt({ subject, includeAnswerKey }) {
  const key = canonical(subject) || 'eng';
  const parts = [
    PROMPTS[SYSTEM_PROMPT[key] || SYSTEM_PROMPT.eng],
    PROMPTS['eg.task.ict_final'],
    PROMPTS[FORMAT_PROMPT[key] || 'eg.format.exam'],
    includeAnswerKey ? '' : ANSWER_KEY_OFF,
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
 * bd-60015 it sized only the unseen half, and "a mix of both" then added every
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
function planCounts({ contentSource = 'unseen', questionCount, questionTypes = [] }) {
  const typed = questionTypes.reduce((s, t) => s + _count(t), 0);
  const total = Number(questionCount) > 0 ? Number(questionCount) : typed;
  if (contentSource === 'seen') {
    return { total, seenTarget: total, unseenTarget: 0, questionTypes: [] };
  }
  if (contentSource === 'both') {
    const seenTarget = Math.floor(total / 2);
    const unseenTarget = total - seenTarget;
    return { total, seenTarget, unseenTarget, questionTypes: _rescale(questionTypes, unseenTarget) };
  }
  return { total, seenTarget: 0, unseenTarget: total, questionTypes };
}

/**
 * What to make, in the words the prompts expect. Objective and subjective are
 * listed separately because that is the shape of the tree the model returns.
 */
function buildUserPrompt({ grade, subject, pageContent, pageReference,
                           contentSource, questionCount, questionTypes = [] }) {
  const plan = planCounts({ contentSource, questionCount, questionTypes });
  const objective = plan.questionTypes.filter((q) => q.category === 'objective');
  const subjective = plan.questionTypes.filter((q) => q.category !== 'objective');
  const describe = (list) => list.map((q) => `${_count(q)} ${q.id}`).join(', ');

  const items = [];
  if (contentSource === 'unseen' || contentSource === 'both') {
    if (objective.length) items.push(`Unseen Objective questions — ${describe(objective)}`);
    if (subjective.length) items.push(`Unseen Subjective questions — ${describe(subjective)}`);
  }
  if (contentSource === 'both') {
    items.push(`Seen questions — at most ${plan.seenTarget}, taken directly from the textbook's own `
      + 'exercises on these pages (if the pages hold fewer usable exercise questions, add unseen '
      + 'questions instead so the total below is still met)');
  } else if (contentSource === 'seen') {
    items.push(`Seen questions — exactly ${plan.seenTarget}, taken directly from the textbook's own `
      + 'exercises on these pages (objective and subjective)');
  }

  return `**Grade:** ${grade}
**Subject:** ${subject}
**Page Reference:** ${pageReference}

**Book Text Content:**
\`\`\`
${pageContent}
\`\`\`

**GENERATE THE FOLLOWING:**
${items.map((i) => `• ${i}`).join('\n')}
• In total the paper must have exactly ${plan.total} questions — no more

**IMPORTANT NOTES:**
• For SEEN questions: Extract questions exactly as they appear in the textbook
• For UNSEEN questions: Create new questions based on concepts from the textbook
• The paper carries no pictures. Do NOT include any question that needs a picture, illustration or diagram to answer (e.g. "write the name of each object under its picture", "look at the picture and…", "colour the…"). Rewrite it so it can be answered from text alone, or leave it out
• Include proper marks allocation for each question
• Maintain grade-appropriate language and difficulty
• Return output in the JSON format specified in the system prompt
• Where a question type specifies an exact count (e.g. "5 MCQs"), generate EXACTLY that many questions for that type — no more, no less

---
`;
}

/**
 * Keep the first `seenTarget` seen questions in tree order and drop the rest.
 * The prompt asks for the cap; this makes it true when the model ignores it.
 * Returns how many were removed.
 */
function trimSeen(examJson, seenTarget) {
  const branch = examJson?.seen;
  if (!branch || typeof branch !== 'object') return 0;
  let kept = 0;
  let removed = 0;
  const take = (list) => {
    const out = [];
    for (const q of list) {
      if (kept < seenTarget) { out.push(q); kept += 1; } else removed += 1;
    }
    return out;
  };
  for (const category of Object.values(branch)) {
    if (!category || typeof category !== 'object') continue;
    for (const [type, entry] of Object.entries(category)) {
      if (Array.isArray(entry)) category[type] = take(entry);
      else if (entry && typeof entry === 'object') {
        for (const [sub, list] of Object.entries(entry)) {
          if (Array.isArray(list)) entry[sub] = take(list);
        }
      }
    }
  }
  return removed;
}

/**
 * Walk every question in the tree. The shape has two shrugs in it: a subjective
 * entry is either a list of questions or a map of sub-type to list (Long
 * Question), and either section may be absent. Both are handled here so no
 * caller has to know.
 */
function _walkQuestions(examJson, visit) {
  for (const section of ['seen', 'unseen']) {
    const branch = examJson?.[section];
    if (!branch || typeof branch !== 'object') continue;
    for (const category of Object.values(branch)) {
      if (!category || typeof category !== 'object') continue;
      for (const entry of Object.values(category)) {
        if (Array.isArray(entry)) {
          entry.forEach((q) => q && typeof q === 'object' && visit(q));
        } else if (entry && typeof entry === 'object') {
          for (const sub of Object.values(entry)) {
            if (Array.isArray(sub)) sub.forEach((q) => q && typeof q === 'object' && visit(q));
          }
        }
      }
    }
  }
}

function countQuestions(examJson) {
  let n = 0;
  _walkQuestions(examJson, () => { n += 1; });
  return n;
}

/**
 * The model is told not to emit "image" keys, and sometimes emits them anyway.
 * Their value is a prompt for an image generator we did not port, so left in
 * place they render as a stray line of instructions on a child's exam paper.
 */
function stripImageKeys(examJson) {
  _walkQuestions(examJson, (q) => {
    delete q.image;
    delete q.image_description;
  });
  return examJson;
}

async function generateExam(args) {
  const { grade, subject, pageContent, pageReference,
          contentSource = 'unseen', questionCount, questionTypes = [], includeAnswerKey = false } = args;

  const key = canonical(subject) || 'eng';
  const model = URDU_MEDIUM.has(key) ? MODELS.urdu : MODELS.eng;
  const plan = planCounts({ contentSource, questionCount, questionTypes });

  const messages = [
    { role: 'system', content: buildSystemPrompt({ subject, includeAnswerKey }) },
    { role: 'user', content: buildUserPrompt({ grade, subject, pageContent, pageReference, contentSource, questionCount, questionTypes }) },
  ];

  logToFile('[assessment] generating', {
    grade, subject: key, model, pageReference, contentSource,
    total: plan.total, seenTarget: plan.seenTarget,
    types: plan.questionTypes.map((q) => `${q.count} ${q.id}`), contentChars: (pageContent || '').length,
  });

  let response;
  const startedAt = Date.now();
  try {
    response = await getClient().chat.completions.create({
      model,
      messages,
      temperature: 0.7,
      response_format: { type: 'json_object' },
    });
  } catch (err) {
    // An outage is not bad output, and telling them apart is what decides
    // whether a retry is worth anything.
    logToFile('[assessment] model call failed', { model, error: err.message });
    throw fail('MODEL_UNAVAILABLE', 'The question writer is unavailable right now.',
      { cause: err.message });
  }

  const choice = response?.choices?.[0] || {};
  const raw = choice.message?.content || '';

  // This model reasons before it answers, and reasoning spends the same budget
  // as output. Hit the ceiling and the reply comes back with a null content and
  // finish_reason 'length' — which is a truncation, not bad output, and wants a
  // different answer: ask for fewer questions rather than simply try again.
  if (!raw && choice.finish_reason === 'length') {
    logToFile('[assessment] model ran out of room', { model, usage: response.usage });
    throw fail('TRUNCATED', 'That was too much to write in one go — try fewer questions.',
      { usage: response.usage });
  }

  let examJson;
  try {
    examJson = extractJsonFromResponse(raw);
  } catch (err) {
    logToFile('[assessment] model returned unusable JSON', {
      model, error: err.message, preview: raw.slice(0, 300),
    });
    throw fail('BAD_JSON', 'The question writer returned something we could not read.',
      { cause: err.message });
  }

  stripImageKeys(examJson);
  const removedSeen = trimSeen(examJson, plan.seenTarget);
  if (removedSeen > 0) {
    logToFile('[assessment] trimmed seen questions to the cap', { seenTarget: plan.seenTarget, removed: removedSeen });
  }
  const trimmed = removedSeen > 0 ? { seen: removedSeen } : {};
  const produced = countQuestions(examJson);
  if (produced === 0) {
    // Valid JSON with an empty tree. Rare, and worth its own code: retrying is
    // reasonable here, where retrying a refusal is not.
    throw fail('NO_QUESTIONS', 'The question writer returned no questions.');
  }

  const usage = response.usage || {};
  const tokenData = {
    inputTokens: usage.prompt_tokens ?? null,
    outputTokens: usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
    model,
  };

  logToFile('[assessment] generated', {
    grade, subject: key, questionCount: produced, elapsedMs: Date.now() - startedAt, ...tokenData,
  });

  return { examJson, questionCount: produced, tokenData, trimmed, plan, elapsedMs: Date.now() - startedAt };
}

module.exports = {
  generateExam,
  buildSystemPrompt,
  buildUserPrompt,
  planCounts,
  trimSeen,
  countQuestions,
  stripImageKeys,
  MODELS,
};
