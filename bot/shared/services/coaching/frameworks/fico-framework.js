/**
 * FICO Framework Module — ICT Canonical Rubric, v4
 *
 * FICO — Fidelity & Impact Classroom Observation Tool.
 *
 * 4 scored sections (B, C, D, F) + Section A (metadata only, not scored).
 * 26 indicators (B7 · C4 · D5 · F10), scale 0-2, max 52 marks defined.
 *
 * A SCORED LESSON IS NOT MARKED OUT OF 52. Seven Section-F indicators are subject-gated and
 * exactly one subject group applies to any lesson, so the real denominator is computed per
 * session by computeScores() from the indicators the scorer declared applicable — 21 x 2 = 42
 * for maths and science, 22 x 2 = 44 for literacy, 19 x 2 = 38 when the subject is unknown.
 * Read getScoringConstants(); never assume a constant.
 *
 * Scale — three rungs, zero-based:
 *   0 = Not observed
 *   1 = Developing
 *   2 = Proficient
 *
 * WHY THREE RUNGS (measured on 2,788 live sessions). The old 1-4 scale had no zero, so
 * a teacher who did nothing scored 25% and a teacher proficient on everything scored 75%; 93.1%
 * of all sessions landed in one 20-point band. The fourth rung was awarded on 4.9% of 103k
 * judgements, and across 845 Punjab classrooms observed by trained humans not one reached the top
 * rung on the cognitive-demand items. Zero-based, three rungs: floor 0%, ceiling reachable at
 * 100%, and the spread roughly doubles.
 *
 * WHY EVERY INDICATOR CARRIES A `count` AND A `notCounted`. Levels used to be judgements of degree
 * ("open-ended questions dominate", "most activities support the objective"). A proportion needs a
 * denominator the model cannot hear, so C1 returned exactly 2 in 90.4% of lessons — and because
 * the focus_area prompt also named C1 to 57% of teachers, the most-issued advice in the product
 * pointed at the one indicator the scorer could not register movement on. Every rung is now read
 * off an absolute count with a quotable instance, and `notCounted` names the specific ways the
 * model has been over-crediting — the standing "scores are too lenient" complaint.
 *
 * Rubric content mirrors the ICT team's canonical sheet
 * (1UZaHrXARlJ2cWiZAGFEuc-_o1zOiC5LNXaz11_XVkFU) for the indicator SET; the descriptors are
 * re-authored as counts. Section E (Student Assessment) is deliberately out of scope — it is
 * one-on-one ASER/EGRA testing, not observable from a classroom recording.
 *
 * Section B is the FALLBACK path only. Whenever a lesson plan is linked and the fidelity engine
 * returns a usable score, applyLpFidelity() overrides Section B with the measured
 * executed-over-prescribed figure and these seven indicators are not what the teacher is scored on.
 */

// ─── Section definitions (verbatim from the ICT sheet) ───────────────

