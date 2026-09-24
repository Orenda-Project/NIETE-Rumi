'use strict';
/**
 * LP-born quiz — pass 1, the DIGEST, read from the LESSON PLAN.
 *
 * The transcript digest (`transcript-quiz-digest.service.js`) reads what a
 * teacher actually said in class. This one reads the SLIDE SCRIPT of the exact
 * lesson version the teacher was served — the authored source the rendered PDF
 * was built from, resolved by (lesson_id, version_stamp, content_hash) so the
 * quiz can never be written from a lesson the teacher did not get (PLAN_R8 D13).
 *
 * It returns the SAME SHAPE as the transcript digest, through the same
 * `normaliseDigest()`. That is not tidiness: the author prompt, the validator,
 * the teacher PDF, the hand-off and the class report's objectives all read that
 * shape and nothing else, so a second shape would mean a second copy of every
 * one of them.
 *
 * THREE THINGS IT MUST NOT FORWARD, each one a red-team finding:
 *
 *  1. `wrap.exitOptions` (PLAN_R8 §8 row 27). The exit MCQ is the one question
 *     this class has already been asked and answered at the end of the period.
 *     A quiz that reuses it measures who remembers the last five minutes.
 *  2. Gendered prose. The plans are authored with a teacher gender
 *     (`meta.teacherGender`) and their prose says "She says…", "ask her". The
 *     teacher's gender is not a fact this system holds — it is a guess, and a
 *     guess printed on that teacher's own document is exactly what the pipeline
 *     spends three gates removing downstream. It is cheaper to never carry it.
 *  3. `meta.teacherGender` itself, for the same reason.
 *
 * What it DOES carry is the planned lesson: the goal and its SLO, the Bloom
 * level, the key fact, the worked example, the misconception the plan warns
 * about (which seeds the distractors), the independent-practice prompts as
 * SHAPE, and the wrap-up key facts.
 */

const { completeJson } = require('./transcript-quiz-llm');
const { normaliseDigest } = require('./transcript-quiz-digest.service');
const { peopleDigestRule } = require('./transcript-quiz-people');
const { canonicalSubject, LANG_NAME } = require('./transcript-quiz-language');
const { logEvent } = require('../../utils/structured-logger');
const { logToFile } = require('../../utils/logger');
const { LP_V8, SOURCE_UNUSABLE_CODE } = require('./quiz-sources');
const Catalog = require('../lp-v8-catalog.service');

/**
 * The lesson's own name, as its PDF caption prints it (`lesson.topic`, falling
 * back to `topic_short`), or null when the catalog does not know the lesson.
 *
 * WHY NOT THE MODEL'S LABEL. The model fills `topic_as_taught` from the slide
 * script's `meta.topic`, and on every script that field is the objective's first
 * clause cut mid-sentence ("طالب علم واحد اور جمع کے فرق کو"). That label is what
 * an Urdu quiz is called everywhere — quizzes.topic, the forward message the
 * children read, /quiz, the PDF — so it is taken from the catalog, never guessed.
 */
function catalogLessonName(lessonId) {
  if (!lessonId) return null;
  try {
    const hit = Catalog.lessonById(lessonId);
    const name = hit && hit.lesson && (hit.lesson.topic || hit.lesson.topic_short);
    return name && String(name).trim() ? String(name).trim() : null;
  } catch (err) {
    // No catalog means the model's label stands — never no quiz.
    logToFile('lp digest: catalog unreadable — keeping the model\'s topic label', { lessonId, error: err.message }, 'error');
    return null;
  }
}

/** Bloom verb → the three levels the whole quiz pipeline speaks. */
const BLOOM_LEVEL = {
  remember: 'recall',
  recall: 'recall',
  knowledge: 'recall',
  identify: 'recall',
  understand: 'understand',
  comprehend: 'understand',
  explain: 'understand',
  apply: 'apply',
  analyse: 'apply',
  analyze: 'apply',
  evaluate: 'apply',
  create: 'apply',
};

