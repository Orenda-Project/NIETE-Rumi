'use strict';
/**
 * Grade 2 Urdu, FDE 2023-24 model paper: oral 30 + written 60. ToS 38 / 41 / 21.
 * The model paper's written items add to 52; singular/plural and opposites (4 each)
 * balance it to 60. Urdu text: needs fluent-Urdu review.
 */

const { makeSubject } = require('./chrome');

const { topicOk } = require('../../fde-early-urdu-topic');
const { g2Q1Ok } = require('../../fde-early-urdu-mcq');

const S = (o) => ({ marks_each: 1, ...o });

module.exports = makeSubject({
  grade: 2,
  key: 'urdu',
  medium: 'ur',
  name_en: 'Urdu',
  name_ur: 'اردو',
  tos: { Remember: 38, Understand: 41, Apply: 21 },
  pages: 134,
  sections: [
    {
      id: 'A',
      label_en: 'Words and grammar',
      label_ur: 'الفاظ اور قواعد',
      levels: { Remember: 18, Understand: 10, Apply: 2 },
      slots: [
        S({ slot: 'g2.urdu.A.Q1', label_en: 'Q1.', type: 'MCQs', shape: 'mcq', generate: 10, option_labels: 'ur', answer_ok: g2Q1Ok,
          instruction_ur: 'درست جواب پر دائرہ لگائیں۔',
          prompt_rule: 'Ten three-option MCQs on the words of the book lessons and poems. This section is words and grammar: meanings, opposites, singular and plural, verbs, the right spelling. No item asks a poet\'s name, who said what or what happened in a story (that is recall, and the comprehension section tests it), so poets never appear in this section.' }),
        S({ slot: 'g2.urdu.A.Q2', label_en: 'Q2.', type: 'Alphabetical Order', generate: 4,
          instruction_ur: 'الفاظ کو حروفِ تہجی کی ترتیب سے لکھیں۔',
          prompt_rule: 'Four items of three book words out of order. Answer: the ordered words.' }),
        S({ slot: 'g2.urdu.A.Q3', label_en: 'Q3.', type: 'Complete the Sentences', generate: 4, print_words: true,
          instruction_ur: 'جملے مکمل کریں۔',
          prompt_rule: 'Four book sentences with one blank; the four answers, mixed, in "words" on the FIRST item.' }),
        S({ slot: 'g2.urdu.A.Q4', label_en: 'Q4.', type: 'Verbs', generate: 4,
          instruction_ur: 'جملوں میں سے فعل تلاش کر کے لکھیں۔',
          prompt_rule: 'Four short book sentences. Answer: the verb. A sentence holds one verb form: never one with a converb («پہن کر») beside its main verb, since a child can name either. `accept` holds the shorter form without the auxiliary («ہنس رہی» for «ہنس رہی ہے»).' }),
        S({ slot: 'g2.urdu.A.Q5', label_en: 'Q5.', type: 'Singular Plural', generate: 4, picture: ['object'],
          instruction_ur: 'واحد سے جمع بنائیں۔', prompt_rule: 'Four book nouns. Answer: the plural. Each item also carries picture: {kind:"object", name} of the given noun, one of it, in English for the artist; choose only words that can be drawn.' }),
        S({ slot: 'g2.urdu.A.Q6', label_en: 'Q6.', type: 'Opposites', generate: 4,
          instruction_ur: 'الٹ لکھیں۔', prompt_rule: 'Four book words with a common opposite. Answer: the opposite. The `accept` list holds only a true opposite.' }),
      ],
    },
    {
      id: 'B',
      label_en: 'Writing',
      label_ur: 'تحریر',
      levels: { Remember: 5, Understand: 15, Apply: 10 },
      slots: [
        { slot: 'g2.urdu.B.Q7', label_en: 'Q7.', type: 'Picture Sentences', generate: 1, marks_each: 10, lines: 6, picture: ['scene'],
          instruction_ur: 'تصویر دیکھ کر پانچ جملے لکھیں۔',
          prompt_rule: 'One busy scene from a book theme (a market, a park, a village) as picture: {kind:"scene", describe} in English for the artist. Its `question` is an empty string: the heading already gives the instruction. Answer: five model sentences, each about only what its own `describe` shows, with the same counts (two children means two, never one child), and never a colour (an outline drawing has none). Scheme: five K points of 2 — each a correct sentence about the picture.' },
        { slot: 'g2.urdu.B.Q8', label_en: 'Q8.', type: 'Topic Sentences', generate: 1, marks_each: 10, lines: 6,
          instruction_ur: 'دیے گئے موضوع پر پانچ جملے لکھیں۔', answer_ok: topicOk,
          prompt_rule: 'One book topic (my school, my favourite fruit, our country). The heading says only «the given topic», so the topic goes in `question` as a short line such as «موضوع: میرا اسکول»; `question` is never empty and never repeats the heading. Answer: five model sentences. Scheme: five K points of 2 — each a correct sentence on topic.' },
        { slot: 'g2.urdu.B.Q9', label_en: 'Q9.', type: 'Dialogue', generate: 1, marks_each: 10, lines: 6,
          instruction_ur: 'دو دوستوں کے درمیان پانچ باتوں کا مکالمہ لکھیں۔ ہر بات سے پہلے بولنے والے کا نام لکھیں۔',
          prompt_rule: 'Two friends planning something together (a game, a picnic); the stem names the plan and does not restate the instruction (the heading asks for five turns, each with the speaker\'s name before it). Scheme points name the five turns only as «a turn that fits the plan and the one before». Answer: a model dialogue of five turns, each written «پہلا دوست: ... دوسرا دوست: ...». Scheme: five K points of 2 — each a turn that fits the one before. No accept: the points mark any dialogue on this plan.' },
      ],
    },
  ],
  oral: {
    tasks: [
      { id: 'poem', kind: 'listening', marks: 10, label_en: 'Poem questions', label_ur: 'نظم سے سوال',
        instruction_en: 'Read the book poem aloud once, then ask the questions.',
        instruction_ur: 'کتاب کی نظم ایک بار پڑھ کر سنائیں، پھر سوال پوچھیں۔',
        ask: 'The opening lines of one book poem (quote the book exactly) and five questions on it with answers. Each answer is a full sentence, as the rubric pays for sentences, but it gives the content and never restates the question\'s words or opens «نظم میں».', n: 5,
        rubric: [{ marks: 2, en: 'Each right answer in a sentence', ur: 'ہر درست جواب جملے میں' }] },
      { id: 'holidays', kind: 'speaking', marks: 10, label_en: 'My summer holidays', label_ur: 'میری گرمیوں کی چھٹیاں',
        instruction_en: 'Ask the child to say five sentences about their summer holidays.',
        instruction_ur: 'بچے سے گرمیوں کی چھٹیوں پر پانچ جملے بولنے کو کہیں۔',
        ask: 'Five prompt questions, one per sentence the child is marked for (where you went, who you went with, what you played, what you ate, what you liked most).', n: 5,
        rubric: [{ marks: 2, en: 'Each clear sentence on topic', ur: 'موضوع پر ہر واضح جملہ' }] },
      { id: 'dialogue', kind: 'read_aloud', marks: 10, label_en: 'Read a dialogue', label_ur: 'مکالمہ پڑھنا',
        instruction_en: 'The child reads the dialogue aloud. Mark against the rubric.',
        instruction_ur: 'بچہ مکالمہ بلند آواز سے پڑھے۔ روبرک کے مطابق نمبر دیں۔',
        ask: 'A dialogue of five short turns from a book lesson (quote the book exactly), none repeated. The first turn is a greeting or an opening question, never a reply («ٹھیک ہے», «جی», «ہاں») to something not in the script.', n: 0,
        rubric: [
          { marks: 4, en: 'Accuracy: 4 reads every word right, 3 most words, 2 some words, 1 few words', ur: 'درستگی: 4 تمام الفاظ درست، 3 زیادہ تر، 2 کچھ، 1 بہت کم' },
          { marks: 3, en: 'Fluency: 3 reads smoothly in full phrases, 2 with a few stops, 1 word by word', ur: 'روانی: 3 پورے فقروں میں رواں، 2 چند بار رک کر، 1 لفظ بہ لفظ' },
          { marks: 3, en: 'Expression: 3 voice fits each speaker, 2 fits some turns, 1 flat throughout', ur: 'لہجہ: 3 ہر کردار کے مطابق، 2 کچھ باتوں میں، 1 ایک ہی سر میں' },
        ] },
    ],
  },
});