const DOMAINS = {
  lesson_plan_fidelity: {
    key: 'B',
    displayName: 'Lesson Plan Fidelity',
    displayName_ur: 'Lesson Plan Fidelity (سبق کے منصوبے پر عمل درآمد)',
    indicatorCount: 7,
    indicators: [
      {
        id: 'B1',
        name: 'Instructional Clarity & Learning Objectives',
        count: 'times the objective is stated, and times it is referred back to',
        levels: {
          0: 'No learning objective is stated anywhere in the lesson.',
          1: 'An objective is stated once and never referred to again.',
          2: 'An objective is stated AND referred back to at least once more during the lesson. Quote both moments.',
        },
        notCounted: 'A topic announcement (\'aaj hum jama karna seekhenge\' / \'today, chapter 4\') names the TOPIC, not an objective — it counts only if it says what students will be able to DO. Writing the date or page number is not an objective.',
      },
      {
        id: 'B2',
        name: 'Lesson Structure & Sequence',
        count: 'spoken transitions between lesson phases',
        levels: {
          0: 'No phases are distinguishable; the lesson is one undifferentiated block.',
          1: 'Phases are distinguishable but the teacher never marks a move between them out loud.',
          2: 'At least TWO transitions are spoken out loud (\'ab hum…\', \'now that we have…, let us…\'). Quote each one.',
        },
        notCounted: 'A pause, a page turn, or simply starting a new activity is not a transition — the teacher must SAY that the lesson is moving on. \'Chup ho jao\' is management, not a transition.',
      },
      {
        id: 'B3',
        name: 'Activities & Tasks Alignment',
        count: 'distinct activities, and how many serve the stated objective',
        levels: {
          0: 'No activity can be traced to the stated objective, or no objective was stated.',
          1: 'At least one activity serves the objective and at least one other is filler or unrelated.',
          2: 'EVERY activity in the lesson serves the objective. Name each activity and state the link.',
        },
        notCounted: 'Do not credit an activity for being on-topic. Copying from the board, or reading the chapter aloud with no task attached, serves an objective only if the objective is about copying or reading aloud.',
      },
      {
        id: 'B4',
        name: 'Activation of Prior Knowledge',
        count: 'NAMED prior concepts actually recalled',
        levels: {
          0: 'No reference to anything students already know.',
          1: 'A generic opener (\'do you remember yesterday?\', \'pichla sabaq yaad hai?\') with no specific concept named, OR exactly one named concept.',
          2: 'TWO OR MORE named prior concepts are recalled and linked to today\'s content, OR a student restates a prior concept in their own words. Name the concepts; quote the student.',
        },
        notCounted: '\'Do you remember?\' with nothing named is never above rung 1, however warmly asked. Re-reading yesterday\'s date or title is not recall. The teacher naming a concept the students do not respond to still counts, but only as a named concept — not as student recall.',
      },
      {
        id: 'B5',
        name: 'Meaningful & Real-World Connections',
        count: 'developed connections to life outside the textbook',
        levels: {
          0: 'Content is presented with no link to anything outside the textbook.',
          1: 'One connection is mentioned in passing and not developed.',
          2: 'At least one connection is DEVELOPED — the teacher explains how it relates — OR a student offers a connection of their own. Quote it.',
        },
        notCounted: 'Naming a familiar object (aam, cricket, bazaar) is not a connection unless it is used to explain the content. A word problem set in a shop is not a real-world connection by itself.',
      },
      {
        id: 'B6',
        name: 'Differentiation / Catering to Learning Levels',
        count: 'distinct tasks or supports offered to different learners',
        levels: {
          0: 'One task, one delivery, for the whole class.',
          1: 'The teacher acknowledges that students are at different levels but everyone still does the same task.',
          2: 'TWO OR MORE distinct tasks or supports — an easier set, an extension for finishers, targeted help to a named group. Quote the instruction that differentiates.',
        },
        notCounted: 'Repeating an instruction louder, slower, or in Urdu is not differentiation. Walking around helping individuals is not a distinct task. \'Tez bachche aage karo\' with no different task attached is rung 1.',
      },
      {
        id: 'B7',
        name: 'Lesson Closure & Consolidation',
        count: 'closure moves that CHECK learning rather than announce the end',
        levels: {
          0: 'The lesson ends with no recap of any kind.',
          1: 'The teacher delivers a recap herself; students are not asked to produce anything.',
          2: 'The closure CHECKS learning — students answer a closing question or summarise in their own words. Quote a student.',
        },
        notCounted: 'The bell, \'kal milte hain\', assigning homework, or \'samajh aa gaya?\' with a choral yes is NOT closure. A teacher-delivered summary is rung 1 no matter how thorough.',
      },
    ],
  },
  high_leverage_practices: {
    key: 'C',
    displayName: 'High-Leverage Practices',
    displayName_ur: 'High-Leverage Practices (مؤثر تدریسی طریقے)',
    indicatorCount: 4,
    indicators: [
      {
        id: 'C1',
        name: 'Quality Questioning (Bloom\'s Aligned)',
        count: 'open-ended questions asked, and follow-ups on a student\'s own answer',
        levels: {
          0: 'No open-ended question is asked. Every question is yes/no, one-word, or a number read off the board.',
          1: 'ONE OR TWO open-ended questions, with no follow-up on what any student said.',
          2: 'THREE OR MORE open-ended questions AND at least one follow-up that refers to what a student just said. Quote each open question and the follow-up.',
        },
        notCounted: 'A question with its answer embedded (\'yeh teen hai na?\'), a yes/no, a one-word recall, a rhetorical question, and a choral prompt are NOT open-ended. Repeating the same question louder is not a follow-up. Asking a NEW question after an answer is not a follow-up — a follow-up must refer to what the student actually said.',
      },
      {
        id: 'C2',
        name: 'Responsive Re-explanation & Adaptive Teaching',
        count: 'genuinely DIFFERENT re-explanations after a student does not understand',
        levels: {
          0: 'When students do not understand, the teacher repeats the same explanation, or moves on.',
          1: 'The teacher tries again in different words, but the second attempt uses the same representation as the first.',
          2: 'At least one re-explanation uses a DIFFERENT representation — a drawing, an object, an analogy, a worked example, a story. Quote the first attempt and the different one.',
        },
        notCounted: 'Saying the same sentence louder, slower, or translated into Urdu is not a different representation. Giving the answer is not a re-explanation. This indicator scores 0 if no student ever signals confusion — do not credit a re-explanation that never had to happen.',
      },
      {
        id: 'C3',
        name: 'Effective Feedback',
        count: 'specific feedback moves, and how many say what to do next',
        levels: {
          0: 'No feedback, or only bare evaluation — \'shabash\', \'good\', \'galat\', or repeating the right answer.',
          1: 'ONE OR TWO pieces of feedback that name what was right or wrong, but none say what to do next.',
          2: 'THREE OR MORE specific feedback moves AND at least one tells the student what to do next. Quote them.',
        },
        notCounted: '\'Shabash\', \'very good\', \'galat\', \'phir se karo\', a tick, or restating the correct answer are NOT specific feedback. Praise of the child (\'achhi bachi\') is never feedback. Feedback must name something about THIS piece of work.',
      },
      {
        id: 'C4',
        name: 'Student Agency & Voice',
        count: 'moments a student chooses a method, or reasons at length unprompted',
        levels: {
          0: 'Students only answer closed questions; no choice and no extended reasoning anywhere.',
          1: 'Students answer at length, but every contribution is a response to a direct teacher question — no choices are offered.',
          2: 'At least one moment where a student CHOOSES how to solve, answer, or present, OR explains their reasoning in a full sentence without being asked to. Quote it.',
        },
        notCounted: 'Answering a question, however long the answer, is not agency. Being picked to come to the board is not a choice. A student repeating the teacher\'s method is not choosing a method.',
      },
    ],
  },
  student_engagement: {
    key: 'D',
    displayName: 'Student Engagement',
    displayName_ur: 'Student Engagement (طلبہ کی شمولیت)',
    indicatorCount: 5,
    indicators: [
      {
        id: 'D1',
        name: 'Diversity of Conceptual Expression',
        count: 'distinct student phrasings of the concept, and any not borrowed from the teacher',
        levels: {
          0: 'No student responses about the concept appear in the transcript at all.',
          1: 'All student responses copy the teacher\'s wording closely, or students give only very short answers — one word, a number, or a chorus.',
          2: 'Students phrase the concept in TWO OR MORE different ways. Quote each phrasing.',
        },
        notCounted: 'A chorus repetition counts as one response, not many. Two students saying the same sentence is one phrasing, not two. Reading aloud from the book is not the student\'s phrasing.',
      },
      {
        id: 'D2',
        name: 'Student Reasoning in Responses',
        count: 'student utterances containing a reason, and whether each was prompted',
        levels: {
          0: 'The teacher never asks for reasoning and no student reasoning appears anywhere.',
          1: 'The teacher asks for reasoning at least once, but no student response actually contains a reason.',
          2: 'At least ONE student response contains an explanation or reason. Quote it, and say whether the teacher had to ask.',
        },
        notCounted: '\'Because\' inside a repeated sentence from the book is not the student\'s reasoning. A one-word answer following \'why?\' is not a reason. The teacher supplying the reason and the student agreeing does not count.',
      },
      {
        id: 'D3',
        name: 'Student-Initiated Questions',
        count: 'questions asked BY students, split into procedural and content',
        levels: {
          0: 'No student questions of any kind appear in the transcript.',
          1: 'Students ask only procedural questions (\'kaunsa page?\', \'likhna hai?\') — no content questions at all.',
          2: 'At least ONE student asks a question about the concept itself. Quote it.',
        },
        notCounted: '\'Miss?\' or calling for attention is not a question. Repeating the teacher\'s question back is not a student question. Asking what page, whether to write, or if they may leave is procedural.',
      },
      {
        id: 'D4',
        name: 'Spontaneous Transfer & Connection-Making',
        count: 'student connections to something outside the lesson, and whether prompted',
        levels: {
          0: 'No connection-making activity of any kind appears in the lesson.',
          1: 'The teacher invites students to make a connection, but no student does.',
          2: 'At least ONE student makes a connection to something outside the lesson. Quote it, and say whether the teacher prompted it.',
        },
        notCounted: 'The teacher making the connection does not count, however good it is. A student naming an object the teacher just named is not a connection.',
      },
      {
        id: 'D5',
        name: 'Visible Learning Progression Across the Lesson',
        count: 'student responses in the first third vs the last third — length and key vocabulary',
        levels: {
          0: 'Fewer than THREE student responses in total — not enough to compare the start and the end.',
          1: 'Student responses look about the same at the end as at the start: no change in length or vocabulary.',
          2: 'By the end, student responses are longer or use the concept\'s key vocabulary more than at the start. Quote one early response and one late response.',
        },
        notCounted: 'A single long answer at the end does not establish progression — compare the general pattern. Louder or more confident chorus is not progression. If the transcript has no usable ordering, score 0 rather than guessing.',
      },
    ],
  },
  teacher_subject_knowledge: {
    key: 'F',
    displayName: 'Teacher Subject Knowledge',
    displayName_ur: 'Teacher Subject Knowledge (استاد کا مضمون سے متعلق علم)',
    indicatorCount: 10,
    indicators: [
      {
        id: 'F1',
        name: 'Content Accuracy',
        count: 'uncorrected factual errors, and explanations of WHY',
        levels: {
          0: 'One or more factual errors go uncorrected. Name the error.',
          1: 'Content is accurate but purely procedural — the teacher says what to do and never why it works.',
          2: 'Content is accurate AND the teacher explains WHY at least once. Quote the explanation.',
        },
        notCounted: 'Do not credit accuracy you cannot verify. If the content is outside what you can check, score what you can hear and say so in the evidence — never invent an error, and never award rung 2 for the absence of errors alone.',
      },
      {
        id: 'F2',
        name: 'Use of Academic Language',
        count: 'key subject terms used, and how many are explained',
        levels: {
          0: 'No subject-specific term is used; the lesson is entirely in general language.',
          1: 'Subject terms are used but never explained.',
          2: 'TWO OR MORE key terms are used AND explained, or students are heard using them correctly. Name the terms.',
        },
        notCounted: 'An English word inside an Urdu sentence is code-switching, not academic language, unless it is a subject term. Reading a term aloud from the book is not using it. Translating a term is not explaining it.',
      },
      {
        id: 'F3',
        name: 'Anticipation of Student Misconceptions',
        count: 'misconceptions NAMED as a wrong idea students hold',
        levels: {
          0: 'No wrong idea is surfaced or addressed anywhere.',
          1: 'A wrong answer is corrected, but the underlying misconception is never named.',
          2: 'At least ONE common misconception is NAMED as a wrong idea students hold (\'bahut bachche samajhte hain ke…, lekin…\') and then addressed. Quote it.',
        },
        notCounted: 'Marking an answer wrong is not addressing a misconception. Saying \'galat, sahi jawab yeh hai\' is a correction, not a named misconception. The misconception must be stated as a belief, not just an error.',
      },
      {
        id: 'F4',
        name: 'Mathematical Discourse & Reasoning',
        subject: 'maths',
        count: 'reasoning questions asked, and student explanations that follow',
        levels: {
          0: 'Entirely answer-focused (\'jawab kya hai?\') with no how or why, and no student explanation at any point.',
          1: 'Reasoning questions are asked but one-word or answer-only responses are accepted without pressing further.',
          2: 'Reasoning questions are asked AND the teacher presses for reasoning rather than accepting an answer alone. Quote the press.',
        },
        notCounted: '\'Kaise kiya?\' answered by re-reading the procedure is not reasoning. Accepting the first correct number and moving on is rung 1 even if the question was well phrased.',
      },
      {
        id: 'F5',
        name: 'Problem-Solving & Productive Struggle',
        subject: 'maths',
        count: 'non-routine problems presented, and the think time allowed before the teacher intervenes',
        levels: {
          0: 'Only routine procedural practice; the teacher provides solutions immediately; no think time.',
          1: 'A challenging problem is presented but the teacher jumps in quickly and removes the challenge.',
          2: 'A genuinely challenging or multi-step problem is presented AND students are given time to work on it before the answer arrives. Quote the problem.',
        },
        notCounted: 'A longer sum of the same type is not a non-routine problem. Silence while students copy is not think time. If the transcript gives no usable sense of elapsed time, judge by whether the teacher gave the answer in her very next turn.',
      },
      {
        id: 'F6',
        name: 'Inquiry-Based Approach',
        subject: 'science',
        count: 'new concepts opened with a question or scenario BEFORE the explanation',
        levels: {
          0: 'The teacher starts directly with a definition or explanation; no space for student thinking at any point.',
          1: 'An inquiry opening is attempted but the answer is given too quickly, or the lesson reverts to pure transmission.',
          2: 'At least ONE concept is opened with a question, picture, or scenario, and students are given genuine space to respond before the explanation. Quote the opening and a student response.',
        },
        notCounted: 'A rhetorical question followed immediately by the answer is not inquiry. \'Kya tum jante ho?\' answered by the teacher in the same breath is rung 1.',
      },
      {
        id: 'F7',
        name: 'Science Talk & Student Sense-Making',
        subject: 'science',
        count: 'student responses expressing an idea in their OWN words',
        levels: {
          0: 'All student responses are one-word, chorus, or direct repetition of the teacher; no student expresses an idea in their own words.',
          1: 'Some sentence-level responses, but most are one-word or chorus, or students mostly repeat the teacher\'s exact wording.',
          2: 'At least ONE student expresses a science idea in their own words rather than repeating a phrase. Quote it.',
        },
        notCounted: 'Reading from the textbook is not the student\'s own words. A chorus answer is never sense-making, however long.',
      },
      {
        id: 'F8',
        name: 'Explicit Phonics / Decoding',
        subject: 'literacy',
        count: 'phonics stages present, in order, with audible student practice',
        levels: {
          0: 'Phonics is skipped entirely; no sound-level instruction at any point.',
          1: 'Some phonics happens but the sequence is incomplete or rushed — one or more stages are skipped.',
          2: 'Phonics follows most of the sequence — sound, then blending, then segmenting — explicitly taught and modelled, with students audibly practising. Name the stages you heard.',
        },
        notCounted: 'Reading words aloud is not phonics. Naming letters (alif, bay) without their sounds is not phonics. The teacher demonstrating with no student response is rung 1.',
      },
      {
        id: 'F9',
        name: 'Comprehension Strategy Instruction',
        subject: 'literacy',
        count: 'of the three steps — naming the strategy, modelling it, students practising it — how many are present',
        levels: {
          0: 'No strategy instruction at any point; comprehension questions may be asked, but HOW to comprehend is never taught.',
          1: 'The strategy is named or modelled but students never practise it, OR students practise with the strategy never named.',
          2: 'At least TWO of the three steps are present — named, modelled, practised. Say which two, and quote them.',
        },
        notCounted: 'Asking \'kya hua?\' is a comprehension question, not strategy instruction. The strategy must be named as a thing you do (\'is ko prediction kehte hain\'), not merely performed.',
      },
      {
        id: 'F10',
        name: 'Reading-Writing Connections',
        subject: 'literacy',
        count: 'explicit links made between what was read and what students write',
        levels: {
          0: 'Reading and writing are completely separate, or only one of the two happens at all.',
          1: 'Both reading and writing happen but the link is never made explicit — \'we read, now write\'.',
          2: 'At least ONE explicit link is made between the reading and the writing — the text used as a model or prompt. Quote the bridge.',
        },
        notCounted: 'Copying sentences from the text is not a reading-writing connection. Answering questions about a text in writing is not a connection unless the text is used as a model for the writing.',
      },
    ],
  },
};