/** @returns {'recall'|'understand'|'apply'} */
function levelFromBloom(bloom) {
  return BLOOM_LEVEL[String(bloom || '').trim().toLowerCase()] || 'understand';
}

/**
 * Take the teacher's gender out of a sentence without taking the sentence out.
 *
 * "She says the ones column reached thirteen" → "The teacher says …";
 * "ask her whether six and seven reach ten"   → "ask them whether …";
 * "his class"                                  → "their class".
 *
 * Objective `her` ("ask her") and possessive `her` ("her class") are the same
 * word, so one of the two readings is always slightly off; `their`/`them` is
 * the reading that stays grammatical in both, which is why the map is not
 * "the teacher" for every form.
 */
const PRONOUN = {
  she: 'the teacher',
  he: 'the teacher',
  her: 'their',
  hers: 'theirs',
  his: 'their',
  him: 'them',
  herself: 'themselves',
  himself: 'themselves',
};
const PRONOUN_RE = /\b(she|he|hers|her|his|him|herself|himself)\b/gi;

function degender(text) {
  const s = String(text == null ? '' : text);
  if (!s) return '';
  return s.replace(PRONOUN_RE, (m) => {
    const to = PRONOUN[m.toLowerCase()];
    // Keep the writer's capitalisation: a replacement at the head of a sentence
    // must not lower-case it.
    return m[0] === m[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to;
  });
}

const arr = (v) => (Array.isArray(v) ? v : []);

// ─── WHAT THE LESSON DREW — the slide script's manipulatives, parsed ────────
//
// A grade 1-5 maths slide script draws its manipulatives in its `diagram`
// fields as TOKEN ROWS, one row per line:
//
//   whole (9): [counter][counter][counter][counter] [counter][counter]…
//   group 2: [dot][dot][dot][dot]
//   342 —
//   3 hundreds: [bundle][bundle][bundle]
//
// That is what the class saw on the board, so it is what a quiz picture should
// draw. The quiz used to throw all of it away as ASCII noise, and the author
// drew apples for a lesson that counted counters. Only the TOKENS are read,
// never the ASCII around them: a column sum (its own place-value grid) is
// recognised and skipped, and so is a hundred-chart piece ("[28]") or a ruler.

/** A token as the lesson wrote it, reduced to letters: "Big-Bundle" → "bigbundle". */
const normToken = (t) => String(t || '').toLowerCase().replace(/[^a-z]/g, '');
/** "4 tens", "1 hundred", "130 ones" — a count followed at once by its place ("1 one-rupee coin" is not one). */
const PLACE_ROW = /^\s*\d[\d,]*\s+(thousands?|hundreds?|tens?|ones?)(?![-\w])/i;
const PLACE_KEY = { thousand: 'thousands', hundred: 'hundreds', ten: 'tens', one: 'ones' };
/** Tokens that only ever stand for a place-value piece — blocks, and the bundles/tens of the stick model. */
const BLOCKS_TOKENS = new Set(['flat', 'rod', 'cube']);
const BUNDLE_TOKENS = new Set(['bundle', 'bigbundle', 'circleof', 'tengroup', 'tenbeads']);
/** The pieces of a fraction or an area drawing — fraction_bar / grid draw these, not a pictogram. */
const FRACTION_TOKENS = new Set(['shaded', 'blank', 'part', 'cell', 'strip', 'piece', 'slice', 'bar', 'unshaded', 'half', 'quarter', 'third']);
/** Words for an arrangement, not a thing: a "group" or a "pile" of something is drawn as that something. */
const NOT_OBJECTS = new Set(['group', 'pile', 'trip', 'place', 'row']);
/** A thing the pictogram set lacks but a manipulative stands in for: a measuring block is a tile. */
const DRAWN_AS = { block: 'tile', brick: 'tile' };
const TALLY_TOKENS = new Set(['tally', 'mark']);
const MONEY_TOKEN = /^rs\d*(note|coin)$|^(coin|note)$/;

function isColumnSum(text) {
  return /COLUMN SUM/i.test(text) || /^\s*\|\s*\|?\s*(HTh|TTh|Th|H|T|O)\s*\|/m.test(text);
}

/** One line: its label (before the first "[") and its token groups ("/" separates groups). */
function parseLine(line) {
  const open = line.indexOf('[');
  const label = (open >= 0 ? line.slice(0, open) : line).replace(/:\s*$/, '').trim();
  if (open < 0) return { label, groups: [] };
  const groups = line.slice(open).split(/\s\/\s/).map((part) => {
    const toks = [...part.matchAll(/\[([^\]\n]*)\]/g)].map((m) => normToken(m[1])).filter(Boolean);
    return toks;
  }).filter((g) => g.length);
  return { label, groups };
}

