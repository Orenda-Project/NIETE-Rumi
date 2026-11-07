'use strict';
// Part of assessment-generation.service.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const { applyLayout, takenNote, firstAskNote, verseLines, scopeLessons, oneStory, STORY_ITEMS } = require('../fde-layout');
const { URDU_Q4_NEVER } = require('./section-calls');

// The rule sentences every section is given. Copied exactly from the engine's
// contract with the paper's reviewers; they compare them by text.
const RULE = {
  bookOnly: 'Set every item from the book text above. Never set an item on \'Create and Connect\' or \'Discovery Playground\' activities.',
  held: 'Urdu: never lessons 1, 2 or 3 (حمد، نعت، ایفائے عہد).',
  r1: 'a single-procedure computation on given numbers counts as Understand; a word problem, a multi-step or unitary problem, a graph from data, a missing angle count as Apply; a fact, name or definition is Remember',
  r1English: '"identify the part of speech by rule" is Understand; "transform a sentence" is Apply',
  recall: 'include 3–5 straight recall MCQs',
  noPictures: 'The paper carries no pictures. A slot marked frame prints an empty frame: write the instruction and the labels/word bank only; never \'look at the picture\'.',
  framePictures: 'A picture-description frame gets a drawn picture: give `describe_en`, one short English line naming the scene and the things behind the helper words, drawn as a plain black outline; it is never shown to the child. Every other frame prints empty: write the instruction and the labels/word bank only; never \'look at the picture\'.',
  marks: 'Marks: use EXACTLY the marks given per slot.',
  blooms: 'blooms is one of Remember, Understand, Apply.',
  scheme: 'For every WRITTEN item add scheme: { points: [{text, marks, kind: M|A|U|K|L}] summing EXACTLY to the item\'s marks, accept: [EVERY method the textbook teaches for this item], common_error }. Name a method point generically (e.g. \'a correct method for the common denominator\'), never one route. Give a U point only where the child chooses the unit (cm², m); otherwise fold the unit into the A point. Words / expanded-form items carry A points only. Points mark only what the question asks, never a part it does not ask. accept lists only answers that earn full marks; the form common_error describes is never in accept. MCQs carry no scheme.',
  families: 'Q2\'s twelve items are four families of three — one number-sense item, one straight computation, one word problem — from Units 1–2, 3–4, 5–6, 7–8 respectively; Q4–Q8 are one each: draw, area, perimeter, average, missing angle.',
  table: 'Data items: give the data as table: { headers, rows }.',
  picks: 'Section B (ب): the (ب) pick lists must be words that appear in the passage, at least two of each kind.',
  jsonOnly: 'Return the JSON only.',
  chapterOnly: 'Set every item only from the pages above. Where a slot\'s rule names a unit or topic outside them, keep the slot\'s kind and marks and set the item from these pages (the nearest skill they hold).',
  scaffold: 'Never write scaffold phrases such as \'based on the passage\', \'based on the text\', \'mentioned in the text\', \'according to the passage\' in a stem. Ask the question directly.',
  noTags: 'Never add a source, chapter, lesson or thinking-level tag to an item, such as \'(Based on the chapter/concept: …)\', \'(Remember)\' or \'(Understand)\'; the stem ends with the question itself.',
  situationParts: 'Write each situation\'s three sub-questions as objects { question, answer, marks: 2.5, scheme } where scheme.points sum to 2.5; do not prefix a sub-question with a letter.',
  picksVerbatim: 'For each pick kind ask for the count needed plus two extra, copied exactly as the words appear in the passage (same spelling, same form).',
  gender: 'A child or a person in a stem is \'a child\', \'a student\', \'they\', or a named character. Never she/he, his/her for an unnamed person.',
  people: 'A person in a word problem or story who is not named is \'they\' (a carpenter … they).',
  // bd-5jmnfj.23: staging printed "Hamza … Their whole trip" and "A boy … They take it home".
  namedChild: 'A named child, or a person the stem calls a boy, girl, man or woman, is never \'they\' or \'their\': repeat the name, or use he/his for a boy or man and she/her for a girl or woman (Hamza … his trip). \'They\' is only for a person the stem gives no name and no sex.',
  genderUrdu: 'کسی نامعلوم شخص کے لیے صنفی فعل استعمال نہ کریں؛ \'آپ … کریں\' یا نام والا کردار استعمال کریں۔', // needs fluent-Urdu review
  oneKey: 'An anagram, homophone or spelling MCQ has exactly one option that satisfies the stem.',
  urduSpelling: 'A spelling (املا) MCQ quotes a meaning or a picture-word in its stem, never the word whose spelling is tested.',
  oneQuestion: 'Each MCQ stem asks one question and ends with its one «؟».',
  urduPlainOptions: 'An MCQ option is never a word of worship (اذان، نماز، روزہ); a distractor is an everyday word.',
  urduTermWord: 'A grammar-term item (اسم صفت، حرفِ عطف، فعل …) never prints a word of its own answer in its stem: describe what the term does, and quote an example.',
  urduConceptOnce: `Q1 asks each grammar concept (شکیہ، تمنائی، شرط و جزا، حرفِ عطف, and so on) in one item only: no other Q1 item names its words, states its rule or gives its example. Each of these is a concept of its own: اسم صوت، اسم آلہ، اسم معرفہ، اسم نکرہ، صفت، موصوف; a definition item asks its concept, so an item that says what a term is («جو لفظ … آواز ظاہر کرے») and an item that asks for that term are one concept asked twice. ${URDU_Q4_NEVER} An antonym item and a synonym item are concepts too: at most one of each.`,
  urduHomograph: 'A homograph (ایک ہی املا) item never quotes the pair\'s word in its stem, not even inside a longer word or phrase; it gives both meanings only.',
  urduPunctuation: 'A رموزِ اوقاف item quotes a sentence printed without its mark and asks which mark it takes; its stem never ends with the mark it asks for (an item keyed «؟» ends «… درست علامت منتخب کریں۔»).',
  urduVerbSense: 'Give a verb sense by a paraphrase or a sentence, never by its infinitive («بننا», «ڈالنا»): the infinitive prints the letters of the word it asks for.',
  urduFormFamily: 'In a واحد/جمع or مذکر/مؤنث item, every option is a form of the asked word\'s family.',
  urduOneTable: 'Q1 takes at most 3 items from one word table of the book (a متشابہ، متضاد or مترادف list), and a distractor is never another Q1 item\'s key.',
  oneCorrect: 'Every MCQ has exactly one correct option: check that no other option is also true (another number that fits the rule, a second work by the same author, a value equal to the key).',
  optionsOnly: 'Write the four options only in `options`; never list (a), (b), (c), (d) inside the question.',
  urduQ4: 'Each Q4 item\'s `question` starts with its own directive in Urdu (what to do: choose the group word, choose the conditional word, change to the future tense, split into syllables), then the sentence or words.',
  urduQ4Group: 'In the Q4 group-word item the group word is one of its four options and is its key; its scheme `accept` names that option only, never another one.',
  urduQ4GroupNotListed: 'In the Q4 group-word item the group word is NOT one of the words the item lists: it names what all of them belong to (تھرمامیٹر، نبض، دوا اور ڈاکٹر all belong to اسپتال), never the odd one out. The item asks in words: it never prints an arrow (← →).',
  urduQ6Points: 'Q6 (ب) scheme: one idea per point, no point above 2 marks.',
  urduSchemeText: 'On an Urdu paper every scheme `points[].text` and `common_error` is written in Urdu, never English: the marking key is read by an Urdu-speaking teacher.',
  urduQ4Syllables: 'In the Q4 ارکان سازی item, split every word into its spoken syllables, as the book does (غ – لا – ظت); every answer `accept` lists splits each word exactly as the key does.',
  urduRelationNouns: 'In Q2 (ب), relation words (امی، ابو، بھائی) are اسم نکرہ, never اسم معرفہ: اسم معرفہ is the own name of one person or place.',
  // On chosen lessons, Q1 asks each of their grammar concepts once; a place left after that is never
  // filled with a concept asked again.
  urduGrammarUsedUp: 'Grammar is used up: these lessons\' grammar concepts are each asked once on this paper already. Write every new Q1 item as vocabulary, word-meaning or comprehension from these lessons; never another antonym, synonym or other grammar item.',
  urduOneWordOnePlace: 'Q3 and Q5 never share a word or idiom: each word on the paper is asked in one place.',
  // The full syllabus: the place was left by a grammar concept asked again.
  urduGrammarUsedUpFull: 'Grammar is used up: the grammar concepts this paper\'s Q1 asks, an antonym and a synonym included, are each asked once already. Write every new Q1 item as vocabulary, word-meaning or comprehension from lessons 4–10; never another antonym, synonym or other grammar item.',
  religious: 'Never set an item that quotes, explains or evaluates a religious text (Qur\'an, hadith, the Farewell Sermon, du\'a, Naat, Hamd); set it from another part of the scope.',
  // Social Studies: book p.5 restates the Farewell Sermon's proposition under the hadith without naming it,
  // and an item keyed on it gives marks for a theological premise.
  sstPremise: 'Never set an item whose answer rests on a religious premise (what Allah created or commands, a prophet\'s story, a verse or a hadith said in other words); book p.5 is asked only for its civic sentences (the UN charter, equal basic rights).',
  noUnderline: 'Never refer to an underlined, bold or italic word; name the word in the stem instead.',
  scienceQ3: 'Q3(a): of the ten short questions, three Remember (state, name, define with the book\'s wording), four Understand (explain, compare, give an example) and three Apply, written as reasoning items (\'Why…\', \'What would happen if…\', \'Is … natural or artificial? Give a reason\'). Q3(b): of the five long questions, three Remember and two Apply (use the idea in a new situation from the book); none Understand. '
    // bd-5jmnfj.4.55: v24 Q3(b) 1 named the three parts Q3(a) 1 asked the child to name.
    + 'A Q3(b) long question never names the parts, examples or facts that a Q3(a) short question asks the child to name or list; ask the long question about how or why instead.',
  unequalOptions: 'MCQ options are pairwise unequal in value (no two options that simplify to the same number, no 2/5 and 6/15) and written in simplest form.',
  // bd-5jmnfj.4.50.8: v22 G1 Urdu keyed «بلی» in Q3 and Q7 and printed it in Q1's stem.
  noRepeats: 'No item repeats another item\'s content, numbers or answer on this paper, in any section. '
    + 'An answer word appears nowhere else on the paper: never in another item\'s stem, choices or word box, and never as another item\'s answer. '
    // bd-5jmnfj.4.55: v24 G5 English's Q6 mind map was «Recycling» and so was a Q8 topic choice.
    + 'A writing question\'s topic (mind map, paragraph, story, letter) is never the topic or a topic choice of another writing question.',
  // Social Studies: a paraphrase of a fact is not a repeated stem, so noRepeats lets Q5 and Q7 re-ask it.
  // The sections are written in parallel, so the rule names the slots, not their items.
  sstNoReask: 'Q5 and Q7 never ask a fact that a Section A item (stem or key) or a Q6 item on this paper already tests.',
  // Social Studies: one thinking level per choice group, as FDE's own paper sets them (Q7 recall,
  // Q5 define / explain / compare, Q6 explain or apply in a situation). A mixed slot put one book-recall
  // item among situations, so the child's choice changed how hard the paper was. Q6's situations carry
  // the Apply marks the counted situation rule used to spread over Q5 and Q6.
  sstBand: {
    // The map, flow chart and mind map are FDE's fixed tasks; the level is asked of what the model writes in them (bd-5jmnfj.27).
    Q2: 'Every Q2 item is Remember: the child names places on the map.',
    Q3: 'Every Q3 item is Understand: the topic needs the child to show how its steps or parts connect, not to copy a list from the book.',
    Q4: 'Every Q4 item is Understand: the topic asks the child to explain or group ideas, so each of its branches says what something means or why; not a list of duties or facts to recall.',
    Q5: 'Every Q5 item is Understand: define a term, explain why, give two reasons, or compare two things from these pages. No Q5 item sets a situation to decide, and none is a one-fact recall item.',
    Q6: 'Every Q6 item is Apply: it sets a situation a Grade 5 child could meet (a decision, a dispute, a journey, a map reading, a weather report) and asks the child to use a concept from these pages to decide or explain. No Q6 item asks to define, list or recall a book fact. '
      + 'A Q6 situation needs the child to apply two different ideas from these pages; never one fact said twice (never "name the tier" twice, never the same government or body as the answer to both parts). '
      + 'No computation in a Q6 item (no degrees, hours or numbers to work out), and never a list of names or book facts to recall dressed as a situation (a poster of names, a quiz). '
      + 'A Q6 situation never asks a history fact; history recall goes to Q7. '
      + 'Nor does it ask only civics or geography facts (who heads or chairs a body, what it is called, how many, when): that recall goes to Q7 too. '
      + 'Nor is a Q6 answered by naming which government, court or body does a job, even with the book\'s one-line reason: besides any marking point that names a government, court or body, at least two of its marking points explain an idea without naming one. '
      + 'A Q6 is never "which map, which medium or which government for each need": such items go to Q7 as one-fact items. '
      + 'A Q6 poses a decision or advice in a situation; never "X asks what Y is" or "X wants to know why": an answer that is the book\'s text in order is a Q5. '
      + 'A Q6 answer is never a list the book gives, nor the name of a tier or a body.',
    Q7: 'Every Q7 item is Remember: one fact (who, what, where, when, how many) answered in one line. No Q7 item asks why or sets a situation. '
      + 'A Q7 item is never a fact every Grade 5 child knows without the book (the year Pakistan was made, its capital, its national language, washing hands before eating, that television shows pictures («… ٹی وی پر اور کیا دکھایا جاتا ہے؟ → تصویر»), the name of a social media app); it asks a fact these pages teach.',
  },
  // Social Studies Q1 (bd-5jmnfj.27): Q2 (map), Q7 and Q4's tags are fixed by their tasks, so the paper reaches
  // FDE's 30/40/30 only if Q1 carries 8 Remember, 6 Understand and 6 Apply. A count, as the model follows counts.
  sstQ1Levels: 'Q1: exactly 8 Remember items, 6 Understand and 6 Apply (an Apply item is a situation the child decides).',
  sstGroups: 'The child chooses which items of a question to answer, so every item of Q5, of Q6 and of Q7 is the same kind as the others in its question and as hard.',
  // Social Studies: a marking point that names no fact («پہلی وجہ درست بتانا») tells the teacher nothing
  // to look for, and the layout compares items by their points.
  sstFactPoints: 'Each marking point states its fact (e.g. «آئین بنیادی حقوق کا تحفظ کرتا ہے»), never «پہلی وجہ», «دوسری وجہ», «درست وضاحت».',
  spreadKeys: 'Spread the correct options across a, b, c and d; no letter holds more than a third of the keys.',
  // The page store runs p.29's three columns together line by line, so a model read the provincial
  // cell (encroachments on public roads) as local work. Given column by column when the pages hold
  // it, and to any pages that name a government tier without it. One job per item: a full paper
  // given the rows still keyed two jobs to one government.
  sstTiers: (inPages) => [
    `The book's table on p.29 says which government does what. ${inPages ? 'The page text above runs its three columns together; these are its rows, column by column:' : 'These are its rows, column by column:'}`,
    '- وفاقی حکومت: ملکی دفاع (مسلح افواج کے امور) کی نگرانی کرتی ہے؛ ملکی معیشت کو سنبھالتی ہے؛ خارجہ پالیسی (بیرونی ممالک سے تعلقات کے معاملات) کی نگرانی کرتی ہے۔',
    '- صوبائی حکومت: صوبے کا نظم و نسق (قانون سازی، عوامی سڑکوں اور راستوں سے تجاوزات ہٹانا، امن و امان کا قیام) چلاتی ہے؛ صوبائی محصولات کی نگرانی کرتی ہے؛ صوبوں کی داخلی پالیسی کے معاملات سنبھالتی ہے۔',
    '- مقامی حکومت: مویشی منڈیاں اور عوامی میلے منعقد کرتی ہے؛ پینے کے پانی کا بندوبست اور نکاسی آب کا انتظام دیکھتی ہے؛ بیواؤں، یتیموں، معذوروں اور قدرتی آفات کے متاثرین کی مدد کرتی ہے۔',
    '  An item, key or marking point that says which government (وفاقی، صوبائی یا مقامی) does a job takes it from these rows only; a job the rows do not name is not asked as a which-government item.',
    '  A which-government item asks about one job; a situation with two jobs names each job\'s government from its own row, never both under one government.',
  ].join('\n'),
  accept: '`accept` lists real alternative answers or methods, never \'as per the book\' or \'any correct answer\'.',
  mathsSectionC: 'Section C is also set from the pages above: keep each slot\'s marks and item shape (a word problem stays a word problem, a calculation a calculation) and take the topic from these pages.',
  grammarFromPages: 'Q1(a) grammar MCQs test only the grammar these pages teach. If the pages teach fewer grammar points than there are MCQs, set the rest on the pages\' vocabulary and comprehension. Never test grammar the pages do not teach.',
  mathsTosFloor: 'Of the 100 marks, 8–12 are Remember (at least 8 of the 20 MCQs recall a definition, fact, formula or property name), at most 60 Understand, at least 30 Apply.',
  propertyOneKey: 'For an MCQ that tests a property (divisible by, prime, factor, multiple, even, odd, greatest, smallest, rounded to, place value) exactly ONE option satisfies the stem; check every option before writing it.',
  unitsNumerals: 'Every measurement stem names its unit (cm, m, kg, litres, rupees, degrees). Write mixed numbers as numerals, e.g. 5 2/3, never \'five and two thirds\' or \'5 and 2/3\'.',
  frameLabels: 'Key labels come only from the book\'s figure; if the figure carries fewer parts than the frame has leader lines, ask for that smaller number.',
  grade5Words: 'Use Grade 5 vocabulary; a term the book does not use (e.g. \'lactic acid\', \'electrons\') is replaced by the book\'s word.',
  // Maths Apply marks come from word problems the child must choose the operation for
  // (convention R1). The model follows counted slot rules, not percentages, so the share is a
  // count. Target, attempt-weighted under R1: Remember 8–12, Understand ≤ 60, Apply ≥ 30.
  mathsQ2Words: (n, total) => `In Q2, at least ${n} of the ${total} items are short word problems set in a situation a Grade 5 child knows (shopping, measuring, time, sharing, travel), in which the child decides which operation(s) to use; the other items stay calculations.`,
  mathsQ2Families: (extra) => `Each Q2 family keeps its word problem; set ${extra} more of the families' number-sense or computation items as such word problems, keeping the skill they test.`,
  mathsQ1bWords: (n, total) => `In Q1(b), at least ${n} of the ${total} items are one-step word problems set in a situation a Grade 5 child knows (shopping, measuring, time, sharing, travel), in which the child decides which operation to use.`,
  // English on chosen chapters or pages: FDE's Q1(a)/(b) topic list is not given; the points come from the pages.
  pagesPoints: 'Q1(a) and Q1(b) test only the grammar and word-study points these pages teach. Before writing, list those points to yourself; the reply is still the JSON only.',
  pagesRest: 'If the pages teach fewer points than there are items, set the rest on the pages\' vocabulary and comprehension. Never test grammar the pages do not teach.',
  oneKeyEnglish: 'A homophone or spelling MCQ has exactly one option that satisfies the stem.',
  q5Poem: 'Q5 uses a poem printed in the book. If these pages hold no poem, take the nearest poem in the syllabus, name its unit in the title, and print its lines verbatim; never write verse and never call prose a poem.',
  // Maths on chosen chapters or pages: FDE's Q1(b) and Q2 topic lists are not given; the topics come from the pages.
  mathsPagesAB: 'Q1(b) and Q2 are set from the pages above: keep each slot\'s marks and item shape (a word problem stays a word problem, a calculation a calculation) and take every topic from these pages. The word-problem counts above still apply.',
  noAnagram: 'Never set an item that asks the child to rearrange, unscramble or reorder letters to make a word.',
  // English Q1(b): the underline sentence Q1(a) and Q2 carry, and one rewrite per item.
  q1bQuote: 'Never refer to an underline the paper cannot show; quote the word or phrase instead.',
  q1bOne: 'Each item is one sentence to rewrite, with its instruction once.',
  // English Q5 on chosen pages with no poem: the nearest poem's own page text is given below the book text.
  q5Given: (p) => `Q5 uses this poem from Unit ${p.unit} (book p.${p.pages}); print only its verse lines, exactly as given, never a heading, instruction or activity line; title «${p.title} (Unit ${p.unit})».`,
  // Urdu Q6 on lessons with no poem: lesson 7's poem page text is given below the book text.
  urduQ6Given: (p) => `Q6's verses (درج ذیل اشعار کا مفہوم واضح کریں) come from this poem, lesson ${p.unit} «${p.title}» (book pp. ${p.pages}), whatever lessons the paper covers: \`passage\` = four consecutive verse lines copied exactly as given, never a question or note printed between the couplets.`,
  urduNoMaxims: 'Model answers, passages, dialogues and stories carry no religious maxim, hadith, verse, dua or act of worship; keep them to everyday life.',
  urduNoDates: 'Never ask an item whose answer is a year, a date or a day of the month; the page text\'s numerals are not reliable.',
  // FDE's table puts the writing tasks at Apply (bd-5jmnfj.19); the model tagged them Understand.
  urduWritingApply: 'The picture description, paragraph, story and letter or application are Apply: tag each of them Apply.',
  // Same table puts sentence work at Understand; the model tagged it Apply, 9 marks over (bd-5jmnfj.19).
  urduSentenceUnderstand: 'The rewrite-the-sentences (Q4) and use-the-words-in-sentences (Q5) items are Understand: tag each of them Understand.',
  // FDE's model paper sets the writing at Apply 40, so the poem is recall; the model flipped between runs (bd-5jmnfj.19).
  urduPoemRemember: 'The poem question (Q6), the meaning of the verses or the Naat\'s central idea, is Remember: tag it Remember.',
};

