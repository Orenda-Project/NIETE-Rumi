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

const { getClient, getClientForModel } = require('../llm-client');
const { resolveModelForJob } = require('../../config/model-registry');
const { configForRequest, ensureCurrent } = require('../../config/model-settings');
const { logToFile } = require('../../utils/logger');
const { extractJsonFromResponse } = require('./assessment-json.util');
const { stemsBlock, applyStems } = require('./topics/stem-prompt');

const PROMPTS = require('./ict-prompts.json');

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

/**
 * What to make, in the words the prompts expect. Objective and subjective are
 * listed separately because that is the shape of the tree the model returns.
 */
function buildUserPrompt({ grade, subject, pageContent, pageReference,
                           contentSource, questionCount, questionTypes = [], totalMarks = null,
                           seenCount = null, slos = null }) {
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
• In total the paper must have exactly ${plan.total} questions — no more${sloBlock(slos)}${stemsBlock(plan.questionTypes)}${budget ? `
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
          totalMarks = null, seenCount = null, slos = null } = args;

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
    { role: 'user', content: buildUserPrompt({ grade, subject, pageContent, pageReference, contentSource, questionCount, questionTypes, totalMarks, seenCount, slos }) },
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
  // bd-6clakk.12 — her ticked stems: a near miss is set to the stem; a question using none is logged.
  const { misses: stemMisses } = applyStems(examJson, plan.questionTypes);
  if (stemMisses.length) logToFile('[assessment] questions without a ticked stem', { misses: stemMisses });
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
const { applyLayout, takenNote, firstAskNote, verseLines, scopeLessons, oneStory, STORY_ITEMS } = require('./fde-layout');
const { normaliseScheme } = require('./marking-scheme');
const { answerRepeats, giveawayNote, stillGivenAway } = require('./fde-answer-repeats');
const { mathsCheck } = require('./maths-check');
const { checkBlueprint, missesSplit, levelDistance, levelNote } = require('./blueprint-check');
const Reader = require('./fde-reader');
const StemCheck = require('./fde-stem-check');
const { writeEarlyPaper } = require('./fde-early-writer');
const { noArrows } = require('./fde-no-arrows');

// Required on first use: the loader opens a database client, and the prompt
// helpers above are loaded by tests and tools that have no database.
// eslint-disable-next-line global-require
const BookContent = () => require('./book-content.service');
const TopicOral = () => require('./topics/topic-oral');

/**
 * One section's ceiling and wait. A whole 48-item paper with a marking scheme
 * on every written item is more than one reply carries, so a pattern paper is
 * written one section per call. The job's model reasons before it answers and
 * the reasoning spends the same budget: real full-syllabus Maths and Social
 * Studies sections ran out at 12,000 (Maths A: 7,927 of 11,986 tokens reasoning).
 * So a section asks for low reasoning effort, which the client passes to every
 * lane. The wait is the SDK's request option, not a body field.
 *
 * A section's slots can only RAISE that ceiling: about 1,000 tokens per
 * written item (its marking scheme included) and 400 per MCQ, up to 32,000.
 * Never below 24,000. That number was set after a real section ran out at
 * 12,000, and low-effort reasoning has not been measured at the high end, so
 * the formula is a ceiling-raiser only. No section of today's pattern sizes
 * above 24,000; a larger section added later gets the room it needs.
 */
const SECTION_TOKENS_PER_WRITTEN = 1000;
const SECTION_TOKENS_PER_MCQ = 400;
const SECTION_MIN_TOKENS = 24000;
const SECTION_MAX_TOKENS = 32000;
const SECTION_TIMEOUT_MS = 300000;
const SECTION_REASONING = { effort: 'low' };

/**
 * Social Studies C and D: the first ask writes spares past what prints, and the layout keeps the
 * first items that are new. A held item (a Section A fact asked again, a point set another item
 * answers) then leaves no gap, and a reader flag later is less likely to take a choice slot below
 * what it must offer. Every other slot asks exactly what it prints.
 */
const FIRST_ASK_SPARES = Object.freeze({ 'social_studies.C.Q5': 2, 'social_studies.D.Q6': 2, 'social_studies.D.Q7': 2 });
const firstAsk = (slot) => (Number(slot.generate) || 0) + (FIRST_ASK_SPARES[slot.slot] || 0);

/** The output ceiling for one section's call, from the items its slots generate. */
function sectionMaxTokens(section) {
  const want = (section.slots || []).reduce((sum, slot) => sum + firstAsk(slot)
    * (slot.shape === 'mcq' ? SECTION_TOKENS_PER_MCQ : SECTION_TOKENS_PER_WRITTEN), 0);
  return Math.min(SECTION_MAX_TOKENS, Math.max(SECTION_MIN_TOKENS, want));
}

// The direct Anthropic lane caches a marked prefix; every other lane is sent today's strings.
const DIRECT_LANE = 'anthropic-direct/';
const CACHE_EPHEMERAL = Object.freeze({ type: 'ephemeral' });

/**
 * One section's messages. Off the direct lane, exactly today's two strings. On it, the system
 * prompt and the book text are marked for caching: every section of a paper set from the whole
 * syllabus shares both, and they come before anything section-specific. The text is unchanged,
 * only split: the user prompt's parts joined are the same string byte for byte. When the book
 * block cannot be found exactly, only the system prompt is marked.
 */
function _sectionMessages({ system, user, pageContent, model }) {
  if (!String(model || '').startsWith(DIRECT_LANE)) {
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
  }
  const block = `**Book Text Content:**\n\`\`\`\n${pageContent}\n\`\`\`\n`;
  const at = user.indexOf(block);
  const end = at + block.length;
  const content = at < 0 || end >= user.length
    ? user
    : [{ type: 'text', text: user.slice(0, end), cache_control: CACHE_EPHEMERAL }, { type: 'text', text: user.slice(end) }];
  return [
    { role: 'system', content: [{ type: 'text', text: system, cache_control: CACHE_EPHEMERAL }] },
    { role: 'user', content },
  ];
}

/** The cached part of a section's messages, as a comparable key; null when nothing past the system is cached. */
function _cachedPrefixKey(messages) {
  const user = messages[1] && messages[1].content;
  if (!Array.isArray(user) || !user[0] || !user[0].cache_control) return null;
  return JSON.stringify([messages[0].content, user[0]]);
}

/**
 * Write each prefix that two or more sections share to the cache, once, before the sections go.
 *
 * Sections run in parallel, and a cache entry is readable only once the request writing it has
 * started answering: sent together, every section writes the same prefix and none reads it. One
 * call with that exact prefix, the sections' own model, effort and JSON instruction, and no output
 * (`max_tokens: 1`; the reasoning is cut off with it) writes it; the
 * sections then read it. Maths sections are set from different pages and share nothing past the
 * system prompt, so they get no warm call. A failure here never fails the paper: the sections
 * simply write the cache themselves. Returns each warm call's usage, which is billed.
 */
const WARM_MAX_TOKENS = 1;

async function _warmSharedPrefixes({ built, model, job, requestId, pattern }) {
  if (!String(model || '').startsWith(DIRECT_LANE)) return [];
  const groups = new Map();
  for (const { section, messages } of built) {
    const key = _cachedPrefixKey(messages);
    if (key) groups.set(key, (groups.get(key) || []).concat([{ section, messages }]));
  }
  const shared = [...groups.values()].filter((g) => g.length >= 2);
  return Promise.all(shared.map(async (group) => {
    const [system, user] = group[0].messages;
    const sections = group.map((g) => g.section.id);
    try {
      const { client } = getClientForModel(model, { job, routed: true });
      const response = await client.chat.completions.create({
        model,
        messages: [system, { role: 'user', content: [user.content[0], { type: 'text', text: 'warmup' }] }],
        temperature: 0.7,
        response_format: { type: 'json_object' },
        // One token, not zero: the API took 0 as "no limit" and wrote a whole billed answer to
        // "warmup" (3,702 tokens, ~22 s, before any section could start). The effort stays the
        // sections' own, because a change of thinking settings would stop the sections reading
        // the cache this call writes; the one-token cap is what bounds the reasoning.
        max_tokens: WARM_MAX_TOKENS,
        reasoning: SECTION_REASONING,
      }, { timeout: SECTION_TIMEOUT_MS });
      const usage = (response && response.usage) || {};
      logToFile('[assessment] cache warmed', { requestId, pattern, sections, model, usage, cost: usage.cost ?? null });
      return usage;
    } catch (err) {
      logToFile('[assessment] cache warm failed', { requestId, pattern, sections, model, error: err.message });
      return null;
    }
  })).then((usages) => usages.filter(Boolean));
}

/**
 * The marks split FDE's table of specification asks for, per subject, by
 * marks. A pattern subject carries its own (`tos`, set per grade by FDE);
 * this is the fallback for a subject whose pattern does not.
 */
const TOS = {
  maths: { Remember: 10, Understand: 50, Apply: 40 },
  science: { Remember: 30, Understand: 30, Apply: 40 },
  english: { Remember: 40, Understand: 30, Apply: 30 },
  urdu: { Remember: 30, Understand: 30, Apply: 40 },
  social_studies: { Remember: 30, Understand: 40, Apply: 30 },
};

// The kinds Urdu Q4 asks, which no Q1 item asks, on every scope.
const URDU_Q4_NEVER = 'Q4 on this paper asks گروہی الفاظ, حروفِ شرط و جزا, a present-to-future tense change and ارکان سازی; no Q1 item asks any of these.';

// The rule sentences every section is given. Copied exactly from the engine's
// contract with the paper's reviewers; they compare them by text.
const RULE = {
  bookOnly: 'Set every item from the book text above. Never set an item on \'Create and Connect\' or \'Discovery Playground\' activities.',
  held: 'Urdu: never lessons 1, 2 or 3 (حمد، نعت، ایفائے عہد).',
  r1: 'a single-procedure computation on given numbers counts as Understand; a word problem, a multi-step or unitary problem, a graph from data, a missing angle count as Apply; a fact, name or definition is Remember',
  r1English: '"identify the part of speech by rule" is Understand; "transform a sentence" is Apply',
  recall: 'include 3–5 straight recall MCQs',
  noPictures: 'The paper carries no pictures. A slot marked frame prints an empty frame: write the instruction and the labels/word bank only; never \'look at the picture\'.',
  framePictures: 'A picture-description frame gets a drawn picture: give `describe_en`, one short English line naming the scene and the things behind the helper words, drawn as a plain black outline; it is never shown to the child. Every other frame prints empty: write the instruction and the labels/word bank only; never \'look at the picture\'.',
  marks: 'Marks: use EXACTLY the marks given per slot.',
  blooms: 'blooms is one of Remember, Understand, Apply.',
  scheme: 'For every WRITTEN item add scheme: { points: [{text, marks, kind: M|A|U|K|L}] summing EXACTLY to the item\'s marks, accept: [EVERY method the textbook teaches for this item], common_error }. Name a method point generically (e.g. \'a correct method for the common denominator\'), never one route. Give a U point only where the child chooses the unit (cm², m); otherwise fold the unit into the A point. Words / expanded-form items carry A points only. Points mark only what the question asks, never a part it does not ask. accept lists only answers that earn full marks; the form common_error describes is never in accept. MCQs carry no scheme.',
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
  people: 'A person in a word problem or story who is not named is \'they\' (a carpenter … they).',
  // bd-5jmnfj.23: staging printed "Hamza … Their whole trip" and "A boy … They take it home".
  namedChild: 'A named child, or a person the stem calls a boy, girl, man or woman, is never \'they\' or \'their\': repeat the name, or use he/his for a boy or man and she/her for a girl or woman (Hamza … his trip). \'They\' is only for a person the stem gives no name and no sex.',
  genderUrdu: 'کسی نامعلوم شخص کے لیے صنفی فعل استعمال نہ کریں؛ \'آپ … کریں\' یا نام والا کردار استعمال کریں۔', // needs fluent-Urdu review
  oneKey: 'An anagram, homophone or spelling MCQ has exactly one option that satisfies the stem.',
  urduSpelling: 'A spelling (املا) MCQ quotes a meaning or a picture-word in its stem, never the word whose spelling is tested.',
  oneQuestion: 'Each MCQ stem asks one question and ends with its one «؟».',
  urduPlainOptions: 'An MCQ option is never a word of worship (اذان، نماز، روزہ); a distractor is an everyday word.',
  urduTermWord: 'A grammar-term item (اسم صفت، حرفِ عطف، فعل …) never prints a word of its own answer in its stem: describe what the term does, and quote an example.',
  urduConceptOnce: `Q1 asks each grammar concept (شکیہ، تمنائی، شرط و جزا، حرفِ عطف, and so on) in one item only: no other Q1 item names its words, states its rule or gives its example. Each of these is a concept of its own: اسم صوت، اسم آلہ، اسم معرفہ، اسم نکرہ، صفت، موصوف; a definition item asks its concept, so an item that says what a term is («جو لفظ … آواز ظاہر کرے») and an item that asks for that term are one concept asked twice. ${URDU_Q4_NEVER} An antonym item and a synonym item are concepts too: at most one of each.`,
  urduHomograph: 'A homograph (ایک ہی املا) item never quotes the pair\'s word in its stem, not even inside a longer word or phrase; it gives both meanings only.',
  urduPunctuation: 'A رموزِ اوقاف item quotes a sentence printed without its mark and asks which mark it takes; its stem never ends with the mark it asks for (an item keyed «؟» ends «… درست علامت منتخب کریں۔»).',
  urduVerbSense: 'Give a verb sense by a paraphrase or a sentence, never by its infinitive («بننا», «ڈالنا»): the infinitive prints the letters of the word it asks for.',
  urduFormFamily: 'In a واحد/جمع or مذکر/مؤنث item, every option is a form of the asked word\'s family.',
  urduOneTable: 'Q1 takes at most 3 items from one word table of the book (a متشابہ، متضاد or مترادف list), and a distractor is never another Q1 item\'s key.',
  oneCorrect: 'Every MCQ has exactly one correct option: check that no other option is also true (another number that fits the rule, a second work by the same author, a value equal to the key).',
  optionsOnly: 'Write the four options only in `options`; never list (a), (b), (c), (d) inside the question.',
  urduQ4: 'Each Q4 item\'s `question` starts with its own directive in Urdu (what to do: choose the group word, choose the conditional word, change to the future tense, split into syllables), then the sentence or words.',
  urduQ4Group: 'In the Q4 group-word item the group word is one of its four options and is its key; its scheme `accept` names that option only, never another one.',
  urduQ4GroupNotListed: 'In the Q4 group-word item the group word is NOT one of the words the item lists: it names what all of them belong to (تھرمامیٹر، نبض، دوا اور ڈاکٹر all belong to اسپتال), never the odd one out. The item asks in words: it never prints an arrow (← →).',
  urduQ6Points: 'Q6 (ب) scheme: one idea per point, no point above 2 marks.',
  urduSchemeText: 'On an Urdu paper every scheme `points[].text` and `common_error` is written in Urdu, never English: the marking key is read by an Urdu-speaking teacher.',
  urduQ4Syllables: 'In the Q4 ارکان سازی item, split every word into its spoken syllables, as the book does (غ – لا – ظت); every answer `accept` lists splits each word exactly as the key does.',
  urduRelationNouns: 'In Q2 (ب), relation words (امی، ابو، بھائی) are اسم نکرہ, never اسم معرفہ: اسم معرفہ is the own name of one person or place.',
  // On chosen lessons, Q1 asks each of their grammar concepts once; a place left after that is never
  // filled with a concept asked again.
  urduGrammarUsedUp: 'Grammar is used up: these lessons\' grammar concepts are each asked once on this paper already. Write every new Q1 item as vocabulary, word-meaning or comprehension from these lessons; never another antonym, synonym or other grammar item.',
  urduOneWordOnePlace: 'Q3 and Q5 never share a word or idiom: each word on the paper is asked in one place.',
  // The full syllabus: the place was left by a grammar concept asked again.
  urduGrammarUsedUpFull: 'Grammar is used up: the grammar concepts this paper\'s Q1 asks, an antonym and a synonym included, are each asked once already. Write every new Q1 item as vocabulary, word-meaning or comprehension from lessons 4–10; never another antonym, synonym or other grammar item.',
  religious: 'Never set an item that quotes, explains or evaluates a religious text (Qur\'an, hadith, the Farewell Sermon, du\'a, Naat, Hamd); set it from another part of the scope.',
  noUnderline: 'Never refer to an underlined, bold or italic word; name the word in the stem instead.',
  scienceQ3: 'Q3(a): of the ten short questions, three Remember (state, name, define with the book\'s wording), four Understand (explain, compare, give an example) and three Apply, written as reasoning items (\'Why…\', \'What would happen if…\', \'Is … natural or artificial? Give a reason\'). Q3(b): of the five long questions, three Remember and two Apply (use the idea in a new situation from the book); none Understand. '
    // bd-5jmnfj.4.55: v24 Q3(b) 1 named the three parts Q3(a) 1 asked the child to name.
    + 'A Q3(b) long question never names the parts, examples or facts that a Q3(a) short question asks the child to name or list; ask the long question about how or why instead.',
  unequalOptions: 'MCQ options are pairwise unequal in value (no two options that simplify to the same number, no 2/5 and 6/15) and written in simplest form.',
  // bd-5jmnfj.4.50.8: v22 G1 Urdu keyed «بلی» in Q3 and Q7 and printed it in Q1's stem.
  noRepeats: 'No item repeats another item\'s content, numbers or answer on this paper, in any section. '
    + 'An answer word appears nowhere else on the paper: never in another item\'s stem, choices or word box, and never as another item\'s answer. '
    // bd-5jmnfj.4.55: v24 G5 English's Q6 mind map was «Recycling» and so was a Q8 topic choice.
    + 'A writing question\'s topic (mind map, paragraph, story, letter) is never the topic or a topic choice of another writing question.',
  // Social Studies: a paraphrase of a fact is not a repeated stem, so noRepeats lets Q5 and Q7 re-ask it.
  // The sections are written in parallel, so the rule names the slots, not their items.
  sstNoReask: 'Q5 and Q7 never ask a fact that a Section A item (stem or key) or a Q6 item on this paper already tests.',
  // Social Studies: one thinking level per choice group, as FDE's own paper sets them (Q7 recall,
  // Q5 define / explain / compare, Q6 explain or apply in a situation). A mixed slot put one book-recall
  // item among situations, so the child's choice changed how hard the paper was. Q6's situations carry
  // the Apply marks the counted situation rule used to spread over Q5 and Q6.
  sstBand: {
    Q5: 'Every Q5 item is Understand: define a term, explain why, give two reasons, or compare two things from these pages. No Q5 item sets a situation to decide, and none is a one-fact recall item.',
    Q6: 'Every Q6 item is Apply: it sets a situation a Grade 5 child could meet (a decision, a dispute, a journey, a map reading, a weather report) and asks the child to use a concept from these pages to decide or explain. No Q6 item asks to define, list or recall a book fact. '
      + 'A Q6 situation needs the child to apply two different ideas from these pages; never one fact said twice (never "name the tier" twice, never the same government or body as the answer to both parts). '
      + 'No computation in a Q6 item (no degrees, hours or numbers to work out), and never a list of names or book facts to recall dressed as a situation (a poster of names, a quiz). '
      + 'A Q6 situation never asks a history fact; history recall goes to Q7. '
      + 'Nor does it ask only civics or geography facts (who heads or chairs a body, what it is called, how many, when): that recall goes to Q7 too. '
      + 'Nor is a Q6 answered by naming which government, court or body does a job, even with the book\'s one-line reason: besides any marking point that names a government, court or body, at least two of its marking points explain an idea without naming one. '
      + 'A Q6 is never "which map, which medium or which government for each need": such items go to Q7 as one-fact items.',
    Q7: 'Every Q7 item is Remember: one fact (who, what, where, when, how many) answered in one line. No Q7 item asks why or sets a situation.',
  },
  sstGroups: 'The child chooses which items of a question to answer, so every item of Q5, of Q6 and of Q7 is the same kind as the others in its question and as hard.',
  // Social Studies: a marking point that names no fact («پہلی وجہ درست بتانا») tells the teacher nothing
  // to look for, and the layout compares items by their points.
  sstFactPoints: 'Each marking point states its fact (e.g. «آئین بنیادی حقوق کا تحفظ کرتا ہے»), never «پہلی وجہ», «دوسری وجہ», «درست وضاحت».',
  spreadKeys: 'Spread the correct options across a, b, c and d; no letter holds more than a third of the keys.',
  // The page store runs p.29's three columns together line by line, so a model read the provincial
  // cell (encroachments on public roads) as local work. Given column by column when the pages hold
  // it, and to any pages that name a government tier without it. One job per item: a full paper
  // given the rows still keyed two jobs to one government.
  sstTiers: (inPages) => [
    `The book's table on p.29 says which government does what. ${inPages ? 'The page text above runs its three columns together; these are its rows, column by column:' : 'These are its rows, column by column:'}`,
    '- وفاقی حکومت: ملکی دفاع (مسلح افواج کے امور) کی نگرانی کرتی ہے؛ ملکی معیشت کو سنبھالتی ہے؛ خارجہ پالیسی (بیرونی ممالک سے تعلقات کے معاملات) کی نگرانی کرتی ہے۔',
    '- صوبائی حکومت: صوبے کا نظم و نسق (قانون سازی، عوامی سڑکوں اور راستوں سے تجاوزات ہٹانا، امن و امان کا قیام) چلاتی ہے؛ صوبائی محصولات کی نگرانی کرتی ہے؛ صوبوں کی داخلی پالیسی کے معاملات سنبھالتی ہے۔',
    '- مقامی حکومت: مویشی منڈیاں اور عوامی میلے منعقد کرتی ہے؛ پینے کے پانی کا بندوبست اور نکاسی آب کا انتظام دیکھتی ہے؛ بیواؤں، یتیموں، معذوروں اور قدرتی آفات کے متاثرین کی مدد کرتی ہے۔',
    '  An item, key or marking point that says which government (وفاقی، صوبائی یا مقامی) does a job takes it from these rows only; a job the rows do not name is not asked as a which-government item.',
    '  A which-government item asks about one job; a situation with two jobs names each job\'s government from its own row, never both under one government.',
  ].join('\n'),
  accept: '`accept` lists real alternative answers or methods, never \'as per the book\' or \'any correct answer\'.',
  mathsSectionC: 'Section C is also set from the pages above: keep each slot\'s marks and item shape (a word problem stays a word problem, a calculation a calculation) and take the topic from these pages.',
  grammarFromPages: 'Q1(a) grammar MCQs test only the grammar these pages teach. If the pages teach fewer grammar points than there are MCQs, set the rest on the pages\' vocabulary and comprehension. Never test grammar the pages do not teach.',
  mathsTosFloor: 'Of the 100 marks, 8–12 are Remember (at least 8 of the 20 MCQs recall a definition, fact, formula or property name), at most 60 Understand, at least 30 Apply.',
  propertyOneKey: 'For an MCQ that tests a property (divisible by, prime, factor, multiple, even, odd, greatest, smallest, rounded to, place value) exactly ONE option satisfies the stem; check every option before writing it.',
  unitsNumerals: 'Every measurement stem names its unit (cm, m, kg, litres, rupees, degrees). Write mixed numbers as numerals, e.g. 5 2/3, never \'five and two thirds\' or \'5 and 2/3\'.',
  frameLabels: 'Key labels come only from the book\'s figure; if the figure carries fewer parts than the frame has leader lines, ask for that smaller number.',
  grade5Words: 'Use Grade 5 vocabulary; a term the book does not use (e.g. \'lactic acid\', \'electrons\') is replaced by the book\'s word.',
  // Maths Apply marks come from word problems the child must choose the operation for
  // (convention R1). The model follows counted slot rules, not percentages, so the share is a
  // count. Target, attempt-weighted under R1: Remember 8–12, Understand ≤ 60, Apply ≥ 30.
  mathsQ2Words: (n, total) => `In Q2, at least ${n} of the ${total} items are short word problems set in a situation a Grade 5 child knows (shopping, measuring, time, sharing, travel), in which the child decides which operation(s) to use; the other items stay calculations.`,
  mathsQ2Families: (extra) => `Each Q2 family keeps its word problem; set ${extra} more of the families' number-sense or computation items as such word problems, keeping the skill they test.`,
  mathsQ1bWords: (n, total) => `In Q1(b), at least ${n} of the ${total} items are one-step word problems set in a situation a Grade 5 child knows (shopping, measuring, time, sharing, travel), in which the child decides which operation to use.`,
  // English on chosen chapters or pages: FDE's Q1(a)/(b) topic list is not given; the points come from the pages.
  pagesPoints: 'Q1(a) and Q1(b) test only the grammar and word-study points these pages teach. Before writing, list those points to yourself; the reply is still the JSON only.',
  pagesRest: 'If the pages teach fewer points than there are items, set the rest on the pages\' vocabulary and comprehension. Never test grammar the pages do not teach.',
  oneKeyEnglish: 'A homophone or spelling MCQ has exactly one option that satisfies the stem.',
  q5Poem: 'Q5 uses a poem printed in the book. If these pages hold no poem, take the nearest poem in the syllabus, name its unit in the title, and print its lines verbatim; never write verse and never call prose a poem.',
  // Maths on chosen chapters or pages: FDE's Q1(b) and Q2 topic lists are not given; the topics come from the pages.
  mathsPagesAB: 'Q1(b) and Q2 are set from the pages above: keep each slot\'s marks and item shape (a word problem stays a word problem, a calculation a calculation) and take every topic from these pages. The word-problem counts above still apply.',
  noAnagram: 'Never set an item that asks the child to rearrange, unscramble or reorder letters to make a word.',
  // English Q1(b): the underline sentence Q1(a) and Q2 carry, and one rewrite per item.
  q1bQuote: 'Never refer to an underline the paper cannot show; quote the word or phrase instead.',
  q1bOne: 'Each item is one sentence to rewrite, with its instruction once.',
  // English Q5 on chosen pages with no poem: the nearest poem's own page text is given below the book text.
  q5Given: (p) => `Q5 uses this poem from Unit ${p.unit} (book p.${p.pages}); print only its verse lines, exactly as given, never a heading, instruction or activity line; title «${p.title} (Unit ${p.unit})».`,
  // Urdu Q6 on lessons with no poem: lesson 7's poem page text is given below the book text.
  urduQ6Given: (p) => `Q6's verses (درج ذیل اشعار کا مفہوم واضح کریں) come from this poem, lesson ${p.unit} «${p.title}» (book pp. ${p.pages}), whatever lessons the paper covers: \`passage\` = four consecutive verse lines copied exactly as given, never a question or note printed between the couplets.`,
  urduNoMaxims: 'Model answers, passages, dialogues and stories carry no religious maxim, hadith, verse, dua or act of worship; keep them to everyday life.',
  urduNoDates: 'Never ask an item whose answer is a year, a date or a day of the month; the page text\'s numerals are not reliable.',
  // FDE's table puts the writing tasks at Apply (bd-5jmnfj.19); the model tagged them Understand.
  urduWritingApply: 'The picture description, paragraph, story and letter or application are Apply: tag each of them Apply.',
  // Same table puts sentence work at Understand; the model tagged it Apply, 9 marks over (bd-5jmnfj.19).
  urduSentenceUnderstand: 'The rewrite-the-sentences (Q4) and use-the-words-in-sentences (Q5) items are Understand: tag each of them Understand.',
  // FDE's model paper sets the writing at Apply 40, so the poem is recall; the model flipped between runs (bd-5jmnfj.19).
  urduPoemRemember: 'The poem question (Q6), the meaning of the verses or the Naat\'s central idea, is Remember: tag it Remember.',
};

// Maths Q1(b): this many of its one-step items are word problems. One above the floor of 3:
// the model lands one or two short of a counted rule (round-4 local papers: Q2 5, 8, 5 of 12 asked for 6).
const MATHS_Q1B_WORDS = 4;
// Maths on chosen pages: the slots whose rule and grain carry FDE's model-paper topics. Each keeps
// the rule from its marks sentence on (a count and topics come before it) under a topic-free head.
const MATHS_PAGES_SLOTS = Object.freeze({
  'maths.A.Q1b': { head: 'Ten one-step items. ', keepFrom: '2 marks each', number_size: 'the sizes these pages use' },
  'maths.B.Q2': { head: 'Twelve 5-mark items. ', keepFrom: 'Every word problem names its unit', number_size: 'the sizes these pages use' },
});
// English on chosen pages: the slot fields that carry FDE's model-paper topic list, and what replaces them.
// English bans anagram items, so FDE scope's Q1(a) topic list loses its "anagrams" entry at assembly.
const ENGLISH_FDE_Q1A_ANAGRAMS = ', anagrams';
const ENGLISH_PAGES_SLOTS = Object.freeze({
  'english.A.Q1a': { prompt_rule: 'Twenty four-option MCQs, one point each. Never refer to an underline the paper cannot show; quote the word instead.' },
  'english.A.Q1b': {
    prompt_rule: 'Five one-line items, each ending with its direction in round brackets.',
    grain_kind: 'one-line transformation',
  },
});

// Urdu Q1 on chosen lessons or pages: grammar only from those lessons' own «قواعد کا میدان» sections,
// less the kinds Q4 asks; the rest of Q1 is their vocabulary, word meanings and comprehension. The
// slot's rule keeps its lessons 1–3 and options sentences from `keepFrom` on.
const URDU_LESSONS_Q1 = Object.freeze({
  keepFrom: 'Never lessons 1, 2 or 3',
  kind: (terms) => `one point per item: lesson facts, word meanings and comprehension from these lessons${terms.length ? `, and grammar only from their قواعد sections (${terms.join('، ')})` : ''}`,
  rule: (terms) => (terms.length
    ? `Twenty four-option MCQs. Grammar only from these lessons' قواعد sections, each concept once: ${terms.join('، ')}; every other item is vocabulary, word meaning or comprehension from these lessons. `
    : 'Twenty four-option MCQs. These lessons\' قواعد sections give Q1 no grammar point to ask (Q4 asks theirs); every item is vocabulary, word meaning or comprehension from these lessons. '),
});

// Urdu Q1 on chosen lessons: the concept-once and grammar-term rules name those lessons' concepts only
// (the full syllabus's lists name lesson 10's and lesson 8's, which there are holds); Q4's kinds stay
// "never in Q1". Lessons whose grammar is all Q4's give Q1 no concept and no grammar-term rule.
const URDU_LESSONS_RULES = Object.freeze({
  conceptOnce: (terms) => (terms.length
    ? `Q1 asks each grammar concept of these lessons (${terms.join('، ')}) in one item only: no other Q1 item names its words, states its rule or gives its example; a definition item asks its concept, so an item that says what a term is and an item that asks for that term are one concept asked twice. ${URDU_Q4_NEVER}`
    : `Q1 asks no grammar concept on these lessons. ${URDU_Q4_NEVER}`),
  termWord: (terms) => (terms.length
    ? `A grammar-term item (${terms.join('، ')}) never prints a word of its own answer in its stem: describe what the term does, and quote an example.`
    : null),
  // A count is easier to keep than "once each". `pairs`: the entries that name two concepts.
  budget: (terms, n, of, pairs) => (n
    ? `Q1: exactly ${n} of the ${of} items ${n === 1 ? 'is' : 'are'} grammar, one item per concept (${terms.join('، ')}${pairs.length ? `; ${pairs.map((t) => `«${t}»`).join(' and ')} ${pairs.length === 1 ? 'is' : 'are each'} two concepts, one item each` : ''}); the other ${of - n} are vocabulary, word meanings or comprehension from these lessons.`
    : null),
  concept: (terms) => (terms.length
    ? `Give every Q1 item a "concept" field: the grammar concept it asks, written as one of ${terms.join('، ')}; or «ذخیرۂ الفاظ / فہم» for a vocabulary, word-meaning or comprehension item. The field is never printed.`
    : null),
  // Lessons with one prose story: twenty items from one story name each other's people and things.
  story: (of) => `These lessons hold one story: at most ${STORY_ITEMS} of the ${of} Q1 items ask a fact of the story; write the rest from the lessons' own word lists (نئے الفاظ، معمے کے الفاظ), their word meanings and idioms, and the poem's words. `
    + 'Give every Q1 item a "source" field: story, word, meaning, idiom or poem. The field is never printed.',
});

// The pages Urdu items are never set from: lessons 1–3 (the Hamd, the Naat, the third).
const HELD_PAGES = '1-27';
// A quote this long from those pages is a quote, not a shared phrase. Stock
// exercise wording runs to 21 characters in real items; a line of verse is 25+.
const HELD_SHINGLE = 24;
// Social Studies: no item may quote, explain or evaluate a religious text, the book's own
// "importance of the Farewell Sermon" questions included. An item naming one of these is
// held. Each pattern is matched on _heldNorm text as a whole word, with the endings the word
// takes (plural, adjective), so «احمد», «ہدایت», «نعمت» or «مدعا» never match.
const HELD_TERMS_SST = Object.freeze([
  { term: 'حجۃ الوداع', pattern: 'حجت?ہ ?الوداعی?' },
  { term: 'حدیث', pattern: 'حدیث(?:یں|وں|ی)?|احادیث' },
  { term: 'آیت', pattern: 'ایت(?:یں|وں)?|ایات' },
  { term: 'قرآن', pattern: 'قران(?:ی|ے)?' },
  { term: 'دعا', pattern: 'دعا(?:ئیں|ئیہ|ئی|ئے|ؤں|وں|یں|ی|ے)?' },
  { term: 'نعت', pattern: 'نعت(?:یں|وں|یہ)?' },
  { term: 'حمد', pattern: 'حمد(?:یہ)?' },
].map(({ term, pattern }) => Object.freeze({ term, re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'u') })));