/**
 * One diagram string → { kind, rows, placeValue } or null for nothing at all.
 *   kind        'column_sum' | 'rows'
 *   rows        [{label, token, count}] — one per token kind per line
 *   placeValue  [{hundreds, tens, ones, model, thousands?}] — read from each
 *               row's PLACE WORD ("4 tens: …"), never from its token: the
 *               scripts write "2 ones: [bundle][bundle]" as often as sticks
 * Pure.
 */
function parseDiagram(text) {
  const s = typeof text === 'string' ? text : '';
  if (!s.trim()) return null;
  if (isColumnSum(s)) return { kind: 'column_sum', rows: [], placeValue: [] };
  const rows = [];
  const placeValue = [];
  let current = null;
  const flush = () => { if (current) placeValue.push(current); current = null; };
  s.split('\n').forEach((line) => {
    // "342 —" opens a new number
    if (/^\s*\d[\d,]*\s*[—–-]\s*$/.test(line)) { flush(); return; }
    const { label, groups } = parseLine(line);
    // "1986: [cube] / [flat]… / [rod]… / [dot]…" — one number as positional groups
    if (groups.length >= 2 && groups.length <= 4 && /^\d[\d,]*(\s+\w+)?$/.test(label)) {
      flush();
      const places = ['ones', 'tens', 'hundreds', 'thousands'];
      const pv = { hundreds: 0, tens: 0, ones: 0 };
      [...groups].reverse().forEach((g, k) => { pv[places[k]] = g.length; });
      const model = groups.flat().some((t) => BLOCKS_TOKENS.has(t)) ? 'blocks' : 'bundles';
      placeValue.push({ ...pv, model });
      return;
    }
    const place = PLACE_ROW.exec(label);
    if (place) {
      const key = PLACE_KEY[place[1].toLowerCase().replace(/s$/, '')];
      const toks = groups.flat();
      // "130 ones: 0 sticks (empty column)" — a place drawn empty
      const count = toks.length;
      if (current && current[`_${key}`]) flush();   // a place seen twice is the next number
      current = current || { hundreds: 0, tens: 0, ones: 0, model: 'bundles' };
      current[key] = count;
      current[`_${key}`] = true;
      if (toks.some((t) => BLOCKS_TOKENS.has(t))) current.model = 'blocks';
      return;
    }
    flush();
    groups.forEach((g) => {
      const counts = new Map();
      g.forEach((t) => { if (/[a-z]/.test(t)) counts.set(t, (counts.get(t) || 0) + 1); });
      counts.forEach((count, token) => rows.push({ label, token, count }));
    });
  });
  flush();
  const clean = placeValue.map((pv) => {
    const out = {};
    Object.entries(pv).forEach(([k, v]) => { if (!k.startsWith('_')) out[k] = v; });
    if (!out.thousands) delete out.thousands;
    return out;
  });
  return { kind: 'rows', rows, placeValue: clean };
}

/** "whole (9)" → "whole"; "10 counters (the whole)" → "counters"; a bare number → "". */
function rowName(label) {
  return String(label || '').replace(/\([^)]*\)/g, ' ').replace(/[=%/\d.,:—–-]+/g, ' ')
    .replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ').toLowerCase();
}