const TOTAL_INDICATORS = 26;  // FICO v4: B7 + C4 + D5 + F10
const SCALE_MAX = 2;          // three rungs: 0 not observed, 1 developing, 2 proficient
// The DEFINED ceiling. The denominator a teacher is actually scored against is computed per
// session by computeScores() from the applicable indicators — see the header.
const MAX_MARKS = TOTAL_INDICATORS * SCALE_MAX;

// The rung names, owned here. Anything that shows a score to a human — the /observe review form,
// the report adapter — reads these rather than keeping its own copy. A second copy of the scale is
// exactly how the HITL form came to show a Proficient 2 as "2 · Developing" (Rifat, 3 Sep).
const RUNG_LABELS = { 0: 'Not observed', 1: 'Developing', 2: 'Proficient' };

// ─── Cached system prompt ────────────────────────────────────────────

let _cachedSystemPrompt = null;

function renderIndicatorRubric(ind) {
  const levels = ind.levels;
  const subjectTag = ind.subject ? `   ⟵ ${ind.subject.toUpperCase()} lessons only` : '';
  return `${ind.id} **${ind.name}**${subjectTag}
   COUNT: ${ind.count}
   - 0: ${levels[0]}
   - 1: ${levels[1]}
   - 2: ${levels[2]}
   DOES NOT COUNT: ${ind.notCounted}`;
}