// Urdu: the text the model writes itself (a model answer, a passage, a scheme point) never carries
// a religious maxim, hadith, verse or act of worship. Matched on _heldNorm text, whole words. The
// operator-allowed classes («اللہ تعالیٰ کرے», «میری دعا ہے کہ», greetings, «دعا» in a letter) are
// not in the list; «ایمان داری» (honesty) is not «ایمان کا حصہ».
// The imperative and the obligation; «پڑھوں گا», «پڑھیں گے», «پڑھو گے» are a future, not an exhortation.
const URDU_EXHORT = '(?:و(?!ں| گ[ےیا])|یں(?! گ[ےیا])|ا کرو|ا کریں|نا چاہی|نی چاہی|نے چاہی)';
const HELD_TERMS_URDU_AUTHORED = Object.freeze([
  { term: 'ایمان کا حصہ', pattern: 'ایمان کا حصہ' },
  { term: 'نصف ایمان', pattern: 'نصف ایمان' },
  { term: 'حدیث', pattern: 'حدیث(?:یں|وں|ی)?|احادیث' },
  { term: 'فرمایا', pattern: 'فرمای[اے]' },
  { term: 'قرآن', pattern: 'قران(?:ی|ے)?' },
  { term: 'آیت', pattern: 'ایت(?:یں|وں)?|ایات' },
  { term: 'ارشاد', pattern: 'ارشاد' },
  // Worship is held as an exhortation or an obligation («نماز پڑھو», «پڑھنی چاہیے», «روزہ رکھنا فرض ہے»);
  // a narrated routine («صبح اٹھ کر نماز پڑھتا») is the prompt line's, not a maxim.
  { term: 'نماز پڑھ', pattern: `نماز ?پڑھ${URDU_EXHORT}`, open: true },
  { term: 'روزہ رکھ', pattern: `روز[ہے] ?رکھ${URDU_EXHORT}`, open: true },
  // «فرض» is also "duty" («اپنا فرض سمجھا»): only the obligation predicate is held.
  { term: 'فرض', pattern: '(?:نماز|روز[ہے])[^۔.!?؟]{0,40}?(?:پر (?:فرض|لازم)|(?:فرض|لازم) ہ(?:ے|یں))' },
].map(({ term, pattern, open }) => Object.freeze({
  term, re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})${open ? '' : '(?![\\p{L}\\p{N}])'}`, 'u'),
})));

// Maths Section A's slot rule asks for 3 to 5 recall MCQs; the ToS floor needs at least 8.
const MATHS_RECALL_FROM = '3 to 5 of them pure recall';
const MATHS_RECALL_TO = 'at least 8 of them pure recall';

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
  const asked = firstAsk(slot);
  const lines = [
    `• ${label} — generate EXACTLY ${asked} item${asked === 1 ? '' : 's'} under unseen.${slot.category}."${slot.type}"; `
      + `tag every item "slot": "${slot.slot}"; ${_marksPhrase(slot)}.`,
  ];
  if (slot.attempt < slot.generate) {
    lines.push(`  Choice: the child chooses ${slot.attempt} of ${slot.generate}; make all ${slot.generate} the same difficulty.`);
  }
  if (asked > slot.generate) {
    lines.push(`  Spares: the last ${asked - slot.generate} are spares, the same difficulty; the paper prints the first ${slot.generate} `
      + 'that ask nothing another item on this paper asks.');
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

// Social Studies p.29: two of the table's own cells, matched with the page store's spacing (and any zero-width mark) removed.
const SST_TIER_CELLS = ['مویشیمنڈیاں', 'تجاوزاتہٹانا'];
function _holdsTierTable(pageContent) {
  const flat = String(pageContent || '').replace(/[\s\u200b-\u200f]+/g, '');
  return SST_TIER_CELLS.every((cell) => flat.includes(cell));
}
// Pages that name a government tier (pp 26-33 in the page store) can ask a which-government item.
const SST_TIER_NAMED = /(?:وفاقی|صوبائی|مقامی)[\s\u200b-\u200f]*حکومت/;

/**
 * What one section of a board-pattern paper asks for. The book text block is
 * the same as buildUserPrompt's (which stays untouched for every other paper);
 * after it, the section's slots and the rules that apply to this subject and
 * this section. Every pattern-specific word comes from the pattern data.
 */
function buildPatternUserPrompt({ grade, subject, pageContent, pageReference, section, slots, lang, P, scope, poem = null }) {
  const medium = lang || P.medium;
  const key = P.key || Patterns.normalise(subject);
  const sectionLabel = section.label_en || section.label_ur || section.id;

  // The FDE syllabus names units and kinds per slot; a paper set on chosen chapters or
  // pages keeps each slot's kind and marks but takes its items from those pages only.
  const fde = Boolean(scope) && scope.kind === 'fde';
  // Maths Section C on chosen pages: the fixed one-of-each-kind list (draw, area, …) is
  // FDE's Units 11–12 syllabus, so it is not asked for; marks and shape stay.
  const mathsC = !fde && key === 'maths' && section.id === 'C';
  const urduLessons = !fde && key === 'urdu' ? scopeLessons(P, scope) : null;
  // Their grammar concepts, less the kinds Q4 asks.
  const urduTerms = urduLessons && [...new Set(urduLessons.flatMap((l) => l.grammar.filter((g) => !g.q4).map((g) => g.ur)))];
  // How many concepts those are: an entry the layout reads as two (تمنائی اور شکیہ) counts two.
  const urduWidth = (ur) => Math.max(1, ...urduLessons.flatMap((l) => l.grammar).filter((g) => g.ur === ur).map((g) => (g.tags || []).length));
  const urduPairs = urduTerms && urduTerms.filter((ur) => urduWidth(ur) > 1);
  const urduConcepts = urduTerms && urduTerms.reduce((n, ur) => n + urduWidth(ur), 0);
  const given = Array.isArray(slots) && slots.length ? slots : section.slots;
  const shaped = given.map((s) => {
    if (mathsC && Array.isArray(s.kinds) && s.kinds.length) {
      return { ...s, kinds: null, prompt_rule: null, grain: s.grain && { ...s.grain, kind: 'a word problem or a calculation' } };
    }
    // Maths on chosen pages: Q1(b)'s ten model topics and Q2's Units 1–8 families go; the topics come from the pages.
    const mathsSlot = !fde && key === 'maths' && MATHS_PAGES_SLOTS[s.slot];
    if (mathsSlot && typeof s.prompt_rule === 'string') {
      const at = s.prompt_rule.indexOf(mathsSlot.keepFrom);
      return {
        ...s,
        prompt_rule: mathsSlot.head + (at >= 0 ? s.prompt_rule.slice(at) : ''),
        grain: s.grain && {
          ...s.grain,
          kind: typeof s.grain.kind === 'string' ? s.grain.kind.split(/[,:]/)[0] : s.grain.kind,
          number_size: mathsSlot.number_size,
        },
        families: null,
      };
    }
    // Urdu on chosen lessons: Q1's grammar is those lessons' own, never "half grammar" from lessons 4–10.
    if (urduLessons && s.slot === 'urdu.A.Q1' && typeof s.prompt_rule === 'string') {
      const at = s.prompt_rule.indexOf(URDU_LESSONS_Q1.keepFrom);
      return {
        ...s,
        prompt_rule: URDU_LESSONS_Q1.rule(urduTerms) + (at >= 0 ? s.prompt_rule.slice(at) : ''),
        grain: s.grain && { ...s.grain, kind: URDU_LESSONS_Q1.kind(urduTerms) },
      };
    }
    // English on chosen pages: the slot's FDE topic list goes; the points come from the pages.
    const pagesSlot = !fde && key === 'english' && ENGLISH_PAGES_SLOTS[s.slot];
    if (pagesSlot) {
      return {
        ...s,
        prompt_rule: pagesSlot.prompt_rule,
        grain: pagesSlot.grain_kind && s.grain ? { ...s.grain, kind: pagesSlot.grain_kind } : s.grain,
      };
    }
    if (key === 'english' && s.slot === 'english.A.Q1a' && typeof s.prompt_rule === 'string') {
      return { ...s, prompt_rule: s.prompt_rule.replace(ENGLISH_FDE_Q1A_ANAGRAMS, '') };
    }
    // Maths MCQs: the ToS floor's recall count replaces the slot's 3-to-5.
    if (key === 'maths' && typeof s.prompt_rule === 'string' && s.prompt_rule.includes(MATHS_RECALL_FROM)) {
      return { ...s, prompt_rule: s.prompt_rule.replace(MATHS_RECALL_FROM, MATHS_RECALL_TO) };
    }
    return s;
  });
  const list = shaped.map((s) => (key === 'english' && s.slot === 'english.A.Q1b'
    ? { ...s, prompt_rule: [s.prompt_rule, RULE.q1bQuote, RULE.q1bOne].filter(Boolean).join(' ') }
    : s));
  // English Q5 on chosen pages that hold no poem: the nearest poem's page text, when the caller loaded it.
  const givenPoem = !fde && key === 'english' && poem && poem.content && list.some((s) => s.slot === 'english.C.Q5') ? poem : null;
  // Urdu Q6 on lessons that hold no poem: lesson 7's poem page text, when the caller loaded it.
  const urduPoem = !fde && key === 'urdu' && poem && poem.content && list.some((s) => s.slot === 'urdu.C.Q6') ? poem : null;
  const hasMcq = list.some((s) => s.shape === 'mcq');
  const rules = [RULE.bookOnly, RULE.religious];
  if (!fde) rules.push(RULE.chapterOnly);
  if (mathsC) rules.push(RULE.mathsSectionC);
  if (!fde && key === 'english' && hasMcq) rules.push(RULE.grammarFromPages);
  if (!fde && key === 'english' && list.some((s) => ENGLISH_PAGES_SLOTS[s.slot])) rules.push(RULE.pagesPoints, RULE.pagesRest);
  if (!fde && key === 'english' && list.some((s) => s.slot === 'english.C.Q5')) rules.push(givenPoem ? RULE.q5Given(givenPoem) : RULE.q5Poem);
  if (key === 'english') rules.push(RULE.noAnagram);
  if (key === 'science' && list.some((s) => s.shape === 'situation')) {
    rules.push('Science: a situation comes only from the book activities its slot\'s rule lists, never another.');
  }
  const closed = _closedLists(P, list);
  if (closed) rules.push(closed);
  if (key === 'urdu') rules.push(fde ? `${RULE.held} Set items only from book pages ${P.scope.page_ranges}.` : RULE.held);
  if (key === 'urdu') rules.push(RULE.urduNoMaxims);
  if (key === 'urdu' && list.some((s) => /^urdu\.[AC]\./.test(s.slot))) rules.push(RULE.urduNoDates);
  if (urduPoem) rules.push(RULE.urduQ6Given(urduPoem));
  if (scope && scope.kind === 'fde' && P.scope.excluded_pages_note) rules.push(P.scope.excluded_pages_note);
  const tos = P.tos || TOS[key];
  if (tos) {
    const split = Object.entries(tos).map(([band, pct]) => `${band} ${pct}%`).join(', ');
    rules.push(`Across the whole paper the marks split by thinking level is ${split} (FDE's table of specification). `
      + `Tag each item: ${RULE.r1}${key === 'english' ? `; ${RULE.r1English}` : ''}.`);
  }
  // Each section is its own call: told only the paper's split, every section tried to carry it alone (bd-5jmnfj.19).
  if (section && section.levels) {
    const own = Object.entries(section.levels).map(([band, marks]) => `${band} ${marks}`).join(', ');
    rules.push(`This section's ${section.marks} marks split by thinking level as ${own}. Tag this section's items to match it.`);
  }
  if (key === 'urdu' && list.some((s) => /^urdu\.C\.Q(7|8|9|10)$/.test(s.slot))) rules.push(RULE.urduWritingApply);
  if (key === 'urdu' && list.some((s) => /^urdu\.C\.Q(4|5)$/.test(s.slot))) rules.push(RULE.urduSentenceUnderstand);
  if (key === 'urdu' && list.some((s) => s.slot === 'urdu.C.Q6')) rules.push(RULE.urduPoemRemember);
  if (key === 'maths') rules.push(RULE.mathsTosFloor, RULE.unitsNumerals);
  if (key === 'maths') {
    const q1b = list.find((s) => s.slot === 'maths.A.Q1b');
    if (q1b) rules.push(RULE.mathsQ1bWords(Math.min(MATHS_Q1B_WORDS, q1b.generate), q1b.generate));
    const q2 = list.find((s) => s.slot === 'maths.B.Q2');
    if (q2) {
      // One above half: the model lands one or two short of a counted rule.
      const need = Math.ceil(q2.generate / 2) + 1;
      rules.push(RULE.mathsQ2Words(need, q2.generate));
      // FDE's families carry one word problem each; the rest of the count comes from their other items.
      // The families are FDE's syllabus, so on chosen pages they are not asked for (see MATHS_PAGES_SLOTS).
      const extra = fde && Array.isArray(q2.families) ? need - q2.families.length : 0;
      if (extra > 0) rules.push(RULE.mathsQ2Families(extra));
    }
    if (!fde && list.some((s) => MATHS_PAGES_SLOTS[s.slot])) rules.push(RULE.mathsPagesAB);
  }
  if (key === 'science' || key === 'english') rules.push(RULE.grade5Words);
  if (hasMcq) {
    if (key !== 'maths') rules.push(`In this section, ${RULE.recall}.`);
    rules.push(RULE.spreadKeys, RULE.oneCorrect, RULE.optionsOnly);
    // Word MCQs (anagram, homophone, spelling) on the language papers; number options on Maths and Science.
    if (key === 'english') rules.push(RULE.oneKeyEnglish);
    if (key === 'urdu') rules.push(RULE.oneKey, RULE.urduSpelling, RULE.oneQuestion, RULE.urduPlainOptions);
    if (key === 'urdu' && list.some((s) => s.slot === 'urdu.A.Q1')) {
      const q1 = list.find((s) => s.slot === 'urdu.A.Q1');
      const concepts = urduTerms
        ? [URDU_LESSONS_RULES.conceptOnce(urduTerms), URDU_LESSONS_RULES.termWord(urduTerms),
          URDU_LESSONS_RULES.budget(urduTerms, urduConcepts, q1.generate, urduPairs), URDU_LESSONS_RULES.concept(urduTerms)].filter(Boolean)
        : [RULE.urduConceptOnce, RULE.urduTermWord];
      rules.push(...concepts, RULE.urduHomograph, RULE.urduVerbSense, RULE.urduPunctuation, RULE.urduFormFamily, RULE.urduOneTable);
      if (urduLessons && oneStory(urduLessons)) rules.push(URDU_LESSONS_RULES.story(q1.generate));
    }
    if (key === 'maths' || key === 'science') rules.push(RULE.unequalOptions);
    if (key === 'maths') rules.push(RULE.propertyOneKey);
  }
  // A section with a picture-description frame (G5 Urdu Q7, English Q10) gets a drawn scene (v24 review).
  const framePicture = list.some((s) => s.frame && s.frame.kind === 'picture');
  rules.push(framePicture ? RULE.framePictures : RULE.noPictures, RULE.marks, RULE.blooms, RULE.scheme, RULE.accept);
  if (fde && key === 'maths' && list.some((s) => (Array.isArray(s.families) && s.families.length) || (Array.isArray(s.kinds) && s.kinds.length))) {
    rules.push(RULE.families);
  }
  rules.push(RULE.table);
  const picks = list.some((s) => Array.isArray(s.parts_spec) && s.parts_spec.some((p) => p.pick));
  if (picks && medium === 'ur') rules.push(RULE.picks);
  if (picks) rules.push(RULE.picksVerbatim);
  if ((key === 'science' || key === 'social_studies') && list.some((s) => s.shape === 'frame')) rules.push(RULE.frameLabels);
  if (key === 'science' && list.some((s) => s.shape === 'situation')) rules.push(RULE.situationParts);
  if (key === 'science' && list.some((s) => /\.Q3[a-z]?$/.test(s.slot))) rules.push(RULE.scienceQ3);
  if (key === 'urdu') rules.push(RULE.urduSchemeText);
  if (key === 'urdu' && list.some((s) => /\.Q4$/.test(s.slot))) rules.push(RULE.urduQ4, RULE.urduQ4Group, RULE.urduQ4GroupNotListed, RULE.urduQ4Syllables);
  // The book's own worked splits, quoted as the book prints them.
  if (key === 'urdu' && Array.isArray(P.syllables) && P.syllables.length && list.some((s) => /\.Q4$/.test(s.slot))) {
    const said = P.syllables.map((b) => `«${b.word}» as ${b.parts.join(' – ')}`);
    rules.push(`The book splits ${said.slice(0, -1).join(', ')}${said.length > 1 ? ' and ' : ''}${said[said.length - 1]}.`);
  }
  if (key === 'urdu' && list.some((s) => s.slot === 'urdu.C.Q3') && list.some((s) => s.slot === 'urdu.C.Q5')) rules.push(RULE.urduOneWordOnePlace);
  if (key === 'urdu' && list.some((s) => s.slot === 'urdu.C.Q6')) rules.push(RULE.urduQ6Points);
  if (key === 'urdu' && list.some((s) => s.slot === 'urdu.B.Q2')) rules.push(RULE.urduRelationNouns);
  rules.push(RULE.scaffold, RULE.noTags, RULE.noUnderline, RULE.gender, RULE.people);
  rules.push(medium === 'ur' ? RULE.genderUrdu : RULE.namedChild);
  rules.push(RULE.noRepeats);
  if (key === 'social_studies' && list.some((s) => /\.Q[57]$/.test(s.slot))) rules.push(RULE.sstNoReask);
  if (key === 'social_studies') {
    const bands = list.map((s) => RULE.sstBand[s.slot.split('.').pop()]).filter(Boolean);
    if (bands.length) rules.push(...bands, RULE.sstGroups);
    if (list.some((s) => /\.[CD]\./.test(s.slot))) rules.push(RULE.sstFactPoints);
  }
  if (key === 'social_studies') {
    const inPages = _holdsTierTable(pageContent);
    if (inPages || SST_TIER_NAMED.test(String(pageContent || ''))) rules.push(RULE.sstTiers(inPages));
  }

  return `**Grade:** ${grade}
**Subject:** ${subject}
**Page Reference:** ${pageReference}

**Book Text Content:**
\`\`\`
${pageContent}
\`\`\`
${givenPoem ? `
**Poem for Q5 (book p.${givenPoem.pages}):**
\`\`\`
${givenPoem.content}
\`\`\`
` : ''}${urduPoem ? `
**Poem for Q6 (book pp. ${urduPoem.pages}):**
\`\`\`
${urduPoem.content}
\`\`\`
` : ''}
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