/**
 * Every manipulative a slide script drew, from the fields the class actually
 * met: the worked example, the modelled problem, the practice and the support
 * work. NEVER the exit options (the red-team rule `carry()` exists to keep).
 */
function lessonManipulatives(ss) {
  const { has: hasPicto, key: pictoKey } = require('../../../vendor/lp-v9/diagrams/lib/pictogram');
  const iDo = ss.iDo || {};
  const weDo = ss.weDo || {};
  const youDo = ss.youDo || {};
  const sources = [
    ['worked', iDo.worked && iDo.worked.diagram],
    ['modelled', weDo.modelled && weDo.modelled.diagram],
    ...arr(youDo.problems).map((p) => ['practice', p && p.diagram]),
    ['support', youDo.behind && youDo.behind.diagram],
  ];
  const objects = new Map();
  const out = {
    objects: [], placeValue: null, fractions: false, tally: false, money: false, maxCount: 0, columnSums: 0,
  };
  sources.forEach(([source, text]) => {
    const d = parseDiagram(text);
    if (!d) return;
    if (d.kind === 'column_sum') { out.columnSums += 1; return; }
    d.placeValue.forEach((pv) => {
      if (!out.placeValue) out.placeValue = { model: pv.model, example: null, thousands: false };
      if (pv.thousands) out.placeValue.thousands = true;
      if (pv.model === 'blocks') out.placeValue.model = 'blocks';
      // Only the WORKED example is quoted with its numbers: it is already in
      // the lesson plan the author reads. A practice number is never offered.
      // base_ten draws a thousands place, so a four-digit example is quoted whole.
      if (source === 'worked' && !out.placeValue.example) {
        out.placeValue.example = {
          ...(pv.thousands ? { thousands: pv.thousands } : {}), hundreds: pv.hundreds, tens: pv.tens, ones: pv.ones,
        };
      }
    });
    d.rows.forEach((r) => {
      if (FRACTION_TOKENS.has(r.token)) { out.fractions = true; return; }
      if (TALLY_TOKENS.has(r.token)) { out.tally = true; return; }
      if (MONEY_TOKEN.test(r.token)) { out.money = true; return; }
      if (NOT_OBJECTS.has(r.token)) return;
      // Bundles or rods counted on their own ("3 bundles: [bundle]…") are still
      // place value: base_ten draws them, a pictogram of a bundle does not exist.
      if (BUNDLE_TOKENS.has(r.token) || BLOCKS_TOKENS.has(r.token)) {
        if (!out.placeValue) out.placeValue = { model: 'bundles', example: null, thousands: false };
        if (BLOCKS_TOKENS.has(r.token)) out.placeValue.model = 'blocks';
        return;
      }
      out.maxCount = Math.max(out.maxCount, r.count);
      const picto = hasPicto(r.token) ? pictoKey(r.token) : (DRAWN_AS[r.token] || null);
      const o = objects.get(r.token) || {
        token: r.token, picto, rows: 0, names: [],
      };
      o.rows += 1;
      const name = rowName(r.label);
      if (name && !o.names.includes(name) && o.names.length < 4) o.names.push(name);
      objects.set(r.token, o);
    });
  });
  out.objects = [...objects.values()].sort((a, b) => b.rows - a.rows);
  return out;
}

/**
 * The ONE field picker. Everything the model or the author is ever shown comes
 * from here, so "we never forward the exit options" is a property of one
 * function rather than a promise repeated in two prompts.
 */
