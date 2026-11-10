/**
 * bd-2453 — GENDER-NEUTRAL URDU for every teacher-facing surface.
 *
 * There is NO gender column anywhere in the schema, so ANY gendered Urdu
 * addressing (or describing) the teacher is a hardcoded assumption — a male
 * teacher receiving "آپ چاہتی ہیں" is the bug the operator asked about
 * ("if it's a male teacher it won't use female pronouns?").
 *
 * The workspace rule (Urdu-gender memory + bd-2220 PRONOUN_RULE):
 *  - when ADDRESSING the teacher: never feminine 2nd-person verb stems
 *    (سکتی ہیں / چاہتی ہیں / کرتی ہیں / چاہیں گی) — use the respectful
 *    آپ-imperative, impersonal reframes, or noun-agreement;
 *  - when DESCRIBING an unknown teacher in 3rd person: respectful plural
 *    (چاہتے ہیں) or impersonal passive — never feminine singular habitual;
 *  - Rumi's OWN first-person voice may stay female (میں کر رہی ہوں is fine).
 *
 * Two layers of guard:
 *  A. STATIC STRINGS — source-level regex over the teacher-facing modules.
 *  B. LLM PROMPTS — every prompt that generates Urdu about/to the teacher
 *     must carry an explicit gender-neutral-Urdu instruction block.
 */

const fs = require('fs');
const path = require('path');

const SRC = (p) => fs.readFileSync(path.join(__dirname, '../../shared', p), 'utf8');

// ── A. static strings ──────────────────────────────────────────────────────

// Feminine 2nd-person: آپ …(same clause)… feminine stem. The clause bound (no
// ۔ or newline in between) keeps noun-agreement forms legal ("تصاویر بھیجی جا
// سکتی ہیں" has no آپ in the clause; "آپ کی تصاویر مل گئیں" agrees with the
// noun and uses none of the banned stems).
const FEM_2P = /آپ[^۔\n'"`]{0,60}?(سکتی ہیں|چاہتی ہیں|کرتی ہیں|دیتی ہیں|رہی ہیں|چاہیں گی|کریں گی|دیں گی|سوچ رہی ہوں گی)/g;

// Feminine 3rd-person habitual ABOUT the teacher (وہ …تی ہیں) — the
// support-moves pattern ("وہ خود کس چیز میں مدد چاہتی ہیں").
const FEM_3P_TEACHER = /وہ[^۔\n'"`]{0,50}?(چاہتی ہیں|کرتی ہیں|دیتی ہیں|دکھاتی ہیں|پڑھاتی ہیں)/g;

// Files whose Urdu strings are sent VERBATIM to users and address or describe
// the TEACHER. (Rumi's own first-person feminine voice — بھیجوں گی، رہی ہوں —
// is NOT matched by the patterns above, by design. System prompts that address
// the MODEL as a female آپ — openai/vision — are covered by test group B
// instead, since their آپ is the assistant persona, not the teacher.)
const TEACHER_FACING_FILES = [
  'handlers/image-message.handler.js',
  'services/pic-to-lp/page-collector.service.js',
  'services/observe/observe-support-moves.js',
  'services/observe/observe-strings.js',
  'services/coaching/reflective-questions/guardrails.js',
  'services/observe/observe-brief-card.js',
];

describe('bd-2453 A — static Urdu strings are gender-neutral toward the teacher', () => {
  test.each(TEACHER_FACING_FILES)('%s has no feminine 2nd-person stems addressing آپ', (file) => {
    const hits = SRC(file).match(FEM_2P) || [];
    expect(hits).toEqual([]);
  });

  test('observe-support-moves has no feminine 3rd-person habitual about the teacher', () => {
    const hits = SRC('services/observe/observe-support-moves.js').match(FEM_3P_TEACHER) || [];
    expect(hits).toEqual([]);
  });

  test('observe-brief-card EN/AR strings do not assume the teacher is female', () => {
    const src = SRC('services/observe/observe-brief-card.js');
    expect(src).not.toMatch(/work on with her\b/);
    expect(src).not.toMatch(/معها/);
  });
});

// ── B. LLM prompts carry the neutral-Urdu instruction ──────────────────────

// The marker every Urdu-emitting prompt must carry. Written in the prompt as
// either the English rule ("gender-neutral") or the Urdu formulation
// (مرد … خاتون). Matching either keeps wording free while pinning intent.
const NEUTRAL_MARKER = /gender[- ]neutral|مرد[^\n]{0,40}خاتون/i;

describe('bd-2453 B — Urdu-emitting prompts instruct gender-neutral output', () => {
  test('observe teacher-report debrief-notes prompt (ur) instructs neutral Urdu', () => {
    const { buildDebriefNotesPromptI18n } = require('../../shared/services/observe/observe-teacher-report');
    const p = buildDebriefNotesPromptI18n('T: transcript', { foName: 'Ali' }, 'ur');
    expect(p).toMatch(NEUTRAL_MARKER);
  });

  test('coach-feedback prompt (ur) instructs neutral Urdu and never says "her own"', () => {
    const { buildCoachFeedbackPromptI18n } = require('../../shared/services/observe/observe-coach-feedback');
    const p = buildCoachFeedbackPromptI18n('T: transcript', { foName: 'Ali' }, 'ur');
    expect(p).toMatch(NEUTRAL_MARKER);
    // "in her own words" / "her OWN if–then" bias the model into feminine Urdu
    expect(p).not.toMatch(/\bher\b/i);
  });

  test('debrief-guide prompt (ur) instructs neutral Urdu for say_this lines', () => {
    const { buildGuidePrompt } = require('../../shared/services/observe/observe-debrief-guide');
    const p = buildGuidePrompt({ focus_area: {} }, { language: 'ur' });
    expect(p).toMatch(NEUTRAL_MARKER);
  });

  test('HOTS observe Urdu analysis prompt instructs neutral Urdu about the teacher', () => {
    const src = SRC('services/observe/observe-framework.js');
    // the ur prompt branch must carry the Urdu neutral rule
    expect(src).toMatch(/مرد[^\n]{0,60}خاتون/);
  });

  test('chat system prompt scopes female verb forms to Rumi\'s OWN voice only', () => {
    const src = SRC('services/openai.service.js');
    // The unqualified "Use female verb forms in Urdu" made the model address
    // male teachers with feminine stems. The instruction must scope female
    // forms to the assistant's first person AND require neutral addressing.
    expect(src).toMatch(/first.person|OWN voice/i);
    expect(src).toMatch(NEUTRAL_MARKER);
  });

  test('vision (image analysis) Urdu prompt instructs neutral addressing', () => {
    const src = SRC('services/vision.service.js');
    expect(src).toMatch(/مرد[^\n]{0,60}خاتون|gender[- ]neutral/i);
  });
});