// The slot each subject's given poem is for: English Q5, Urdu Q6's verses.
const POEM_SLOT = { english: 'english.C.Q5', urdu: 'urdu.C.Q6' };

/**
 * English Q5 / Urdu Q6 on chosen pages: the book poem nearest those pages when none of them holds one,
 * or null (the FDE syllabus, another subject, a page list that cannot be read, or a poem page already
 * chosen). A poem in a held lesson is never given.
 */
function patternPoemFor({ P, scope, pageContent }) {
  if (!P || !Array.isArray(P.poems) || !P.poems.length || !scope || scope.kind === 'fde') return null;
  const slot = POEM_SLOT[P.key];
  if (!slot || !P.sections.some((sec) => sec.slots.some((s) => s.slot === slot))) return null;
  const held = (P.scope && Array.isArray(P.scope.held)) ? P.scope.held : [];
  const poems = P.poems.filter((poem) => !held.includes(poem.unit));
  if (!poems.length) return null;
  const chosen = (_splitPages(pageContent) || []).map((p) => p.page);
  if (!chosen.length) return null;
  const pagesOf = (poem) => Patterns.parseRanges(poem.pages).flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));
  if (poems.some((poem) => pagesOf(poem).some((n) => chosen.includes(n)))) return null;
  const distance = (poem) => Math.min(...pagesOf(poem).flatMap((n) => chosen.map((c) => Math.abs(n - c))));
  const nearest = poems.reduce((best, poem) => (distance(poem) < distance(best) ? poem : best));
  return { unit: nearest.unit, pages: nearest.pages, title: nearest.title };
}

