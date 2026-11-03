/**
 * bd-5jmnfj.33.4 packet B — cross-section repeats and give-aways the v31 Grade 3-4 papers carried
 * (REVIEW.md Should-fix). Fixtures are the real items of the g3/g4 english, urdu, general_knowledge and
 * science exam.json files. Each flag names the LATER item's slot; fde-answer-repeats merges them.
 *  G3 English Halwa Puri (Q1 iii/Q3 i), Elephant Path (Q1 vi/Q3 iii), huge (Q1 v/Q4 i).
 *  G3 Urdu ملازمت, مفت کھانا, چار سال, جیت/ہار, two items keyed خدمت گار.
 *  G3 GK word-box words in Q4/Q5 key points, پسند ناپسند, "listening" tested eight times.
 *  G4 English gust of wind, turtles and dolphins, "do not belong".
 *  G4 Urdu ریت کے ذرے, کششِ ثقل, نظامِ شمسی, Q3/Q5 same words. G4 Science Steel, Buoyancy, ship, paper cup.
 */
const { conceptRepeats } = require('../../bot/shared/services/assessment/fde-concept-repeats');
const { answerRepeats } = require('../../bot/shared/services/assessment/fde-answer-repeats');

const exam = (items) => {
  const slots = [...new Set(items.map((q) => q.slot))];
  const unseen = {};
  items.forEach((q) => { (unseen[q.slot] = unseen[q.slot] || []).push(q); });
  return { _layout: { sections: [{ id: 'X', slots: slots.map((slot) => ({ slot })) }] }, unseen: { x: unseen } };
};
const it = (slot, question, answer, extra = {}) => ({ slot, question, answer, ...extra });
const mcq = (slot, question, options, key) => it(slot, question, options.find((o) => o.includes(key)), { options });
const flagOf = (flags, slot) => flags.find((f) => f.slot === slot);
const has = (f, re) => !!f && f.words.some((w) => re.test(w));

describe('G3 English', () => {
  const E = (s) => `g3.english.${s}`;
  test('Q1 iii and Q3 i: the MCQ key Halwa Puri is the short answer too', () => {
    const f = conceptRepeats(exam([
      mcq(E('A.mcq'), 'What did Pinky eat for breakfast in Lahore?', ['a) Eggs', 'b) Halwa Puri', 'c) Paratha'], 'Halwa'),
      it(E('B.short'), 'What did Pinky have to eat in the morning in Lahore before the tour?', 'Pinky had a yummy breakfast of Halwa Puri.'),
    ]));
    expect(flagOf(f, E('B.short'))).toMatchObject({ reason: 'giveaway', printed: true, with: [E('A.mcq')] });
    expect(has(flagOf(f, E('B.short')), /halwa puri/)).toBe(true);
    expect(flagOf(f, E('A.mcq'))).toBeUndefined();
  });
  test('Q1 vi and Q3 iii: the Elephant Path key text is the short answer', () => {
    const f = conceptRepeats(exam([
      mcq(E('A.mcq'), 'Why was the Elephant Path made?', ['a) For the big feet of the animals that walked there', 'b) For cars to drive on', 'c) For people to sell fruit'], 'big feet'),
      it(E('B.short'), 'Why was the big path in the fort made in the way it was?', 'It was made for the big feet of the animals the king used.'),
    ]));
    expect(flagOf(f, E('B.short')).with).toEqual([E('A.mcq')]);
  });
  test('Q1 v and Q4 i: "huge" is an MCQ stem word and a Use-the-words stem', () => {
    const f = conceptRepeats(exam([
      mcq(E('A.mcq'), "Which word means almost the same as 'huge'?", ['a) big', 'b) soft', 'c) tiny'], 'big'),
      it(E('B.sentences'), 'huge', 'The huge walls of the building looked very strong.'),
    ]));
    expect(has(flagOf(f, E('B.sentences')), /huge/)).toBe(true);
  });
  test('Use-the-words items on different words are not flagged', () => {
    const f = conceptRepeats(exam([
      it(E('B.sentences'), 'special', 'My birthday is a special day for me.'),
      it(E('B.sentences'), 'colourful', 'The children wore colourful clothes at the fair.'),
      it(E('B.sentences'), 'tour', 'We went on a tour of the museum with our teacher.'),
    ]));
    expect(f).toEqual([]);
  });
});

