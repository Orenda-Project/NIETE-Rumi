'use strict';
// Part of assessment-generation.service.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const { stemsBlock, applyStems } = require('../topics/stem-prompt');
const { DRAWN_BY_THE_CHILD, DRAW_IT_LINE, _count, planCounts, sloBlock } = require('./models-prompts');

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

module.exports = {
  _norm, _splitOption, _walkQuestions, buildUserPrompt, countQuestions, enforceMarksBudget, stripImageKeys,
  totalMarksOf, trimSeen,
};
