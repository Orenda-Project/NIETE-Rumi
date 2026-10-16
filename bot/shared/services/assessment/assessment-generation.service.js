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
const { resolveModelForJob } = require('../../config/model-registry');
const { configForRequest, ensureCurrent } = require('../../config/model-settings');
const { logToFile } = require('../../utils/logger');
const { extractJsonFromResponse } = require('./assessment-json.util');

const PROMPTS = require('./ict-prompts.json');

/** One question, one answer: what this family should run right now. */
function familyModel(family) {
  return resolveModelForJob('assessment.generate', { cfg: configForRequest(), family }).model;
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
  + '- Match the Column: every correct pair, "left → right", comma-separated.\n'
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
 * What to make, in the words the prompts expect. Objective and subjective are
 * listed separately because that is the shape of the tree the model returns.
 */
function buildUserPrompt({ grade, subject, pageContent, pageReference,
                           contentSource, questionCount, questionTypes = [], totalMarks = null,
                           seenCount = null }) {
  const plan = planCounts({ contentSource, questionCount, questionTypes, seenCount });
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

  // Only when she set one. An always-present line about marks would change every
  // prompt we have ever sent, including for the papers nobody budgeted.
  const budget = Number(totalMarks) > 0 ? Number(totalMarks) : null;
  const drawIt = plan.questionTypes.some((q) => DRAWN_BY_THE_CHILD.has(q.id));

  return `**Grade:** ${grade}
**Subject:** ${subject}
**Page Reference:** ${pageReference}

**Book Text Content:**
\`\`\`
${pageContent}
\`\`\`

**GENERATE THE FOLLOWING:**
${items.map((i) => `• ${i}`).join('\n')}
• In total the paper must have exactly ${plan.total} questions — no more${budget ? `
• The whole paper must be worth ${budget} marks in total — allocate the marks across the questions so they add up to ${budget} and NEVER exceed it` : ''}

**IMPORTANT NOTES:**
• For SEEN questions: Extract questions exactly as they appear in the textbook
• For UNSEEN questions: Create new questions based on concepts from the textbook
• The paper carries no pictures. Do NOT include any question that needs a picture, illustration or diagram to answer (e.g. "write the name of each object under its picture", "look at the picture and…", "colour the…"). Rewrite it so it can be answered from text alone, or leave it out${drawIt ? `
${DRAW_IT_LINE}` : ''}
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
 * What one question is worth, measured the way the paper prints it.
 *
 * A composite question (a Long Question with parts) carries marks on its
 * sub-questions, and the renderer's totalMarks() prefers their sum over the
 * parent's own number. Enforcement has to agree with the renderer, or we trim
 * against one total and print another.
 */
function _marksOf(q) {
  if (Array.isArray(q?.questions)) {
    const subs = q.questions.reduce((s, sub) => s + (Number(sub?.marks) || 0), 0);
    if (subs > 0) return subs;
  }
  return Number(q?.marks) || 0;
}

/** What the whole tree is worth. Same rule, every question. */
function totalMarksOf(examJson) {
  let sum = 0;
  _walkQuestions(examJson, (q) => { sum += _marksOf(q); });
  return sum;
}

/**
 * Keep the paper inside the marks budget she asked for.
 *
 * The prompt states the budget; this makes it true when the model ignores it —
 * the same job trimSeen does for the seen cap, and done the same way: walk in
 * tree order, keep while there is room, drop the rest. Returns how many were
 * removed.
 *
 * Two decisions worth stating, because both are load-bearing:
 *
 *   * We DROP whole questions rather than rescale marks. Marks are pedagogical:
 *     a 5-mark essay rewritten to 2 marks misrepresents the work it demands and
 *     silently edits a mark scheme she will grade against. Every question that
 *     survives is exactly as the model wrote it.
 *
 *   * Dropping can leave her with fewer questions than she asked for, and that
 *     is the intended trade. The marks total is the constraint imposed on her
 *     from outside — the exam type, the school — while the question count is her
 *     own preference, and is already soft downstream (trimSeen drops, and the
 *     review screen lets her untick more). Overshooting marks is the failure she
 *     cannot fix after the fact; a question short, she can see and regenerate.
 *
 * A budget of null/0 means she set none: nothing is touched, which is the
 * behaviour that existed before this field did.
 */
function enforceMarksBudget(examJson, budget) {
  const cap = Number(budget);
  if (!Number.isFinite(cap) || cap <= 0) return 0;
  if (totalMarksOf(examJson) <= cap) return 0;

  let spent = 0;
  let kept = 0;
  let removed = 0;

  const fits = (q) => {
    const cost = _marksOf(q);
    // The first question always survives. A single question worth more than the
    // whole budget would otherwise empty the paper, and a paper slightly over
    // budget beats a blank one.
    if (kept === 0 || spent + cost <= cap) {
      spent += cost;
      kept += 1;
      return true;
    }
    removed += 1;
    return false;
  };

  const take = (list) => list.filter((q) => (q && typeof q === 'object' ? fits(q) : true));

  for (const section of ['seen', 'unseen']) {
    const branch = examJson?.[section];
    if (!branch || typeof branch !== 'object') continue;
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
  }
  return removed;
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

// An option's label and the text after it: "b) 4", "(b) 4", "B. 4", "ج) اسلام آباد".
const OPTION_LABEL = /^\s*\(?\s*([A-Za-z]|[؀-ۿ]{1,3})\s*[).:\-]\s*(.*)$/s;

function _norm(text) {
  return String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function _splitOption(option) {
  const m = String(option ?? '').match(OPTION_LABEL);
  return m ? { label: _norm(m[1]), text: _norm(m[2]) } : { label: null, text: _norm(option) };
}

/**
 * The option an MCQ answer names, or null when it names none unambiguously.
 * Tried in order: the option itself, its label alone ("b", "(b)", "ج"), and the
 * text after the label ("4" for "b) 4"). Only a single match counts — a guess
 * would print a wrong answer on a teacher's key, which is worse than a gap.
 */
function _resolveOption(options, answer) {
  const want = _norm(answer);
  if (!want) return null;
  const exact = options.filter((o) => _norm(o) === want);
  if (exact.length === 1) return exact[0];
  const bareLabel = want.replace(/^\(\s*/, '').replace(/\s*[).:\-]?\s*\)?$/, '');
  const byLabel = options.filter((o) => _splitOption(o).label === bareLabel);
  if (byLabel.length === 1) return byLabel[0];
  const asOption = _splitOption(answer);
  const byText = options.filter((o) => {
    const t = _splitOption(o).text;
    return t && (t === want || (asOption.label && t === asOption.text));
  });
  return byText.length === 1 ? byText[0] : null;
}

/** "1) a 2) b 3) c" → ['a','b','c'], or null when it is not numbered 1..n. */
function _splitNumbered(answer, n) {
  const text = String(answer ?? '');
  const marks = [...text.matchAll(/(?:^|\s)\(?(\d{1,2})\s*[).:\-]\s*/g)];
  const seq = [];
  for (const m of marks) {
    if (Number(m[1]) === seq.length + 1) seq.push(m);
  }
  if (seq.length !== n || n === 0) return null;
  return seq.map((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < seq.length ? seq[i + 1].index : text.length;
    return text.slice(start, end).trim();
  });
}

function _hasText(v) {
  return typeof v === 'string' ? v.trim() !== '' : v != null && v !== false;
}

/**
 * Make the model's answers usable by the key without asking it again — only
 * where the right answer is recoverable from what it wrote (bd-bfnsk):
 *
 *   * An MCQ answer given as a letter, a label or the option's bare text is
 *     rewritten to the exact option, so the key reads "b) 4", not "b".
 *   * A comprehension answer written once on the passage as "1) … 2) …" is
 *     split onto the sub-questions that carry none. A sub-question's own
 *     answer is never overwritten.
 *
 * Nothing is invented: an answer that cannot be placed is left as written.
 */
function normaliseAnswers(examJson) {
  _walkQuestions(examJson, (q) => {
    if (Array.isArray(q.options) && q.options.length && _hasText(q.answer)
        && typeof q.answer !== 'object') {
      const hit = _resolveOption(q.options, q.answer);
      if (hit != null) q.answer = hit;
    }
    if (Array.isArray(q.questions) && q.questions.length && _hasText(q.answer)) {
      const parts = _splitNumbered(q.answer, q.questions.length);
      if (parts) {
        q.questions.forEach((sub, i) => {
          if (sub && typeof sub === 'object' && !_hasText(sub.answer) && parts[i]) sub.answer = parts[i];
        });
      }
    }
  });
  return examJson;
}

/**
 * How much of the key has an answer, counted the way renderAnswerKey prints
 * it: a comprehension question counts once per sub-question, and falls back to
 * the passage's own answer only when none of its subs has one.
 */
function answerCoverage(examJson) {
  let questions = 0;
  let answered = 0;
  _walkQuestions(examJson, (q) => {
    if (Array.isArray(q.questions) && q.questions.length && q.passage) {
      const subs = q.questions;
      const anySub = subs.some((s) => s && typeof s === 'object' && _hasText(s.answer));
      if (!anySub && _hasText(q.answer)) { questions += 1; answered += 1; return; }
      subs.forEach((s) => {
        questions += 1;
        if (s && typeof s === 'object' && _hasText(s.answer)) answered += 1;
      });
      return;
    }
    questions += 1;
    if (_hasText(q.answer)) answered += 1;
  });
  return { questions, answered };
}

async function generateExam(args) {
  const { grade, subject, pageContent, pageReference,
          contentSource = 'unseen', questionCount, questionTypes = [], includeAnswerKey = false,
          totalMarks = null, seenCount = null } = args;

  const key = canonical(subject) || 'eng';
  const family = URDU_MEDIUM.has(key) ? 'urdu' : 'eng';
  // bd-gr4fy.5.8: this job picks its model here, before the client's own wait for stale settings runs, so
  // settings too old to trust are read first (one bounded wait). familyModel stays synchronous for MODELS.
  if (typeof ensureCurrent === 'function') await ensureCurrent();
  const model = familyModel(family);
  // The model this family runs with no settings at all (bd-gr4fy.7). Named as `fallbackModel` only
  // when the settings moved the call, so llm-client stands this paper's own model behind the moved
  // one: Urdu and English papers run different models, and only this call site knows which.
  const ownModel = resolveModelForJob('assessment.generate', { family }).model;
  const plan = planCounts({ contentSource, questionCount, questionTypes, seenCount });

  const messages = [
    { role: 'system', content: buildSystemPrompt({ subject, includeAnswerKey }) },
    { role: 'user', content: buildUserPrompt({ grade, subject, pageContent, pageReference, contentSource, questionCount, questionTypes, totalMarks, seenCount }) },
  ];

  logToFile('[assessment] generating', {
    grade, subject: key, model, pageReference, contentSource,
    total: plan.total, seenTarget: plan.seenTarget,
    types: plan.questionTypes.map((q) => `${q.count} ${q.id}`), contentChars: (pageContent || '').length,
  });

  const ask = () => getClient().chat.completions.create({
    model,
    // Names the spender. llm-client records it on api.cost.incurred and strips it
    // before the request goes out, so this job stops being $11.34/day of anonymous spend.
    job: 'assessment.generate',
    ...(model !== ownModel ? { fallbackModel: ownModel } : {}),
    messages,
    temperature: 0.7,
    response_format: { type: 'json_object' },
    max_tokens: MAX_OUTPUT_TOKENS,
  });

  let response;
  const startedAt = Date.now();
  try {
    response = await ask();
    if (_isEmptyReply(response)) {
      logToFile('[assessment] empty reply, retrying once', { model, usage: response.usage || null });
      response = await ask();
    }
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
    // Cut off mid-paper at the ceiling: the same answer as above, not "try again".
    if (choice.finish_reason === 'length') {
      logToFile('[assessment] model ran out of room', { model, usage: response.usage, partial: true });
      throw fail('TRUNCATED', 'That was too much to write in one go — try fewer questions.',
        { usage: response.usage });
    }
    logToFile('[assessment] model returned unusable JSON', {
      model, error: err.message, preview: raw.slice(0, 300),
    });
    throw fail('BAD_JSON', 'The question writer returned something we could not read.',
      { cause: err.message });
  }

  stripImageKeys(examJson);
  normaliseAnswers(examJson);
  const removedSeen = trimSeen(examJson, plan.seenTarget);
  if (removedSeen > 0) {
    logToFile('[assessment] trimmed seen questions to the cap', { seenTarget: plan.seenTarget, removed: removedSeen });
  }
  const trimmed = removedSeen > 0 ? { seen: removedSeen } : {};

  // Last, because it measures the paper that actually survived the seen cap.
  const marksRemoved = enforceMarksBudget(examJson, totalMarks);
  if (marksRemoved > 0) {
    logToFile('[assessment] dropped questions to fit the marks budget', {
      totalMarks, removed: marksRemoved, marksNow: totalMarksOf(examJson),
    });
  }

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

  // Measured on every paper, so a model that stops writing answers shows up in
  // the logs the day it happens rather than in a teacher's blank key (bd-bfnsk).
  const coverage = answerCoverage(examJson);

  logToFile('[assessment] generated', {
    grade, subject: key, questionCount: produced, elapsedMs: Date.now() - startedAt, ...tokenData,
    answersGiven: coverage.answered, answersExpected: coverage.questions,
  });

  return { examJson, questionCount: produced, tokenData, trimmed, plan, marksRemoved,
    answerCoverage: coverage, elapsedMs: Date.now() - startedAt };
}

// ───────────────────────── Board-pattern papers ─────────────────────────
//
// Everything below runs only for a job that carries `pattern`. Nothing above
// calls it, so a paper without a pattern is built exactly as it always was.

const Patterns = require('./patterns');
const { applyLayout } = require('./fde-layout');
const { normaliseScheme } = require('./marking-scheme');
const { mathsCheck } = require('./maths-check');

// Required on first use: the loader opens a database client, and the prompt
// helpers above are loaded by tests and tools that have no database.
// eslint-disable-next-line global-require
const BookContent = () => require('./book-content.service');

/**
 * One section's ceiling and wait. A whole 48-item paper with a marking scheme
 * on every written item is more than one reply carries, so a pattern paper is
 * written one section per call. The job's model reasons before it answers and
 * the reasoning spends the same budget: real full-syllabus Maths and Social
 * Studies sections ran out at 12,000 (Maths A: 7,927 of 11,986 tokens reasoning).
 * So a section has 24,000 and asks for low reasoning effort, which the client
 * passes to every lane. The wait is the SDK's request option, not a body field.
 */
const SECTION_MAX_TOKENS = 24000;
const SECTION_TIMEOUT_MS = 300000;
const SECTION_REASONING = { effort: 'low' };

/**
 * The marks split FDE's table of specification asks for, per subject, by
 * marks (from the FDE pattern document). Not yet in the pattern
 * data, so it lives here until the pattern carries it.
 */
const TOS = {
  maths: { Remember: 10, Understand: 50, Apply: 40 },
  science: { Remember: 30, Understand: 30, Apply: 40 },
  english: { Remember: 40, Understand: 30, Apply: 30 },
  urdu: { Remember: 30, Understand: 30, Apply: 40 },
  social_studies: { Remember: 30, Understand: 40, Apply: 30 },
};

// The rule sentences every section is given. Copied exactly from the engine's
// contract with the paper's reviewers; they compare them by text.
const RULE = {
  bookOnly: 'Set every item from the book text above. Never set an item on \'Create and Connect\' or \'Discovery Playground\' activities.',
  held: 'Urdu: never lessons 1, 2 or 3 (حمد، نعت، ایفائے عہد).',
  r1: 'a single-procedure computation on given numbers counts as Understand; a word problem, a multi-step or unitary problem, a graph from data, a missing angle count as Apply; a fact, name or definition is Remember',
  r1English: '"identify the part of speech by rule" is Understand; "transform a sentence" is Apply',
  recall: 'include 3–5 straight recall MCQs',
  noPictures: 'The paper carries no pictures. A slot marked frame prints an empty frame: write the instruction and the labels/word bank only; never \'look at the picture\'.',
  marks: 'Marks: use EXACTLY the marks given per slot.',
  blooms: 'blooms is one of Remember, Understand, Apply.',
  scheme: 'For every WRITTEN item add scheme: { points: [{text, marks, kind: M|A|U|K|L}] summing EXACTLY to the item\'s marks, accept: [EVERY method the textbook teaches for this item], common_error }. Name a method point generically (e.g. \'a correct method for the common denominator\'), never one route. Give a U point only where the child chooses the unit (cm², m); otherwise fold the unit into the A point. Words / expanded-form items carry A points only. MCQs carry no scheme.',
  families: 'Q2\'s twelve items are four families of three — one number-sense item, one straight computation, one word problem — from Units 1–2, 3–4, 5–6, 7–8 respectively; Q4–Q8 are one each: draw, area, perimeter, average, missing angle.',
  table: 'Data items: give the data as table: { headers, rows }.',
  picks: 'Section B (ب): the (ب) pick lists must be words that appear in the passage, at least two of each kind.',
  jsonOnly: 'Return the JSON only.',
  chapterOnly: 'Set every item only from the pages above. Where a slot\'s rule names a unit or topic outside them, keep the slot\'s kind and marks and set the item from these pages (the nearest skill they hold).',
  scaffold: 'Never write scaffold phrases such as \'based on the passage\', \'based on the text\', \'mentioned in the text\', \'according to the passage\' in a stem. Ask the question directly.',
  noTags: 'Never add a source, chapter, lesson or thinking-level tag to an item, such as \'(Based on the chapter/concept: …)\', \'(Remember)\' or \'(Understand)\'; the stem ends with the question itself.',
  situationParts: 'Write each situation\'s three sub-questions as objects { question, answer, marks: 2.5, scheme } where scheme.points sum to 2.5; do not prefix a sub-question with a letter.',
  picksVerbatim: 'For each pick kind ask for the count needed plus two extra, copied exactly as the words appear in the passage (same spelling, same form).',
  gender: 'A child or a person in a stem is \'a child\', \'a student\', \'they\', or a named character. Never she/he, his/her for an unnamed person.',
  genderUrdu: 'کسی نامعلوم شخص کے لیے صنفی فعل استعمال نہ کریں؛ \'آپ … کریں\' یا نام والا کردار استعمال کریں۔', // needs fluent-Urdu review
  oneKey: 'An anagram, homophone or spelling MCQ has exactly one option that satisfies the stem.',
  oneCorrect: 'Every MCQ has exactly one correct option: check that no other option is also true (another number that fits the rule, a second work by the same author, a value equal to the key).',
  optionsOnly: 'Write the four options only in `options`; never list (a), (b), (c), (d) inside the question.',
  urduQ4: 'Each Q4 item\'s `question` starts with its own directive in Urdu (what to do: choose the group word, choose the conditional word, change to the future tense, split into syllables), then the sentence or words.',
  noUnderline: 'Never refer to an underlined, bold or italic word; name the word in the stem instead.',
  scienceQ3: 'Q3(a): two of the three long questions are Remember (state, name, define with the book\'s wording); one is Understand. Q3(b): the short questions are reasoning items (\'Why…\', \'What would happen if…\', \'Is … natural or artificial? Give a reason\') so that the paper carries Apply marks.',
  unequalOptions: 'MCQ options are pairwise unequal in value (no two options that simplify to the same number, no 2/5 and 6/15) and written in simplest form.',
  noRepeats: 'No item repeats another item\'s content, numbers or answer on this paper, in any section.',
  spreadKeys: 'Spread the correct options across a, b, c and d; no letter holds more than a third of the keys.',
  sstQ56: 'Q5 and Q6 are situations, \'why\' questions and comparisons that need the child to use a concept, not name or list it; at most one of each slot\'s items is a list.',
  accept: '`accept` lists real alternative answers or methods, never \'as per the book\' or \'any correct answer\'.',
};

// The pages Urdu items are never set from: lessons 1–3 (the Hamd, the Naat, the third).
const HELD_PAGES = '1-27';
// A quote this long from those pages is a quote, not a shared phrase. Stock
// exercise wording runs to 21 characters in real items; a line of verse is 25+.
const HELD_SHINGLE = 24;

/** "1 mark each", "1.25 marks each", "20 marks (parts 10 + 8 + 2)". */
function _marksPhrase(slot) {
  if (Array.isArray(slot.parts) && slot.parts.length) {
    return `${slot.marks_each} marks (parts ${slot.parts.join(' + ')})`;
  }
  return `${slot.marks_each} mark${Number(slot.marks_each) === 1 ? '' : 's'} each`;
}

/** One slot as the model is asked for it: every field read from the pattern, nothing typed. */
function _slotBlock(slot, lang) {
  const label = lang === 'ur' && slot.label_ur ? `${slot.label_en} (${slot.label_ur})` : slot.label_en;
  const lines = [
    `• ${label} — generate EXACTLY ${slot.generate} item${slot.generate === 1 ? '' : 's'} under unseen.${slot.category}."${slot.type}"; `
      + `tag every item "slot": "${slot.slot}"; ${_marksPhrase(slot)}.`,
  ];
  if (slot.attempt < slot.generate) {
    lines.push(`  Choice: the child chooses ${slot.attempt} of ${slot.generate}; make all ${slot.generate} the same difficulty.`);
  }
  if (slot.prompt_rule) lines.push(`  Rule: ${slot.prompt_rule}`);
  const g = slot.grain;
  if (g) {
    lines.push(`  Grain: ${g.kind}; numbers: ${g.number_size}; steps: ${g.steps}; `
      + `${g.unit_choice ? 'the child chooses the unit' : 'the unit is not the child\'s choice'}.`);
  }
  if (Array.isArray(slot.families) && slot.families.length) {
    lines.push(`  Families, in this order: ${slot.families.map((f) => `units ${f.units}: ${f.kinds.join(', ')}`).join('; ')}.`);
  }
  if (Array.isArray(slot.kinds) && slot.kinds.length) {
    lines.push(`  Kinds, one each in this order: ${slot.kinds.join(', ')}.`);
  }
  if (Array.isArray(slot.parts_spec)) {
    const parts = slot.parts_spec.map((p) => {
      const pick = p.pick ? ` (${Object.entries(p.pick).map(([k, n]) => `${k}: ${n}`).join(', ')})` : '';
      return `${p.key}: ${p.n} × ${p.marks_each}${pick}`;
    });
    lines.push(`  Parts: ${parts.join('; ')}.`);
  }
  if (Array.isArray(slot.alternatives)) {
    const fixed = slot.alternatives.find((a) => a.kind === 'fixed');
    if (fixed) lines.push('  Its other alternative is printed from the pattern with no key; do not write it.');
  }
  return lines.join('\n');
}

/** The closed composition lists, for a section that sets composition from them. */
function _closedLists(P, slots) {
  if (!P.closed_lists || !slots.some((s) => s.shape === 'composition')) return null;
  const lists = Object.entries(P.closed_lists).map(([name, items]) => `  closed_lists.${name}: ${items.join(' | ')}`);
  return `Composition topics come only from these closed lists, exactly as written:\n${lists.join('\n')}`;
}

/**
 * What one section of a board-pattern paper asks for. The book text block is
 * the same as buildUserPrompt's (which stays untouched for every other paper);
 * after it, the section's slots and the rules that apply to this subject and
 * this section. Every pattern-specific word comes from the pattern data.
 */
function buildPatternUserPrompt({ grade, subject, pageContent, pageReference, section, slots, lang, P, scope }) {
  const list = Array.isArray(slots) && slots.length ? slots : section.slots;
  const medium = lang || P.medium;
  const key = P.key || Patterns.normalise(subject);
  const sectionLabel = section.label_en || section.label_ur || section.id;
  const hasMcq = list.some((s) => s.shape === 'mcq');

  // The FDE syllabus names units and kinds per slot; a paper set on chosen chapters or
  // pages keeps each slot's kind and marks but takes its items from those pages only.
  const fde = Boolean(scope) && scope.kind === 'fde';
  const rules = [RULE.bookOnly];
  if (!fde) rules.push(RULE.chapterOnly);
  if (key === 'science' && list.some((s) => s.shape === 'situation')) {
    rules.push('Science: a situation comes only from the book activities its slot\'s rule lists, never another.');
  }
  const closed = _closedLists(P, list);
  if (closed) rules.push(closed);
  if (key === 'urdu') rules.push(fde ? `${RULE.held} Set items only from book pages ${P.scope.page_ranges}.` : RULE.held);
  if (scope && scope.kind === 'fde' && P.scope.excluded_pages_note) rules.push(P.scope.excluded_pages_note);
  const tos = TOS[key];
  if (tos) {
    const split = Object.entries(tos).map(([band, pct]) => `${band} ${pct}%`).join(', ');
    rules.push(`Across the whole paper the marks split by thinking level is ${split} (FDE's table of specification). `
      + `Tag each item: ${RULE.r1}${key === 'english' ? `; ${RULE.r1English}` : ''}.`);
  }
  if (hasMcq) {
    rules.push(`In this section, ${RULE.recall}.`, RULE.spreadKeys, RULE.oneCorrect, RULE.optionsOnly);
    // Word MCQs (anagram, homophone, spelling) on the language papers; number options on Maths and Science.
    if (key === 'english' || key === 'urdu') rules.push(RULE.oneKey);
    if (key === 'maths' || key === 'science') rules.push(RULE.unequalOptions);
  }
  rules.push(RULE.noPictures, RULE.marks, RULE.blooms, RULE.scheme, RULE.accept);
  if (fde && key === 'maths' && list.some((s) => (Array.isArray(s.families) && s.families.length) || (Array.isArray(s.kinds) && s.kinds.length))) {
    rules.push(RULE.families);
  }
  rules.push(RULE.table);
  const picks = list.some((s) => Array.isArray(s.parts_spec) && s.parts_spec.some((p) => p.pick));
  if (picks && medium === 'ur') rules.push(RULE.picks);
  if (picks) rules.push(RULE.picksVerbatim);
  if (key === 'science' && list.some((s) => s.shape === 'situation')) rules.push(RULE.situationParts);
  if (key === 'science' && list.some((s) => /\.Q3[a-z]?$/.test(s.slot))) rules.push(RULE.scienceQ3);
  if (key === 'social_studies' && list.some((s) => /\.Q[56]$/.test(s.slot))) rules.push(RULE.sstQ56);
  if (key === 'urdu' && list.some((s) => /\.Q4$/.test(s.slot))) rules.push(RULE.urduQ4);
  rules.push(RULE.scaffold, RULE.noTags, RULE.noUnderline, RULE.gender);
  if (medium === 'ur') rules.push(RULE.genderUrdu);
  rules.push(RULE.noRepeats);

  return `**Grade:** ${grade}
**Subject:** ${subject}
**Page Reference:** ${pageReference}

**Book Text Content:**
\`\`\`
${pageContent}
\`\`\`

**SECTION ${section.id}** — ${sectionLabel}, one section of a board-pattern paper. Write this section only.

**GENERATE THE FOLLOWING:**
${list.map((slot) => _slotBlock(slot, medium)).join('\n')}

Put the items in the tree: unseen → objective|subjective → "<type>" → [items], every item tagged with its "slot".

**RULES:**
${rules.map((r) => `• ${r}`).join('\n')}

${RULE.jsonOnly}
`;
}