function carry(slideScript) {
  const ss = slideScript && typeof slideScript === 'object' ? slideScript : {};
  const meta = ss.meta || {};
  const iDo = ss.iDo || {};
  const youDo = ss.youDo || {};
  const wrap = ss.wrap || {};
  const worked = iDo.worked || null;
  const mis = iDo.misconception || null;
  return {
    meta: {
      grade: meta.grade ?? null,
      subject: meta.subject ?? null,
      topic: degender(meta.topic),
      chapter: degender(meta.chapterTitle),
      minutes: meta.minutes ?? meta.durationMin ?? null,
      slo_descriptions: arr(meta.sloDescriptions).map(degender).filter(Boolean),
      // meta.teacherGender is deliberately absent. So is meta.sourceFile — an
      // absolute path on somebody's laptop, and this repo is public.
    },
    goal: degender(ss.goal),
    slo_full: degender(ss.sloFull),
    slo_code: String(ss.sloCode || '').trim(),
    bloom: String(ss.bloom || '').trim(),
    key_fact: degender(iDo.keyFact),
    worked: worked ? {
      problem: degender(worked.problem),
      work: arr(worked.work).map(degender).filter(Boolean),
      answer: degender(worked.answer),
      // worked.diagram is never forwarded as it is — ASCII column-sum art with
      // its own row-mark legend reads as noise in a prompt. Its TOKENS are read
      // instead, below, into `manipulatives`.
    } : null,
    misconception: mis ? {
      slip: degender(mis.slip), why: degender(mis.why), fix: degender(mis.fix),
    } : null,
    // Any further mistakes the plan warns about. A K-5 slide script has one
    // (iDo.misconception) and no top-level list — 0 of 1,281 ingested scripts
    // carry one — so for K-5 this is always empty and nothing below changes. A
    // Grades 6-12 lesson warns about three or four (lp612-quiz-source.js), and
    // every one is material for a wrong option.
    more_misconceptions: arr(ss.misconceptions).map((m) => (m && typeof m === 'object'
      ? { slip: degender(m.slip), why: degender(m.why), fix: degender(m.fix) }
      : { slip: degender(m), why: '', fix: '' })).filter((m) => m.slip),
    // PROMPTS ONLY — never the answers, and never as questions to reuse.
    practice_prompts: arr(youDo.problems).map((p) => degender(p && p.prompt)).filter(Boolean),
    key_facts: arr(wrap.keyFacts).map(degender).filter(Boolean),
    // What the class counted with — parsed from the diagram fields of the
    // worked example, the modelled problem, the practice and the support work.
    // Never from wrap.exitOptions.
    manipulatives: lessonManipulatives(ss),
  };
}

/** Is there enough of a plan here to write anything from? */
function isUsable(slideScript) {
  const c = carry(slideScript);
  return Boolean(c.goal || c.slo_full || c.key_fact || c.practice_prompts.length || c.key_facts.length);
}

/**
 * The block the AUTHOR pass reads where a transcript quiz reads the passages
 * around each SLO's evidence. Same picker, so the same three things are absent.
 * @returns {string}
 */
function lessonExcerpts(slideScript) {
  const c = carry(slideScript);
  const lines = [];
  const push = (label, value) => { if (value) lines.push(`${label}: ${value}`); };
  push('LESSON', [c.meta.topic, c.meta.chapter].filter(Boolean).join(' — '));
  push('WHAT THE CLASS WAS TO LEARN', c.goal);
  push('THE OBJECTIVE IN FULL', c.slo_full);
  if (c.slo_code) push('OBJECTIVE CODE', c.slo_code);
  if (c.bloom) push('THE LEVEL THE LESSON WAS PITCHED AT', c.bloom);
  c.meta.slo_descriptions.forEach((d) => push('WRITTEN FOR THE CLASS AS', d));
  push('THE KEY FACT THE LESSON TURNS ON', c.key_fact);
  if (c.worked && (c.worked.problem || c.worked.work.length)) {
    lines.push('THE WORKED EXAMPLE THE CLASS WAS SHOWN:');
    if (c.worked.problem) lines.push(`  ${c.worked.problem}`);
    c.worked.work.forEach((w) => lines.push(`  ${w}`));
    if (c.worked.answer) lines.push(`  ${c.worked.answer}`);
  }
  if (c.misconception) {
    lines.push('THE MISTAKE THIS LESSON EXPECTS CHILDREN TO MAKE (gold for distractors):');
    if (c.misconception.slip) lines.push(`  what they do: ${c.misconception.slip}`);
    if (c.misconception.why) lines.push(`  why: ${c.misconception.why}`);
    if (c.misconception.fix) lines.push(`  what fixes it: ${c.misconception.fix}`);
  }
  if (c.more_misconceptions.length) {
    lines.push('OTHER MISTAKES THE PLAN WARNS ABOUT (gold for distractors too):');
    c.more_misconceptions.forEach((m) => lines.push(`  what they do: ${m.slip}${m.fix ? ` — what fixes it: ${m.fix}` : ''}`));
  }
  if (c.practice_prompts.length) {
    lines.push('WHAT THE CLASS PRACTISED ON THEIR OWN — the SHAPE of the work, never questions to copy:');
    c.practice_prompts.forEach((p) => lines.push(`  ${p}`));
  }
  if (c.key_facts.length) {
    lines.push('WHAT THE LESSON ENDED ON:');
    c.key_facts.forEach((k) => lines.push(`  ${k}`));
  }
  return lines.join('\n');
}