// Maths Q1(b): this many of its one-step items are word problems. One above the floor of 3:
// the model lands one or two short of a counted rule (round-4 local papers: Q2 5, 8, 5 of 12 asked for 6).
const MATHS_Q1B_WORDS = 4;
// Maths on chosen pages: the slots whose rule and grain carry FDE's model-paper topics. Each keeps
// the rule from its marks sentence on (a count and topics come before it) under a topic-free head.
const MATHS_PAGES_SLOTS = Object.freeze({
  'maths.A.Q1b': { head: 'Ten one-step items. ', keepFrom: '2 marks each', number_size: 'the sizes these pages use' },
  'maths.B.Q2': { head: 'Twelve 5-mark items. ', keepFrom: 'Every word problem names its unit', number_size: 'the sizes these pages use' },
});
// English on chosen pages: the slot fields that carry FDE's model-paper topic list, and what replaces them.
// English bans anagram items, so FDE scope's Q1(a) topic list loses its "anagrams" entry at assembly.
const ENGLISH_FDE_Q1A_ANAGRAMS = ', anagrams';
const ENGLISH_PAGES_SLOTS = Object.freeze({
  'english.A.Q1a': { prompt_rule: 'Twenty four-option MCQs, one point each. Never refer to an underline the paper cannot show; quote the word instead.' },
  'english.A.Q1b': {
    prompt_rule: 'Five one-line items, each ending with its direction in round brackets.',
    grain_kind: 'one-line transformation',
  },
});