/**
 * Urdu Q6's verses come from the poem's own pages: the given poem's text, or the poem pages inside
 * the loaded text. Letters only, so spacing and punctuation never decide. '' when neither is there
 * (another subject, a page that could not be loaded): then nothing is checked.
 */
function _versesReference(P, poem, content) {
  if (!P || P.key !== 'urdu' || !Array.isArray(P.poems) || !P.poems.length) return '';
  if (poem && poem.content) return _lettersOnly(poem.content);
  // Only a poem whose every page is loaded: on chosen pages that cut a poem in two, the lines on
  // the missing page would read as not the poem's, so nothing is checked.
  const pages = _splitPages(content) || [];
  const have = new Set(pages.map((pg) => pg.page));
  const pagesOf = (poem) => Patterns.parseRanges(poem.pages).flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));
  const want = new Set(P.poems.map(pagesOf).filter((list) => list.every((n) => have.has(n))).flat());
  return _lettersOnly(pages.filter((pg) => want.has(pg.page)).map((pg) => pg.text).join('\n'));
}
function _lettersOnly(text) { return _heldNorm(text).replace(/[^\p{L}]/gu, ''); }
// A line is the poem's when it is in the poem's text, or when three in four of its four-letter runs
// are: a model writes a word as it is spelled, not as the page store read it («بیماری» / «پیماری»).
function _lineFromPoem(line, ref) {
  const n = _lettersOnly(line);
  if (n.length < 8) return false;
  if (ref.includes(n)) return true;
  let found = 0;
  for (let i = 0; i + 4 <= n.length; i += 1) if (ref.includes(n.slice(i, i + 4))) found += 1;
  return found >= 0.75 * (n.length - 3);
}
/**
 * Urdu Q6: a verses item whose four lines are not the poem's (lesson prose reworded under «درج ذیل
 * اشعار کا مفہوم واضح کریں») is taken out of the reply, so the slot is short and Section C is asked
 * once more; it is never printed. An item with fewer than four lines is the layout's to refuse.
 * Mutates the tree.
 */
function _dropProseVerses(tree, ref, requestId) {
  if (!ref || !tree || typeof tree !== 'object') return;
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values(tree[branch] || {})) {
      if (!types || typeof types !== 'object') continue;
      for (const [type, list] of Object.entries(types)) {
        if (!Array.isArray(list)) continue;
        types[type] = list.filter((q) => {
          if (!q || q.slot !== 'urdu.C.Q6') return true;
          const fromPassage = verseLines(q.passage).lines;
          const lines = (fromPassage.length >= 4 ? fromPassage : verseLines(q.question).lines).slice(-4);
          if (lines.length < 4 || lines.filter((l) => _lineFromPoem(l, ref)).length >= 3) return true;
          logToFile('[assessment] Q6 verses not from the poem', { requestId, slot: q.slot, lines });
          return false;
        });
      }
    }
  }
}

/** The given poem's page text from the book store; null (and today's rule) when it cannot be loaded. */
async function _loadPatternPoem({ grade, subject, P, scope, pageContent }) {
  const poem = patternPoemFor({ P, scope, pageContent });
  if (!poem) return null;
  try {
    const got = await BookContent().loadPageRangeContent({ grade, subject, pageRanges: poem.pages });
    // The page store keeps the book's picture notes ("Object: Illustration of …") among the
    // poem's lines, and a page goes on to its activities after the poem ("Diving Deeper"; in the
    // Urdu book the poet's letter «پیارے طلبہ!» and the exercises); the given lines are printed
    // exactly, so neither is given.
    let activities = false;
    const content = got && got.content
      ? String(got.content).split('\n').filter((line) => {
        if (/^=== Page \d+ ===/.test(line)) activities = false;
        else if (/^\s*(?:Diving Deeper\b|پیارے طلبہ)/i.test(line)) activities = true;
        return !activities && !/^\s*Object:/.test(line);
      }).join('\n').trim()
      : '';
    return content ? { ...poem, content } : null;
  } catch (err) {
    logToFile('[assessment] Q5 poem pages not loaded', { pages: poem.pages, error: err.message });
    return null;
  }
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
/**
 * A comprehension item whose "questions" part came back with marks and no questions: the paper would
 * print the part's head and its marks over nothing. Read on a laid-out paper (the slot's parts_spec
 * says how many questions the part holds). Only the "questions" part is read: other parts keep
 * their content under other names.
 */
function _emptyQuestionParts(examJson) {
  const specs = {};
  for (const section of (examJson && examJson._layout && examJson._layout.sections) || []) {
    for (const slot of section.slots || []) if (Array.isArray(slot.parts_spec)) specs[slot.slot] = slot.parts_spec;
  }
  const out = [];
  _walkQuestions(examJson, (q) => {
    if (!q.slot || !specs[q.slot] || !Array.isArray(q.parts)) return;
    q.parts.forEach((part) => {
      if (!part || part.key !== 'questions') return;
      if (Array.isArray(part.questions) && part.questions.length) return;
      const spec = specs[q.slot].find((x) => x.key === 'questions');
      out.push({ slot: q.slot, part: 'questions', missing: (spec && spec.n) || 1 });
    });
  });
  return out;
}

/**
 * The first reply, plus the second reply's items for the given slots that are not already in it. Nothing else of the second reply is kept.
 */
// For each short slot: the items a section's reply wrote under it and the layout's holds of it, by rule.
function _shortWhy(shortfall, tree, held) {
  return shortfall.map((f) => {
    let written = 0;
    _walkQuestions(tree, (q) => { if (q && q.slot === f.slot) written += 1; });
    const rules = {};
    for (const h of held || []) if (h.slot === f.slot) rules[h.rule] = (rules[h.rule] || 0) + 1;
    return { slot: f.slot, written, held: rules };
  });
}

function _topUp(firstTree, secondTree, slots) {
  // Keyed on everything the item says, not its question line alone: an item whose stem sits in
  // another field has no question line, and two of those are not the same item.
  const keyOf = (q) => _textsOf(q).map((t) => _flat(t).toLowerCase()).join('\u0001');
  const seen = new Set();
  _walkQuestions(firstTree, (q) => seen.add(keyOf(q)));
  const extra = JSON.parse(JSON.stringify(secondTree || {}));
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values((extra && extra[branch]) || {})) {
      if (!types || typeof types !== 'object') continue;
      for (const [type, list] of Object.entries(types)) {
        if (!Array.isArray(list)) continue;
        types[type] = list.filter((q) => q && slots.has(q.slot) && !seen.has(keyOf(q)));
      }
    }
  }
  const out = _mergeSections([firstTree, extra]);
  // A laid paper keeps what its layout recorded (the layout reads it back on Urdu papers only).
  if (firstTree && firstTree._layout) out._layout = firstTree._layout;
  return out;
}

// The markers the paper refuses in a question's own text (the renderer's item list). The renderer's
// own list is used when it exports one; this copy is the fallback.
const REVIEW_ITEM_FALLBACK = Object.freeze([/needs review/i, /\bfil{2}er\b/i, /\u26A0/, /Islamabad\sModel\sSchool/i, /MODEL PAPER FOR/i]);

function _reviewItemList() {
  try {
    const list = require('./assessment-paper-fde.renderer').REFUSED_ITEM;
    if (Array.isArray(list) && list.length) return list;
  } catch { /* the fallback below */ }
  return REVIEW_ITEM_FALLBACK;
}

