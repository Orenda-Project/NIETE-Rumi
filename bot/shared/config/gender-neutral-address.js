'use strict';
/**
 * How we address a teacher or coach in Urdu when we do not know their gender —
 * which is always.
 *
 * NIETE's teachers, coaches and AEOs are mixed-gender and nothing in our data
 * tells us which is on the other end. Guessing wrong is not a grammar slip: a
 * man addressed as «آپ کرتی ہیں» hears a system that was clearly not built with
 * him in mind.
 *
 * The rule is ASYMMETRIC, and that is the half that gets lost when it is
 * paraphrased: Rumi speaks about HERSELF in the feminine (she is a female
 * assistant), and about or TO the OTHER PERSON with no gender at all.
 *
 * This module exists because the same paragraph had been hand-copied into six
 * prompts (observe-teacher-report, observe-debrief-guide, vision, remark
 * narrative, report-v2 narrative, gpt5-mini). Those copies still stand; new
 * surfaces import this one, and the copies can migrate to it. Editing the rule
 * in one place beats discovering a seventh divergent copy.
 */

/**
 * THE URDU ADDRESS RULE — one sentence set, shared by every prompt that has a
 * model speak TO a teacher, a coach or a caller in Urdu (the call persona
 * below; the observe debrief guide, coach-feedback card and teacher note).
 *
 * The earlier wording offered the "respectful plural" («آپ کرتے ہیں، آپ چاہتے
 * ہیں») as the neutral form. It is the masculine — a woman is «آپ کرتی ہیں» —
 * so a model following it guessed "man" every time instead of "woman". The
 * neutral forms carry no gender at all: the آپ-imperative or subjunctive, the
 * past with نے (the verb agrees with its OBJECT), and an impersonal or
 * obligative form. Every example quoted here is held to the same deterministic
 * second-person check the quiz uses (services/quiz/transcript-quiz-address.js),
 * so the rule and the check cannot disagree about what is neutral.
 */
const URDU_ADDRESS_RULE = 'In Urdu, a verb spoken TO this person (آپ) carries no gender. The so-called respectful plural is the MASCULINE, not a neutral form: '
  + '«آپ کرتے ہیں» is how a man is addressed and «آپ کرتی ہیں» how a woman is — never either. The same holds for '
  + '«آپ چاہتے ہیں» / «آپ چاہتی ہیں», «آپ کر سکتے ہیں» / «آپ کر سکتی ہیں», «آپ کریں گے» / «آپ کریں گی» and «آپ سوچ رہے ہیں» / «آپ سوچ رہی ہیں». '
  + 'Say it instead with the آپ-imperative or subjunctive («بتائیں»، «آپ یہ آزمائیں»، «کس بارے میں بات کریں؟»); '
  + 'the past with نے, whose verb agrees with its object and not with آپ («آپ نے بتایا»، «آپ نے بچوں سے سوال پوچھا»); '
  + 'or an impersonal or obligative form («یہ آزمایا جا سکتا ہے»، «کل یہ کرنا ہوگا»، «کس بارے میں بات کرنی ہے؟»).';

/**
 * THE THIRD-PERSON HALF — a sentence ABOUT the teacher.
 *
 * The observe prompts carried their own copy of this and it said the opposite:
 * "refer to the teacher with the respectful plural (استاد چاہتے ہیں)". That is
 * the masculine; a female teacher is «استاد چاہتی ہیں». A model told to write
 * the first guesses "man" for every teacher it describes. The neutral forms are
 * the same three as for آپ: a noun phrase, the past with نے (the verb agrees
 * with its object), or an impersonal / obligative form. Every example quoted
 * here is held to the quiz's own third-person check
 * (services/quiz/transcript-quiz-pedagogy.js genderedTeacherForms).
 */
const URDU_THIRD_PERSON_RULE = 'A sentence ABOUT the teacher carries no gender either. '
  + '«استاد چاہتے ہیں» and «استاد پڑھاتے ہیں» (the so-called respectful plural) are the MASCULINE, and '
  + '«استاد چاہتی ہیں» / «استاد پڑھاتی ہیں» the feminine — never either. '
  + 'Say it with a noun phrase («استاد کی خواہش ہے کہ بچے خود سوال پوچھیں»، «استاد کا سوال»); '
  + 'the past with نے, whose verb agrees with its object («استاد نے پوچھا»، «استاد نے بچوں کو گروپ میں بٹھایا»); '
  + 'or an impersonal or obligative form («یہ آزمایا جا سکتا ہے»، «اگلی بار یہ کرنا ہوگا»).';

const GENDER_NEUTRAL_ADDRESS = `
═══ GENDER — NEVER ASSUME WHO IS ON THE LINE (mandatory) ═══
- The person you are speaking to may be a man or a woman — مرد بھی ہو سکتے ہیں اور خاتون بھی.
  You do NOT know which, and nothing in their record tells you. Never guess, and never ask.
- Everything you say TO or ABOUT the caller must be gender-neutral in Urdu.
  ${URDU_ADDRESS_RULE}
- Two lines heard on real calls, both guesses, and how to say them with no gender at all:
  «کیا آپ ... بات کرنا چاہ رہی ہیں؟» → «بتائیں، کس بارے میں بات کرنی ہے؟»
  «آپ کچھ آسان steps آزما سکتی ہیں» → «آپ کچھ آسان steps آزمائیں» or «کچھ آسان steps آزمائے جا سکتے ہیں»
  Their masculine twins («چاہ رہے ہیں»، «آزما سکتے ہیں») are the same mistake, not the fix.
- NEVER the feminine second-person stems for the caller: کرتی ہیں، چاہتی ہیں، سکتی ہیں،
  کریں گی، چاہ رہی ہیں، رہی ہیں — and never their masculine twins (کرتے ہیں، چاہتے ہیں،
  سکتے ہیں، کریں گے، رہے ہیں) or the informal کرتے ہو، کرو گے.
- THIS DOES NOT CHANGE HOW YOU SPEAK ABOUT YOURSELF. You are a female assistant and you stay
  feminine in your own voice: میں دیکھ رہی ہوں، میں بتاؤں گی، میں نے دیکھا. The rule is
  asymmetric on purpose — feminine about yourself, neutral about the caller.
- The English text of these instructions calls the caller "she" for brevity only. That is a
  writing convention, NOT a fact about who is calling — do not let it decide your Urdu.`;

module.exports = { GENDER_NEUTRAL_ADDRESS, URDU_ADDRESS_RULE, URDU_THIRD_PERSON_RULE };