describe('G3 Urdu', () => {
  const U = (s) => `g3.urdu.${s}`;
  test('Q1 ii, Q3 i, Q5 i: ملازمت asked as a meaning MCQ, a meaning and a sentence', () => {
    const f = conceptRepeats(exam([
      mcq(U('A.mcq'), 'لفظ «ملازِمت» کا کیا مطلب ہے؟', ['الف) چھٹی', 'ب) نوکری', 'ج) کھانا'], 'نوکری'),
      it(U('B.meanings'), 'لفظ «ملازمت» کے معنی لکھیں۔', 'نوکری'),
      it(U('C.sentences'), 'ملازمت', 'میرے چچا کو نئی ملازمت مل گئی۔'),
    ]));
    expect(flagOf(f, U('B.meanings')).with).toContain(U('A.mcq'));
    expect(flagOf(f, U('C.sentences')).with).toContain(U('A.mcq'));
  });
  test('Q1 iv and Q2 ii: key مفت کھانا is printed in the short answer', () => {
    const f = conceptRepeats(exam([
      mcq(U('A.mcq'), 'ریستوران کے اشتہار میں دونوں عیدوں پر پورے خاندان کو کیا ملتا ہے؟', ['الف) نئے کپڑے', 'ب) مفت کھانا', 'ج) انعام'], 'مفت'),
      it(U('B.short'), 'ریستوران کے اشتہار کے مطابق دونوں عیدوں پر کیا سہولت ملتی ہے؟', 'دونوں عیدوں پر پورے خاندان کا مفت کھانا ملتا ہے۔'),
    ]));
    expect(has(flagOf(f, U('B.short')), /مفت کھان/)).toBe(true);
  });
  test('Q1 v and Q2 i: key چار سال is the short answer', () => {
    const f = conceptRepeats(exam([
      mcq(U('A.mcq'), 'ہوٹل کے اشتہار میں خدمت گار کے لیے کتنے سال سے زیادہ تجربہ مانگا گیا ہے؟', ['الف) دو سال', 'ب) تین سال', 'ج) چار سال'], 'چار'),
      it(U('B.short'), 'ہوٹل کے اشتہار میں کتنے سال سے زیادہ تجربے والے ملازم کی ضرورت ہے؟', 'ہوٹل کو چار سال سے زیادہ تجربے والے ملازم کی ضرورت ہے۔'),
    ]));
    expect(has(flagOf(f, U('B.short')), /چار سال/)).toBe(true);
  });
  test('Q1 x and Q4 iv: the MCQ key ہار is the stem of the opposite-word item that keys جیت (printed in Q1 x)', () => {
    const f = conceptRepeats(exam([
      mcq(U('A.mcq'), 'جملے کے لیے صحیح لفظ چنیں: «اچھا انسان جیت جاتا ہے اور بُرا انسان ___ جاتا ہے۔»', ['الف) سو', 'ب) ہار', 'ج) جاگ'], 'ہار'),
      it(U('B.grammar'), 'لفظ «ہار» کا متضاد لکھیں۔', 'جیت'),
    ]));
    expect(flagOf(f, U('B.grammar')).with).toEqual([U('A.mcq')]);
  });
  test('Q1 iii and Q1 vii: two items keyed خدمت گار', () => {
    const f = conceptRepeats(exam([
      mcq(U('A.mcq'), 'ریستوران میں مہمانوں کو خوش آمدید کون کہتا ہے؟', ['الف) مالک کا دوست', 'ب) باورچی کا بیٹا', 'ج) خدمت گار'], 'خدمت'),
      mcq(U('A.mcq'), '«خدمت کرنے والا» کس لفظ کا مطلب ہے؟', ['الف) خدمت گار', 'ب) ریستوران', 'ج) رابطہ'], 'خدمت'),
    ]));
    expect(flagOf(f, U('A.mcq')).words).toContain('خدمت گار');
  });
});