/** Section id → the first refused marker one of its items carries. */
function _reviewTextHits(results) {
  const list = _reviewItemList();
  const hits = new Map();
  for (const r of results) {
    _walkQuestions(r.tree, (q) => {
      if (hits.has(r.id)) return;
      // The marking scheme prints too, so its text is read with the item's.
      const texts = _textsOf(q);
      const walk = (v) => {
        if (typeof v === 'string') texts.push(v);
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
      };
      walk(q.scheme);
      for (const t of texts) {
        const re = list.find((x) => x.test(t));
        if (re) { hits.set(r.id, { slot: q.slot || null, marker: String(re) }); return; }
      }
    });
  }
  return hits;
}

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
async function _writeSection({ messages, model, ownModel, job = 'assessment.generate', pattern, section }) {
  const ask = () => getClient().chat.completions.create({
    model,
    job,
    ...(model !== ownModel ? { fallbackModel: ownModel } : {}),
    messages,
    temperature: 0.7,
    response_format: { type: 'json_object' },
    max_tokens: sectionMaxTokens(section),
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
  const sum = (k, of = (u) => u && u[k]) => {
    const vals = usages.map(of).filter((v) => v != null);
    return vals.length ? vals.reduce((s, v) => s + Number(v), 0) : null;
  };
  // Prompt tokens served from a cache, where the lane reports them (already inside prompt_tokens).
  const cached = sum('cached_tokens', (u) => u && u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens);
  return {
    prompt_tokens: sum('prompt_tokens'), completion_tokens: sum('completion_tokens'), total_tokens: sum('total_tokens'), cost: sum('cost'),
    cached_tokens: cached,
  };
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
 * One spelling for a word however it was typed: vowel marks, tatweel and zero-width
 * characters gone, Arabic letter forms read as their Urdu ones (ي ى → ی, ك → ک,
 * ة ۃ ه ۂ ۀ → ہ, آ أ إ ٱ → ا), whitespace collapsed.
 */
function _heldNorm(text) {
  return _flat(String(text ?? '')
    .replace(/[ً-ٰٟۖ-ۭـ​-‏⁠﻿]/g, '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ةۃهۂۀ]/g, 'ہ')
    .replace(/[آأإٱ]/g, 'ا'));
}

/** The first held term a Social Studies item names (its marking scheme included), or null. */
function _heldTermOf(q) {
  const texts = [..._textsOf(q)];
  if (q.scheme && typeof q.scheme === 'object') texts.push(..._textsOf({ parts: q.scheme }));
  for (const t of texts) {
    const s = _heldNorm(t);
    const hit = HELD_TERMS_SST.find(({ re }) => re.test(s));
    if (hit) return hit.term;
  }
  return null;
}

/**
 * The text an item carries that the model wrote as its own: answers, passages, `accept`, the scheme.
 * An MCQ's answer is one of its options, which are read with the stem, so it is not model prose.
 */
function _modelTextsOf(q) {
  const out = [];
  const add = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === 'object') Object.values(v).forEach(add);
  };
  const visit = (o) => {
    if (!o || typeof o !== 'object') return;
    const mcq = Array.isArray(o.options) && o.options.length > 0;
    ['answer', 'passage', 'accept', 'scheme'].forEach((k) => { if (!(mcq && k === 'answer')) add(o[k]); });
    ['parts', 'questions'].forEach((k) => { if (Array.isArray(o[k])) o[k].forEach(visit); });
  };
  visit(q);
  return out;
}

/** Whether the match at `at` (length `len`) in `s` sits in a run of HELD_SHINGLE characters `book` prints. */
function _quotesBook(s, at, len, book) {
  if (!book) return false;
  if (s.length <= HELD_SHINGLE || len >= HELD_SHINGLE) return book.includes(s.length <= HELD_SHINGLE ? s : s.slice(at, at + len));
  for (let i = Math.max(0, at + len - HELD_SHINGLE); i <= Math.min(at, s.length - HELD_SHINGLE); i += 1) {
    if (book.includes(s.slice(i, i + HELD_SHINGLE))) return true;
  }
  return false;
}

/**
 * Urdu: the first held term (HELD_TERMS_URDU_AUTHORED) an item's own model text carries, or null.
 * `book` is the paper's book text, _heldNorm'd: a term inside a run the book prints is the book's.
 */
function _authoredReligiousOf(q, book) {
  for (const t of _modelTextsOf(q)) {
    const s = _heldNorm(t);
    for (const { term, re } of HELD_TERMS_URDU_AUTHORED) {
      for (const m of s.matchAll(new RegExp(re.source, 'gu'))) {
        if (!_quotesBook(s, m.index, m[0].length, book)) return term;
      }
    }
  }
  return null;
}

/** The book text a paper is set from, the held pages (lessons 1–3) left out, whitespace collapsed. */
function _keptBookText(allowedText) {
  // The held pages themselves never count as allowed, even when the teacher's chapters reach into them.
  const pages = _splitPages(allowedText);
  const kept = pages ? pages.filter((pg) => !_inRanges(pg.page, HELD_PAGES)).map((pg) => pg.text).join(' ') : allowedText;
  return _flat(String(kept || '').replace(/=== Page \d+ ===/g, ' '));
}

/** Section id → the first authored religious term one of its Urdu items carries ({ slot, term }). */
function _religiousHits(results, book) {
  const hits = new Map();
  for (const r of results) {
    _walkQuestions(r.tree, (q) => {
      if (hits.has(r.id)) return;
      const term = _authoredReligiousOf(q, book);
      if (term) hits.set(r.id, { slot: q.slot || null, term });
    });
  }
  return hits;
}

/**
 * Urdu: an item of a printed-word-list slot (`shape: 'words'`, `print_words`) whose FDE instruction
 * takes no {q} prints FDE's instruction and the list; a `question` the model wrote for it only says
 * the instruction again. That restatement is stock exercise wording the held lessons also print, so
 * the held-lessons filter would read it as a quote and drop the item: it is emptied first.
 * Every other slot, and every other subject, keeps its question. Mutates the tree.
 */
function _blankWordsStems(examJson, P, key) {
  if (key !== 'urdu' || !P || !Array.isArray(P.sections)) return;
  const blank = new Set();
  for (const sec of P.sections) {
    for (const s of sec.slots || []) {
      if (s.shape === 'words' && s.print_words && !/\{q\}/.test(s.instruction_ur || '')) blank.add(s.slot);
    }
  }
  _walkQuestions(examJson, (q) => {
    if (blank.has(q.slot) && typeof q.question === 'string' && q.question) q.question = '';
  });
}

/** Drop every item `held(q)` names, logging each; returns [{ slot, reason, ... }]. */
function _dropHeld(examJson, held, requestId = null) {
  const dropped = [];
  for (const branch of ['seen', 'unseen']) {
    const tree = examJson && examJson[branch];
    if (!tree || typeof tree !== 'object') continue;
    for (const types of Object.values(tree)) {
      if (!types || typeof types !== 'object') continue;
      for (const [type, list] of Object.entries(types)) {
        if (!Array.isArray(list)) continue;
        types[type] = list.filter((q) => {
          if (!q || typeof q !== 'object') return true;
          const why = held(q);
          if (!why) return true;
          // The kind (the reply's own type key) and, for a quote, the run that matched: one log line
          // then says whether a drop was a real quote or a phrase the held lessons share with others.
          const { match, ...reason } = why;
          const hit = { slot: q.slot || null, ...reason };
          dropped.push(hit);
          const line = { ...hit, kind: type, ...(match ? { match } : {}) };
          logToFile('[assessment] held item dropped', requestId ? { requestId, ...line } : line);
          return false;
        });
      }
    }
  }
  return dropped;
}

/**
 * Urdu: drop every item that quotes lessons 1–3 (book pp 1–27: the Hamd,
 * the Naat and the third lesson). The prompt already says so; this makes it
 * true when the model forgets. A quote is any run of 24 characters or more
 * from those pages, whitespace collapsed. The pages are loaded each time the filter runs.
 * Social Studies: drop every item that names a religious text (HELD_TERMS_SST).
 * The emptied place is a shortfall. Urdu: a place a quote emptied is asked again once by the caller
 * (`quotes` collects each matched run for that re-ask's note); a second quote fails the paper.
 * Mutates the tree; returns what was dropped, [{ slot, reason }] (plus `term` for Social Studies).
 */
async function religiousFilter(examJson, P, { grade, subject, allowedText = '', requestId = null, quotes = null } = {}) {
  const key = (P && P.key) || Patterns.normalise(subject);
  if (key === 'social_studies') {
    return _dropHeld(examJson, (q) => {
      const term = _heldTermOf(q);
      return term ? { reason: 'religious_text', term } : null;
    }, requestId);
  }
  if (key !== 'urdu') return [];
  const held = await BookContent().loadPageRangeContent({ grade, subject, pageRanges: HELD_PAGES });
  const text = _flat(String(held.content || '').replace(/=== Page \d+ ===/g, ' '));
  const shingles = new Set();
  for (let i = 0; i + HELD_SHINGLE <= text.length; i += 1) shingles.add(text.slice(i, i + HELD_SHINGLE));
  // A short run of Urdu is two or three words, so stock exercise wording ("answer the
  // questions below") sits on the held pages AND in the lessons the paper is set from. Only
  // what the held lessons alone contain marks an item as quoting them; a shared phrase never
  // drops a good item and fails the paper as a short slot.
  const kept = _keptBookText(allowedText);
  // The pattern's own Urdu (instructions, closed lists, rules) is what the model is told to
  // copy, and a held lesson's exercise can print the same instruction: never a quote.
  const allowedTexts = [kept, ..._urduStringsOf(P)];
  for (const allowed of allowedTexts) {
    for (let i = 0; i + HELD_SHINGLE <= allowed.length; i += 1) shingles.delete(allowed.slice(i, i + HELD_SHINGLE));
  }

  // The first run of the held pages an item carries, or null.
  const quoteOf = (q) => {
    for (const t of _textsOf(q)) {
      const s = _flat(t);
      for (let i = 0; i + HELD_SHINGLE <= s.length; i += 1) {
        const run = s.slice(i, i + HELD_SHINGLE);
        if (shingles.has(run)) return run;
      }
    }
    return null;
  };

  // A religious maxim, hadith or act of worship the model wrote into an answer, passage or scheme.
  const book = _heldNorm(kept);
  return _dropHeld(examJson, (q) => {
    const match = quoteOf(q);
    if (match) {
      // The caller's re-ask is told the run, so it writes the place again without it.
      if (Array.isArray(quotes)) quotes.push({ slot: q.slot || null, match });
      return { reason: 'lesson_1_3', match };
    }
    const term = _authoredReligiousOf(q, book);
    return term ? { reason: 'authored_religious', term } : null;
  }, requestId);
}

/** Where a pattern paper's pages come from: the pattern's syllabus, the job's pages, or a chapter. */
async function _loadPatternContent({ grade, subject, P, scope, pageRanges, chapterNumber }) {
  const pages = scope && scope.kind === 'fde' ? P.scope.page_ranges : (pageRanges || (scope && scope.pages) || null);
  if (pages) return BookContent().loadPageRangeContent({ grade, subject, pageRanges: pages });
  if (chapterNumber != null) return BookContent().loadChapterContent({ grade, subject, chapterNumber });
  throw fail('NO_CONTENT', 'No pages were given for this paper.');
}

// ── The reader pass (Urdu) ─────────────────────────────────────────────
//
// After the final layout, one call reads the question paper as the child sees it, with Q1's keys
// beside it, and names the Q1 items a child could answer from text printed elsewhere on it. Those
// are held, Section A is asked for replacements, the paper is laid out again, and the reader
// checks the replacements against the whole paper. A caught item never prints: a place still empty
// after one more top-up fails the paper closed (PATTERN_SHORT_SLOT, the record on the paper).
// Runs only when the caller says so (the reader setting, read by the orchestrator) and only for
// READER_SUBJECTS. A failed READ (a timeout, a reply with no candidates) keeps the paper as it was:
// the reader erroring never fails a paper that prints without it.
const READER_TIMEOUT_MS = 120000;
// The longest recorded read wrote 3,768 tokens (reasoning included); a cut-off read skips the pass.
const READER_MAX_TOKENS = 8000;
// High. At low effort eight recorded papers read 8, 8, 7 and 6 of 8 give-aways. At medium the model
// may skip thinking altogether (0 reasoning tokens on 48 of 48 reads in one session), and it then
// misses the by-meaning shapes. High thought on 64 of 64 reads and found 12 of 12, twice.
const READER_REASONING = { effort: 'high' };
const READ_SLOT = 'urdu.A.Q1';
// The Section A top-ups a reader pass may run: the first, and one more for a place the first leaves.
const READER_TOP_UPS = 2;

const _readerId = (q) => `${_flat(q && q.question)}\u0001${Reader.keyOf(q || {})}`;

// A copy of the paper with the given items of one slot taken out.
function _dropItems(examJson, slotId, ids) {
  const out = JSON.parse(JSON.stringify(examJson));
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values(out[branch] || {})) {
      for (const [type, list] of Object.entries(types || {})) {
        if (Array.isArray(list)) types[type] = list.filter((q) => !(q && q.slot === slotId && ids.has(_readerId(q))));
      }
    }
  }
  return out;
}

// A copy of the paper with one item added at the end of its slot's list.
function _addItem(examJson, slotId, q) {
  const out = JSON.parse(JSON.stringify(examJson));
  for (const types of Object.values(out.unseen || {})) {
    for (const list of Object.values(types || {})) {
      if (Array.isArray(list) && list.some((x) => x && x.slot === slotId)) { list.push(JSON.parse(JSON.stringify(q))); return out; }
    }
  }
  return out;
}

async function _askReader({ examJson, P, only = null, pages = null, model, ownModel, job, usages, reasoning = READER_REASONING }) {
  const { prompt, labels, only: onlyLabels, blocks, split } = Reader.buildReaderPrompt(examJson, P, { only, pages });
  const response = await getClient().chat.completions.create({
    model,
    job,
    ...(model !== ownModel ? { fallbackModel: ownModel } : {}),
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    response_format: { type: 'json_object' },
    max_tokens: READER_MAX_TOKENS,
    reasoning,
  }, { timeout: READER_TIMEOUT_MS });
  usages.push(response?.usage || {});
  // A client that already parsed the JSON hands back an object: read it, never skip the pass for it.
  const content = response?.choices?.[0]?.message?.content;
  const reply = content && typeof content === 'object' ? content : extractJsonFromResponse(content || '');
  return { flags: Reader.parseFlags(reply, labels, onlyLabels, blocks, { split }), labels };
}

