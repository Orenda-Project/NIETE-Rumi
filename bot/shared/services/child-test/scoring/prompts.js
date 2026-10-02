'use strict';
/**
 * Child test (bd-s1oo0.5) — model prompts.
 *
 * STORY is the May 2026 study prompt verbatim (harness/10_window_scorers.py),
 * the one Gemini 3.8 Flash was measured with in HARNESS_RESULTS §3b; changing a
 * word of it invalidates that measurement. COMPREHENSION is the study's
 * harness/11 prompt with each question's accept/reject list and rubric added.
 *
 * Children are referred to as "the child". No prompt ever carries a name: the
 * inputs are item text, transcripts and audio only.
 */

const LANG_NAME = { urdu: 'Urdu', english: 'English', maths: 'Urdu' };

const STORY = ({ lang, tokens }) => `A child in a Pakistani government school (grade 1-5) is reading aloud from a printed ${LANG_NAME[lang] || lang} text for 60 seconds. The exact printed text, word by word, is:
${tokens.map((w, i) => `${i + 1}:${w}`).join(' ')}
Judge every word of the printed text in order. For each word say whether the child read it CORRECTLY (an acceptable pronunciation of that word), read it WRONG (said a different word or a mispronunciation that changes the word), or SKIPPED it (never attempted, including everything after the child stopped). Self-corrections count as correct. Do not invent words the child did not say. Return ONLY JSON:
{"words":[{"i":1,"w":"<word>","v":"correct|wrong|skipped"}, ...], "words_correct": <int>, "words_attempted": <int>, "notes":"<one line>"}`;

const COMPREHENSION = ({ lang, passage, questions, transcript }) => `You are marking an oral reading-comprehension test in ${LANG_NAME[lang] || lang} for a grade 1-5 child in Pakistan. The child has just read this passage aloud:
${passage}
Below is a timestamped, diarised transcript of the coach asking ${questions.length} questions about the passage and the child answering. Speech-to-text errors are possible; judge the meaning. An answer is CORRECT if it conveys the right information from the passage in any language or wording; WRONG if it is incorrect, off-topic, or the child says they do not know; NO_ANSWER if no audible answer. Use each question's accepted and rejected answers and rubric. Mark each question in order.
QUESTIONS:
${questions.map((q, i) => `${i + 1}. [${q.id}] ${q.prompt}\n   accept: ${(q.accept || []).join(' | ') || '-'}\n   reject: ${(q.reject || []).join(' | ') || '-'}\n   rubric: ${q.rubric || '-'}`).join('\n')}
Return ONLY JSON: {"questions":[{"id":"<id>","answer":"<child's answer as heard>","verdict":"correct|wrong|no_answer","confidence":<0-1>}, ...]}
TRANSCRIPT:
${transcript}`;

const PHONICS = ({ lang, firstSounds, nonwords }) => `A child in a Pakistani government school (grade 1-5) is doing two short ${LANG_NAME[lang] || lang} tasks with a coach, recorded in this clip.
${firstSounds.length ? `TASK 1, FIRST SOUNDS: the coach says a word and the child says only its first sound. Words and expected first sounds:
${firstSounds.map((f, i) => `${i + 1}. [${f.id}] word "${f.word}" -> first sound "${f.sound}"`).join('\n')}
` : ''}${nonwords.length ? `TASK ${firstSounds.length ? 2 : 1}, MADE-UP WORDS: the child reads made-up words from a card. They are not real words; judge whether the child decoded each one with the expected sounds.
${nonwords.map((n, i) => `${i + 1}. [${n.id}] "${n.text}" sounds: ${(n.sounds || []).join(' ')}`).join('\n')}
` : ''}For each item say CORRECT, WRONG (a different sound or word), or NONE (no attempt heard). Report what you heard. Return ONLY JSON:
{"first_sounds":[{"id":"<id>","heard":"<what the child said>","verdict":"correct|wrong|none","confidence":<0-1>}], "nonwords":[{"id":"<id>","heard":"<what the child said>","verdict":"correct|wrong|none","confidence":<0-1>}]}`;

