'use strict';
/**
 * Which kinds of question each subject supports, and how many of each to ask for.
 *
 * Lifted from the generator this replaces, where the lists are what the prompts
 * were written against — a Science prompt knows what a "Label the Diagram"
 * question is and an English prompt does not. Offering a teacher a type her
 * subject's prompt has never heard of produces a question the model invents the
 * format for.
 *
 * Two things are subject-dependent and easy to get wrong:
 *   * whether a type is objective or subjective. "Brief Answers" is OBJECTIVE
 *     for English and Urdu and SUBJECTIVE for Science, and the distinction
 *     decides which half of the output tree it lands in.
 *   * English and Urdu split their subjective types by grade band, because a
 *     Grade 1 child is not writing an essay.
 */

const ENG_URDU = {
  objective: ['MCQs', 'MSQs', 'Fill in the Blanks', 'Missing Letters', 'True/False',
    'Match the Column', 'Circle the Correct Answer', 'Rewrite Sentences',
    'Brief Answers', 'Listening', 'Speaking', 'Reading'],
  subjectiveByGrade: {
    '1-2': ['Word Meanings', 'Word Sentences', 'Comprehension Passage',
      'Rewriting', 'Story Completion', 'Simple Writing'],
    '3-5': ['Word Meanings', 'Word Sentences', 'Comprehension Passage',
      'Letter Writing', 'Application Writing', 'Story Writing',
      'Essay Writing', 'Paragraph Writing', 'Picture Description'],
  },
};

const CATALOGUE = {
  english: ENG_URDU,
  urdu: ENG_URDU,
  maths: {
    objective: ['MCQs', 'Fill in the Blanks', 'True/False', 'Match the Column',
      'Mental Math (Viva)', 'Sequences'],
    subjective: ['Short Questions', 'Restricted Response Question',
      'Word Problems', 'Graphs & Geometric Problems'],
  },
  science: {
    objective: ['MCQs', 'MSQs', 'True/False', 'Fill in the Blanks'],
    subjective: ['Brief Answers', 'Mind Map', 'Flow Chart',
      'Label the Diagram', 'Logical Reasoning'],
  },
  islamiat: {
    objective: ['MCQs', 'MSQs', 'Fill in the Blanks', 'True/False',
      'Match the Column', 'Listening', 'Reading'],
    subjective: ['Short Questions', 'Long Question'],
  },
  general_knowledge: {
    objective: ['MCQs', 'MSQs', 'Fill in the Blanks', 'True/False', 'Match the Column'],
    subjective: ['Short Questions', 'Long Question', 'Mind Map'],
  },
  social_studies: {
    objective: ['MCQs', 'Fill in the Blanks', 'True/False', 'Match the Column'],
    subjective: ['Short Questions', 'Long Question', 'Mind Map', 'Flow Chart'],
  },
};

// What a paper looks like when she does not want to choose. Objective types
// first and in quantity, because they are quick to mark for a class of thirty
// and quick to answer for a child who is six.
const DEFAULT_MIX = {
  objective: ['MCQs', 'Fill in the Blanks', 'True/False'],
  subjective: ['Short Questions'],
};

function normalise(subject) {
  const k = String(subject || '').trim().toLowerCase();
  const alias = {
    eng: 'english', math: 'maths', mathematics: 'maths', gensci: 'science',
    genk: 'general_knowledge', sst: 'social_studies',
  };
  return alias[k] || k;
}

function _sets(subject, grade) {
  const entry = CATALOGUE[normalise(subject)] || ENG_URDU;
  const objective = entry.objective || [];
  const subjective = entry.subjective
    || (Number(grade) <= 2 ? entry.subjectiveByGrade['1-2'] : entry.subjectiveByGrade['3-5']);
  return { objective, subjective };
}