async function _readerPass({ examJson, P, key, layoutScope, now, pattern, built, writeOne, system, model, ownModel, job, loaded, grade, subject, requestId }) {
  const began = Date.now();
  const readUsages = [];
  const sectionUsages = [];
  // put_back stays 0: a reader-caught item never prints (a place it leaves fails the paper closed).
  const stats = { flagged: 0, replaced: 0, still_flagged: 0, put_back: 0, top_ups: 0 };
  // What became of each flag, written on the paper (`_layout.reader`) as well as the log line, so a
  // panel reads from exam_json which items printed over a flag. The renderers never read it.
  const items = [];
  const record = (f, outcome) => items.push({ label: f.item, by: f.by, reason: f.reason, outcome });
  const lay = (exam) => applyLayout(exam, P, layoutScope, { now, presetId: pattern, reasked: true });
  // The record keeps its items on every path, an error's included: a failed paper still names them.
  const done = (exam, laid, error = null) => {
    logToFile('[assessment] reader pass', {
      requestId, subject: key, ...stats, ms: Date.now() - began, tokens: _sumUsage(readUsages).total_tokens || 0, ...(error ? { error } : {}),
    });
    if (exam && exam._layout) exam._layout.reader = { ...stats, items, ...(error ? { error } : {}) };
    return { examJson: exam, laid, usages: readUsages.concat(sectionUsages) };
  };
  // The book pages ride along, so the reader is handed the pairs whose answers stand side by side in them.
  const ask = (exam, only = null) => _askReader({ examJson: exam, P, only, pages: loaded && loaded.content, model, ownModel, job, usages: readUsages });
  // A flag with its item and, when another Q1 item gives it away, that partner: the top-up is told both.
  const withItems = (read) => read.flags.map((f) => ({ ...f, q: read.labels.get(f.item), partner: read.labels.get(f.by) || null }));
  const idsOf = (list) => new Set(list.map((h) => _readerId(h.q)));

  let first;
  try {
    first = await ask(examJson);
  } catch (err) {
    return done(examJson, null, `read: ${err.message}`);
  }
  if (!first.flags.length) return done(examJson, null);
  stats.flagged = first.flags.length;
  const held = withItems(first);
  held.forEach((h) => record(h, 'replaced'));
  // Every item a read has caught: none of them prints, and every top-up is told all of them.
  let taken = held;
  let laid = lay(_dropItems(examJson, READ_SLOT, idsOf(held)));
  const short = (l) => l.shortfall.filter((f) => f.slot === READ_SLOT);

  try {
    const b = built.find((x) => x.section.slots.some((s) => s.slot === READ_SLOT));
    for (let round = 0; round < READER_TOP_UPS && short(laid).length; round += 1) {
      const kept = laid;
      const shortfall = short(kept);
      // Ask twice what is missing (plus the note's spares): on a narrow scope the layout holds most of a
      // top-up's items (5 asked, 4 held on a local lessons 6-7 paper), and the extras never print.
      const ask2 = shortfall.map((f) => ({ ...f, missing: f.missing * 2 }));
      // The one more top-up is told grammar is used up: the first one's place was
      // left by a grammar concept asked again, which never comes back.
      const usedUp = round > 0 && _grammarUsedUp(P, layoutScope, kept) ? _grammarUsedUpNote(P, layoutScope) : null;
      const note = [takenNote(P, b.section, kept.examJson, { topUp: true, shortfall: ask2 }), Reader.readerNote(taken), usedUp]
        .filter(Boolean).join('\n\n');
      logToFile('[assessment] section re-asked', { requestId, pattern, section: b.section.id, shortfall, reader: taken.map(({ q, partner, ...f }) => f) });
      stats.top_ups += 1;
      const second = await writeOne({ ...b, messages: _sectionMessages({ system, user: `${b.user}\n\n${note}`, pageContent: b.pageContent, model }) });
      sectionUsages.push(...second.usages);
      // A replacement carrying text the paper refuses to print would fail the paper at render.
      if (_reviewTextHits([{ id: b.section.id, tree: second.tree }]).size) return done(kept.examJson, kept, 'top-up: refused text');
      stripImageKeys(second.tree);
      normaliseAnswers(second.tree);
      // Only new Q1 items: a caught item written again is not a replacement.
      const fresh = _dropItems(second.tree, READ_SLOT, idsOf(taken));
      let next = lay(_topUp(kept.examJson, fresh, new Set([READ_SLOT])));
      _blankWordsStems(next.examJson, P, key);
      if ((await religiousFilter(next.examJson, P, { grade, subject, allowedText: loaded.content, requestId })).length) next = lay(next.examJson);

      const keptIds = new Set(Reader.itemsOf(kept.examJson, READ_SLOT).map(_readerId));
      const replacements = Reader.itemsOf(next.examJson, READ_SLOT).filter((q) => !keptIds.has(_readerId(q)));
      let still = [];
      if (replacements.length) {
        try {
          still = withItems(await ask(next.examJson, replacements));
          stats.rechecked = true;
        } catch (err) {
          stats.rechecked = false;
          logToFile('[assessment] reader re-check failed, replacements kept', { requestId, error: err.message });
        }
      }
      stats.still_flagged += still.length;
      stats.replaced += replacements.length - still.length;
      still.forEach((h) => record(h, 'taken_off'));
      taken = taken.concat(still);
      laid = still.length ? lay(_dropItems(next.examJson, READ_SLOT, idsOf(still))) : next;
    }
    // Still short after the top-ups: the paper fails closed (PATTERN_SHORT_SLOT, with this record),
    // never printing a caught item to fill the place.
    if (laid.shortfall.length) return done(laid.examJson, laid, 'the paper would be short');
    return done(laid.examJson, laid);
  } catch (err) {
    return done(laid.examJson, laid, `top-up: ${err.message}`);
  }
}

/**
 * Social Studies: the first-ask spares a D slot could take when the reader's re-check might leave it
 * short. A slot is at risk when it is short with every replacement taken off; its spares are the items
 * of `source` (the model's replies) that a layout of the paper, without the replacements, places in
 * it: new against everything the layout holds against, and not an item the reader caught. Laid out
 * (their slot, marks and lines set). None when no slot is at risk.
 */
function _sstSpares({ exam, source, replacements, caught, lay }) {
  if (!source) return [];
  const without = replacements.reduce((e, q) => _dropItems(e, q.slot, new Set([_readerId(q)])), exam);
  const risk = new Set(lay(without).shortfall.map((f) => f.slot).filter((slot) => SST_D_SLOTS.includes(slot)));
  if (!risk.size) return [];
  const onPaper = new Set(SST_D_SLOTS.flatMap((slot) => Reader.itemsOf(exam, slot).map(_readerId)));
  const caughtIds = new Set(caught.map((h) => _readerId(h.q)));
  const trial = lay(_topUp(without, source, risk)).examJson;
  return [...risk].flatMap((slot) => Reader.itemsOf(trial, slot))
    .filter((q) => !onPaper.has(_readerId(q)) && !caughtIds.has(_readerId(q)));
}

// The paper with the given laid-out items added at the end of their slots' lists.
function _withItems(examJson, list) {
  const out = JSON.parse(JSON.stringify(examJson));
  for (const q of list) {
    const slot = q.slot;
    const lists = Object.values(out.unseen || {}).flatMap((types) => Object.values(types || {})).filter(Array.isArray);
    const home = lists.find((l) => l.some((x) => x && x.slot === slot));
    if (home) home.push(JSON.parse(JSON.stringify(q)));
    else out.unseen = _mergeSections([out, { unseen: { _spares: { [slot]: [JSON.parse(JSON.stringify(q))] } } }]).unseen;
  }
  return out;
}

// ── The reader pass (Social Studies) ───────────────────────────────────
//
// The same read for T6-A: the reader judges the Q5, Q6 and Q7 items (a duplicate, a whole answer
// Section A prints, a point set another C/D item's answer contains). Every flagged item is taken off.
// A flagged D item leaves a place that Section D fills in ONE top-up (told what was taken off, asked
// twice what is missing plus spares), the paper is laid out again and the reader checks the
// replacements only; one still flagged is taken off too. A flagged Q5 is taken off with no re-ask:
// Q5 offers more than the child answers. Nothing taken off comes back: a choice slot prints fewer
// items (applyLayout), and a paper the pass would leave short fails closed (PATTERN_SHORT_SLOT, with
// this record on it), never printing a caught item to fill the place. A read that fails prints the
// paper as it was: no caught item is known.
// A D slot the replacements alone could not fill also offers its first-ask spares (`source`: what the
// model wrote, before the layout): the items the layout finds new but had no room for. They are read
// in the same re-check as the replacements, and one fills a place only when the slot is short without
// it; a spare the re-check flags never prints either.
const SST_D_SLOTS = ['social_studies.D.Q6', 'social_studies.D.Q7'];
const _labelSlot = (label) => ({ Q5: 'social_studies.C.Q5', Q6: 'social_studies.D.Q6', Q7: 'social_studies.D.Q7' })[String(label).split('.')[0]];

async function _readerPassSst({ examJson, source = null, P, key, layoutScope, now, pattern, built, writeOne, system, model, ownModel, job, loaded, grade, subject, requestId }) {
  const began = Date.now();
  const readUsages = [];
  const sectionUsages = [];
  const stats = { flagged: 0, replaced: 0, still_flagged: 0, taken_off: 0, spares_read: 0, spares: 0 };
  const items = [];
  const record = (f, outcome) => items.push({ label: f.item, by: f.by, reason: f.reason, outcome });
  const lay = (exam) => applyLayout(exam, P, layoutScope, { now, presetId: pattern, reasked: true });
  const done = (exam, laid, error = null) => {
    logToFile('[assessment] reader pass', {
      requestId, subject: key, ...stats, ms: Date.now() - began, tokens: _sumUsage(readUsages).total_tokens || 0, ...(error ? { error } : {}),
    });
    // The record keeps its items on every path, an error's included: a refused paper still names them.
    if (exam && exam._layout) exam._layout.reader = { ...stats, items, ...(error ? { error } : {}) };
    return { examJson: exam, laid, usages: readUsages.concat(sectionUsages) };
  };
  const ask = (exam, only = null) => _askReader({ examJson: exam, P, only, model, ownModel, job, usages: readUsages });
  const without = (exam, list) => list.reduce((e, h) => _dropItems(e, h.slot, new Set([_readerId(h.q)])), exam);
  const count = (exam, slot) => Reader.itemsOf(exam, slot).length;

  let first;
  try {
    first = await ask(examJson);
  } catch (err) {
    return done(examJson, null, `read: ${err.message}`);
  }
  if (!first.flags.length) return done(examJson, null);
  stats.flagged = first.flags.length;
  const held = first.flags.map((f) => ({ ...f, q: first.labels.get(f.item), slot: _labelSlot(f.item) }));

  const dHeld = held.filter((h) => SST_D_SLOTS.includes(h.slot));
  // From here on no caught item prints: every exit returns the paper with them taken off, and one the
  // pass leaves short fails closed in the engine (PATTERN_SHORT_SLOT) with this record attached.
  let laid = lay(without(examJson, held));
  let exam = laid.examJson;
  let still = [];
  let replacements = [];
  const settle = (error = null) => {
    stats.still_flagged = still.length;
    stats.replaced = error ? 0 : replacements.length - still.length;
    stats.taken_off = held.length + still.length;
    held.forEach((h) => record(h, !error && SST_D_SLOTS.includes(h.slot) ? 'replaced' : 'taken_off'));
    still.forEach((h) => record(h, 'taken_off'));
    return done(exam, laid, error);
  };
  try {
    if (dHeld.length) {
      const b = built.find((x) => x.section.slots.some((s) => s.slot === SST_D_SLOTS[0]));
      const missing = b.section.slots.map((s) => ({ slot: s.slot, missing: s.generate - count(exam, s.slot) })).filter((f) => f.missing > 0);
      // Asked twice what is missing (and the note's spares): the layout holds some of a top-up's items too.
      const ask2 = missing.map((f) => ({ ...f, missing: f.missing * 2 }));
      const note = [takenNote(P, b.section, exam, { topUp: true, shortfall: ask2, held: laid.held }), Reader.readerNote(dHeld, first.labels, P)]
        .filter(Boolean).join('\n\n');
      logToFile('[assessment] section re-asked', { requestId, pattern, section: b.section.id, shortfall: missing, reader: dHeld.map(({ q, ...f }) => f) });
      const second = await writeOne({ ...b, messages: _sectionMessages({ system, user: `${b.user}\n\n${note}`, pageContent: b.pageContent, model }) });
      sectionUsages.push(...second.usages);
      if (_reviewTextHits([{ id: b.section.id, tree: second.tree }]).size) return settle('top-up: refused text');
      stripImageKeys(second.tree);
      normaliseAnswers(second.tree);
      // Only new items: an item taken off and written again is not a replacement.
      const fresh = without(second.tree, dHeld);
      const keptIds = new Set(SST_D_SLOTS.flatMap((slot) => Reader.itemsOf(exam, slot).map(_readerId)));
      laid = lay(_topUp(exam, fresh, new Set(SST_D_SLOTS)));
      exam = laid.examJson;
      _blankWordsStems(exam, P, key);
      if ((await religiousFilter(exam, P, { grade, subject, allowedText: loaded.content, requestId })).length) {
        laid = lay(exam);
        exam = laid.examJson;
      }
      replacements = SST_D_SLOTS.flatMap((slot) => Reader.itemsOf(exam, slot)).filter((q) => !keptIds.has(_readerId(q)));
      const replacedIds = new Set(replacements.map(_readerId));
      const spares = _sstSpares({ exam, source, replacements, caught: held, lay });
      let spareFlags = [];
      if (replacements.length || spares.length) {
        // The paper as the re-check reads it: the replacements in place, the spares after them.
        const readExam = _withItems(exam, spares);
        const ids = new Set([...replacedIds, ...spares.map(_readerId)]);
        const judged = SST_D_SLOTS.flatMap((slot) => Reader.itemsOf(readExam, slot)).filter((q) => ids.has(_readerId(q)));
        stats.spares_read = spares.length;
        try {
          const again = await ask(readExam, judged);
          const flags = again.flags.map((f) => ({ ...f, q: again.labels.get(f.item), slot: _labelSlot(f.item) }));
          still = flags.filter((h) => replacedIds.has(_readerId(h.q)));
          spareFlags = flags.filter((h) => !replacedIds.has(_readerId(h.q)));
          stats.rechecked = true;
        } catch (err) {
          stats.rechecked = false;
          // An unread spare is never offered: only the replacements are kept, as before.
          spareFlags = spares.map((q) => ({ q, slot: q.slot }));
          logToFile('[assessment] reader re-check failed, replacements kept', { requestId, error: err.message });
        }
      }
      if (still.length) {
        laid = lay(without(exam, still));
        exam = laid.examJson;
      }
      const flaggedSpares = new Set(spareFlags.map((h) => _readerId(h.q)));
      const clean = spares.filter((q) => !flaggedSpares.has(_readerId(q)));
      if (clean.length && laid.shortfall.some((f) => SST_D_SLOTS.includes(f.slot))) {
        const before = new Set(SST_D_SLOTS.flatMap((slot) => Reader.itemsOf(exam, slot).map(_readerId)));
        laid = lay(_withItems(exam, clean));
        exam = laid.examJson;
        _blankWordsStems(exam, P, key);
        if ((await religiousFilter(exam, P, { grade, subject, allowedText: loaded.content, requestId })).length) {
          laid = lay(exam);
          exam = laid.examJson;
        }
        // Nothing the reader caught comes back as a spare, whatever form the model wrote it in.
        const gone = [...held, ...still, ...spareFlags];
        if (gone.some((h) => SST_D_SLOTS.some((slot) => Reader.itemsOf(exam, slot).some((q) => _readerId(q) === _readerId(h.q))))) {
          laid = lay(without(exam, gone.map((h) => ({ ...h, slot: h.slot || h.q.slot }))));
          exam = laid.examJson;
        }
        stats.spares = SST_D_SLOTS.flatMap((slot) => Reader.itemsOf(exam, slot)).filter((q) => !before.has(_readerId(q))).length;
      }
    }
    return settle(laid.shortfall.length ? 'the paper would be short' : null);
  } catch (err) {
    return settle(`top-up: ${err.message}`);
  }
}

/**
 * Urdu: the places the lessons 1–3 filter emptied are asked again ONCE, for exactly what each slot
 * lacks. The filter matches any run of 24 characters only the held lessons print, and an everyday
 * phrase in a model answer can be one («… کی عادت اپنانی چاہیے۔»); one such run used to fail the whole
 * paper, since the slot was never refilled. The re-ask is told the runs that matched, and the filter
 * then reads the paper again exactly as strictly: a second quote leaves the slot short and the paper
 * fails as it always has. A section call that fails, or carries text the paper refuses, leaves it short too.
 */
