'use strict';
/**
 * Grade 2 English, FDE 2023-24 model paper: 100 marks. Oral: listening 5, speaking 5,
 * read aloud 10 (20). Written: comprehension 20 + writing 60 (80). ToS 36 / 36 / 28.
 */

const { makeSubject } = require('./chrome');

const S = (o) => ({ marks_each: 1, ...o });
// One underscore per missing letter: v12 printed "man__o" for mango, two blanks for one letter.
const oneBlankEach = (q) => {
  const stem = String(q.question || '').replace(/\s/g, '');
  return stem.includes('_') && stem.length === String(q.answer || '').trim().length;
};

module.exports = makeSubject({
  grade: 2,
  key: 'english',
  medium: 'en',
  name_en: 'English',
  name_ur: 'انگریزی',
  tos: { Remember: 36, Understand: 36, Apply: 28 },
  pages: 159,
  sections: [
    {
      id: 'A',
      label_en: 'Reading',
      levels: { Remember: 8, Understand: 8, Apply: 4 },
      slots: [
        { slot: 'g2.english.A.Q1', label_en: 'Q1.', type: 'Read and Answer', generate: 1, marks_each: 20, lines: 0,
          instruction_en: 'Read the passage and answer the questions.',
          prompt_rule: 'One new passage of 80 to 110 words in "passage", on a book theme, in Grade 2 words. "questions": ten objects { question, answer, marks: 2, scheme } — four recall, four understand, two apply — where scheme.points sum to 2. Do not prefix a question with a letter.' },
      ],
    },
    {
      id: 'B',
      label_en: 'Words and grammar',
      levels: { Remember: 14, Understand: 10, Apply: 4 },
      slots: [
        S({ slot: 'g2.english.B.Q2', label_en: 'Q2.', type: 'Sentences from Words', generate: 3,
          instruction_en: 'Make sentences with these words.',
          prompt_rule: 'Three book words. Answer: a model sentence; accept any correct sentence using the word.' }),
        S({ slot: 'g2.english.B.Q3', label_en: 'Q3.', type: 'Rhyming Pairs', generate: 3, picture: ['object'],
          instruction_en: 'Write a rhyming word.', prompt_rule: 'Three book words. Answer: one rhyme; accept lists other real rhymes. Each item also carries picture: {kind:"object", name} of the given word, in English for the artist; choose only words that can be drawn.' }),
        S({ slot: 'g2.english.B.Q4', label_en: 'Q4.', type: 'Spelling', generate: 2, picture: ['object'], picture_only: true,
          instruction_en: 'Look at the picture and write the word.',
          prompt_rule: 'Two book objects as picture: {kind:"object", name}. Answer: the word.' }),
        S({ slot: 'g2.english.B.Q5', label_en: 'Q5.', type: 'Is Am Are', shape: 'mcq', generate: 3,
          instruction_en: 'Choose is, am or are.', prompt_rule: 'Three sentences with one blank; options exactly is, am, are.' }),
        S({ slot: 'g2.english.B.Q6', label_en: 'Q6.', type: 'Missing Letters', generate: 3, picture: ['object'],
          instruction_en: 'Fill in the missing letters.', answer_ok: oneBlankEach,
          prompt_rule: 'Three book words with one or two letters blank, one underscore for each missing letter ("b__k" for book, "man_o" for mango); the picture is the clue. Answer: the full word. Each item also carries picture: {kind:"object", name} of the answer word, in English for the artist; choose only words that can be drawn.' }),
        S({ slot: 'g2.english.B.Q7', label_en: 'Q7.', type: 'Opposites', generate: 3,
          instruction_en: 'Write the opposite.', prompt_rule: 'Three book adjectives or verbs. Answer: the opposite.' }),
        S({ slot: 'g2.english.B.Q8', label_en: 'Q8.', type: 'Singular Plural', generate: 3, picture: ['object'],
          instruction_en: 'Write the plural.', prompt_rule: 'Three book nouns (one -es, one irregular). Answer: the plural. Each item also carries picture: {kind:"object", name} of the given noun, one of it, in English for the artist; choose only words that can be drawn.' }),
        S({ slot: 'g2.english.B.Q9', label_en: 'Q9.', type: 'Has Have', shape: 'mcq', generate: 3,
          instruction_en: 'Choose has or have.', prompt_rule: 'Three sentences with one blank; options exactly has, have.' }),
        S({ slot: 'g2.english.B.Q10', label_en: 'Q10.', type: 'Prepositions', generate: 5, picture: ['scene'],
          instruction_en: 'Look at the picture. Write in, on, under, near or behind.',
          answer_ok: (q) => /^(in|on|under|near|behind)$/i.test(String(q.answer).trim()),
          prompt_rule: 'Five items, each a scene as picture: {kind:"scene", describe} of one object placed by another (a cat under a table), placed in, on, under, near or behind it, never above, over, beside or next to. Stem: "The cat is ____ the table." Answer: that one word.' }),
      ],
    },
    {
      id: 'C',
      label_en: 'Writing',
      levels: { Remember: 8, Understand: 10, Apply: 14 },
      slots: [
        S({ slot: 'g2.english.C.Q11', label_en: 'Q11.', type: 'Pronouns', generate: 4,
          instruction_en: 'Use he, she, it or they.', prompt_rule: 'Four sentences naming a person or thing; the child rewrites with the pronoun. Answer: the pronoun.' }),
        { slot: 'g2.english.C.Q12', label_en: 'Q12.', type: 'Paragraph', generate: 1, marks_each: 10, lines: 7,
          instruction_en: 'Write five sentences on "My House".',
          prompt_rule: 'Topic exactly "My House". Answer: a model paragraph of five sentences. Scheme: five K points of 2 — on topic, five sentences, capitals and full stops, spelling, describing words.' },
        S({ slot: 'g2.english.C.Q13', label_en: 'Q13.', type: 'Articles', shape: 'mcq', generate: 3,
          instruction_en: 'Choose a or an.', prompt_rule: 'Three nouns with a blank before them; options exactly a, an.' }),
        S({ slot: 'g2.english.C.Q14', label_en: 'Q14.', type: 'Punctuation', generate: 3,
          instruction_en: 'Put a full stop (.) or question mark (?).', answer_ok: (q) => /[.?]$/.test(String(q.answer).trim()),
          prompt_rule: 'Three short sentences with no end mark, each a statement or a question, never an exclamation. Answer: the sentence with its . or ?.' }),
        { slot: 'g2.english.C.Q15', label_en: 'Q15.', type: 'Picture Description', generate: 1, marks_each: 6, lines: 4, picture: ['scene'],
          instruction_en: 'Look at the picture and write three sentences.',
          prompt_rule: 'One busy scene from a book theme (a park, a market, a classroom) as picture: {kind:"scene", describe}. Answer: three model sentences. Scheme: three K points of 2 — each a correct sentence about the picture.' },
        { slot: 'g2.english.C.Q16', label_en: 'Q16.', type: 'Story Order', generate: 1, marks_each: 6, lines: 3,
          instruction_en: 'Put the sentences in order to make a story.',
          prompt_rule: 'One short story of six sentences from a book theme, given out of order and numbered in "questions" as plain strings. Answer: the order. Scheme: one K point of 1 per sentence in the right place. Write the story so exactly one order is valid; if two orders are really valid, list every valid order in scheme.accept.' },
      ],
    },
  ],
  oral: {
    tasks: [
      { id: 'listening', kind: 'listening', marks: 5, label_en: 'Listening', label_ur: 'سننا',
        instruction_en: 'Read the story aloud twice. Then ask the questions; the child answers aloud.',
        instruction_ur: 'کہانی دو بار بلند آواز سے پڑھیں، پھر سوال پوچھیں۔',
        ask: 'A story of 5 to 7 sentences on a book theme, then five questions (2 recall, 2 understand, 1 apply) with answers.', n: 5,
        rubric: [{ marks: 1, en: 'Each right answer', ur: 'ہر درست جواب' }] },
      { id: 'speaking', kind: 'speaking', marks: 5, label_en: 'Speaking', label_ur: 'بولنا',
        instruction_en: 'Ask the child to talk about the topic for about a minute.',
        instruction_ur: 'بچے سے موضوع پر تقریباً ایک منٹ بات کرنے کو کہیں۔',
        ask: 'One topic (my best friend, my favourite game) and three prompt questions.', n: 3,
        rubric: [
          { marks: 1, en: 'Confidence', ur: 'اعتماد' },
          { marks: 1, en: 'Gives details', ur: 'تفصیل' },
          { marks: 1, en: 'Standard English', ur: 'درست انگریزی' },
          { marks: 2, en: 'Expression', ur: 'اظہار' },
        ] },
      { id: 'read_aloud', kind: 'read_aloud', marks: 10, label_en: 'Read aloud', label_ur: 'بلند خوانی',
        instruction_en: 'The child reads the passage aloud. Mark against the rubric.',
        instruction_ur: 'بچہ عبارت بلند آواز سے پڑھے۔ روبرک کے مطابق نمبر دیں۔',
        ask: 'A passage of 40 to 50 words from a book lesson (quote the book exactly).', n: 0,
        rubric: [
          { marks: 2, en: 'Breaks words into syllables', ur: 'الفاظ کو ہجوں میں توڑنا' },
          { marks: 3, en: 'Accuracy', ur: 'درستگی' },
          { marks: 3, en: 'Fluency', ur: 'روانی' },
          { marks: 2, en: 'Expression', ur: 'اظہار' },
        ] },
    ],
  },
});
