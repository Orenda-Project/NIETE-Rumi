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
          prompt_rule: 'A word quoted in a «لفظ «…» کا مطلب» stem is spelled exactly as the book pages print it (v37r4 printed «بیسرا» for the book\'s «بسیرا»); copy it from the pages. Ten three-option MCQs on the words of the book lessons and poems. This section is words and grammar: meanings, opposites, singular and plural, verbs, the right spelling. No item asks a poet\'s name, who said what or what happened in a story (that is recall, and the comprehension section tests it), so poets never appear in this section. No answer or target word repeats another question\'s: the keyed word and the word asked about are never a keyed or asked word of any other question on this paper; a feminine or plural key that another question already keys is a repeat. A singular/plural MCQ never offers the oblique plural (…وں) as a distractor: «کھڑکیوں» beside «کھڑکیاں» makes two right answers.' }),
        S({ slot: 'g2.urdu.A.Q2', label_en: 'Q2.', type: 'Alphabetical Order', generate: 4,
          instruction_ur: 'الفاظ کو حروفِ تہجی کی ترتیب سے لکھیں۔',
          prompt_rule: 'Four items of three book words out of order. Answer: the ordered words. The three words of an item begin with three different letters, so the order is never decided by the second letter (v35 «اونٹ، الو، مور» needed ل before و); use only letters whose order a Grade 2 child knows from the book chart.' }),
        S({ slot: 'g2.urdu.A.Q3', label_en: 'Q3.', type: 'Complete the Sentences', generate: 4, print_words: true,
          instruction_ur: 'جملے مکمل کریں۔',
          prompt_rule: 'Four book sentences with one blank; the four answers, mixed, in "words" on the FIRST item. The box holds exactly the four keyed answers and no other word: every item\'s answer is one of the box words (v37r4 keyed «فوج» with «کلیاں» in the box).' }),
        S({ slot: 'g2.urdu.A.Q4', label_en: 'Q4.', type: 'Verbs', generate: 4,
          instruction_ur: 'جملوں میں سے فعل تلاش کر کے لکھیں۔',
          prompt_rule: 'Four short book sentences. Answer: the verb. A sentence holds one verb form: never one with a converb («پہن کر») beside its main verb, since a child can name either, and never a compound verb of noun + verb (v35 «دلاسا دیا», where a child may write the whole phrase), so the answer is one word. `accept` holds the shorter form without the auxiliary («ہنس رہی» for «ہنس رہی ہے»). The sentence holds no noun that is also a verb form: «گانا», «کھانا», «پینا» used as nouns are infinitives, so a child may name them as the verb (v37 «بلبل گانا گائے گی» has two verbs to choose from); pick a sentence whose only verb form is the keyed one.' }),
        S({ slot: 'g2.urdu.A.Q5', label_en: 'Q5.', type: 'Singular Plural', generate: 4, picture: ['object'],
          instruction_ur: 'واحد سے جمع بنائیں۔', prompt_rule: 'Four book nouns. Answer: the plural. Each item also carries picture: {kind:"object", name} of the given noun, one of it, in English for the artist; choose only words that can be drawn. No answer or target word repeats another question\'s: the keyed word and the word asked about are never a keyed or asked word of any other question on this paper; a feminine or plural key that another question already keys is a repeat.' }),
        S({ slot: 'g2.urdu.A.Q6', label_en: 'Q6.', type: 'Opposites', generate: 4,
          instruction_ur: 'الٹ لکھیں۔', prompt_rule: 'Four book words with a common opposite. Answer: the opposite. The `accept` list holds only a true opposite, and holds every other true opposite a Grade 2 child would write (اچھا: برا and خراب; a word with one opposite only needs that one); never a related word that is not an opposite. Prefer words whose opposite is one word.' }),
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
          prompt_rule: 'One busy scene from a book theme (a market, a park, a village) as picture: {kind:"scene", describe} in English for the artist. Its `question` is an empty string: the heading already gives the instruction. Answer: five model sentences, each about only what its own `describe` shows, with the same counts (two children means two, never one child), and never a colour (an outline drawing has none). Scheme: five K points of 2 — each a correct sentence about the picture. Each thing in the scene is one simple object or action that a drawing shows plainly (no animal pulling or carrying a load: a donkey with a cart and baskets was drawn with the baskets on its back and no cart), and each key sentence states only what the `describe` says. The `describe` never names a person, and shows exactly the number of people the key speaks of.' },
        { slot: 'g2.urdu.B.Q8', label_en: 'Q8.', type: 'Topic Sentences', generate: 1, marks_each: 10, lines: 6,
          instruction_ur: 'دیے گئے موضوع پر پانچ جملے لکھیں۔', answer_ok: topicOk,
          prompt_rule: 'One book topic (my school, my favourite fruit, our country). The heading says only «the given topic», so the topic goes in `question` as a short line such as «موضوع: میرا اسکول»; `question` is never empty and never repeats the heading. Answer: five model sentences. Scheme: five K points of 2 — each a correct sentence on topic.' },
        { slot: 'g2.urdu.B.Q9', label_en: 'Q9.', type: 'Dialogue', generate: 1, marks_each: 10, lines: 6,
          instruction_ur: 'دو دوستوں کے درمیان پانچ باتوں کا مکالمہ لکھیں۔ ہر بات سے پہلے بولنے والے کا نام لکھیں۔',
          prompt_rule: 'Two friends planning something together (a game, a picnic); the stem names the plan and does not restate the instruction (the heading asks for five turns, each with the speaker\'s name before it). Answer: a model dialogue of five turns, each written «پہلا دوست: ... دوسرا دوست: ...». Scheme: five K points of 2, and each point pays the speaker\'s name: 1 for the name before the turn and 1 for the turn that fits the plan and the one before (the heading asks for the name, so a mark must pay it). The descriptors under each point match that header: 2 = the name and a correct sentence, 1 = one of the two, 0 = neither; never descriptors that score the sentence alone. The common error is not the only place the name appears. No accept: the points mark any dialogue on this plan.' },
      ],
    },
  ],
  oral: {
    tasks: [
      { id: 'poem', kind: 'listening', marks: 10, label_en: 'Poem questions', label_ur: 'نظم سے سوال',
        instruction_en: 'Read the book poem aloud once, then ask the questions.',
        instruction_ur: 'کتاب کی نظم ایک بار پڑھ کر سنائیں، پھر سوال پوچھیں۔',
        ask: 'Choose a book poem about nature, family, school, animals or play; never a hamd, naat, prayer or a poem that names God. The opening lines of that book poem (quote the book exactly) and five questions on it with answers. Each answer is a full sentence, as the rubric pays for sentences, but it gives the content and never restates the question\'s words or opens «نظم میں». No question or answer names God, a prayer or a religious form (حمد، نعت، دعا) in words the poem does not print, and no question prints a poem word that is another question\'s answer.', n: 5,
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