// Urdu Q1 on chosen lessons or pages: grammar only from those lessons' own «قواعد کا میدان» sections,
// less the kinds Q4 asks; the rest of Q1 is their vocabulary, word meanings and comprehension. The
// slot's rule keeps its lessons 1–3 and options sentences from `keepFrom` on.
const URDU_LESSONS_Q1 = Object.freeze({
  keepFrom: 'Never lessons 1, 2 or 3',
  kind: (terms) => `one point per item: lesson facts, word meanings and comprehension from these lessons${terms.length ? `, and grammar only from their قواعد sections (${terms.join('، ')})` : ''}`,
  rule: (terms) => (terms.length
    ? `Twenty four-option MCQs. Grammar only from these lessons' قواعد sections, each concept once: ${terms.join('، ')}; every other item is vocabulary, word meaning or comprehension from these lessons. `
    : 'Twenty four-option MCQs. These lessons\' قواعد sections give Q1 no grammar point to ask (Q4 asks theirs); every item is vocabulary, word meaning or comprehension from these lessons. '),
});

// Urdu Q1 on chosen lessons: the concept-once and grammar-term rules name those lessons' concepts only
// (the full syllabus's lists name lesson 10's and lesson 8's, which there are holds); Q4's kinds stay
// "never in Q1". Lessons whose grammar is all Q4's give Q1 no concept and no grammar-term rule.
const URDU_LESSONS_RULES = Object.freeze({
  conceptOnce: (terms) => (terms.length
    ? `Q1 asks each grammar concept of these lessons (${terms.join('، ')}) in one item only: no other Q1 item names its words, states its rule or gives its example; a definition item asks its concept, so an item that says what a term is and an item that asks for that term are one concept asked twice. ${URDU_Q4_NEVER}`
    : `Q1 asks no grammar concept on these lessons. ${URDU_Q4_NEVER}`),
  termWord: (terms) => (terms.length
    ? `A grammar-term item (${terms.join('، ')}) never prints a word of its own answer in its stem: describe what the term does, and quote an example.`
    : null),
  // A count is easier to keep than "once each". `pairs`: the entries that name two concepts.
  budget: (terms, n, of, pairs) => (n
    ? `Q1: exactly ${n} of the ${of} items ${n === 1 ? 'is' : 'are'} grammar, one item per concept (${terms.join('، ')}${pairs.length ? `; ${pairs.map((t) => `«${t}»`).join(' and ')} ${pairs.length === 1 ? 'is' : 'are each'} two concepts, one item each` : ''}); the other ${of - n} are vocabulary, word meanings or comprehension from these lessons.`
    : null),
  concept: (terms) => (terms.length
    ? `Give every Q1 item a "concept" field: the grammar concept it asks, written as one of ${terms.join('، ')}; or «ذخیرۂ الفاظ / فہم» for a vocabulary, word-meaning or comprehension item. The field is never printed.`
    : null),
  // Lessons with one prose story: twenty items from one story name each other's people and things.
  story: (of) => `These lessons hold one story: at most ${STORY_ITEMS} of the ${of} Q1 items ask a fact of the story; write the rest from the lessons' own word lists (نئے الفاظ، معمے کے الفاظ), their word meanings and idioms, and the poem's words. `
    + 'Give every Q1 item a "source" field: story, word, meaning, idiom or poem. The field is never printed.',
});