describe('G3 General Knowledge', () => {
  const G = (s) => `g3.general_knowledge.${s}`;
  test('Q3 word-box key غور is a key point of a Q4 answer', () => {
    const f = conceptRepeats(exam([
      it(G('A.fill'), 'دوسروں کی بات ___________ سے سننی چاہیے۔', 'غور', { words: ['معافی', 'جھگڑے', 'غور', 'ملکیت'] }),
      it(G('B.short'), 'دوسروں کی بات کو توجہ سے سننے کا کیا فائدہ ہے؟', 'جب ہم توجہ سے سنتے ہیں تو دوسرے کی بات سمجھ آتی ہے۔ ہم اس پر غور کرتے ہیں۔'),
    ]));
    expect(has(flagOf(f, G('B.short')), /غور/)).toBe(true);
  });
  test('Q2 i and Q4 vii: the matched pair پسند ناپسند is printed in a short stem', () => {
    const f = conceptRepeats(exam([
      it(G('A.match'), 'ملاپ کریں', 'پسند ناپسند: لڑائی کی وجہ', { column_a: ['پسند ناپسند'], column_b: ['لڑائی کی وجہ'] }),
      it(G('B.short'), 'پسند ناپسند کا فرق دو بچوں کے درمیان اختلاف کیسے پیدا کر سکتا ہے؟ ایک مثال دیں۔', 'ایک بچے کو ایک کھیل پسند ہو۔'),
    ]));
    expect(has(flagOf(f, G('B.short')), /پسند ناپسند/)).toBe(true);
  });
  test('"listening" tested in eight items: the items past the cap are flagged', () => {
    const f = conceptRepeats(exam([
      mcq(G('A.mcq'), 'آپ کا دوست بات کرتے ہوئے ناراض ہو جائے تو سب سے اچھا کام کون سا ہے؟', ['الف) آپ بھی ناراض ہو جائیں', 'ب) اس کی بات پوری طرح سن لیں', 'ج) بات کرنا چھوڑ دیں'], 'سن لیں'),
      it(G('B.short'), 'اختلاف کی کوئی سی تین وجوہات لکھیں۔', 'دوسروں کی بات غور سے نہ سننا، اپنے فرائض ادا نہ کرنا۔'),
      it(G('B.short'), 'دوسروں کی بات کو توجہ سے سننے کا کیا فائدہ ہے؟', 'جب ہم توجہ سے سنتے ہیں تو بات سمجھ آتی ہے۔'),
      it(G('B.short'), 'عام طور پر اختلاف کب پیدا ہوتا ہے؟', 'جب ہم ایک دوسرے کی بات نہیں سنتے تو اختلاف پیدا ہوتا ہے۔'),
      it(G('B.short'), 'ایک بچہ کھیل میں دوسرے بچوں کی بات بالکل نہیں سنتا۔ اس سے کیا ہو سکتا ہے؟', 'اختلاف پیدا ہو سکتا ہے۔'),
      it(G('B.long'), 'اختلافات پر قابو پانے کے چار طریقے لکھیں۔', 'ہم دوسروں کی بات غور سے سنیں۔ بات آہستہ کریں۔'),
      it(G('B.long'), 'اختلاف ختم کرنے میں ہمارا رویہ اہم کردار کیوں ادا کرتا ہے؟', 'اچھے رویے سے ہم دوسرے کی بات سنتے ہیں۔'),
      it(G('B.long'), 'مسئلے کے حل کے قدموں کے مطابق آپ ان کی مدد کیسے کریں گے؟', 'پھر دونوں سے بات کروں گا اور سنوں گا کہ ہر ایک کیا چاہتا ہے۔'),
      // The rest of a real paper is about other things, so listening is a word, not the chapter's topic.
      ...['پانی', 'ہوا', 'درخت', 'پرندہ', 'بازار', 'کتاب', 'سڑک', 'موسم', 'مچھلی', 'پہاڑ', 'دریا', 'کھیت', 'چاند', 'ستارہ', 'پھول', 'گاؤں', 'شہر', 'ہسپتال'].map((w) => it(G('B.short'), `${w} کی کیا اہمیت ہے؟`, `${w} ہمارے لیے ضروری ہے۔`)),
    ]));
    const last = flagOf(f, G('B.long'));
    expect(last).toBeDefined();
    expect(last.words.some((w) => /^سن/.test(w))).toBe(true);
  });
});

describe('G4 English', () => {
  const E = (s) => `g4.english.${s}`;
  test('Q1 iv and Q3 iii: the key a gust of wind is printed in a Q3 stem', () => {
    const f = conceptRepeats(exam([
      mcq(E('A.mcq'), 'What pushed the bottle onto a new path at night?', ['a) a gust of wind', 'b) a street dog', 'c) a child'], 'gust'),
      it(E('B.short'), 'What did a gust of wind do in the park at night?', 'A gust of wind swept through the park and pushed the plastic onto a new path.'),
    ]));
    expect(has(flagOf(f, E('B.short')), /gust wind/)).toBe(true);
  });
  test('Q2 ii/iv and Q3 ii: turtles, dolphins and fish are in a grammar stem and a short answer', () => {
    const f = conceptRepeats(exam([
      it(E('A.grammar'), '___ do the turtles and dolphins live? (Fill in the blank with the correct question word: who, what, where, when, why)', 'Where do the turtles and dolphins live?'),
      it(E('B.short'), 'Which creatures were seen in the ocean?', 'Turtles, dolphins and many fish were seen in the ocean.'),
    ]));
    expect(has(flagOf(f, E('B.short')), /turtles dolphins/)).toBe(true);
  });
  test('Q1 vi and Q3 iv: "do not belong" is the MCQ key and the short answer', () => {
    const f = conceptRepeats(exam([
      mcq(E('A.mcq'), "What does the word 'intruder' mean?", ['a) a friendly helper', 'b) someone or something in a place where they do not belong', 'c) a very old object'], 'do not belong'),
      it(E('B.short'), 'Why were the fish confused by the plastic in their home?', 'The plastic did not belong in the river. It was a strange new thing in their home.'),
    ]));
    expect(has(flagOf(f, E('B.short')), /not belong/)).toBe(true);
  });
});

