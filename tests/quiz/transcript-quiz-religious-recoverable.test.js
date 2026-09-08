'use strict';
/**
 * bd-mg9c7.95 — an Islamiyat lesson could produce NO quiz at all.
 *
 * Six offline runs of one real Islamiyat lesson shipped zero questions; in
 * three of them the ONLY complaint was `companion without honorific: حضرت سعد`.
 * Two separate defects made that terminal, and this suite pins both.
 *
 * 1. THE COMPLAINT WAS WRONG. The text the checker rejected reads
 *    «حضرت سعد بن ربیع رضی اللہ عنہ» — the honorific IS there. The name is a
 *    patronymic, and the checker captured at most two words after حضرت, then
 *    looked for the honorific after «سعد بن». So every correctly-honorified
 *    «حضرت X بن Y رضی اللہ عنہ» — the form the books print most companions in —
 *    was reported as bare. The model was right on every attempt; the checker
 *    was wrong.
 *
 * 2. THE COMPLAINT WAS UNCLEARABLE. It carried no `q<i>:` prefix, so
 *    rewriteTargets() refused the whole set (it needs every complaint to name a
 *    question) and salvageWithoutBadFigures() set other=true and returned null.
 *    A genuinely bare name has to be repairable, so the check now runs per
 *    question and reports `q<i>: RELIGIOUS_MARKS — …`.
 *
 * Fixtures are synthetic (COMMON rule 6). The Urdu here is name-and-honorific
 * text only, which is the whole point of the checker.
 */
const RM = require('../../bot/shared/services/quiz/religious-marks');
const V = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { rewriteTargets } = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');

const HON = 'رضی اللہ عنہ';