function getSystemPrompt() {
  if (_cachedSystemPrompt) return _cachedSystemPrompt;

  const sectionBlocks = Object.values(DOMAINS).map(section => {
    const header = `**SECTION ${section.key}: ${section.displayName.toUpperCase()}** (${section.indicatorCount} indicators, max ${section.indicatorCount * SCALE_MAX})`;
    const body = section.indicators.map(renderIndicatorRubric).join('\n\n');
    return `${header}\n\n${body}`;
  }).join('\n\n');

  _cachedSystemPrompt = `You are an expert classroom observer analysing a primary lesson in a Pakistani government school, using the FICO Fidelity & Impact Classroom Observation Tool (the ICT canonical rubric).
Urdu, English and code-switching between them are all normal — never treat a code-switch as an error.

OBSERVATION FRAMEWORK: FICO V4 — 4 sections (B, C, D, F), ${TOTAL_INDICATORS} indicators, scale 0-2.
(Section E — Student Assessment — is intentionally out of scope: it is one-on-one ASER/EGRA
reading & numeracy testing, not observable from a classroom recording.)

**THE SCALE — three rungs, and you read the rung off a COUNT:**
- 0 = Not observed. The behaviour is absent from the transcript.
- 1 = Developing. The behaviour appears but does not reach the rung-2 count.
- 2 = Proficient. The rung-2 count is met AND you can quote every instance.

**HOW TO SCORE — this is the whole method:**
1. For each indicator, first TALLY the unit named on its COUNT line, and quote each instance.
2. Then read the rung off the count using the 0/1/2 lines, and apply the DOES NOT COUNT line
   before you finish counting. Do not judge a proportion; do not average an impression.
   If your count and your instinct disagree, THE COUNT WINS.
3. No quote, no count. If you cannot quote the line that contains an instance, it did not happen.
4. If the behaviour is absent, score 0. NEVER infer that a move "probably happened".
5. A closed or compliance check — "samajh aa gayi?", "theek hai?", a choral "yes" — is not
   evidence of anything. It never counts toward any indicator.
6. Rung 2 is meant to be REACHABLE by a good teacher in a real government primary classroom.
   It is not a description of an ideal lesson. Award it whenever the count is met.

**TWO DEFINITIONS USED BY SEVERAL INDICATORS. Apply them exactly.**
- IN THE STUDENT'S OWN WORDS (D1, D2, D5, F7): the student's phrasing differs from the teacher's
  and from the textbook's. Repeating the teacher's sentence, a chorus answer, and reading aloud
  from the book are NEVER the student's own words, however long or correct.
- PROMPTED vs UNPROMPTED (D2, D4): a response is prompted when the teacher's immediately preceding
  turn asked for exactly that thing ("kyun?", "where else have you seen this?"). Anything the
  student volunteers without that ask is unprompted. When you cannot tell, call it prompted.

${sectionBlocks}

**SUBJECT-GATED INDICATORS — F4 to F10.**
F4/F5 = MATHEMATICS. F6/F7 = SCIENCE. F8/F9/F10 = LITERACY/LANGUAGE. B, C, D and F1-F3 apply to
every lesson. For a subject-tagged indicator whose subject does not match this lesson, emit
"applicable": false with "score": null and evidence "Not applicable — lesson subject is <subject>".
DO NOT score it 0: a non-applicable indicator LEAVES THE TOTAL ENTIRELY, it is not a low mark.
Every other indicator carries "applicable": true. If you cannot tell the subject, mark ALL SEVEN
subject-tagged indicators non-applicable rather than guessing.

**TOTAL: 2 marks per APPLICABLE indicator.** Do not compute a percentage yourself.

SPECIAL INSTRUCTIONS:
- For B1 (Instructional Clarity & Learning Objectives): if a lesson plan is linked, compare the
  observed execution against the specific LP objectives and steps.
- Provide SPECIFIC transcript evidence (a real quote) for every indicator, including a 0.
- Reference timestamps when quoting dialogue, if the transcript carries them.`;

  return _cachedSystemPrompt;
}