describe('G4 Urdu', () => {
  const U = (s) => `g4.urdu.${s}`;
  test('Q1 viii and Q2 vi: the key ذرّے is printed in the short answer', () => {
    const f = conceptRepeats(exam([
      mcq(U('A.mcq'), 'خالی جگہ کے لیے درست لفظ منتخب کریں: ہمارا نظامِ شمسی کائنات کے مقابلے میں ریت کے ____ سے بھی چھوٹا ہے۔', ['الف) دریا', 'ب) تارے', 'ج) ذرّے', 'د) پہاڑ'], 'ذرّے'),
      it(U('B.short'), 'ہمارا نظامِ شمسی کائنات کے مقابلے میں کیسا ہے؟', 'کائنات کے مقابلے میں یہ ریت کے ذرے سے بھی چھوٹا ہے۔'),
    ]));
    expect(has(flagOf(f, U('B.short')), /ذر/)).toBe(true);
  });
  test('Q1 iv and Q2 i: the key کششِ ثقل (with diacritics) is printed in a short answer', () => {
    const f = conceptRepeats(exam([
      mcq(U('A.mcq'), 'ہر مادہ کون سی قوت رکھتا ہے؟', ['الف) روشنی', 'ب) آواز', 'ج) حرارت', 'د) کششِ ثقل'], 'ثقل'),
      it(U('B.short'), 'چاند زمین کے گرد کیوں گردش کرتا ہے؟', 'زمین کی کششِ ثقل کی وجہ سے چاند اس کے گرد گردش کرتا ہے۔'),
    ]));
    expect(has(flagOf(f, U('B.short')), /کشش ثقل/)).toBe(true);
  });
  test('Q1 i and Q1 ii: the key نظامِ شمسی is printed in the next stem', () => {
    const f = conceptRepeats(exam([
      mcq(U('A.mcq'), 'سورج اور تمام اجرامِ فلکی کے مجموعے کو کیا کہا جاتا ہے؟', ['الف) خلا', 'ب) کہکشاں', 'ج) نظامِ شمسی', 'د) مدار'], 'نظام'),
      mcq(U('A.mcq'), 'نظامِ شمسی میں کتنے سیارے شامل ہیں؟', ['الف) نو', 'ب) آٹھ', 'ج) دس', 'د) سات'], 'آٹھ'),
    ]));
    expect(has(flagOf(f, U('A.mcq')), /نظام شمس/)).toBe(true);
  });
  test('Q3 and Q5: the same vocabulary word is asked as a meaning and as a sentence', () => {
    const f = conceptRepeats(exam([
      it(U('B.meanings'), 'سوغات', 'تحفہ', { words: ['سوغات'] }),
      it(U('C.sentences'), 'لفظ «سوغات» کو جملے میں استعمال کریں۔', 'چچا میرے لیے مری سے سوغات لائے۔'),
    ]));
    expect(has(flagOf(f, U('C.sentences')), /سوغات/)).toBe(true);
  });
});