/**
 * WHAT THE LESSON DREW, for the author: each object the class counted, the
 * spec that draws it, and the size of its counts — or '' when the lesson drew
 * nothing to count. The instruction is to draw the SAME objects, so a child
 * recognises the lesson in the picture.
 * @returns {string}
 */
function lessonDrewBlock(slideScript) {
  const m = carry(slideScript).manipulatives;
  const lines = [];
  m.objects.slice(0, 6).forEach((o) => {
    const named = o.names.length ? ` (the lesson named its rows: ${o.names.join(', ')})` : '';
    lines.push(o.picto
      ? `- ${o.token} → "picto":"${o.picto}" in count_objects${named}`
      : `- ${o.token} → the pictogram set has no ${o.token}; draw it as "picto":"counter"${named}`);
  });
  if (m.placeValue) {
    const ex = m.placeValue.example;
    const how = m.placeValue.model === 'blocks'
      ? 'flats, rods and cubes → {"type":"base_ten","model":"blocks",…}'
      : 'bundles of ten sticks and loose sticks → {"type":"base_ten",…}';
    const exThousands = ex && ex.thousands ? `${ex.thousands} thousands, ` : '';
    lines.push(`- place value with ${how}${ex ? `; the worked example showed ${exThousands}${ex.hundreds} hundreds, ${ex.tens} tens and ${ex.ones} ones` : ''}`);
  }
  if (m.fractions) lines.push('- fractions as shaded parts of a whole → fraction_bar (a strip, or "model":"circle" for a roti)');
  if (m.tally) lines.push('- tally marks → {"type":"count_frame","model":"tally",…}');
  if (m.money) lines.push('- coins and notes → money');
  if (!lines.length) return '';
  const size = m.maxCount ? `
The lesson's counts went up to ${m.maxCount}; keep yours about that size (count_objects draws at most 30).` : '';
  return `WHAT THE LESSON DREW — the manipulatives this lesson put in front of the class. A picture question draws THE SAME objects, so a child recognises the lesson in it:
${lines.join('\n')}${size}
Use your own numbers — never copy a practice problem's.`;
}