/** "=== Page N ===" blocks, in order; null when the text carries no markers. */
function _splitPages(content) {
  const text = String(content || '');
  const marks = [...text.matchAll(/=== Page (\d+) ===\n?/g)];
  if (!marks.length) return null;
  return marks.map((m, i) => ({
    page: Number(m[1]),
    text: text.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : text.length).trim(),
  }));
}

/**
 * The text one section is set from. Every section gets all the loaded pages,
 * except on the FDE syllabus where a slot names its own pages (Maths: Section B
 * from Units 1–8, Section C from Units 11–12).
 */
function _sectionText(section, loaded, scopeKind, ranges) {
  const narrows = scopeKind === 'fde' && section.slots.some((s) => s.section_pages && s.section_pages !== 'scope');
  const whole = { content: loaded.content, pageReference: loaded.pageReference };
  if (!narrows || !ranges) return whole;
  const pages = _splitPages(loaded.content);
  if (!pages) {
    logToFile('[assessment] section pages cannot be split, using all pages', { section: section.id });
    return whole;
  }
  const wanted = Patterns.parseRanges(ranges);
  const kept = pages.filter((p) => wanted.some(([a, b]) => p.page >= a && p.page <= b));
  if (!kept.length) {
    logToFile('[assessment] section pages not loaded, using all pages', { section: section.id, ranges });
    return whole;
  }
  return { content: kept.map((p) => p.text).join('\n\n'), pageReference: ranges };
}