describe('G4 Science', () => {
  const S = (s) => `g4.science.${s}`;
  test('Q1 iii vs Q4 i: the key Steel is in the Q4 stem', () => {
    const f = conceptRepeats(exam([
      mcq(S('A.mcq'), 'Which of these materials passes heat through it quickly?', ['a) Wool', 'b) Paper', 'c) Steel'], 'Steel'),
      it(S('B.reasons'), 'Why does tea in a paper cup feel less hot to hold than tea in a steel cup?', 'Steel is a metal and metals are good conductors of heat.'),
    ]));
    expect(has(flagOf(f, S('B.reasons')), /steel/)).toBe(true);
  });
  test('Q1 ii vs Q3 iv: the key Buoyancy is a later stem', () => {
    const f = conceptRepeats(exam([
      mcq(S('A.mcq'), 'Which upward push from water keeps a big ship floating?', ['a) Buoyancy', 'b) Friction', 'c) Magnetism'], 'Buoyancy'),
      it(S('B.short'), 'What is buoyancy?', 'Buoyancy is the upward force that water puts on an object.'),
    ]));
    expect(has(flagOf(f, S('B.short')), /buoyancy/)).toBe(true);
  });
  test('Q4 ii and Q5 iii: the ship questions share their content', () => {
    const f = conceptRepeats(exam([
      it(S('B.reasons'), 'Why do huge ships carrying heavy cargo not sink in the ocean?', 'The water pushes up on the ship.'),
      it(S('C.extended'), 'A big iron ship carries heavy cargo but stays afloat on the ocean. Explain why it does not sink.', 'The water pushes up on the ship with an upward force.'),
    ]));
    expect(flagOf(f, S('C.extended')).with).toEqual([S('B.reasons')]);
  });
  test('Q4 i and Q5 iv: the paper-cup and steel-cup question twice', () => {
    const f = conceptRepeats(exam([
      it(S('B.reasons'), 'Why does tea in a paper cup feel less hot to hold than tea in a steel cup?', 'Steel is a good conductor of heat.'),
      it(S('C.extended'), 'Tea in a paper cup feels less hot than tea in a steel cup. Explain why, and say what this tells us about the two materials.', 'Steel is a metal.'),
    ]));
    expect(flagOf(f, S('C.extended')).with).toContain(S('B.reasons'));
  });
  test('parallel template items with different content are not the same item', () => {
    const f = conceptRepeats(exam([
      it('g3.english.A.grammar', 'Change into the plural: The path is long.', 'The paths are long.'),
      it('g3.english.A.grammar', 'Change into the plural: The child sat on a chair.', 'The children sat on chairs.'),
      it('g3.english.A.grammar', 'Change into the plural: A bird flew over the river.', 'Birds flew over rivers.'),
    ]));
    expect(f).toEqual([]);
  });
});

describe('holds and merging', () => {
  test('Islamiat, Social Studies and picture or oral items are not flagged', () => {
    const f = conceptRepeats(exam([
      mcq('g4.islamiat.A.mcq', 'Which is the key word?', ['a) Salah', 'b) Zakat'], 'Salah'),
      it('g4.islamiat.B.short', 'What is Salah?', 'Salah is prayer.'),
      mcq('g4.social_studies.A.mcq', 'Which is the key word?', ['a) Mountains', 'b) Rivers'], 'Mountains'),
      it('g4.social_studies.B.short', 'What are mountains?', 'Mountains are high land.'),
      it('g3.english.A.picture', 'Name the animal.', 'elephant', { picture: 'x' }),
      it('g3.english.B.picture', 'Name the animal.', 'elephant', { picture: 'x' }),
    ]));
    expect(f).toEqual([]);
  });
  test('Grades 1, 2 and 5 are untouched', () => {
    const f = conceptRepeats(exam([
      mcq('g5.science.A.mcq', 'Which force pushes up?', ['a) Buoyancy', 'b) Friction'], 'Buoyancy'),
      it('g5.science.B.short', 'What is buoyancy?', 'Buoyancy is an upward force.'),
    ]));
    expect(f).toEqual([]);
  });
  test('a clean paper has no flags', () => {
    expect(conceptRepeats(exam([
      mcq('g4.science.A.mcq', 'Which state of matter flows?', ['a) Liquid', 'b) Brick', 'c) Stone'], 'Liquid'),
      mcq('g4.science.A.mcq', 'Wires are usually made from which material?', ['a) Glass', 'b) Copper', 'c) Wood'], 'Copper'),
      it('g4.science.B.short', 'What is a vacuum?', 'An area that contains no matter.'),
      it('g4.science.B.short', 'Why do we wear a coat in winter?', 'It keeps the body warm.'),
    ]))).toEqual([]);
    expect(conceptRepeats(null)).toEqual([]);
  });
  test('answerRepeats carries the flags', () => {
    const e = exam([
      mcq('g3.english.A.mcq', 'What did Pinky eat for breakfast in Lahore?', ['a) Eggs', 'b) Halwa Puri', 'c) Paratha'], 'Halwa'),
      it('g3.english.B.short', 'What did Pinky have to eat in the morning?', 'Pinky had a breakfast of Halwa Puri.'),
    ]);
    expect(answerRepeats(e).find((f) => f.slot === 'g3.english.B.short')).toMatchObject({ with: expect.arrayContaining(['g3.english.A.mcq']) });
  });
});
