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

// The coaching VOICE (open-endedness, never-accusatory, no advice-with-a-
// question-mark) lives in ONE module shared with the live-call persona, so
// call-coaching and chat-coaching cannot drift apart (bd-1hae7.5).
const { buildCoachingVoice } = require('../../../config/coaching-voice');

const Q_BEATS = {
  1: `THIS IS THE ONE REFLECTIVE QUESTION — the teacher gets EXACTLY ONE, so make it the single highest-leverage move. Keep it SHORT and speakable: ONE question, HARD CAP ~55-70 words total. Two folded beats:
1) THE IMPASSE (this is the engine). Name TWO distant moments in the corpus where the SAME children did DIFFERENT cognitive work — e.g. reasoning/discovering for themselves at one point, and being given a rule / corrected / drilled at another. State each briefly and concretely: roughly WHEN, what was said or done, quote the real words, name a child ONLY if named_student is set. Put them side by side and ask her to make sense of the SHIFT between them — what changed in the children's thinking? Do NOT resolve it, do NOT hint which was "better": HERS to interpret. (Duncker/Ohlsson + Beeman-Kounios: insight lives in a held contradiction between two moments.)
2) A LIGHT FORWARD CLOSE (one short clause, a genuine invitation — NEVER a demand, NEVER advice-with-a-question-mark): "…and the next time you reach that same kind of moment, what is the one small thing you'd want to try?" — tied to a CUE she can SEE again (a child answering in one or two words; tomorrow's first problem), never a vague mental state. (Gollwitzer-Sheeran: an if-then with a real cue moves behaviour.)
Do NOT add a third "what does this tell you about how they learn" clause — that bloats it; the interpretation is already carried by "what changed in their thinking". If the lesson truly has only ONE strong moment, use it (interpret, never justify) and keep the light forward close. STAY UNDER ~70 words.`,
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
${buildCoachingVoice({ language, firstName })}
- NATURAL-REGISTER PRINCIPLE: the everyday register a teacher in ${region} actually speaks — NOT bookish, classical, archaic, or borrowed from another country's variant.${avoid_hint}
- GENDER-NEUTRALITY PRINCIPLE: the question must NEVER require knowing the teacher's gender. ${gender_hint}
- ENGLISH TERMS ALWAYS STAY IN ENGLISH (Latin) — NON-NEGOTIABLE. Every scientific, technical, or subject-matter concept is written with its ENGLISH term and is NEVER translated into ${language}, even if the teacher said it in ${language}. A translated technical term confuses the teacher and mis-renders when read aloud. Terms that MUST stay English include: photosynthesis, place value, proper noun, adjective, fraction, evaporation, dead organism, terminology, fundamental/basic — plus any English word the teacher used. (A teacher speaking ${language} should still hear "dead organism", never "Murda"; "terminology", never "Istlahat".) When in doubt, keep it English.
- REMIND WHEN it happened + just enough specific detail to place her back in the moment, then stop. NEVER raw MM:SS. NEVER say "Q1/Q2". Open ending.
- NO HONORIFICS when you ADDRESS her: use the bare first name ("${firstName || 'Afshan'}") or none — never "${firstName || 'Afshan'} ji", never "Mwalimu"/"Teacher"/"Madam" as a form of address. (You MAY still quote her or a student's exact words verbatim even if the transcript labels a line "Mwalimu:" — quoting the moment is not addressing her by an honorific.)
- LENGTH: aim for ≤75 words. Cut padding — no "I am wondering", no restating the question twice. But NEVER sacrifice the insight to hit the limit: depth lives in the question's structure, not word count.`;
}

module.exports = { buildQuestionPrompt };