// ─── Focus-area language directive ───────────────────────────────────

// FICO teachers are English/Urdu (NIETE / ICT). MEWAKA emits its focus_area
// hardcoded in Swahili because its entire prompt is Swahili; FICO's prompt is
// English, so the focus_area strings must be steered into the teacher's
// REGISTERED language explicitly. This mirrors the report-v2 narrative
// service's langRules(): Urdu → Nastaliq, gender-neutral, code-switch
// pedagogical terms in English, RTL. Never hardcode a language.
const LANG_NAME = { en: 'English', ur: 'Urdu' };

function focusAreaLangDirective(language) {
  if (language === 'ur') {
    return `FOCUS-AREA LANGUAGE — write the four focus_area strings (title, rationale, try_this_tomorrow, lever_question) in URDU (Nastaliq), warm and natural. Text is right-to-left. Use gender-neutral phrasing (verbal nouns / impersonal constructions), never gendered second-person verb forms. Keep pedagogical/technical terms in ENGLISH (Latin letters) inline (e.g. open-ended questions, scaffolding, phonics, Bloom's). Keep "domain" and "indicator" as the EXACT English keys/ids listed above — do NOT translate them.`;
  }
  const name = LANG_NAME[language] || 'English';
  return `FOCUS-AREA LANGUAGE — write the four focus_area strings (title, rationale, try_this_tomorrow, lever_question) in ${name}. Keep "domain" and "indicator" as the EXACT English keys/ids listed above — do NOT translate them.`;
}