const FALLBACK = ({ lang, letters, words }) => `A child in a Pakistani government school could not read the first line of a ${LANG_NAME[lang] || lang} story, so the coach asked them to read 10 letters and then 10 words from a card. Letters, in order: ${letters.map((l, i) => `${i + 1}:${l}`).join(' ')}
Words, in order: ${words.map((w, i) => `${i + 1}:${w}`).join(' ')}
Listen to the clip and judge each letter (its name or its sound both count) and each word: correct, wrong, or none (not attempted). Return ONLY JSON:
{"letters":[{"i":1,"v":"correct|wrong|none"}], "words":[{"i":1,"v":"correct|wrong|none"}], "letters_correct":<int>, "words_correct":<int>}`;

const LABELLER = ({ block, sections, items, transcript }) => `Below is a timestamped, diarised speech-to-text transcript of ONE voice note recorded by a coach testing a grade 3-5 child in Pakistan (${block} block). The coach speaks the instructions; the child answers. Find where each of these sections starts and ends, in seconds on the transcript clock:
${sections.map((s) => `- ${s}: ${SECTION_HELP[s] || s}`).join('\n')}
Item text that may help you recognise each section:
${items}
If a section is not in the recording, return null for it. Return ONLY JSON:
{"sections":{${sections.map((s) => `"${s}":{"start_s":<number>,"end_s":<number>,"confidence":<0-1>}`).join(',')}}}
TRANSCRIPT:
${transcript}`;

const SECTION_HELP = {
  story: 'the child reads the printed story aloud (a timed minute); start = the moment the child is told to begin',
  questions: 'the coach asks questions about the story and the child answers',
  first_sounds: 'the coach says words and the child says the first sound of each',
  nonwords: 'the child reads made-up words from a card',
  numbers: 'the child reads numbers aloud from a card',
  quick_sums: 'the child answers quick sums aloud as fast as they can (a timed minute); start = when told to begin',
  word_problem: 'the coach reads a word problem and the child answers',
};

const WORD_PROBLEM = ({ prompt, answer, transcript }) => `A coach read this maths word problem to a grade 3-5 child in Pakistan: "${prompt}" The correct answer is ${answer}.
Below is the transcript of the child's reply (speech-to-text errors are possible; numbers may be in Urdu words, English words or digits). Take the child's FINAL answer (the last number they commit to; counting aloud before it is not the answer). Return ONLY JSON:
{"answer":"<the child's final number or null>","verdict":"correct|wrong|no_answer","confidence":<0-1>}
TRANSCRIPT:
${transcript}`;

const STRIP = ({ written, wordProblem, expectedCode }) => `This is a photo of a printed maths answer strip that a grade 3-5 child in Pakistan has written on. Read exactly what the child WROTE as the answer to each item; do not solve the sums yourself. Items printed on the strip:
${written.map((w, i) => `${i + 1}. [${w.id}] ${w.prompt} = ?`).join('\n')}
${wordProblem ? `${written.length + 1}. [${wordProblem.id}] word problem: ${wordProblem.prompt_en}` : ''}
Also read the small form code printed in a corner of the strip (expected "${expectedCode}").
For each item return what the child wrote as digits ("" if blank), a status: "written" | "blank" | "unreadable" (crossed out with no clear final answer, illegible, or covered), and your confidence (0-1) that you read it right. Return ONLY JSON:
{"form_code":"<as printed or null>","items":[{"id":"<id>","read":"<digits>","status":"written|blank|unreadable","confidence":<0-1>}]}`;

module.exports = { STORY, COMPREHENSION, PHONICS, FALLBACK, LABELLER, WORD_PROBLEM, STRIP, LANG_NAME };
