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

/**
 * What to make, in the words the prompts expect. Objective and subjective are
 * listed separately because that is the shape of the tree the model returns.
 */
function buildUserPrompt({ grade, subject, pageContent, pageReference,
                           contentSource, questionTypes = [] }) {
  const objective = questionTypes.filter((q) => q.category === 'objective');
  const subjective = questionTypes.filter((q) => q.category !== 'objective');
  const describe = (list) => list
    .map((q) => `${Math.max(1, parseInt(q.count, 10) || 1)} ${q.id}`)
    .join(', ');

  const items = [];
  if (contentSource === 'unseen' || contentSource === 'both') {
    if (objective.length) items.push(`Unseen Objective questions — ${describe(objective)}`);
    if (subjective.length) items.push(`Unseen Subjective questions — ${describe(subjective)}`);
  }
  if (contentSource === 'seen' || contentSource === 'both') {
    items.push('Seen questions (all objective and subjective questions directly from the textbook)');
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

**IMPORTANT NOTES:**
• For SEEN questions: Extract questions exactly as they appear in the textbook
• For UNSEEN questions: Create new questions based on concepts from the textbook
• Include proper marks allocation for each question
• Maintain grade-appropriate language and difficulty
• Return output in the JSON format specified in the system prompt
• Where a question type specifies an exact count (e.g. "5 MCQs"), generate EXACTLY that many questions for that type — no more, no less

---
`;
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
          contentSource = 'unseen', questionTypes = [], includeAnswerKey = false } = args;

  const key = canonical(subject) || 'eng';
  const model = URDU_MEDIUM.has(key) ? MODELS.urdu : MODELS.eng;

  const messages = [
    { role: 'system', content: buildSystemPrompt({ subject, includeAnswerKey }) },
    { role: 'user', content: buildUserPrompt({ grade, subject, pageContent, pageReference, contentSource, questionTypes }) },
  ];

  logToFile('[assessment] generating', {
    grade, subject: key, model, pageReference, contentSource,
    types: questionTypes.map((q) => q.id), contentChars: (pageContent || '').length,
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
  const questionCount = countQuestions(examJson);
  if (questionCount === 0) {
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
    grade, subject: key, questionCount, elapsedMs: Date.now() - startedAt, ...tokenData,
  });

  return { examJson, questionCount, tokenData, elapsedMs: Date.now() - startedAt };
}

module.exports = {
  generateExam,
  buildSystemPrompt,
  buildUserPrompt,
  countQuestions,
  stripImageKeys,
  MODELS,
};
