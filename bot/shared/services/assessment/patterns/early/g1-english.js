'use strict';
/**
 * Grade 1 English, FDE 2023-24 model paper: 100 marks. Oral: listening 5, speaking 5,
 * read aloud 6 (16). Written: reading 24 + writing 60 (84). ToS K40 / U40 / A20.
 * The writing slot is "Rhyming Pairs", never "Rhyming Words" (the layout tests that type as a poem).
 */

const { makeSubject } = require('./chrome');

const S = (o) => ({ marks_each: 1, ...o });

module.exports = makeSubject({
  grade: 1,
  key: 'english',
  medium: 'en',
  name_en: 'English',
  name_ur: 'انگریزی',
  tos: { Remember: 40, Understand: 40, Apply: 20 },
  pages: 166,
  sections: [
    {
      id: 'A',
      label_en: 'Reading',
      levels: { Remember: 10, Understand: 9, Apply: 5 },
      slots: [
        S({ slot: 'g1.english.A.Q1', label_en: 'Q1.', type: 'Match Word to Picture', generate: 6, lines: 1, picture: ['object'], picture_only: true, print_words: true,
          instruction_en: 'Look at the picture and write its word from the box.',
          prompt_rule: 'Six items, each one book object as picture: {kind:"object", name}. Put all six words, mixed, in "words" on the FIRST item only. Answer: the word.' }),
        S({ slot: 'g1.english.A.Q2', label_en: 'Q2.', type: 'Alphabetical Order', generate: 5, lines: 1,
          instruction_en: 'Write the letters in ABC order.',
          prompt_rule: 'Five items of three or four letters out of order, e.g. "d b c". Answer: the ordered letters.' }),
        S({ slot: 'g1.english.A.Q3', label_en: 'Q3.', type: 'Word Families', generate: 4, lines: 1, picture: ['object'],
          instruction_en: 'Join the letters to make a word.',
          prompt_rule: 'Four items: a first letter and an ending (-at, -in, -an, -ig, -op) from the book, e.g. "c + at = ____". Answer: the word. Each item also carries picture: {kind:"object", name} of the answer word, in English for the artist; choose only words that can be drawn.' }),
        S({ slot: 'g1.english.A.Q4', label_en: 'Q4.', type: 'Unscramble Words', generate: 5, lines: 1, picture: ['object'],
          instruction_en: 'Put the letters in order to make a word.',
          prompt_rule: 'Five three- or four-letter book words with letters mixed, e.g. "t a c". Only one word can be made. Answer: the word. Each item also carries picture: {kind:"object", name} of the answer word, in English for the artist; choose only words that can be drawn.' }),

        S({ slot: 'g1.english.A.Q5', label_en: 'Q5.', type: 'Missing Letters', generate: 4, lines: 1, picture: ['object'],
          instruction_en: 'Look at the picture and fill in the missing letter.',
          prompt_rule: 'Four items, each a book object as picture: {kind:"object", name} and its word with one letter blank, e.g. "b_g". Answer: the full word.' }),
      ],
    },
    {
      id: 'B',
      label_en: 'Writing (1)',
      levels: { Remember: 12, Understand: 13, Apply: 7 },
      slots: [
        S({ slot: 'g1.english.B.Q6', label_en: 'Q6.', type: 'Rhyming Pairs', generate: 4, lines: 1, picture: ['object'],
          instruction_en: 'Write a word that rhymes.',
          prompt_rule: 'Four simple book words, e.g. "cat". Answer: one rhyming word; accept lists other real rhymes. Each item also carries picture: {kind:"object", name} of the given word, in English for the artist; choose only words that can be drawn.' }),
        S({ slot: 'g1.english.B.Q7', label_en: 'Q7.', type: 'Name the Picture', generate: 9, lines: 1, picture: ['object'], picture_only: true, print_words: true,
          instruction_en: 'Write the name of each picture from the box.',
          prompt_rule: 'Nine book objects (animals, fruit, school things), each as picture: {kind:"object", name}. Put all nine words, mixed, in "words" on the FIRST item only. Answer: the word.' }),
        S({ slot: 'g1.english.B.Q8', label_en: 'Q8.', type: 'Action Words', generate: 4, lines: 1, picture: ['scene'],
          instruction_en: 'What is the child doing? Write the action word.',
          answer_ok: (q) => /ing$/i.test(String(q.answer).trim()),
          prompt_rule: 'Four items, each a child doing one action from the book (run, jump, read, eat, sleep, swim) as picture: {kind:"scene", describe}. Answer: the -ing word the question asks for ("running"); accept lists the plain word ("run").' }),
        { slot: 'g1.english.B.Q9', label_en: 'Q9.', type: 'Complete the Sentences', generate: 5, marks_each: 2, lines: 1, print_words: true,
          instruction_en: 'Fill in the blanks with words from the box.',
          prompt_rule: 'Five short sentences from the book, each with one blank. Each sentence rules out every other word: only one word from the box fits each blank (never "likes to ___ in the park", where play, run or paint all fit). Put the five answer words, mixed, in "words" on the FIRST item. Scheme: K 2 for the right word.' },
        S({ slot: 'g1.english.B.Q10', label_en: 'Q10.', type: 'Match Capital and Small Letters', generate: 5, shape: 'mcq',
          instruction_en: 'Match the capital letter with its small letter.',
          prompt_rule: 'Five items: a capital letter as the stem and four small letters as options (a, b, c, d). Answer: the matching small letter.' }),
      ],
    },
    {
      id: 'C',
      label_en: 'Writing (2)',
      levels: { Remember: 10, Understand: 11, Apply: 7 },
      slots: [
        S({ slot: 'g1.english.C.Q11', label_en: 'Q11.', type: 'Complete the Words', generate: 5, lines: 1, picture: ['object'],
          instruction_en: 'Complete the words.',
          prompt_rule: 'Five book words with two letters missing, e.g. "m _ _ go"; the picture is the clue, so write no text clue. Answer: the word. Each item also carries picture: {kind:"object", name} of the answer word, in English for the artist; choose only words that can be drawn.' }),
        { slot: 'g1.english.C.Q12', label_en: 'Q12.', type: 'This Is A', generate: 5, marks_each: 2, lines: 1, picture: ['object'], picture_only: true,
          instruction_en: 'Look at the picture and write "This is a ____."',
          prompt_rule: 'Five book objects as picture: {kind:"object", name}. Answer: "This is a <name>." Scheme: K 1 for the word, K 1 for the sentence with capital and full stop.' },
        { slot: 'g1.english.C.Q13', label_en: 'Q13.', type: 'Speech Bubbles', generate: 2, marks_each: 2, lines: 1, picture: ['scene'],
          instruction_en: 'What will they say? Write in the speech bubble.',
          // v18: the image model left the bubble out, put it over the wrong child, and drew a gift box
          // for a pencil case. The paper prints the bubble beside the picture (bd-5jmnfj.4.40).
          bubble: true,
          prompt_rule: 'Two greetings or polite words from the book (Good morning, Thank you, Sorry, Please), each a scene as picture: '
            + '{kind:"scene", describe} of two children. The question names who speaks. The describe has no speech bubble (the paper '
            + 'prints it) and shows exactly the thing the question names, in the same words, plain and never wrapped. '
            + 'The child who speaks stands on the right, next to the printed bubble, and the describe says "on the right". '
            + 'The question is about meeting, helping or saying sorry, never a gift or a present. '
            + 'Answer: the words. Scheme: K 2.',
          // v19 put the bubble beside the child who was not speaking; v20 asked about a gift and drew a
          // wrapped box (bd-5jmnfj.4.40).
          answer_ok: (q) => {
            const d = String((q.picture && q.picture.describe) || '');
            return !/bubble|gift|present|wrapped/i.test(d) && /\bon the right\b/i.test(d)
              && !/gift|present/i.test(String(q.question || ''));
          } },
        S({ slot: 'g1.english.C.Q14', label_en: 'Q14.', type: 'Capital Letters', generate: 4, lines: 1,
          instruction_en: 'Rewrite the sentence with a capital letter.',
          prompt_rule: 'Four short sentences written all in small letters, each needing one capital (start or a name). Answer: the corrected sentence.' }),
        S({ slot: 'g1.english.C.Q15', label_en: 'Q15.', type: 'Is Am Are', generate: 5, shape: 'mcq', option_labels: 'a',
          instruction_en: 'Choose is, am or are.',
          prompt_rule: 'Five short sentences with one blank; options exactly is, am, are. Answer: the right word.' }),
      ],
    },
  ],
  oral: {
    tasks: [
      { id: 'listening', kind: 'listening', marks: 5, label_en: 'Listening', label_ur: 'سننا',
        instruction_en: 'Read the short story aloud twice. Then ask the questions; the child answers aloud.',
        instruction_ur: 'مختصر کہانی دو بار بلند آواز سے پڑھیں، پھر سوال پوچھیں؛ بچہ زبانی جواب دے۔',
        ask: 'A story of 4 to 6 short sentences on a book theme, then five questions (2 recall, 2 understand, 1 apply), one mark each, with answers.',
        n: 5,
        rubric: [{ marks: 1, en: 'Each right answer', ur: 'ہر درست جواب' }] },
      { id: 'speaking', kind: 'speaking', marks: 5, label_en: 'Speaking', label_ur: 'بولنا',
        instruction_en: 'Ask the child to talk about the topic for about a minute. Prompt with the questions if they stop.',
        instruction_ur: 'بچے سے موضوع پر تقریباً ایک منٹ بات کرنے کو کہیں۔ رک جائے تو سوالوں سے مدد کریں۔',
        ask: 'One topic a Grade 1 child knows (my family, my school, my favourite food), with three prompt questions.',
        n: 3,
        rubric: [
          { marks: 2, en: 'Speaks with confidence', ur: 'اعتماد سے بولتا ہے' },
          { marks: 2, en: 'Says three or more things about the topic', ur: 'موضوع پر تین یا زیادہ باتیں' },
          { marks: 1, en: 'Uses English words and short sentences', ur: 'انگریزی الفاظ اور مختصر جملے' },
        ] },
      { id: 'read_aloud', kind: 'read_aloud', marks: 6, label_en: 'Read aloud', label_ur: 'بلند خوانی',
        instruction_en: 'Point to each word in turn. The child reads it aloud. One mark per word read right.',
        instruction_ur: 'ہر لفظ پر باری باری انگلی رکھیں۔ بچہ اسے بلند آواز سے پڑھے۔ ہر درست لفظ پر 1 نمبر۔',
        ask: 'Six simple book words (three-letter and sight words) printed large for the child to read.',
        n: 6,
        rubric: [{ marks: 1, en: 'Each word read right', ur: 'ہر درست پڑھا گیا لفظ' }] },
    ],
  },
});