describe('1 — a patronymic companion name keeps its honorific', () => {
  test('«حضرت سعد بن ربیع رضی اللہ عنہ» is clean', () => {
    expect(RM.checkReligiousMarks(`حضرت سعد بن ربیع ${HON} نے پیشکش کی`)).toEqual([]);
  });

  test('«حضرت عبدالرحمن بن عوف رضی اللہ عنہ» is clean', () => {
    expect(RM.checkReligiousMarks(`حضرت عبدالرحمن بن عوف ${HON} نے جواب دیا`)).toEqual([]);
  });

  test('the sentence that failed all six eval runs is clean', () => {
    const stem = `حضرت سعد بن ربیع ${HON} نے حضرت عبدالرحمن بن عوف ${HON} کو کیا پیشکش کی تھی؟`;
    expect(RM.checkReligiousMarks(stem)).toEqual([]);
  });

  test('a kunya with a patronymic is clean: «حضرت ابو عبیدہ بن الجراح رضی اللہ عنہ»', () => {
    expect(RM.checkReligiousMarks(`حضرت ابو عبیدہ بن الجراح ${HON} امین الامت تھے`)).toEqual([]);
  });

  test('a female companion with a patronymic is clean: «حضرت زینب بنت خزیمہ رضی اللہ عنہا»', () => {
    expect(RM.checkReligiousMarks('حضرت زینب بنت خزیمہ رضی اللہ عنہا کا ذکر ہوا')).toEqual([]);
  });

  test('REGRESSION — a genuinely bare name is still caught', () => {
    expect(RM.checkReligiousMarks('حضرت سعد نے یہ بات کہی')).toEqual(
      expect.arrayContaining([expect.stringContaining('companion without honorific')]),
    );
  });

  test('REGRESSION — a bare patronymic name is still caught', () => {
    expect(RM.checkReligiousMarks('حضرت سعد بن ربیع نے یہ بات کہی')).toEqual(
      expect.arrayContaining([expect.stringContaining('companion without honorific')]),
    );
  });

  test('REGRESSION — the honorific may not be borrowed from a later, different name', () => {
    // «حضرت سعد» is bare; the honorific three words away belongs to ابوبکر.
    expect(RM.checkReligiousMarks(`حضرت سعد نے کہا کہ ابوبکر ${HON}`)).toEqual(
      expect.arrayContaining([expect.stringContaining('companion without honorific')]),
    );
  });

  // Both of the following were found by running the offline Islamiyat eval on
  // this branch: the patronymic fix let two lessons through, and the two
  // lessons that still failed did so on the SAME defect shape — the checker
  // demanding an honorific that is already on the page, one token to the right.

  test('a COMPOUND title carries its honorific after the last element', () => {
    // «نبی حضرت محمد ﷺ». The scan lands on «نبی» first and used to demand the
    // honorific right there, ignoring that the name continues.
    expect(RM.checkReligiousMarks('ہمارے پیارے نبی حضرت محمد ﷺ نے فرمایا')).toEqual([]);
    expect(RM.checkReligiousMarks('نبی حضرت محمد صلی اللہ علیہ وآلہ وسلم')).toEqual([]);
  });

  test('REGRESSION — a compound title with NO honorific at all is still caught', () => {
    expect(RM.checkReligiousMarks('نبی حضرت محمد نے فرمایا')).toEqual(
      expect.arrayContaining([expect.stringContaining('prophet mention without')]),
    );
  });

  test('«آنحضرت ﷺ» is clean — the companion rule must not read حضرت inside it', () => {
    // COMPANION_RE has no left boundary, so it matched the حضرت inside
    // آنحضرت and reported «حضرت ﷺ» as a companion with no honorific.
    expect(RM.checkReligiousMarks('آنحضرت ﷺ نے فرمایا')).toEqual([]);
    expect(RM.checkReligiousMarks('آں حضرت ﷺ کا ارشاد')).toEqual([]);
  });

  test('a Prophet token INSIDE a longer word is not a mention of the Prophet', () => {
    // «نبیوں» is the plural "prophets"; «انبیاء» likewise. Neither is a
    // mention of the Prophet ﷺ, and neither takes his honorific. The token
    // list is scanned without a word boundary (JS \b is ASCII-only), so both
    // used to demand ﷺ — and one Islamiyat lesson failed on exactly that.
    expect(RM.checkReligiousMarks('اللہ تعالیٰ کی طرف سے نبیوں کی سچائی')).toEqual([]);
    expect(RM.checkReligiousMarks('انبیاء کرام کی تعلیمات')).toEqual([]);
    expect(RM.checkReligiousMarks('نبیوں پر ایمان لانا فرض ہے')).toEqual([]);
  });

  test('REGRESSION — the bare token as a whole word still demands ﷺ', () => {
    expect(RM.checkReligiousMarks('نبی نے فرمایا')).toEqual(
      expect.arrayContaining([expect.stringContaining('prophet mention without')]),
    );
    expect(RM.checkReligiousMarks('حضرت محمد نے فرمایا')).toEqual(
      expect.arrayContaining([expect.stringContaining('prophet mention without')]),
    );
    expect(RM.checkReligiousMarks('نبی کریم نے فرمایا')).toEqual(
      expect.arrayContaining([expect.stringContaining('prophet mention without')]),
    );
  });

  test('«حضرت محمد ﷺ» is clean — rule 1 owns the Prophet, not rule 3', () => {
    expect(RM.checkReligiousMarks('حضرت محمد ﷺ نے فرمایا')).toEqual([]);
  });

  test('REGRESSION — the two other rules are untouched', () => {
    expect(RM.checkReligiousMarks('نبی کریم نے فرمایا')).toEqual(
      expect.arrayContaining([expect.stringContaining('prophet mention without')]),
    );
    expect(RM.checkReligiousMarks('Allah کا نام')).toEqual(
      expect.arrayContaining([expect.stringContaining('latin-script sacred name')]),
    );
  });
});

// ── the validator: the complaint names its question ─────────────────────────
const DIGEST = {
  slos: [
    { id: 'S1', statement_ur: 'مواخات مدینہ کا مطلب بتانا', taught_level: 'recall' },
    { id: 'S2', statement_ur: 'انصار و مہاجرین کے رشتے کی وضاحت کرنا', taught_level: 'understand' },
  ],
};

function q(i, overrides = {}) {
  return {
    slo_id: 'S1', level: 'recall',
    question: `مواخات مدینہ کے بارے میں سوال نمبر ${i}؟`,
    options: [`پہلا جواب ${i}`, `دوسرا جواب ${i}`, `تیسرا جواب ${i}`],
    correct_index: 0,
    explanation: `اس کی وضاحت یہ ہے کہ سوال ${i} کا جواب پہلا ہے۔`,
    selected_because: 'یہ سبق کے اس حصے کو جانچتا ہے۔',
    distractor_misconceptions: { 1: 'دوسرے کو درست سمجھنا', 2: 'تیسرے کو درست سمجھنا' },
    option_feedback: {
      correct: 'درست — یہی بات سبق میں پڑھائی گئی تھی۔',
      wrong: { 1: 'یہ درست نہیں؛ سبق میں پہلا جواب بتایا گیا تھا۔',
               2: 'یہ بھی درست نہیں؛ سبق میں پہلا جواب بتایا گیا تھا۔' },
    },
    ...overrides,
  };
}