/** Concatenate the sections' trees: the same type under the same category becomes one list. */
function _mergeSections(trees) {
  const out = {};
  for (const tree of trees) {
    for (const branch of ['seen', 'unseen']) {
      const src = tree && tree[branch];
      if (!src || typeof src !== 'object') continue;
      out[branch] = out[branch] || {};
      for (const [category, types] of Object.entries(src)) {
        if (!types || typeof types !== 'object') continue;
        out[branch][category] = out[branch][category] || {};
        for (const [type, list] of Object.entries(types)) {
          if (!Array.isArray(list)) continue;
          out[branch][category][type] = (out[branch][category][type] || []).concat(list);
        }
      }
    }
  }
  return out;
}

/**
 * One section's call: one retry on an empty reply or unreadable JSON, none on a
 * cut-off reply (the same reply again) or a failed call (an outage). Returns the
 * section's tree and every call's usage, so the tokens add up to what was billed.
 */
async function _writeSection({ messages, model, ownModel, pattern, section }) {
  const ask = () => getClient().chat.completions.create({
    model,
    job: 'assessment.generate',
    ...(model !== ownModel ? { fallbackModel: ownModel } : {}),
    messages,
    temperature: 0.7,
    response_format: { type: 'json_object' },
    max_tokens: SECTION_MAX_TOKENS,
    reasoning: SECTION_REASONING,
  }, { timeout: SECTION_TIMEOUT_MS });

  const usages = [];
  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      response = await ask();
    } catch (err) {
      logToFile('[assessment] model call failed', { model, pattern, section: section.id, error: err.message });
      throw fail('MODEL_UNAVAILABLE', 'The question writer is unavailable right now.', { cause: err.message });
    }
    usages.push(response?.usage || {});
    const choice = response?.choices?.[0] || {};
    const raw = choice.message?.content || '';

    if (_isEmptyReply(response)) {
      if (attempt < 2) {
        logToFile('[assessment] empty reply, retrying once', { model, pattern, section: section.id });
        continue;
      }
      throw fail('BAD_JSON', 'The question writer returned something we could not read.', { section: section.id });
    }
    if (!raw && choice.finish_reason === 'length') {
      logToFile('[assessment] model ran out of room', { model, pattern, section: section.id, usage: response.usage });
      throw fail('TRUNCATED', 'That was too much to write in one go — try fewer questions.', { usage: response.usage, section: section.id });
    }
    try {
      return { tree: extractJsonFromResponse(raw), usages };
    } catch (err) {
      if (choice.finish_reason === 'length') {
        logToFile('[assessment] model ran out of room', { model, pattern, section: section.id, usage: response.usage, partial: true });
        throw fail('TRUNCATED', 'That was too much to write in one go — try fewer questions.', { usage: response.usage, section: section.id });
      }
      logToFile('[assessment] model returned unusable JSON', {
        model, pattern, section: section.id, attempt, error: err.message, preview: raw.slice(0, 300),
      });
      if (attempt >= 2) {
        throw fail('BAD_JSON', 'The question writer returned something we could not read.', { cause: err.message, section: section.id });
      }
    }
  }
}