// ─── Analysis prompt builder ─────────────────────────────────────────

function buildIndicatorJsonRow(ind) {
  // bd-2369: `evidence_summary` is the ≤500-char gist the human observer sees on
  // the editable Flow form (Meta caps a TextArea at 600). `evidence` stays FULL
  // and flows to the teacher's report unchanged. One LLM pass emits both — no
  // extra call. Keep them consistent: the summary is a faithful compression of
  // the same moment, never a different judgement.
  return `        { "id": "${ind.id}", "name": "${ind.name.replace(/"/g, '\\"')}", "score": <0-2, or null if not applicable>, "applicable": <true|false>, "evidence": "Detailed description + Quote: \\\"...\\\"", "evidence_summary": "<= 500 chars: the move + its effect on students + one short quote — the gist a reviewer needs to sanity-check the score", "timestamp": "exact time" }`;
}

// ─── Feedback-uptake loop: the PRIOR ACTION block ─────────────────────
//
// The teacher's previous action record (metadata.priorAction, attached by the
// analysis processor only when the loop is enabled) rides inside THIS scoring
// call — zero extra LLM calls — and asks for a TALLY of the target indicator's
// COUNT unit, quoted. The verdict is computed in code from that tally; the
// model never judges uptake, and the block must never move a score.

function describeTally(obj) {
  if (!obj || typeof obj !== 'object') return 'not recorded';
  const parts = Object.entries(obj)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${String(k).replace(/_/g, ' ')}: ${v}`);
  return parts.length ? parts.join(', ') : 'not recorded';
}

function priorTallyKeys(prior) {
  const bar = prior && prior.action_spec && prior.action_spec.count_target;
  if (!bar || typeof bar !== 'object') return [];
  return Object.keys(bar).filter((k) => /^[a-z][a-z0-9_]*$/.test(k));
}

function buildPriorActionBlock(prior) {
  if (!prior || !prior.target || !prior.target.indicator) return '';
  const keys = priorTallyKeys(prior);
  if (!keys.length) return '';
  const id = String(prior.target.indicator);
  const name = String(prior.target.name || id).replace(/"/g, '\\"');
  const date = String(prior.created_at || '').slice(0, 10);
  const asked = String(prior.action || '').replace(/\s+/g, ' ').trim();
  const baseline = prior.baseline || {};
  const rung = baseline.rung !== null && baseline.rung !== undefined ? ` (rung ${baseline.rung})` : '';
  return `
PRIOR ACTION (this teacher's previous lesson${date ? `, ${date}` : ''}) — target ${id} "${name}".
The teacher was asked: "${asked}". The bar the rubric sets for ${id} at rung 2: ${describeTally(prior.action_spec.count_target)}. Last lesson's tally: ${describeTally(baseline.count)}${rung}.
For the "uptake" field below, tally from THIS transcript ONLY: count each unit for ${id} exactly as its COUNT line defines it, apply its DOES NOT COUNT line, and quote every counted moment in "evidence". This is a count, not a judgement of effort. Do NOT let the prior action change any indicator score — score every indicator exactly as you would without this block.
`;
}

function buildUptakeSchema(prior) {
  if (!buildPriorActionBlock(prior)) return '';
  const keys = priorTallyKeys(prior).map((k) => `"${k}": <integer>`).join(', ');
  return `,
  "uptake": { "count": { ${keys} }, "evidence": "<quote each counted moment, in order>", "moment": "<where in the lesson the first counted moment happened, a short phrase, or empty>" }`;
}

function buildAnalysisPrompt(transcript, metadata, lessonPlanStructured, photoAnalysis) {
  const {
    grade,
    subject,
    duration,
    language,
    teacherFirstName,
    priorFeedback,
    priorAction
  } = metadata || {};

  const priorActionBlock = buildPriorActionBlock(priorAction);
  const uptakeSchema = buildUptakeSchema(priorAction);

  const lpFidelityNote = lessonPlanStructured
    ? `\nIMPORTANT - LP Fidelity: A lesson plan is linked. For Section B (especially B1, B2, B3), compare the planned LP objectives + steps against what was observed in the transcript.\n`
    : '';

  const photoNote = photoAnalysis
    ? `\nCLASSROOM PHOTOS: Visual evidence is available. Use it as supplementary context, but score primarily from audio-detectable signals (this rubric is audio-scoreable by design).\n`
    : '';

  const sectionJsonBlocks = Object.entries(DOMAINS).map(([sectionKey, section]) => {
    const indicatorRows = section.indicators.map(buildIndicatorJsonRow).join(',\n');
    return `    "${sectionKey}": {
      "indicators": [
${indicatorRows}
      ],
      "domain_score": <sum>,
      "domain_max": ${section.indicatorCount * SCALE_MAX}
    }`;
  }).join(',\n');

  return `Analyze this classroom transcript using the FICO ICT rubric.

LESSON CONTEXT:
${teacherFirstName ? `- Teacher's First Name: ${teacherFirstName}` : ''}
${grade ? `- Grade: ${grade}` : ''}
${subject ? `- Subject: ${subject}` : ''}
${duration ? `- Duration: ${Math.round(duration / 60)} minutes` : ''}
${language ? `- Primary Language: ${language}` : ''}

${priorFeedback ? `PRIOR FEEDBACK:\n${priorFeedback}\n` : ''}${priorActionBlock}
${lpFidelityNote}${photoNote}
CLASSROOM TRANSCRIPT:
${transcript}

TASK: Score all ${TOTAL_INDICATORS} FICO indicators (1-4 scale) with evidence. Return STRICT JSON:

{
  "executive_summary": "2-3 sentences. Use ${teacherFirstName || 'the teacher'}'s FIRST NAME. Highlight strongest section and key growth area.",
  "domains": {
${sectionJsonBlocks}
  },
  "strengths": [
    { "title": "Strength", "evidence": "Specific evidence + Quote: \\"...\\"", "impact": "Learning impact" }
  ],
  "growth_opportunities": [
    { "area": "Area", "observation": "What was observed", "strategies": ["Strategy 1", "Strategy 2"] }
  ],
  "focus_area": {
    "domain": "<ONE of: lesson_plan_fidelity | high_leverage_practices | student_engagement | teacher_subject_knowledge>",
    "indicator": "<the single indicator id to focus on next>",
    "title": "<short headline, 3-6 words>",
    "rationale": "<1-2 sentences: why this ONE indicator is the highest-leverage next focus for this teacher>",
    "try_this_tomorrow": "<one concrete classroom move the teacher can try in their very next lesson>",
    "lever_question": "<ONE short, plain, open question the OBSERVER asks the TEACHER about her OWN lesson — inviting her to reflect on a real moment in this lesson (e.g. 'When you saw…', 'What made you…', 'When the pupils were asked…'). NOT a question about how to design questions, NOT pedagogy jargon, NOT a task. Max 15 words.>"
  },
  "recommendations": ["Actionable recommendation 1", "Actionable recommendation 2", "Actionable recommendation 3"]${uptakeSchema}
}

FOCUS AREA — pick the SINGLE most useful growth area (one domain + one indicator) as the teacher's lead next-step. Choose it from the indicators you scored LOWEST in this lesson, and among those prefer the one whose evidence you can quote most concretely. Never pick a non-applicable indicator. Its "domain" MUST be one of the four section keys above and "indicator" MUST be one of that section's indicator ids.
${focusAreaLangDirective(language)}

EVIDENCE RULES:
- For EACH indicator, describe what the teacher DID (not what they didn't do)
- Include English translation of dialogue: Quote: "..."
- Even for score 1, provide detailed evidence of what was observed
- For non-applicable Section F rows (subject mismatch), score 1 with evidence noting the mismatch
- For EACH indicator ALSO write "evidence_summary": a self-contained ≤500-character
  compression of that indicator's "evidence" — the move, its effect on students, and one
  short quote. It is the ONLY note the human observer reads on the review form, so it must
  stand alone and justify the score. Do NOT write "see full note" or truncate mid-sentence;
  compress. It must never contradict the full "evidence".`;
}

// ─── Score computation ───────────────────────────────────────────────

// An indicator the lesson could not exercise leaves BOTH sides of the fraction.
// Before this, a maths-pedagogy row in an Urdu lesson was scored at the bottom rung and kept in a
// fixed denominator, so every teacher lost marks she could not earn. `applicable === false` is the
// ONLY thing that removes a row; an ABSENT flag means applicable, so every pre-cutover session
// scores exactly as it did before.
function isApplicable(indicator) {
  return !(indicator && indicator.applicable === false);
}

function computeScores(analysis) {
  const domainKeys = Object.keys(DOMAINS);
  let overallMarks = 0;
  let overallMax = 0;
  let applicableCount = 0;
  let notApplicableCount = 0;

  for (const domainKey of domainKeys) {
    if (analysis.domains && analysis.domains[domainKey]) {
      const domain = analysis.domains[domainKey];
      let domainScore = 0;
      let domainMax = 0;

      if (domain.indicators) {
        for (const indicator of domain.indicators) {
          if (!isApplicable(indicator)) { notApplicableCount += 1; continue; }
          domainScore += indicator.score || 0;
          domainMax += SCALE_MAX;
          applicableCount += 1;
        }
      }

      domain.domain_score = domainScore;
      // Fall back to the declared size only when the domain emitted no scorable rows at all,
      // so an empty domain still reports a sane max rather than 0.
      domain.domain_max = domainMax || DOMAINS[domainKey].indicatorCount * SCALE_MAX;
      domain.indicators_applicable = domainMax / SCALE_MAX;
      overallMarks += domainScore;
      overallMax += domainMax;
    }
  }

  const maxMarks = overallMax || MAX_MARKS;
  analysis.scores = {
    overall_marks: overallMarks,
    overall_max_marks: maxMarks,
    overall_percentage: parseFloat(((overallMarks / maxMarks) * 100).toFixed(1)),
    indicators_applicable: applicableCount,
    indicators_not_applicable: notApplicableCount,
  };

  return analysis;
}

// ─── Section B from measured LP fidelity (P4.1 / bd-wmfsp.9, D27) ────
//
// When a lesson plan is linked and the executed÷prescribed fidelity engine produced a
// USABLE score, Section B (Lesson Plan Fidelity) is DERIVED from that measurement —
// fidelity_pct scaled onto Section B's /40 — instead of the 10 legacy B indicators.
// The overall /104 is recomputed so the total reflects the measured Section B.
//
// The 10 legacy B indicators are still emitted by the LLM: fidelity runs CONCURRENTLY
// with the pedagogy pass and may fail (garbled recording → fidelity_pct null), in which
// case the legacy indicator-summed Section B (the proxy) must be able to stand. So we
// override at merge time, never by stripping B from the prompt. No-LP and unusable
// recordings keep the proxy untouched.
const SECTION_B_KEY = 'lesson_plan_fidelity';

function applyLpFidelity(analysis, lpFidelity) {
  if (!analysis || !analysis.domains) return analysis;
  if (!lpFidelity || lpFidelity.status !== 'ok') return analysis;

  const pct = Number(lpFidelity.fidelity_pct);
  if (lpFidelity.fidelity_pct == null || Number.isNaN(pct)) return analysis; // unusable → proxy stands

  const sectionB = analysis.domains[SECTION_B_KEY];
  if (!sectionB) return analysis; // not a FICO analysis / no Section B — no-op

  // Use the max computeScores already derived for Section B (applicable-aware), not the declared
  // size. Hardcoding it here is what produced the denominator bug in a sibling framework: the
  // pedagogy pass reported against the applicable total while this path reported against a
  // constant, and the two percentages silently disagreed.
  const maxB = sectionB.domain_max || DOMAINS[SECTION_B_KEY].indicatorCount * SCALE_MAX;
  sectionB.domain_score = Math.round((pct / 100) * maxB);
  sectionB.domain_max = maxB;
  sectionB.fidelity_derived = true;
  sectionB.fidelity_pct = pct;
  if (lpFidelity.band) sectionB.fidelity_band = lpFidelity.band;

  // Recompute overall from the (now fidelity-derived) domain_scores. C/D/F are unchanged.
  let overallMarks = 0;
  for (const key of Object.keys(DOMAINS)) {
    const d = analysis.domains[key];
    if (d && typeof d.domain_score === 'number') overallMarks += d.domain_score;
  }
  // Keep the denominator computeScores derived from the applicable indicators. Section B's own
  // max is unchanged by the override — only its score is — so the overall max is untouched.
  const maxMarks = (analysis.scores && analysis.scores.overall_max_marks) || MAX_MARKS;
  analysis.scores = {
    ...(analysis.scores || {}),
    overall_marks: overallMarks,
    overall_max_marks: maxMarks,
    overall_percentage: parseFloat(((overallMarks / maxMarks) * 100).toFixed(1)),
  };
  return analysis;
}

// ─── Performance bands (per sheet's Interpretation Guide) ────────────

function getPerformanceBand(percentage) {
  if (percentage >= 85) return 'excellent';    // Highly Effective
  if (percentage >= 70) return 'proficient';   // Effective
  if (percentage >= 50) return 'developing';   // Emerging / Developing
  return 'emerging';                            // Needs Support
}

// ─── Scoring constants accessor ──────────────────────────────────────

function getScoringConstants() {
  return {
    domains: DOMAINS,
    maxMarks: MAX_MARKS,
    scaleMax: SCALE_MAX,
    totalIndicators: TOTAL_INDICATORS,
    rungLabels: RUNG_LABELS,
  };
}

// ─── Module exports (standard framework interface) ───────────────────

module.exports = {
  name: 'fico',
  version: '3.0', // FICO V3 (37 ind, B/C/D/F) — adopted from canonical Coaching Framework sheet 2026-07-29
  displayName: 'FICO Framework',
  maxMarks: MAX_MARKS,
  hasDebrief: false,
  hasLPBonus: false,

  getSystemPrompt,
  buildAnalysisPrompt,
  buildPriorActionBlock,
  computeScores,
  applyLpFidelity,
  getPerformanceBand,
  getScoringConstants,
  RUNG_LABELS,
};
