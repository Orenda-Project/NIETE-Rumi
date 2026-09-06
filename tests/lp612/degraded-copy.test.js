/**
 * WHAT THE TEACHER IS TOLD WHEN A LESSON ARRIVES IMPERFECT, OR DOES NOT ARRIVE — bd-oak77.14.
 *
 * Root rule 24(d): failure copy that does not name the actual state misdirects every field report
 * and every engineer who reads them. On 2026-09-06 the first Urdu tap on production hit
 * `FIGURE TOO SMALL` and the teacher received `lp612Failed` —
 *
 *   "I could not finish that lesson plan this time. Please tap it again in a few minutes and I
 *    will try once more."
 *
 * — which is what she is told for an author timeout, a stranded worker, a missing page-truth and a
 * renderer crash as well. Four states, one sentence, and the lesson had in fact been finished:
 * a complete 17-page document was sitting on disk. She re-typed "Lesson plan" 43 seconds later.
 *
 * TWO strings change that, and no more, because a catalog grows by earning entries:
 *
 *   `lp612RenderDegraded`  — APPENDED to the caption of a lesson that IS being delivered with a
 *                            layout defect. Names the state (something looks tight), says nothing
 *                            is missing (true — the document is whole), and gives her the one
 *                            action worth taking (look before printing).
 *   `lp612Unrenderable`    — for the failures that survive the never-fail policy: the pages could
 *                            not be laid out at all. Distinct from "I ran out of time", because
 *                            those are distinct things and the retry means something different.
 *
 * CAPS (language-protocol §3), in CODE POINTS: both ride in `body.text` (1024) — the first is
 * appended to `lp612Caption` on a document send, the second is a plain message. Neither is a
 * footer (60) or a button (20).
 *
 * URDU VOICE: every verb agrees with a NOUN (سبق, حصہ, خاکہ, صفحات, نسخہ) or is an imperative —
 * never a gendered second-person stem — because the NIETE cohort is mixed and the bot cannot know.
 */

const UX = require('../../bot/shared/config/ux-strings');
const UX_STRINGS = UX.UX_STRINGS || UX.STRINGS || UX;

const cp = (s) => [...s].length;
const NEW_KEYS = ['lp612RenderDegraded', 'lp612Unrenderable'];

describe('the new states have their own sentences', () => {
  test.each(NEW_KEYS)('%s exists in BOTH languages — a partial map degrades Urdu to English', (k) => {
    const s = UX_STRINGS[k];
    expect(s).toBeTruthy();
    expect(typeof s.en).toBe('string');
    expect(typeof s.ur).toBe('string');
    expect(s.en.trim().length).toBeGreaterThan(0);
    expect(s.ur.trim().length).toBeGreaterThan(0);
  });

  test.each(NEW_KEYS)('%s fits body.text (1024) measured in CODE POINTS, in both languages', (k) => {
    // `.length` and `[...s].length` diverge on Urdu and emoji, and an off-by-a-surrogate count is
    // how a string passes locally and is REJECTED whole by Meta.
    const s = UX_STRINGS[k];
    expect(cp(s.en)).toBeLessThanOrEqual(1024);
    expect(cp(s.ur)).toBeLessThanOrEqual(1024);
    // …and leaves room for the caption it is appended to (topic + grade + subject + pages).
    expect(cp(s.en)).toBeLessThanOrEqual(400);
    expect(cp(s.ur)).toBeLessThanOrEqual(400);
  });

  test.each(NEW_KEYS)('%s addresses her without a gendered verb stem', (k) => {
    // The exact patterns honest-eta.test.js pins for the rest of this catalog.
    expect(UX_STRINGS[k].ur).not.toMatch(/رہی\s+ہوں\s+گی|رہے\s+ہوں\s+گے|کر\s+رہی\s+ہیں|کر\s+رہے\s+ہیں/);
  });

  test.each(NEW_KEYS)('%s is Urdu, not Roman-Urdu', (k) => {
    expect(UX_STRINGS[k].ur).toMatch(/[؀-ۿ]/);
    // no Latin letters at all beyond what an isolated atom would need — there are none here
    expect(UX_STRINGS[k].ur.replace(/[^A-Za-z]/g, '')).toBe('');
  });

  test('lp612RenderDegraded says nothing is MISSING — because nothing is', () => {
    // The document is whole; only its layout is imperfect. Copy that hinted at loss would send
    // her hunting for content that is on the page.
    expect(UX_STRINGS.lp612RenderDegraded.en).toMatch(/nothing is missing/i);
  });

  test('lp612Unrenderable does NOT claim the lesson was never written', () => {
    // It was. Saying otherwise is the same misdirection lp612Failed produced on 2026-09-06.
    expect(UX_STRINGS.lp612Unrenderable.en).toMatch(/written|wrote/i);
    expect(UX_STRINGS.lp612Unrenderable.en).not.toBe(UX_STRINGS.lp612Failed.en);
  });
});

describe('the caption carries the honesty line on a degraded delivery', () => {
  const { buildCaption } = require('../../bot/shared/services/lp612-serving.service');
  const SEGMENT = {
    segment_id: 'grade_12_chemistry.c14.p227-230',
    subtopic_title: 'AI in drug discovery',
    grade: 12,
    subject: 'Chemistry',
    printed_page_start: 227,
    printed_page_end: 230,
  };

  test('a degraded delivery appends the line — in English', () => {
    const c = buildCaption(SEGMENT, 'en', { renderDegraded: true });
    expect(c).toContain(UX_STRINGS.lp612RenderDegraded.en);
  });

  test('a degraded delivery appends the line — in Urdu', () => {
    const c = buildCaption(SEGMENT, 'ur', { renderDegraded: true });
    expect(c).toContain(UX_STRINGS.lp612RenderDegraded.ur);
  });

  test('a clean delivery says nothing extra', () => {
    const c = buildCaption(SEGMENT, 'en', { renderDegraded: false });
    expect(c).not.toContain(UX_STRINGS.lp612RenderDegraded.en);
    expect(buildCaption(SEGMENT, 'en')).toBe(c);
  });

  test('a degraded URDU delivery that ALSO lost its overlay carries BOTH lines', () => {
    // Two different facts about the same file. Dropping either because the other is present is
    // how one shared sentence starts standing in for several states again.
    const c = buildCaption(SEGMENT, 'ur', { renderDegraded: true, overlayDropped: true });
    expect(c).toContain(UX_STRINGS.lp612OverlayDropped.ur);
    expect(c).toContain(UX_STRINGS.lp612RenderDegraded.ur);
  });
});

describe('the failure copy names its state', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'bot', 'workers', 'lp612-author.worker.js'), 'utf8',
  );

  test('RENDER_FAILED no longer shares lp612Failed with the timeouts', () => {
    // Source-level, and deliberately narrow: this asserts the ROUTING TABLE exists, while the
    // worker suites above execute the delivery path itself. (A source assertion alone would be
    // vacuous — language-protocol §7.)
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');   // strip comments FIRST
    expect(code).toMatch(/UNRENDERABLE_CODES/);
    expect(code).toMatch(/lp612Unrenderable/);
  });
});