function _sumUsage(usages) {
  const sum = (k) => {
    const vals = usages.map((u) => u && u[k]).filter((v) => v != null);
    return vals.length ? vals.reduce((s, v) => s + Number(v), 0) : null;
  };
  return { prompt_tokens: sum('prompt_tokens'), completion_tokens: sum('completion_tokens'), total_tokens: sum('total_tokens'), cost: sum('cost') };
}

/** Whitespace collapsed, so a quote laid out differently on the page still matches. */
function _flat(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/** Every string a question carries that a child or teacher would read. */
function _textsOf(q) {
  const out = [];
  const add = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === 'object') Object.values(v).forEach(add);
  };
  ['question', 'passage', 'answer', 'options', 'words', 'questions', 'parts', 'topics'].forEach((k) => add(q[k]));
  return out;
}

function _inRanges(page, ranges) {
  return Patterns.parseRanges(ranges).some(([a, b]) => page >= a && page <= b);
}

/** Every Urdu-script string the subject's pattern data carries, whitespace collapsed. */
function _urduStringsOf(P) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') { if (/[\u0600-\u06FF]/.test(v)) out.push(_flat(v)); } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(P);
  return out;
}

/**
 * Urdu only: drop every item that quotes lessons 1–3 (book pp 1–27: the Hamd,
 * the Naat and the third lesson). The prompt already says so; this makes it
 * true when the model forgets. A quote is any run of 24 characters or more
 * from those pages, whitespace collapsed. The pages are loaded once per paper.
 * Mutates the tree; returns what was dropped, [{ slot, reason }].
 */