async function _reaskQuoted({ examJson, laid, quotes, P, key, layoutScope, now, pattern, built, writeOne, system, model, loaded, grade, subject, requestId, versesRef }) {
  const usages = [];
  const short = laid.shortfall.filter((f) => quotes.some((x) => x.slot === f.slot));
  if (!short.length) return { examJson, laid, usages };
  const lay = (exam) => applyLayout(exam, P, layoutScope, { now, presetId: pattern, reasked: true });
  const asked = built.filter((b) => b.section.slots.some((s) => short.some((f) => f.slot === s.slot)));
  const replies = await Promise.all(asked.map(async (b) => {
    const mine = short.filter((f) => b.section.slots.some((s) => s.slot === f.slot));
    const label = (id) => { const slot = b.section.slots.find((s) => s.slot === id); return (slot && slot.label_en) || id.split('.').pop(); };
    const runs = [...new Set(quotes.filter((x) => mine.some((f) => f.slot === x.slot)).map((x) => x.match))];
    // Section A's own top-up note names what Q1 keeps (and its spares), so a refill is not a twin of a kept item.
    const kept = takenNote(P, b.section, examJson, { topUp: true, shortfall: mine });
    const note = 'This paper cannot print what you wrote for '
      + `${mine.map((f) => label(f.slot)).join(', ')}: it repeats words from a lesson the paper must never quote. `
      + `Never write these words, or any longer run that holds them, anywhere in an item, its answer or its scheme:\n${runs.map((r) => `- «${r}»`).join('\n')}\n`
      + (kept || mine.map((f) => `${label(f.slot)} needs ${f.missing} more. Write ${f.missing} new item${f.missing === 1 ? '' : 's'} for it, in your own everyday words.`).join('\n'));
    logToFile('[assessment] section re-asked', { requestId, pattern, section: b.section.id, shortfall: mine, quoted: runs });
    try {
      const second = await writeOne({ ...b, messages: _sectionMessages({ system, user: `${b.user}\n\n${note}`, pageContent: b.pageContent, model }) });
      usages.push(...second.usages);
      if (_reviewTextHits([{ id: b.section.id, tree: second.tree }]).size) return null;
      stripImageKeys(second.tree);
      normaliseAnswers(second.tree);
      _dropProseVerses(second.tree, versesRef, requestId);
      return { slots: new Set(mine.map((f) => f.slot)), tree: second.tree };
    } catch (err) {
      logToFile('[assessment] held quote re-ask failed', { requestId, section: b.section.id, error: err.message });
      return null;
    }
  }));
  let exam = examJson;
  for (const r of replies) if (r) exam = _topUp(exam, r.tree, r.slots);
  let next = lay(exam);
  _blankWordsStems(next.examJson, P, key);
  const again = await religiousFilter(next.examJson, P, { grade, subject, allowedText: loaded.content, requestId });
  if (again.length) next = lay(next.examJson);
  logToFile('[assessment] held quote re-asked', {
    requestId, slots: short.map((f) => f.slot), refilled: !next.shortfall.some((f) => short.some((x) => x.slot === f.slot)), held_again: again.length,
  });
  return { examJson: next.examJson, laid: next, usages };
}

/**
 * Urdu (chosen lessons; the full syllabus when a concept was asked again): a Q1 place the re-asks left empty is never filled with a grammar concept
 * asked again (applyLayout keeps it out). Section A is topped up once more, for what Q1 lacks plus
 * spares, told grammar is used up, and the paper is laid out again; a place still empty fails the
 * paper as a short slot. Runs only when Q1 is the one slot short.
 */
// On the full syllabus only when the layout held a concept asked again: a place left by anything else
// (a lessons 1–3 quote) fails the paper as it did.
const _conceptHeld = (laid) => Boolean(laid && laid.examJson && laid.examJson._layout
  && (laid.examJson._layout.holds || []).some((h) => h.slot === READ_SLOT && h.rule === 'concept_repeat'));