/** Everything this subject and grade supports, each tagged with its category. */
function forSubject(subject, grade) {
  const { objective, subjective } = _sets(subject, grade);
  return [
    ...objective.map((id) => ({ id, category: 'objective' })),
    ...subjective.map((id) => ({ id, category: 'subjective' })),
  ];
}

function categoryOf(typeId, subject, grade) {
  const { objective } = _sets(subject, grade);
  return objective.includes(typeId) ? 'objective' : 'subjective';
}

/**
 * Spread a total across the types she picked. The remainder goes to the earlier
 * types rather than the last one, so a request for 10 across 3 types reads
 * 4/3/3 and not 3/3/4 — the paper opens with its fullest section.
 */
function withCounts(pickedIds, total, subject, grade) {
  const ids = (pickedIds || []).filter(Boolean);
  if (ids.length === 0) return defaultMix(subject, grade, total);

  const wanted = Math.max(1, Number(total) || ids.length);
  const base = Math.floor(wanted / ids.length);
  let spare = wanted - (base * ids.length);

  return ids.map((id) => {
    const count = base + (spare > 0 ? 1 : 0);
    if (spare > 0) spare -= 1;
    return { id, count: Math.max(1, count), category: categoryOf(id, subject, grade) };
  });
}

/** The mix she gets when she did not want to choose types. */
function defaultMix(subject, grade, total) {
  const { objective, subjective } = _sets(subject, grade);
  const pick = [
    ...DEFAULT_MIX.objective.filter((t) => objective.includes(t)),
    ...DEFAULT_MIX.subjective.filter((t) => subjective.includes(t)),
  ];
  // A subject whose catalogue shares none of the defaults still needs a paper.
  const ids = pick.length ? pick : [objective[0], subjective[0]].filter(Boolean);
  return withCounts(ids, total, subject, grade);
}


/**
 * How many questions a paper may hold.
 *
 * 25 is where the generator stops writing well: past it the model starts
 * padding and the seen half repeats itself. It is a product ceiling, not a
 * technical one.
 */
const MAX_QUESTIONS = 25;
const DEFAULT_QUESTIONS = 15;

/**
 * How many types she may pick, and therefore how many count boxes the COUNTS
 * screen holds.
 *
 * A Flow cannot grow a component at runtime, so the boxes are a fixed bank that
 * the server labels and hides. Eight is above what a paper of 25 questions can
 * meaningfully carry — eight types is already three questions each — and keeps
 * the published screen small.
 */
const MAX_TYPE_SLOTS = 8;

/**
 * Read the number she typed.
 *
 * A Flow TextInput has no min or max — `input-type: number` only picks the
 * keypad — so every bound is enforced here, on a value that can be anything
 * she can type: empty, "0", "-5", "999", "7.5", "abc".
 *
 * Out of range is REFUSED rather than clamped. Quietly turning 40 into 25 hands
 * her a paper she did not ask for and never mentions it; refusing puts the
 * number back in front of her while she can still change it.
 */
function parseQuestionCount(raw) {
  const text = String(raw ?? '').trim();
  const range = `Type a number between 1 and ${MAX_QUESTIONS}.`;

  if (!text) return { ok: false, message: range };
  if (!/^\d+$/.test(text)) return { ok: false, message: range };

  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) return { ok: false, message: range };
  if (n > MAX_QUESTIONS) {
    return { ok: false, message: `A paper can hold up to ${MAX_QUESTIONS} questions. ${range}` };
  }
  return { ok: true, count: n };
}

/**
 * Read the count she typed against EACH type she picked.
 *
 * The counterpart to parseQuestionCount, for the screen that replaced it on the
 * unseen path. She picked her types on TYPES, so this receives one box per pick
 * (`count_1`…`count_N`, positional, in the order she ticked them) and returns
 * the `{ id, count, category }` list the generator already speaks.
 *
 * Every box is REQUIRED: a type she ticked and then left blank is a
 * contradiction, and the two ways out of it are both worse than asking. Filling
 * it with a default hands her a number she never chose; dropping the type
 * quietly deletes a section she asked for. So a blank bounces, and it bounces
 * naming the type rather than the slot — "MCQs" is hers, "count_1" is ours.
 *
 * The paper ceiling is checked on the SUM, because that is the paper. Fifteen
 * MCQs and fifteen Short Questions are each individually reasonable and
 * together are a paper the generator pads its way through.
 *
 * Refused, never clamped — the same rule the single count already followed.
 */