function buildLpDigestPrompt({ slideScript, language, grade, subject }) {
  const c = carry(slideScript);
  return `You are reading the LESSON PLAN a teacher in a Pakistani government school was given and taught from today. Your job is to write a faithful DIGEST of what that lesson set out to teach — nothing more, nothing less. This digest will be used to write a short quiz for the children who sat in that lesson, so anything you invent will be tested on children who never met it.

WHAT YOU KNOW ABOUT THIS LESSON:
- grade (from the curriculum catalog, trust it over your own reading): ${grade || c.meta.grade || 'unknown'}
- subject (from the catalog): ${subject || c.meta.subject || 'unknown'}
- the quiz will be written in: ${LANG_NAME[language] || 'the lesson’s own language'}

RULES
- Use ONLY the lesson below. If there is too little of it to say what was taught, say so via confidence < 0.5.
- "slos" = the specific learning objectives THIS lesson set out to teach, 2-6 of them, each with a short verbatim quote from the plan as its evidence and the level the plan pitched it at: "recall" (name/repeat/identify), "understand" (explain/compare/give own example), "apply" (solve/use in a new case). The plan's own level is "${c.bloom || 'understand'}" — no objective may be tagged ABOVE it.
- Every SLO carries "statement_en" (the objective in English) and "statement_ur" (the same objective in Urdu script, English technical terms in English letters). The teacher may ask for the quiz in either language and the document must read in one language only.
- "topic_as_taught" = the topic label as the plan names it. ENGLISH TECHNICAL TERMS ARE WRITTEN IN ENGLISH LETTERS, never transliterated into Urdu script: write "column method", "numerator", "photosynthesis" — not "کالم میتھڈ". "topic" = a clean short label in English.
- "subject" must be one of: urdu | english | maths | science | sst | genk | islamiat | other.
- "grade_band": "1-2" | "3-5" | "6-8" | "9-10".
- "key_terms": up to 8 terms the lesson teaches; "term" is the canonical form, "as_spoken" is how the plan words it for the class.
- "examples_used": the concrete examples, numbers, objects and stories THIS plan uses — the worked example and the practice work. These are the material of the quiz: a child should recognise their own lesson in it.
- "misconceptions_surfaced": the mistake this plan expects children to make, and why. This is what the quiz's wrong options are built from, so write it as the mistaken THINKING, not as an instruction to the teacher.
${peopleDigestRule('the plan')}
- THE PRACTICE PROMPTS BELOW ARE SHAPE, NOT QUESTIONS. Never copy one of them, or its numbers, into anything you write — a child who did that exact sum in the period is being asked to remember an answer, not to use the idea. Write about the same skill with different material.
- THE TEACHER HAS NO GENDER. Never write "she", "he", "her", "his" or "him" about the teacher in any field — say "the teacher". In Urdu use no gendered word for the teacher and no gendered verb form about the teacher; a verb that agrees with the object ("استاد نے سبق پڑھایا") says nothing about the teacher and is what to write. Never guess a child's gender either.
- Religious content (Islamiyat / سیرت): write sacred names and honorifics exactly and in Urdu/Arabic script (اللہ، نبی کریم ﷺ، رضی اللہ عنہ) — never transliterated, never dropped.

Return ONLY this JSON object:
{
  "topic": "", "topic_as_taught": "", "subject": "urdu|english|maths|science|sst|genk|islamiat|other", "subject_conflict": false,
  "grade_band": "", "language_of_instruction": "", "confidence": 0.0,
  "slos": [ { "id": "S1", "statement": "", "statement_en": "", "statement_ur": "", "evidence_quote": "", "taught_level": "recall|understand|apply" } ],
  "key_terms": [ { "term": "", "as_spoken": "" } ],
  "examples_used": [ "" ],
  "misconceptions_surfaced": [ "" ],
  "people": [ { "latin": "", "ur": "" } ]
}

THE LESSON PLAN:
${lessonExcerpts(slideScript)}`;
}

/**
 * Run the digest for ONE served lesson.
 *
 * @param {object}  args
 * @param {object}  args.slideScript  the slide script of the exact served version
 * @param {string}  args.language     the quiz language already settled on the row
 * @param {string|number} [args.grade]   the catalog grade (authoritative)
 * @param {string}  [args.subject]    the catalog subject
 * @param {string}  [args.lessonId]   the served lesson (`quizzes.meta.lessons[0].lesson_id`);
 *                                    names the quiz from the catalog. Falls back to the
 *                                    slide script's own `meta.lessonId`.
 * @param {string}  [args.lessonName] the lesson's own name when the caller already holds it
 *                                    (a Grades 6-12 lesson: its book heading). Wins over the
 *                                    K-5 catalog lookup, which cannot know a 6-12 segment.
 * @param {string}  [args.quizSource] `quizzes.quiz_source` of the quiz being written, for the
 *                                    telemetry (default lp_v8).
 * @returns {Promise<{digest:object, grade:string|null, gradeSource:'catalog', lpHint:null,
 *                    model:string, costUsd:number|null, latencyMs:number}>}
 *   The same envelope `transcript-quiz-digest.service.run()` returns, so the
 *   generate step spreads one or the other without a second branch.
 */