async function religiousFilter(examJson, P, { grade, subject, allowedText = '' } = {}) {
  const key = (P && P.key) || Patterns.normalise(subject);
  if (key !== 'urdu') return [];
  const held = await BookContent().loadPageRangeContent({ grade, subject, pageRanges: HELD_PAGES });
  const text = _flat(String(held.content || '').replace(/=== Page \d+ ===/g, ' '));
  const shingles = new Set();
  for (let i = 0; i + HELD_SHINGLE <= text.length; i += 1) shingles.add(text.slice(i, i + HELD_SHINGLE));
  // A short run of Urdu is two or three words, so stock exercise wording ("answer the
  // questions below") sits on the held pages AND in the lessons the paper is set from. Only
  // what the held lessons alone contain marks an item as quoting them; a shared phrase never
  // drops a good item and fails the paper as a short slot.
  // The held pages themselves never count as allowed, even when the teacher's chapters reach into them.
  const pages = _splitPages(allowedText);
  const kept = pages ? pages.filter((pg) => !_inRanges(pg.page, HELD_PAGES)).map((pg) => pg.text).join(' ') : allowedText;
  // The pattern's own Urdu (instructions, closed lists, rules) is what the model is told to
  // copy, and a held lesson's exercise can print the same instruction: never a quote.
  const allowedTexts = [_flat(String(kept || '').replace(/=== Page \d+ ===/g, ' ')), ..._urduStringsOf(P)];
  for (const allowed of allowedTexts) {
    for (let i = 0; i + HELD_SHINGLE <= allowed.length; i += 1) shingles.delete(allowed.slice(i, i + HELD_SHINGLE));
  }

  const quotes = (q) => _textsOf(q).some((t) => {
    const s = _flat(t);
    for (let i = 0; i + HELD_SHINGLE <= s.length; i += 1) if (shingles.has(s.slice(i, i + HELD_SHINGLE))) return true;
    return false;
  });

  const dropped = [];
  for (const branch of ['seen', 'unseen']) {
    const tree = examJson && examJson[branch];
    if (!tree || typeof tree !== 'object') continue;
    for (const types of Object.values(tree)) {
      if (!types || typeof types !== 'object') continue;
      for (const [type, list] of Object.entries(types)) {
        if (!Array.isArray(list)) continue;
        types[type] = list.filter((q) => {
          if (!q || typeof q !== 'object' || !quotes(q)) return true;
          const hit = { slot: q.slot || null, reason: 'lesson_1_3' };
          dropped.push(hit);
          logToFile('[assessment] held item dropped', hit);
          return false;
        });
      }
    }
  }
  return dropped;
}