const _grammarUsedUp = (P, scope, laid) => Boolean(P && P.key === 'urdu' && (scopeLessons(P, scope) || _conceptHeld(laid)));
const _grammarUsedUpNote = (P, scope) => (scopeLessons(P, scope) ? RULE.urduGrammarUsedUp : RULE.urduGrammarUsedUpFull);
async function _topUpGrammarUsedUp({ examJson, laid, P, key, layoutScope, now, pattern, built, writeOne, system, model, loaded, grade, subject, requestId, versesRef }) {
  const usages = [];
  const lay = (exam) => applyLayout(exam, P, layoutScope, { now, presetId: pattern, reasked: true });
  const b = built.find((x) => x.section.slots.some((s) => s.slot === READ_SLOT));
  const shortfall = laid.shortfall.filter((f) => f.slot === READ_SLOT);
  const note = [takenNote(P, b.section, examJson, { topUp: true, shortfall }), _grammarUsedUpNote(P, layoutScope)].filter(Boolean).join('\n\n');
  logToFile('[assessment] section topped up again', { requestId, pattern, section: b.section.id, shortfall, grammar: 'used_up' });
  try {
    const second = await writeOne({ ...b, messages: _sectionMessages({ system, user: `${b.user}\n\n${note}`, pageContent: b.pageContent, model }) });
    usages.push(...second.usages);
    if (_reviewTextHits([{ id: b.section.id, tree: second.tree }]).size) return { examJson, laid, usages };
    stripImageKeys(second.tree);
    normaliseAnswers(second.tree);
    _dropProseVerses(second.tree, versesRef, requestId);
    let next = lay(_topUp(examJson, second.tree, new Set([READ_SLOT])));
    _blankWordsStems(next.examJson, P, key);
    if ((await religiousFilter(next.examJson, P, { grade, subject, allowedText: loaded.content, requestId })).length) next = lay(next.examJson);
    return { examJson: next.examJson, laid: next, usages };
  } catch (err) {
    logToFile('[assessment] grammar top-up failed', { requestId, section: b.section.id, error: err.message });
    return { examJson, laid, usages };
  }
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
/**
 * A board-pattern paper, written once more when it misses FDE's split by level (bd-5jmnfj.18): the
 * second run is told the first paper's split and the target, the nearer paper is returned, and both
 * runs are billed. A second run that fails leaves the first paper. Only when the caller asks
 * (`splitRetry`): the orchestrator does; a direct call writes one paper, as it always has.
 */
// One read of the finished English-medium paper; a failed read keeps the paper as it was.
async function _stemCheck({ examJson, P, model, ownModel, job, usages, requestId, pattern }) {
  const refused = _reviewItemList();
  const ask = async (prompt) => {
    const response = await getClient().chat.completions.create({
      model,
      job,
      ...(model !== ownModel ? { fallbackModel: ownModel } : {}),
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
      max_tokens: READER_MAX_TOKENS,
      reasoning: READER_REASONING,
    }, { timeout: READER_TIMEOUT_MS });
    usages.push(response?.usage || {});
    const content = response?.choices?.[0]?.message?.content;
    return content && typeof content === 'object' ? content : extractJsonFromResponse(content || '');
  };
  try {
    const out = await StemCheck.runStemCheck({ examJson, P, ask, refuses: (t) => refused.some((re) => re.test(t)) });
    out.examJson._layout.stem_check = { flags: out.record };
    logToFile('[assessment] stem check', { requestId, pattern, flags: out.record });
    return out.examJson;
  } catch (err) {
    examJson._layout.stem_check = { failed: err.message };
    logToFile('[assessment] stem check', { requestId, pattern, failed: err.message });
    return examJson;
  }
}

async function generatePatternExam({ splitRetry = false, ...args }) {
  const first = await _writePatternPaper(args);
  const bp = first.examJson._layout.blueprint;
  if (!splitRetry || !missesSplit(bp)) return first;
  // Grades 1-2: the level note steers Grade 5's prompts only, so an early paper is written once.
  if ((Patterns.get(args.pattern) || {}).profile === 'early') return first;
  const { pattern, subject, requestId = null } = args;
  logToFile('[assessment] paper re-asked for its level split', { requestId, pattern, subject: Patterns.normalise(subject), levels: bp.levels });
  let second;
  try {
    second = await _writePatternPaper({ ...args, levelNote: levelNote(bp) });
  } catch (err) {
    logToFile('[assessment] level split re-ask failed', { requestId, pattern, code: err.code || null, error: err.message });
    return first;
  }
  const better = levelDistance(second.examJson._layout.blueprint) < levelDistance(bp);
  logToFile('[assessment] level split re-ask kept', {
    requestId, pattern, kept: better ? 'second' : 'first',
    first: levelDistance(bp), second: levelDistance(second.examJson._layout.blueprint),
  });
  const t = (k) => (first.tokenData[k] || 0) + (second.tokenData[k] || 0);
  return {
    ...(better ? second : first),
    tokenData: { inputTokens: t('inputTokens'), outputTokens: t('outputTokens'), totalTokens: t('totalTokens'), cost: t('cost'), model: first.tokenData.model },
    elapsedMs: first.elapsedMs + second.elapsedMs,
  };
}

/** The helpers a Grade 1-2 paper is written with (fde-early-writer): this file's own, passed in. */
function _earlyDeps(subject) {
  return {
    family: URDU_MEDIUM.has(canonical(subject) || 'eng') ? 'urdu' : 'eng',
    loadPatternContent: _loadPatternContent,
    ensureCurrent: typeof ensureCurrent === 'function' ? ensureCurrent : null,
    patternModel,
    resolveModelForJob,
    buildSystemPrompt,
    sectionText: _sectionText,
    buildPatternUserPrompt,
    sectionMessages: _sectionMessages,
    warmSharedPrefixes: _warmSharedPrefixes,
    writeSection: _writeSection,
    mergeSections: _mergeSections,
    stripImageKeys,
    normaliseAnswers,
    emptyQuestionParts: _emptyQuestionParts,
    topUp: _topUp,
    sumUsage: _sumUsage,
    countQuestions,
    fail,
    logToFile,
  };
}

async function _writePatternPaper({ grade, subject, pattern, scope = null, pageRanges = null, chapterNumber = null, onSection = null, requestId = null, readerPass = false, stemCheck = false, levelNote: splitNote = null }) {
  const startedAt = Date.now();
  const def = Patterns.get(pattern);
  const key = Patterns.normalise(subject);
  const P = def && def.subjects[key];
  if (!P || !Patterns.isEligible(pattern, grade, subject)) {
    throw fail('PATTERN_INELIGIBLE', 'That board pattern is not available for this grade and subject.', { pattern, grade, subject });
  }
  // Grades 1-2 (bd-5jmnfj.4): whole-book papers with pictures and an oral part, written on their own path.
  if (def.profile === 'early') return writeEarlyPaper({ grade, subject, pattern, P, onSection, requestId }, _earlyDeps(subject));

  const loaded = await _loadPatternContent({ grade, subject, P, scope, pageRanges, chapterNumber });
  const layoutScope = scope || (chapterNumber != null && !pageRanges
    ? { kind: 'chapters', chapters: [Number(chapterNumber)], pages: null }
    : { kind: 'pages', chapters: null, pages: pageRanges });
  const sectionRanges = (Patterns.scopeFor(pattern, subject) || {}).section_ranges || {};
  const poem = await _loadPatternPoem({ grade, subject, P, scope: layoutScope, pageContent: loaded.content });

  const family = URDU_MEDIUM.has(canonical(subject) || 'eng') ? 'urdu' : 'eng';
  if (typeof ensureCurrent === 'function') await ensureCurrent();
  const { model, job } = patternModel(family);
  const ownModel = resolveModelForJob('assessment.generate', { family }).model;
  const system = buildSystemPrompt({ subject, includeAnswerKey: true });

  const built = P.sections.map((section) => {
    const text = _sectionText(section, loaded, layoutScope.kind, sectionRanges[section.id]);
    const prompt = buildPatternUserPrompt({
      grade, subject, pageContent: text.content, pageReference: text.pageReference,
      section, slots: section.slots, lang: P.medium, P, scope: layoutScope, poem,
    });
    // A per-section note (bd-5jmnfj.19) is keyed by section id; the paper-level one is a string.
    const note = splitNote && typeof splitNote === 'object' ? splitNote[section.id] : splitNote;
    const user = prompt + (note ? `\n\n${note}` : '');
    const messages = _sectionMessages({ system, user, pageContent: text.content, model });
    return { section, messages, user, pageContent: text.content };
  });
  // Awaited, so the sections that follow read what it wrote. Empty off the direct lane.
  const warmUsages = await _warmSharedPrefixes({ built, model, job, requestId, pattern });

  const writeOne = async ({ section, messages }) => {
    const began = Date.now();
    const { tree, usages } = await _writeSection({ messages, model, ownModel, job, pattern, section });
    const usage = _sumUsage(usages);
    const elapsedMs = Date.now() - began;
    const slots = section.slots.map((s) => s.slot);
    logToFile('[assessment] generating', {
      requestId, pattern, section: section.id, slots, model, usage, cost: usage.cost ?? null,
      cachedTokens: usage.cached_tokens ?? 0, elapsedMs,
    });
    if (onSection) {
      try { await onSection(section.id); } catch (err) { logToFile('[assessment] section progress not recorded', { section: section.id, error: err.message }); }
    }
    return { id: section.id, slots, usage, elapsedMs, tree, usages };
  };
  // Social Studies: Section D is written after Section C's first reply, told C's Q5 items and their
  // marking points, so its first Q6s are not C's cases again; A and B are still written beside C.
  const iC = key === 'social_studies' ? built.findIndex((b) => b.section.slots.some((s) => s.slot === 'social_studies.C.Q5')) : -1;
  const iD = iC >= 0 ? built.findIndex((b) => b.section.slots.some((s) => s.slot === 'social_studies.D.Q6')) : -1;
  let results;
  if (iD < 0) {
    results = await Promise.all(built.map(writeOne));
  } else {
    const writes = built.map((b, i) => (i === iD ? null : writeOne(b)));
    const d = built[iD];
    writes[iD] = writes[iC].then((c) => {
      const note = firstAskNote(P, c.tree);
      return writeOne(note
        ? { ...d, messages: _sectionMessages({ system, user: `${d.user}\n\n${note}`, pageContent: d.pageContent, model }) }
        : d);
    });
    results = await Promise.all(writes);
  }
  // Urdu Q6: verses that are not the poem's are taken out before the layout, so Section C is asked again.
  const versesRef = key === 'urdu' ? _versesReference(P, poem, loaded.content) : '';
  results.forEach((r) => _dropProseVerses(r.tree, versesRef, requestId));
  const now = new Date().toISOString();
  const merged = () => {
    const tree = _mergeSections(results.map((r) => r.tree));
    stripImageKeys(tree);
    normaliseAnswers(tree);
    return tree;
  };

  // A section that came back short is asked once more before the paper fails: the usual hole
  // is one whole block of a section (Maths C's Q4–8), and the same call usually comes back
  // whole. Decided on the reply as the model wrote it, BEFORE the held-content filter, so an
  // item the filter drops is still never refilled.
  const firstLaid = applyLayout(merged(), P, layoutScope, { now, presetId: pattern, reasked: false });
  // Social Studies always returns `held` (Section D reads it) and logs its own rows per rule after the last layout.
  if (firstLaid.held && key !== 'social_studies') logToFile('[assessment] held items', { requestId, pattern, held: firstLaid.held });
  const layoutShort = new Set(firstLaid.shortfall.map((f) => f.slot));
  const short = firstLaid.shortfall
    .concat(normaliseScheme(JSON.parse(JSON.stringify(firstLaid.examJson))).shortfall)
    .concat(_emptyQuestionParts(firstLaid.examJson))
    .concat(answerRepeats(firstLaid.examJson)); // an answer printed in another question (bd-5jmnfj.4.51.3)
  const shortSlots = new Set(short.map((f) => f.slot));
  // An item carrying text the paper refuses to print (a review mark the model copied) fails the
  // paper at render; its section is asked once more instead, and a second hit fails it here.
  const reviewHits = _reviewTextHits(results);
  // Urdu: a section whose model text carries an authored religious maxim is asked once more; a
  // second hit is held by religiousFilter below and the slot is short.
  const religiousHits = key === 'urdu' ? _religiousHits(results, _heldNorm(_keptBookText(loaded.content))) : new Map();
  const again = built.filter(({ section }) => section.slots.some((s) => shortSlots.has(s.slot))
    || reviewHits.has(section.id) || religiousHits.has(section.id));
  const extraUsages = [];
  if (again.length) {
    // One re-ask of `b`: its note reads the layout `laid`; `shortList` names the short slots and
    // `layoutShortSet` the ones short only because the layout set items aside.
    const reask = async (b, laid, shortList, layoutShortSet) => {
      const shortfall = shortList.filter((f) => b.section.slots.some((s) => s.slot === f.slot));
      const reviewText = reviewHits.get(b.section.id) || null;
      const religious = religiousHits.get(b.section.id) || null;
      const i = results.findIndex((r) => r.id === b.section.id);
      const first = results[i];
      // Social Studies: why each slot is short, so a re-ask can be read from the log alone: how many
      // items the reply wrote for it, and how many the layout held, by rule.
      const why = key === 'social_studies' ? { why: _shortWhy(shortfall, first.tree, [...(laid.held || []), ...(laid.repeated || [])]) } : {};
      logToFile('[assessment] section re-asked', {
        requestId, pattern, section: b.section.id, shortfall, ...why, ...(reviewText ? { reviewText } : {}), ...(religious ? { religious } : {}),
      });
      extraUsages.push(...first.usages);
      // The re-ask is told what the first replies already test (Section A's facts, Q4's words), so
      // it writes something new instead of the item the layout set aside, again.
      // A slot short only because the layout set items aside (two options of equal value, an item
      // tagged to a full slot) keeps the first reply and takes the missing items from the second:
      // the layout fills a slot in reply order, so the first reply's items land first. Any other
      // re-ask (a part with no marking points, a review mark, a religious maxim) takes the second reply whole.
      const topUp = !reviewText && !religious && shortfall.length && shortfall.every((f) => layoutShortSet.has(f.slot));
      // On a top-up the note also names what the slot keeps, and asks for spares.
      const note = [takenNote(P, b.section, laid.examJson, { topUp: Boolean(topUp), shortfall, held: laid.held }), giveawayNote(shortfall)]
        .filter(Boolean).join('\n\n');
      const second = await writeOne(note
        ? { ...b, messages: _sectionMessages({ system, user: `${b.user}\n\n${note}`, pageContent: b.pageContent, model }) }
        : b);
      results[i] = topUp ? { ...second, tree: _topUp(first.tree, second.tree, new Set(shortfall.map((f) => f.slot))) } : second;
      _dropProseVerses(results[i].tree, versesRef, requestId);
    };
    // Social Studies: Section D's re-ask is told Q5's situations and its Q6 is held against Q5, so
    // when C is asked again too, D waits for C and reads the layout of C's second reply. A D that
    // was full but now restates a new Q5 is asked again as well.
    const inSection = (b, id) => b.section.slots.some((s) => s.slot.startsWith(`social_studies.${id}.`));
    const afterC = key === 'social_studies' && again.some((b) => inSection(b, 'C'));
    await Promise.all(again.filter((b) => !(afterC && inSection(b, 'D')))
      .map((b) => reask(b, firstLaid, short, layoutShort)));
    if (afterC) {
      const midLaid = applyLayout(merged(), P, layoutScope, { now, presetId: pattern, reasked: false });
      const midShort = new Set(midLaid.shortfall.map((f) => f.slot));
      const otherShort = short.filter((f) => !firstLaid.shortfall.includes(f));
      // A D that C's second reply left whole (the Q5 its Q6 restated is gone) keeps its first reply;
      // only a D still short, or with a review or religious hit, is asked again.
      const later = built.filter((b) => inSection(b, 'D')
        && (b.section.slots.some((s) => midShort.has(s.slot) || otherShort.some((f) => f.slot === s.slot))
          || reviewHits.has(b.section.id) || religiousHits.has(b.section.id)));
      await Promise.all(later.map((b) => reask(b, midLaid, otherShort.concat(midLaid.shortfall), midShort)));
    }
    // Social Studies: a D item the layout still sets aside never prints, so before the paper is laid
    // out D is asked once more, a top-up told what was held. A slot still short of a held item after it
    // prints fewer items when it is a choice (applyLayout).
    if (key === 'social_studies' && iD >= 0) {
      const preLaid = applyLayout(merged(), P, layoutScope, { now, presetId: pattern, reasked: false });
      const dShort = preLaid.shortfall.filter((f) => f.slot.startsWith('social_studies.D.') && preLaid.held.some((h) => h.slot === f.slot));
      if (dShort.length) {
        logToFile('[assessment] D asked once more', {
          requestId, pattern, shortfall: dShort, held: preLaid.held.filter((h) => dShort.some((f) => f.slot === h.slot)).map((h) => ({ slot: h.slot, rule: h.rule })),
        });
        await reask(built[iD], preLaid, dShort, new Set(dShort.map((f) => f.slot)));
      }
    }
    // Urdu Section A still short after its re-ask (the top-up's own items held as twins of kept
    // facts, or a new hold against the re-asked Section C) is topped up once more, for exactly what
    // it misses plus spares: a held Section C give-away is never put back to fill the place.
    const a = key === 'urdu' ? built.find(({ section }) => section.slots.some((s) => s.slot === 'urdu.A.Q1')) : null;
    const check = a && applyLayout(merged(), P, layoutScope, { now, presetId: pattern, reasked: false });
    const shortA = check ? check.shortfall.filter((f) => a.section.slots.some((s) => s.slot === f.slot)) : [];
    if (shortA.length) {
      logToFile('[assessment] section topped up again', { requestId, pattern, section: a.section.id, shortfall: shortA, ...(check.held ? { held: check.held } : {}) });
      const i = results.findIndex((r) => r.id === a.section.id);
      const first = results[i];
      extraUsages.push(...first.usages);
      const note = takenNote(P, a.section, check.examJson, { topUp: true, shortfall: shortA });
      const second = await writeOne(note
        ? { ...a, messages: _sectionMessages({ system, user: `${a.user}\n\n${note}`, pageContent: a.pageContent, model }) }
        : a);
      results[i] = { ...second, tree: _topUp(first.tree, second.tree, new Set(shortA.map((f) => f.slot))) };
      _dropProseVerses(results[i].tree, versesRef, requestId);
    }
    // A re-asked reply is checked again: a give-away still there is asked once more, naming the words.
    // Only when the first check found one: a paper with none is not laid out again for this.
    const lateLaid = short.some((f) => f.reason === 'giveaway') ? applyLayout(merged(), P, layoutScope, layOpts(true)) : null;
    const late = lateLaid ? stillGivenAway(lateLaid.examJson) : [];
    const reaskGiveaways = async (flags, flagsLaid) => {
      const lateBuilt = built.filter(({ section }) => section.slots.some((s) => flags.some((f) => f.slot === s.slot)));
      for (const b of lateBuilt) {
        await reask(b, flagsLaid, flags, new Set());
      }
      // That reply is taken whole, after the Section A top-up above, so a section it left short is
      // topped up once for exactly what it misses (v24 G5 Urdu, bd-5jmnfj.4.54).
      const afterLate = lateBuilt.length ? applyLayout(merged(), P, layoutScope, layOpts(true)) : null;
      for (const b of lateBuilt) {
        const mine = afterLate.shortfall.filter((f) => b.section.slots.some((s) => s.slot === f.slot));
        if (!mine.length) continue;
        logToFile('[assessment] section topped up after give-away', { requestId, pattern, section: b.section.id, shortfall: mine });
        await reask(b, afterLate, mine, new Set(mine.map((f) => f.slot)));
      }
      return afterLate;
    };
    // A give-away a child can see, still there after that, is asked exactly once more. A repeat never costs the
    // teacher a paper: one still there after this ships and is logged below (bd-5jmnfj.4.55).
    const lastLaid = late.length ? await reaskGiveaways(late, lateLaid) : null;
    if (lastLaid) await reaskGiveaways(stillGivenAway(lastLaid.examJson).filter((f) => f.printed), lastLaid);
    const still = _reviewTextHits(results);
    if (still.size) {
      throw fail('REVIEW_TEXT', 'A question carries text that must never print.', { sections: [...still.keys()], examJson: merged(), model });
    }
  }

  // Layout first, so the filter sees every item under its pattern slot; a drop
  // then lays the paper out again, and the emptied place is a shortfall — the
  // extras the model wrote were already set aside and never fill it.
  let examJson = merged();
  let laid = applyLayout(examJson, P, layoutScope, { now, presetId: pattern, reasked: again.length > 0 });
  const firstUnplaced = laid.unplaced;
  examJson = laid.examJson;
  _blankWordsStems(examJson, P, key);
  const quotes = [];
  const dropped = await religiousFilter(examJson, P, { grade, subject, allowedText: loaded.content, requestId, quotes });
  if (dropped.length) {
    laid = applyLayout(examJson, P, layoutScope, { now, presetId: pattern, reasked: again.length > 0 });
    examJson = laid.examJson;
  }
  // Urdu: a place the lessons 1–3 filter emptied is asked again once, told the run it matched.
  if (quotes.length && laid.shortfall.length) {
    const re = await _reaskQuoted({
      examJson, laid, quotes, P, key, layoutScope, now, pattern, built, writeOne, system, model, loaded, grade, subject, requestId, versesRef,
    });
    examJson = re.examJson;
    laid = re.laid;
    extraUsages.push(...re.usages);
  }
  // Urdu: Q1 still short after the re-asks is topped up once more, told grammar is used up.
  if (_grammarUsedUp(P, layoutScope, laid) && laid.shortfall.length && laid.shortfall.every((f) => f.slot === READ_SLOT)) {
    const re = await _topUpGrammarUsedUp({
      examJson, laid, P, key, layoutScope, now, pattern, built, writeOne, system, model, loaded, grade, subject, requestId, versesRef,
    });
    examJson = re.examJson;
    laid = re.laid;
    extraUsages.push(...re.usages);
  }
  // Social Studies: every item the layout set aside, by slot and rule (a repeat of a placed item
  // among them), and how many were put back.
  if (key === 'social_studies' && ((laid.held && laid.held.length) || (laid.repeated && laid.repeated.length))) {
    const rows = new Map();
    for (const h of [...(laid.held || []), ...(laid.repeated || [])]) {
      const row = rows.get(`${h.slot}|${h.rule}`) || { slot: h.slot, rule: h.rule, held: 0, printed: 0 };
      row.held += 1;
      if (h.printed) row.printed += 1;
      rows.set(`${h.slot}|${h.rule}`, row);
    }
    logToFile('[assessment] held items', { requestId, pattern, held: [...rows.values()], ...(laid.shortChoice && laid.shortChoice.length ? { shortChoice: laid.shortChoice } : {}) });
  }
  // The reader pass reads a whole paper only: a short one fails below as it always has.
  if (readerPass && Reader.READER_SUBJECTS.includes(key) && !laid.shortfall.length && !_emptyQuestionParts(examJson).length) {
    const read = await (key === 'social_studies' ? _readerPassSst : _readerPass)({
      examJson, source: key === 'social_studies' ? merged() : null, P, key, layoutScope, now, pattern, built, writeOne, system, model, ownModel, job, loaded, grade, subject, requestId,
    });
    examJson = read.examJson;
    if (read.laid) laid = read.laid;
    extraUsages.push(...read.usages);
  }
  const layout = { placed: laid.placed, unplaced: firstUnplaced };
  logToFile('[assessment] layout applied', {
    requestId, pattern, placed: layout.placed, unplaced: layout.unplaced, totalMarks: examJson._layout.total_marks,
    sections: P.sections.map((s) => s.id), dropped: dropped.length, shortfall: laid.shortfall,
    ...(laid.putBack && laid.putBack.length ? { putBack: laid.putBack } : {}),
    // The final layout's holds (Urdu Q1 on chosen lessons): the held-items line above is the first
    // layout's only, and a re-ask, a top-up or the reader pass lays the paper out again.
    ...(laid.held ? { held: laid.held } : {}),
  });
  // A failed paper keeps what the model wrote and which model wrote it (on the error, for the
  // row), so the failure can be read afterwards instead of guessed at.
  if (laid.shortfall.length) {
    throw fail('PATTERN_SHORT_SLOT', 'A question slot came back short.', { shortfall: laid.shortfall, examJson, model });
  }
  const emptyParts = _emptyQuestionParts(examJson);
  if (emptyParts.length) {
    throw fail('PATTERN_SHORT_SLOT', 'A question slot came back short.', { shortfall: emptyParts, examJson, model });
  }
  // The stem check (bd-5jmnfj.22): one read of the whole paper for a question that does not make sense.
  if (stemCheck && StemCheck.STEM_CHECK_SUBJECTS.includes(key)) {
    examJson = await _stemCheck({ examJson, P, model, ownModel, job, usages: extraUsages, requestId, pattern });
  }
  // An answer word still given away after the re-asks is logged, not failed: the teacher still gets a paper (bd-5jmnfj.4.55).
  const giveaways = answerRepeats(examJson);
  if (giveaways.length) logToFile('[assessment] answers given away', { requestId, pattern, giveaways });

  const scheme = normaliseScheme(examJson);
  examJson = noArrows(scheme.examJson); // bd-5jmnfj.4.50.1: no arrow in any text a child or teacher reads
  if (scheme.log.length) logToFile('[assessment] scheme normalised', { pattern, notes: scheme.log.slice(0, 50), count: scheme.log.length });
  if (scheme.shortfall.length) {
    throw fail('PATTERN_SHORT_SLOT', 'A question slot came back short.', { shortfall: scheme.shortfall, examJson, model });
  }

  const notesBefore = (examJson._layout.notes || []).length;
  examJson = mathsCheck(examJson, { subject: key }).examJson;
  (examJson._layout.notes || []).slice(notesBefore).forEach((note) => {
    logToFile('[assessment] maths key replaced', { slot: note.slot, n: note.n ?? note.index ?? null, computed: note.computed, model: note.model });
  });

  // Urdu Q6's verses given from a lesson outside the chosen ones: the paper says where they come from.
  const versesPrinted = Object.values(examJson.unseen || {}).flatMap((t) => Object.values(t || {})).flat()
    .some((q) => q && q.slot === 'urdu.C.Q6' && typeof q.passage === 'string' && q.passage.trim());
  if (key === 'urdu' && poem && versesPrinted) examJson._layout.verse_source = { lesson: poem.unit, pages: poem.pages };

  // Report-only: what the paper carries against its pattern and FDE's split; it never fails a paper.
  const sectionLevels = P.sections.every((s) => s.levels) ? Object.fromEntries(P.sections.map((s) => [s.id, s.levels])) : null;
  const blueprint = checkBlueprint(examJson, { tos: P.tos || TOS[key] || null, sectionLevels });
  examJson._layout.blueprint = blueprint;
  logToFile('[assessment] blueprint checked', { pattern, subject: key, ok: blueprint.ok, total: blueprint.total, levels: blueprint.levels, problems: blueprint.problems });

  // G5 Urdu Q7 / English Q10: a drawn scene in the frame from the item's `describe_en` (v24 review).
  // A failed drawing never fails the paper: the item keeps today's empty frame.
  try {
    await require('./fde-pictures').resolveFramePictures(examJson);
  } catch (err) {
    logToFile('[assessment] frame pictures skipped', { requestId, pattern, error: err.message });
  }

  // The warm call is billed like any other, so it is in the paper's totals.
  const all = _sumUsage(warmUsages.concat(extraUsages, results.flatMap((r) => r.usages)));
  return {
    examJson,
    questionCount: countQuestions(examJson),
    tokenData: { inputTokens: all.prompt_tokens, outputTokens: all.completion_tokens, totalTokens: all.total_tokens, cost: all.cost, model },
    pageReference: loaded.pageReference,
    chapterTitle: null,
    sections: results.map(({ id, slots, usage, elapsedMs }) => ({ id, slots, usage, elapsedMs })),
    elapsedMs: Date.now() - startedAt,
    layout,
  };
}

/** bd-6clakk.11: the FDE oral part of an English or Urdu topic paper, or null. */
function generateTopicOral(args) {
  return TopicOral().writeTopicOral(args, _earlyDeps(args.subject));
}

module.exports = {
  generateExam,
  generateTopicOral,
  generatePatternExam,
  sectionMaxTokens,
  buildPatternUserPrompt,
  patternPoemFor,
  _versesReference,
  _dropProseVerses,
  religiousFilter,
  _blankWordsStems,
  _askReader,
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