function eight() {
  return [
    q(1), q(2, { slo_id: 'S2', level: 'understand' }), q(3),
    q(4, { slo_id: 'S2', level: 'understand' }), q(5),
    q(6, { slo_id: 'S2', level: 'understand' }), q(7),
    q(8, { slo_id: 'S2', level: 'apply' }),
  ];
}

const ctx = {
  language: 'ur', subject: 'islamiat', digest: DIGEST, nExpected: 8,
  lessonSummary: 'اس سبق میں مواخات مدینہ اور انصار و مہاجرین کے رشتے پر بات ہوئی۔',
};

/** Only the religious complaints, so an unrelated fixture drift cannot hide the point. */
const religious = (errs) => errs.filter((e) => /honorific|RELIGIOUS_MARKS|ﷺ|sacred name/.test(e));

describe('2 — a religious-marks complaint names the question that carries it', () => {
  test('a bare companion name in q3 is reported as q3: RELIGIOUS_MARKS', () => {
    const qs = eight();
    qs[3].question = 'حضرت سعد نے مہاجرین کے لیے کیا پیشکش کی؟';
    const r = V.validate(qs, ctx);
    expect(religious(r.errors)).toEqual([
      expect.stringMatching(/^q3: RELIGIOUS_MARKS — .*companion without honorific/),
    ]);
  });

  test('a bare Prophet mention in q0 is reported as q0: RELIGIOUS_MARKS', () => {
    const qs = eight();
    qs[0].explanation = 'نبی کریم نے مواخات کا حکم دیا۔';
    const r = V.validate(qs, ctx);
    expect(religious(r.errors)).toEqual([
      expect.stringMatching(/^q0: RELIGIOUS_MARKS — .*prophet mention without/),
    ]);
  });

  test('two questions at fault produce two q-prefixed complaints', () => {
    const qs = eight();
    qs[1].question = 'حضرت سعد نے کیا کہا؟';
    qs[5].explanation = 'نبی کریم نے یہ بات بتائی۔';
    const codes = religious(V.validate(qs, ctx).errors).map((e) => e.split(':')[0]);
    expect(codes).toEqual(['q1', 'q5']);
  });

  test('the honorified patronymic quiz that failed six eval runs now validates', () => {
    const qs = eight();
    qs[6].question = `حضرت سعد بن ربیع ${HON} نے حضرت عبدالرحمن بن عوف ${HON} کو کیا پیشکش کی؟`;
    qs[6].explanation = `حضرت سعد بن ربیع ${HON} نے اپنی آدھی جائیداد کی پیشکش کی تھی۔`;
    expect(religious(V.validate(qs, ctx).errors)).toEqual([]);
  });

  test('a non-Islamiyat English quiz is not scanned at all', () => {
    const qs = eight();
    qs[2].question = 'Allah is written here';
    const r = V.validate(qs, { ...ctx, subject: 'science', language: 'ur' });
    expect(religious(r.errors)).toEqual([]);
  });
});

describe('3 — the complaint is now one the targeted rewrite can repair', () => {
  test('rewriteTargets accepts a q-prefixed RELIGIOUS_MARKS complaint', () => {
    const t = rewriteTargets(['q3: RELIGIOUS_MARKS — companion without honorific: حضرت سعد']);
    expect(t.indices).toEqual([3]);
  });

  test('it still refuses a quiz-level complaint', () => {
    expect(rewriteTargets(['companion without honorific: حضرت سعد']).indices).toEqual([]);
  });

  test('one honorific fault ships eight questions after one rewrite', () => {
    const qs = eight();
    qs[3].question = 'حضرت سعد نے مہاجرین کے لیے کیا پیشکش کی؟';
    const errors = V.validate(qs, ctx).errors;
    // Every complaint names a question, so the rewrite is reachable...
    const t = rewriteTargets(errors);
    expect(t.indices).toEqual([3]);
    // ...and the repaired question, merged back, leaves the set valid at eight.
    const { mergeReplacements } = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');
    // The replacement names neither slo_id nor level, so it inherits q3's —
    // the contract mergeReplacements asserts, and what keeps the level mix
    // intact when a repair lands on an "understand" question.
    const { slo_id: _s, level: _l, ...replacement } = q(4);
    const merged = mergeReplacements(qs, {
      questions: [{ index: 3, ...replacement, question: `حضرت سعد بن ربیع ${HON} نے کیا پیشکش کی؟` }],
    }, t);
    const after = V.validate(merged.questions, ctx);
    expect(after.errors).toEqual([]);
    expect(after.questions).toHaveLength(8);
  });
});