/** Where a pattern paper's pages come from: the pattern's syllabus, the job's pages, or a chapter. */
async function _loadPatternContent({ grade, subject, P, scope, pageRanges, chapterNumber }) {
  const pages = scope && scope.kind === 'fde' ? P.scope.page_ranges : (pageRanges || (scope && scope.pages) || null);
  if (pages) return BookContent().loadPageRangeContent({ grade, subject, pageRanges: pages });
  if (chapterNumber != null) return BookContent().loadChapterContent({ grade, subject, chapterNumber });
  throw fail('NO_CONTENT', 'No pages were given for this paper.');
}

/**
 * A board-pattern paper: one call per section, in parallel, merged and laid out
 * in the pattern's shape. A slot left short after the checks fails the paper
 * (PATTERN_SHORT_SLOT): a board rehearsal missing a question is not one.
 *
 * The job's totalMarks is not read: a pattern fixes its own marks, and the
 * budget trim generateExam applies would cut a slot short.
 */
// `onSection` is called (and awaited, never thrown from) as each section comes back, so the caller
// can mark the paper row as alive: a run of several long calls must not look silent.
async function generatePatternExam({ grade, subject, pattern, scope = null, pageRanges = null, chapterNumber = null, onSection = null }) {
  const startedAt = Date.now();
  const def = Patterns.get(pattern);
  const key = Patterns.normalise(subject);
  const P = def && def.subjects[key];
  if (!P || !Patterns.isEligible(pattern, grade, subject)) {
    throw fail('PATTERN_INELIGIBLE', 'That board pattern is not available for this grade and subject.', { pattern, grade, subject });
  }

  const loaded = await _loadPatternContent({ grade, subject, P, scope, pageRanges, chapterNumber });
  const layoutScope = scope || (chapterNumber != null && !pageRanges
    ? { kind: 'chapters', chapters: [Number(chapterNumber)], pages: null }
    : { kind: 'pages', chapters: null, pages: pageRanges });
  const sectionRanges = (Patterns.scopeFor(pattern, subject) || {}).section_ranges || {};

  const family = URDU_MEDIUM.has(canonical(subject) || 'eng') ? 'urdu' : 'eng';
  if (typeof ensureCurrent === 'function') await ensureCurrent();
  const model = familyModel(family);
  const ownModel = resolveModelForJob('assessment.generate', { family }).model;
  const system = buildSystemPrompt({ subject, includeAnswerKey: true });

  const results = await Promise.all(P.sections.map(async (section) => {
    const text = _sectionText(section, loaded, layoutScope.kind, sectionRanges[section.id]);
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: buildPatternUserPrompt({
        grade, subject, pageContent: text.content, pageReference: text.pageReference,
        section, slots: section.slots, lang: P.medium, P, scope: layoutScope,
      }) },
    ];
    const began = Date.now();
    const { tree, usages } = await _writeSection({ messages, model, ownModel, pattern, section });
    const usage = _sumUsage(usages);
    const elapsedMs = Date.now() - began;
    const slots = section.slots.map((s) => s.slot);
    logToFile('[assessment] generating', {
      pattern, section: section.id, slots, model, usage, cost: usage.cost ?? null, elapsedMs,
    });
    if (onSection) {
      try { await onSection(section.id); } catch (err) { logToFile('[assessment] section progress not recorded', { section: section.id, error: err.message }); }
    }
    return { id: section.id, slots, usage, elapsedMs, tree, usages };
  }));

  let examJson = _mergeSections(results.map((r) => r.tree));
  stripImageKeys(examJson);
  normaliseAnswers(examJson);

  // Layout first, so the filter sees every item under its pattern slot; a drop
  // then lays the paper out again, and the emptied place is a shortfall — the
  // extras the model wrote were already set aside and never fill it.
  const now = new Date().toISOString();
  let laid = applyLayout(examJson, P, layoutScope, { now, presetId: pattern });
  const firstUnplaced = laid.unplaced;
  examJson = laid.examJson;
  const dropped = await religiousFilter(examJson, P, { grade, subject, allowedText: loaded.content });
  if (dropped.length) {
    laid = applyLayout(examJson, P, layoutScope, { now, presetId: pattern });
    examJson = laid.examJson;
  }
  const layout = { placed: laid.placed, unplaced: firstUnplaced };
  logToFile('[assessment] layout applied', {
    pattern, placed: layout.placed, unplaced: layout.unplaced, totalMarks: examJson._layout.total_marks,
    sections: P.sections.map((s) => s.id), dropped: dropped.length, shortfall: laid.shortfall,
  });
  if (laid.shortfall.length) {
    throw fail('PATTERN_SHORT_SLOT', 'A question slot came back short.', { shortfall: laid.shortfall });
  }

  const scheme = normaliseScheme(examJson);
  examJson = scheme.examJson;
  if (scheme.log.length) logToFile('[assessment] scheme normalised', { pattern, notes: scheme.log.slice(0, 50), count: scheme.log.length });
  if (scheme.shortfall.length) {
    throw fail('PATTERN_SHORT_SLOT', 'A question slot came back short.', { shortfall: scheme.shortfall });
  }

  const notesBefore = (examJson._layout.notes || []).length;
  examJson = mathsCheck(examJson, { subject: key }).examJson;
  (examJson._layout.notes || []).slice(notesBefore).forEach((note) => {
    logToFile('[assessment] maths key replaced', { slot: note.slot, n: note.n ?? note.index ?? null, computed: note.computed, model: note.model });
  });

  const all = _sumUsage(results.flatMap((r) => r.usages));
  return {
    examJson,
    questionCount: countQuestions(examJson),
    tokenData: { inputTokens: all.prompt_tokens, outputTokens: all.completion_tokens, totalTokens: all.total_tokens, model },
    pageReference: loaded.pageReference,
    chapterTitle: null,
    sections: results.map(({ id, slots, usage, elapsedMs }) => ({ id, slots, usage, elapsedMs })),
    elapsedMs: Date.now() - startedAt,
    layout,
  };
}

module.exports = {
  generateExam,
  generatePatternExam,
  buildPatternUserPrompt,
  religiousFilter,
  buildSystemPrompt,
  buildUserPrompt,
  planCounts,
  trimSeen,
  enforceMarksBudget,
  totalMarksOf,
  countQuestions,
  stripImageKeys,
  normaliseAnswers,
  answerCoverage,
  MODELS,
};