function parsePerTypeCounts(pickedIds, data, subject, grade, seenCount = 0) {
  const ids = (pickedIds || []).filter(Boolean);
  if (ids.length === 0) {
    return { ok: false, message: 'Please choose at least one kind of question.' };
  }

  const out = [];
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const raw = data?.[`count_${i + 1}`];
    const text = String(raw ?? '').trim();
    const range = `Type a number between 1 and ${MAX_QUESTIONS}.`;

    if (!text || !/^\d+$/.test(text)) {
      return { ok: false, message: `How many ${id}? ${range}` };
    }
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1) {
      return { ok: false, message: `How many ${id}? ${range}` };
    }
    if (n > MAX_QUESTIONS) {
      return {
        ok: false,
        message: `A paper can hold up to ${MAX_QUESTIONS} questions, so ${id} cannot be ${n}. ${range}`,
      };
    }
    out.push({ id, count: n, category: categoryOf(id, subject, grade) });
  }

  const total = out.reduce((s, t) => s + t.count, 0);
  // On Both, the Seen questions she already asked for are part of the same
  // paper, so the ceiling is checked on Seen + Unseen together.
  const seen = Math.max(0, Number(seenCount) || 0);
  if (total + seen > MAX_QUESTIONS) {
    const which = seen ? ` (${seen} Seen + ${total} Unseen)` : '';
    return {
      ok: false,
      message: `That is ${total + seen} questions in total${which}. A paper can hold up to `
        + `${MAX_QUESTIONS} — please lower one of the numbers.`,
    };
  }

  return { ok: true, types: out, total };
}

/**
 * The most marks a paper may be asked to carry.
 *
 * This is a typo guard, not a product opinion. It has to sit ABOVE any paper a
 * teacher could legitimately want, or it refuses real work: 25 questions (the
 * question ceiling) at a generous 20 marks each is 500. So 500 never blocks a
 * genuine request and still catches the keypad slip that turns 40 into 4000.
 */
const MAX_TOTAL_MARKS = 500;

/**
 * Read the marks budget she typed, which she is allowed not to type.
 *
 * The one real difference from parseQuestionCount: BLANK IS VALID. The question
 * count is required and an empty box is a mistake; the budget is optional and an
 * empty box is an answer — "no budget", the behaviour that existed before this
 * field did. So empty returns ok with a null, and only a value she actually
 * typed is held to the range.
 *
 * Out of range is REFUSED rather than clamped, for the same reason as the count:
 * quietly turning 4000 into 500 hands her a paper she did not ask for and never
 * mentions it.
 */
function parseTotalMarks(raw) {
  const text = String(raw ?? '').trim();
  const range = `Type a number between 1 and ${MAX_TOTAL_MARKS}, or leave it blank.`;

  // Blank is a choice, not a mistake.
  if (!text) return { ok: true, marks: null };

  if (!/^\d+$/.test(text)) return { ok: false, message: range };

  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) return { ok: false, message: range };
  if (n > MAX_TOTAL_MARKS) {
    return { ok: false, message: `A paper can carry up to ${MAX_TOTAL_MARKS} marks. ${range}` };
  }
  return { ok: true, marks: n };
}

module.exports = {
  parseQuestionCount, MAX_QUESTIONS, DEFAULT_QUESTIONS, forSubject, categoryOf, withCounts, defaultMix, CATALOGUE,
  parseTotalMarks, MAX_TOTAL_MARKS, parsePerTypeCounts, MAX_TYPE_SLOTS };