async function run({
  slideScript, language = null, grade = null, subject = null, lessonId = null, lessonName: givenName = null,
  quizSource = LP_V8,
}) {
  if (!isUsable(slideScript)) {
    // Loudly, and before the LLM call: an empty digest authored into a quiz is
    // eight questions about nothing, and the teacher would be the one to find out.
    // The code is what tells this — the one failure that IS the lesson plan's —
    // apart from every failure of the model after it (quiz-sources
    // `digestFailureReason`), so the teacher is told which one happened.
    const err = new Error('lp digest: the slide script carries no lesson to digest');
    err.code = SOURCE_UNUSABLE_CODE;
    throw err;
  }
  const prompt = buildLpDigestPrompt({ slideScript, language, grade, subject });
  const {
    json, model, costUsd, latencyMs,
  } = await completeJson({ prompt, label: 'lp_quiz.digest' });

  const digest = normaliseDigest(json, { storedSubject: subject });
  const bloomLevel = levelFromBloom(slideScript && slideScript.bloom);

  // The plan's Bloom level is the ceiling, and it is a FACT about the lesson —
  // not something the model may raise. The author prompt and the validator both
  // read per-SLO taught_level, so the clamp happens here, once.
  const RANK = { recall: 0, understand: 1, apply: 2 };
  digest.taught_level = bloomLevel;
  digest.slos = digest.slos.map((s) => (
    RANK[s.taught_level] > RANK[bloomLevel] ? { ...s, taught_level: bloomLevel } : s
  ));

  // The misconception is SEEDED from the plan, not hoped for from the model:
  // it is what every wrong option is built from, and on this path it is the one
  // piece of the lesson we know for certain.
  const c = carry(slideScript);
  if (c.misconception || c.more_misconceptions.length) {
    const seeded = [
      ...(c.misconception ? [c.misconception.slip, c.misconception.why] : []),
      ...c.more_misconceptions.map((m) => m.slip),
    ].filter(Boolean);
    const already = new Set(digest.misconceptions_surfaced.map((m) => String(m).trim()));
    digest.misconceptions_surfaced = [
      ...seeded.filter((m) => !already.has(m.trim())),
      ...digest.misconceptions_surfaced,
    ].slice(0, 8);
  }
  if (!digest.subject || digest.subject === 'other') digest.subject = canonicalSubject(subject);

  // The label is the lesson's catalog name, set AFTER the model and verbatim
  // (see catalogLessonName). The model's English `topic` stays: it is what an
  // English-language quiz is called, and the catalog has no English name for an
  // Urdu lesson.
  const servedLessonId = lessonId || (slideScript && slideScript.meta && slideScript.meta.lessonId) || null;
  const named = givenName && String(givenName).trim() ? String(givenName).trim() : null;
  const lessonName = named || catalogLessonName(servedLessonId);
  if (lessonName) digest.topic_as_taught = lessonName;

  const resolvedGrade = grade != null && String(grade).trim() ? String(grade).trim() : null;

  logEvent('transcript_quiz.digest_done', {
    quiz_source: quizSource,
    lessonId: servedLessonId,
    topicSource: named ? 'lesson' : (lessonName ? 'catalog' : 'model'),
    model,
    costUsd,
    latencyMs,
    subject: digest.subject,
    slos: digest.slos.length,
    confidence: digest.confidence,
    taughtLevel: bloomLevel,
    grade: resolvedGrade,
    gradeSource: 'catalog',
  });

  return {
    digest,
    grade: resolvedGrade,
    gradeSource: 'catalog',
    lpHint: null,
    model,
    costUsd,
    latencyMs,
  };
}

module.exports = {
  run, lessonExcerpts, buildLpDigestPrompt, carry, degender, levelFromBloom, isUsable,
  parseDiagram, lessonDrewBlock,
};