// The pages Urdu items are never set from: lessons 1–3 (the Hamd, the Naat, the third).
const HELD_PAGES = '1-27';
// A quote this long from those pages is a quote, not a shared phrase. Stock
// exercise wording runs to 21 characters in real items; a line of verse is 25+.
const HELD_SHINGLE = 24;
// Social Studies: no item may quote, explain or evaluate a religious text, the book's own
// "importance of the Farewell Sermon" questions included. An item naming one of these is
// held. Each pattern is matched on _heldNorm text as a whole word, with the endings the word
// takes (plural, adjective), so «احمد», «ہدایت», «نعمت» or «مدعا» never match.
const HELD_TERMS_SST = Object.freeze([
  { term: 'حجۃ الوداع', pattern: 'حجت?ہ ?الوداعی?' },
  { term: 'حدیث', pattern: 'حدیث(?:یں|وں|ی)?|احادیث' },
  { term: 'آیت', pattern: 'ایت(?:یں|وں)?|ایات' },
  { term: 'قرآن', pattern: 'قران(?:ی|ے)?' },
  { term: 'دعا', pattern: 'دعا(?:ئیں|ئیہ|ئی|ئے|ؤں|وں|یں|ی|ے)?' },
  { term: 'نعت', pattern: 'نعت(?:یں|وں|یہ)?' },
  { term: 'حمد', pattern: 'حمد(?:یہ)?' },
  // A religious premise as an answer («اللہ تعالیٰ نے تمام انسان برابر پیدا کیے», «… علیہ السلام کی
  // اولاد»): the item asks a hadith's proposition without naming the hadith. A name that carries one
  // of these words («عبداللہ», «اللہ دتہ», «عرب») is a whole other word.
  { term: 'اللہ تعالیٰ', pattern: 'اللہ ?تعالی' },
  { term: 'علیہ السلام', pattern: 'علیہ ?السلام' },
  { term: 'علیھا السلام', pattern: 'علی(?:ہ|ھ)م?ا ?السلام' },
  // The same premise written with no honorific («سب آدم و حوا کی اولاد ہیں»). The two names together,
  // so a child called «آدم» in a story, or «حوالہ», is a whole other word.
  { term: 'آدم و حوا', pattern: '(?:حضرت ?)?ادم\u0611? ?(?:و|اور) ?(?:حضرت ?)?حوا' },
  // The ligature is written against the name it follows («حضورﷺ»), so it needs no word edge.
  { term: 'ﷺ', pattern: 'ﷺ', bare: true },
  // «رب» is the word wherever it stands («ہمارا رب سب کو دیکھتا ہے», «اللہ رب کریم», «ربِ کائنات»), except in
  // the name «رب نواز» («رب نواز نے دکان کھولی»), which is a person.
  { term: 'رب', pattern: 'رب(?!\\s+نواز(?![\\p{L}\\p{N}]))' },
  // The same premise with no honorific at all («خدا نے سب کو برابر بنایا», «کسی عربی کو کسی عجمی پر …»,
  // «… فرمایا گیا کہ …»). «خدا» in every form («خدائے بزرگ و برتر») except in the name «خدا بخش»; «اللہ» only
  // beside «پاک», «کریم» or «رب», since bare «اللہ» and «نبی» start names («عبد اللہ ہارون», «اکرام اللہ», «غلام نبی»).
  { term: 'خدا', pattern: 'خدا(?:ؤں|وں|ئی|ئے)?(?!\\s+بخش(?![\\p{L}\\p{N}]))' },
  { term: 'پیغمبر', pattern: 'پیغمبر(?:وں|ی)?' },
  { term: 'فرمایا', pattern: 'فرمایا' },
  { term: 'عجمی', pattern: 'عجمی' },
  { term: 'پروردگار', pattern: 'پروردگار' },
  { term: 'خالق', pattern: 'خالق' },
  { term: 'اللہ پاک', pattern: 'اللہ ?(?:پاک|کریم|رب)' },
].map(({ term, pattern, bare }) => Object.freeze({
  term, re: new RegExp(bare ? pattern : `(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'u'),
})));

module.exports = {
  ENGLISH_FDE_Q1A_ANAGRAMS, ENGLISH_PAGES_SLOTS, HELD_PAGES, HELD_SHINGLE, HELD_TERMS_SST, MATHS_PAGES_SLOTS,
  MATHS_Q1B_WORDS, RULE, URDU_LESSONS_Q1, URDU_LESSONS_RULES,
};
