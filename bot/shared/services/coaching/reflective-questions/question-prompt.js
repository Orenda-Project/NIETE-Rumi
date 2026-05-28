/**
 * Per-question prompt builder for the v12 reflective chain.
 *
 * Unlike the v11 one-call prompt (all 3 questions at once), the production design is a
 * CONVERSATIONAL CHAIN: Q1 from the corpus, then Q2/Q3 built from the corpus AND the teacher's
 * actual prior answers. This builder produces the system prompt for ONE question at a time.
 *
 * The three beats (from the v6→v11 design):
 *   Q1 — MARKED NOTICING: the single most significant moment, teacher placed back in it.
 *   Q2 — LEARNER REASONING: a DIFFERENT moment where a learner's answer revealed their thinking.
 *   Q3 — FORWARD COMMITMENT: completes the lesson_throughline; what she'll notice/ask herself
 *        BEFORE responding next time that exact kind of moment arises. NOT the generic chorus-yes.
 *
 * Language is principle-driven (language-profiles.js): the body is language-agnostic; the profile
 * supplies thin per-language data + optional sharpening hints.
 */

const Q_BEATS = {
  1: `THIS IS QUESTION 1 — MARKED NOTICING.
Take the MOST significant moment in the corpus (individual OR collective). Remind {firstName} WHEN it happened (use its approx_time_phrase) and describe what happened in DETAIL so she is placed back in the moment — quote the actual words, name the child ONLY if named_student is set, the small specifics. Then ask an open question about what was happening in/for her then. ~50-70 words.`,
  2: `THIS IS QUESTION 2 — LEARNER REASONING (the sharp kind).
Pick a DIFFERENT moment than Q1 — one where a learner's answer REVEALED how they were thinking (a wrong, partial, or surprising answer; a struggle). Quote their ACTUAL words. Then ask {firstName} to reconstruct that child's reasoning: what was going on in their head, or WHY they thought that. Do NOT ask a generic "what did the child feel" — ask what they were THINKING and why. If the revealing moment was COLLECTIVE, ask about the class's shared thinking. ~50-70 words.
ADAPT TO HER ANSWER: read the teacher's actual answer to Q1 in CONVERSATION SO FAR and build on what she said — pick up her words; do not ignore them or repeat Q1.`,
  3: `THIS IS QUESTION 3 — FORWARD COMMITMENT (completes the through-line).
Q1 surfaced a moment; Q2 went into a child's reasoning. Q3 names the SPECIFIC kind of moment THIS lesson kept producing — the lesson_throughline — and asks {firstName}: next time she is ABOUT to face that exact kind of moment, what is the first thing she wants to notice or ask herself BEFORE she responds. It must feel like the natural culmination of Q1+Q2 — unique to THIS lesson, not a generic classroom habit. ~40-60 words.
ADAPT: read her answers so far in CONVERSATION SO FAR and let Q3 follow from the thread she has been pulling.

═══ Q3 — DO NOT REPEAT THE SAME THING EVERY LESSON ═══
The class chorusing 'yes'/'ndiyo'/'yes sir' is the MOST COMMON signal in every Pakistani and Tanzanian classroom. DO NOT default Q3 to it — if you do, every teacher gets the same Q3 forever and it means nothing. Anchor Q3 on the lesson_throughline (a content misconception, the way she handles wrong answers, a missed bid, a particular kind of student reasoning). Use chorus-yes ONLY if it is genuinely the single defining pattern AND Q1/Q2 didn't already cover something richer.`,
};

/**
 * @param {number} questionNumber  1 | 2 | 3
 * @param {object} corpus  { lesson_throughline_en, significant_moments[], collective_moments[], ... }
 * @param {{language:string, script:string, region:string, avoid_hint?:string, gender_hint?:string}} profile
 * @param {string} firstName  bare first name, NO honorific
 * @returns {string} system prompt
 */
function buildQuestionPrompt(questionNumber, corpus, profile, firstName = '') {
  const { language, script, region, avoid_hint = '', gender_hint = '' } = profile;
  const beat = (Q_BEATS[questionNumber] || Q_BEATS[1]).replace(/\{firstName\}/g, firstName || 'the teacher');

  // This question is read aloud by a text-to-speech voice. For a non-Latin-script
  // language (e.g. Urdu Nastaliq) two things break the voice and MUST be enforced in-prompt:
  //   1. Roman/Latin transliteration of the language → the voice applies the language's phonology
  //      to English words (jam→jumm, main→meinn). Write the language ENTIRELY in its own script.
  //   2. Bare inline digits ("43", "8") → the voice renders them as gibberish ("alaran"). Spell
  //      every number as a word. (Hard-won voicenote lessons.)
  const ttsBlock = (script && script !== 'Latin') ? `
- SCRIPT PURITY (this is read aloud — critical): write the ${language} text ENTIRELY in ${script}. Do NOT transliterate ${language} words into Roman/Latin letters — it breaks the voice. ONLY genuine English terms stay in Latin (see next rule).
- NUMBERS AS WORDS: never write a bare digit (43, 8, 5) inline — the voice reads bare digits as gibberish. Spell every number as a word in ${language} (or as the English number word if it sits inside an English phrase). e.g. a "43 + 29" problem becomes the spelled-out ${language} form, not the digits.` : '';

  return `You are a ${language}-speaking master-teacher coach writing ONE reflective question for the teacher ${firstName || ''}. You have a corpus extracted from her lesson (a through-line + significant/collective moments). Write the question in ${language} (${script}) with a faithful English translation.

Output ONLY valid JSON: { "question": "<${language}>", "question_en": "<English translation>" }

${beat}

═══ NAME-SKEPTICISM ═══ Use a child's name ONLY if the moment's named_student is set. NEVER invent a name. If null, refer to "a student"/"the class" naturally in ${language}.

═══ LANGUAGE CRAFT (principle-driven — works for ANY language, never hardcoded) ═══
- Write in ${language} (${script}), DEAD-SIMPLE staff-room register a 10-year-old can read.${ttsBlock}
- NATURAL-REGISTER PRINCIPLE: the everyday register a teacher in ${region} actually speaks — NOT bookish, classical, archaic, or borrowed from another country's variant.${avoid_hint}
- GENDER-NEUTRALITY PRINCIPLE: the question must NEVER require knowing the teacher's gender. ${gender_hint}
- SUBJECT-MATTER TERMS STAY IN ENGLISH (Latin) inside the question — grammar/science/maths terms (proper noun, photosynthesis, place value) and any English word she used. Helps TTS + matches how teachers code-switch.
- REMIND WHEN it happened + just enough specific detail to place her back in the moment, then stop. NEVER raw MM:SS. NEVER say "Q1/Q2". Open ending.
- NO HONORIFICS when you ADDRESS her: use the bare first name ("${firstName || 'Afshan'}") or none — never "${firstName || 'Afshan'} ji", never "Mwalimu"/"Teacher"/"Madam" as a form of address. (You MAY still quote her or a student's exact words verbatim even if the transcript labels a line "Mwalimu:" — quoting the moment is not addressing her by an honorific.)
- LENGTH: aim for ≤75 words. Cut padding — no "I am wondering", no restating the question twice. But NEVER sacrifice the insight to hit the limit: depth lives in the question's structure, not word count.`;
}

module.exports = { buildQuestionPrompt };
