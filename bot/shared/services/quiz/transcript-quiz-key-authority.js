'use strict';
/**
 * KEY_BY_AUTHORITY — an answer justified by what was said in class, set against
 * the fact the item itself states.
 *
 * WHY. On staging a Proper Fraction quiz asked «ان میں سے کون سا Proper Fraction
 * نہیں ہے؟ 1/4 · 4/8 · 2/5» and keyed 4/8. All three are proper fractions. Its
 * explanation said so and then sided with the class: «… 4، 8 سے چھوٹا ہے، لیکن
 * استاد نے کلاس میں 4/8 کو Proper Fraction نہیں مانا تھا». A recording can hold
 * a mistake — a teacher misspeaks, or holds a wrong idea — and the author made
 * that mistake the key. A wrong key marks every child who knows the fact wrong.
 *
 * WHAT IS CAUGHT. Only the two shapes that concede: in the explanation or the
 * correct-answer feedback (the two texts that justify the key), a sentence where
 *   - a contrast («لیکن», «مگر», "but", "although", …) is followed at once by
 *     the teacher or the class («… لیکن استاد نے …», "… but the teacher …"), or
 *   - the teacher or the class is said NOT to accept or count something
 *     («استاد نے … نہیں مانا», "the teacher did not accept …").
 * Crediting the class with a fact is NOT caught: «جیسا کہ کلاس میں بتایا گیا
 * تھا», "as the teacher explained" — on production, 8,410 of 18,664 items
 * (1 – 24 Sep 2026) mention the teacher in these two texts, almost always like
 * that. The two shapes matched 5 of the 18,664: one a real case («The
 * butterfly.» keyed as a short sentence because "the teacher used it as an
 * example"), four where the teacher corrected a child or answered the question
 * asked. A match goes to the targeted rewrite, which may keep the question and
 * restate the reason by the fact; it is never shipped as it is.
 *
 * This is the narrow, certain half. A key defended by the class WITHOUT a
 * concession («the teacher described the cow's sound as 'Bhaoo, Bhaoo'») reads
 * like any other explanation; the blind solve without the lesson
 * (transcript-quiz-key-verify) is what catches those.
 *
 * Pure: a question in, one complaint or null out.
 */

const CONTRAST = '(?:لیکن|مگر|البتہ|تاہم|حالانکہ|پھر\\s+بھی|\\bbut\\b|\\bhowever\\b|\\balthough\\b|\\bthough\\b|\\byet\\b)';
const AUTHORITY = '(?:استاد|استانی|ٹیچر|معلم|معلمہ|میڈم|کلاس\\s+میں|جماعت\\s+میں|(?:the\\s+|our\\s+|your\\s+)?teacher\\b|\\bin\\s+(?:the\\s+)?class\\b|\\bsir\\b|\\bmiss\\b|\\bmadam\\b)';
/** A contrast, then the teacher or the class within two words: the fact conceded, then overridden. */
const CONCEDED = new RegExp(`${CONTRAST}[\\s,،]+(?:[^\\s,،.۔!؟?]+[\\s,،]+){0,2}?${AUTHORITY}`, 'i');
/** The teacher or the class refusing a thing: «نہیں مانا», "did not accept". */
// «نہیں» as a word of its own: «انہیں گننا» and «جنہیں گنا» hold the same letters.
const REFUSED = new RegExp(`${AUTHORITY}[^.۔!؟?]*?(?:(?:^|[\\s،,])نہیں\\s*(?:مان|گن|قبول)|قبول\\s*نہیں|\\b(?:did\\s*not|didn't|does\\s*not|doesn't|would\\s*not|wouldn't)\\s+(?:accept|count|agree))`, 'i');

const SENTENCE = /[^.۔!؟?\n]+[.۔!؟?]?/g;
const clean = (t) => String(t ?? '').replace(/[\u200e\u200f\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();

/** The first sentence of `text` that concedes the fact to the class, or null. */
function concedingSentence(text) {
  const sentences = clean(text).match(SENTENCE) || [];
  const hit = sentences.find((s) => CONCEDED.test(s) || REFUSED.test(s));
  return hit ? hit.trim() : null;
}

/**
 * KEY_BY_AUTHORITY for ONE question, or null. Reads the explanation and the
 * correct-answer feedback; the message is what the targeted rewrite reads, so it
 * quotes the sentence and says what to write instead.
 */
function keyByAuthorityError(q, i) {
  const fb = (q && q.option_feedback) || {};
  const fields = [['explanation', q && q.explanation], ['option_feedback.correct', fb.correct]];
  for (const [field, text] of fields) {
    const sentence = concedingSentence(text);
    if (sentence) {
      const quoted = [...sentence].length > 160 ? `${[...sentence].slice(0, 159).join('')}…` : sentence;
      return `q${i}: KEY_BY_AUTHORITY — the ${field} sets what was said in class against the fact: "${quoted}". `
        + 'A key is right by the subject — the definition, the rule, the sum, the spelling — never because the teacher said, used or accepted it. '
        + 'Mark as correct only the option that is right by the subject (change the options if none is), and give the fact as the reason.';
    }
  }
  return null;
}

module.exports = { keyByAuthorityError, concedingSentence };
