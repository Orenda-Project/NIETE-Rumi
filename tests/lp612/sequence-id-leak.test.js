/**
 * bd-w56zx — internal segment ids must never reach the teacher-facing sequence strip.
 *
 * WHAT A TEACHER SAW
 *
 * The first native-Urdu render printed, on page 1, directly under the masthead:
 *
 *     previous: grade_10_urdu.p1c01.r990
 *
 * `sequence.previous` is rendered verbatim by the template (lib/template.js:1043),
 * so an internal corpus id was painted onto a lesson plan a teacher prints and
 * takes into a classroom.
 *
 * WHY THE MODEL DID IT — this is a prompt defect, not a model failure.
 *
 * buildUserPrompt hands the model:
 *
 *     where this sits: previous <prev_segment_id> · next <next_segment_id>
 *
 * Raw internal ids, labelled with the EXACT words of the teacher-facing fields
 * ("previous" / "next"). The model did the reasonable thing and copied them
 * through. Any model would.
 *
 * SO THE FIX IS BOTH HALVES, AND THE CODE HALF IS THE LOAD-BEARING ONE.
 *
 * The prompt stops labelling internal ids with output-field names. But a prompt
 * instruction is not an input contract — the model complies almost always and
 * freestyles the rest, which is the failure mode root CLAUDE.md rule 24(c) names.
 * So `sanitizeSequence` also runs in CODE before the gates, on the first parse and
 * on every revision round, exactly as sanitizeOverlay does.
 *
 * It never invents. For the three NULLABLE fields it drops the value. For `this`
 * — required, minLength 3 — it substitutes the segment's own human title, which we
 * already know from the row, rather than leaving an id or an empty string.
 */

const { sanitizeSequence } = require('../../bot/shared/services/lp612-author.service');

const SEGMENT = {
  segment_id: 'grade_10_urdu.p1c01.r991',
  prev_segment_id: 'grade_10_urdu.p1c01.r990',
  next_segment_id: 'grade_10_urdu.p1c01.r992',
  subtopic_title: 'اخلاقِ نبوی',
  menu_title: 'اخلاقِ نبوی',
  book_stem: 'grade_10_urdu',
};

describe('bd-w56zx — sanitizeSequence', () => {
  test('drops a previous that is the literal prev_segment_id — the reported bug', () => {
    const doc = { sequence: { previous: 'grade_10_urdu.p1c01.r990', this: 'Akhlaq-e-Nabvi' } };
    const notes = sanitizeSequence(doc, SEGMENT);

    expect(doc.sequence.previous).toBeNull();
    expect(notes.length).toBeGreaterThan(0);
  });

  test('drops a next that is the literal next_segment_id', () => {
    const doc = { sequence: { previous: null, this: 'Lesson', next: 'grade_10_urdu.p1c01.r992' } };
    sanitizeSequence(doc, SEGMENT);
    expect(doc.sequence.next).toBeNull();
  });

  test('drops an id-shaped value even when it is not one of the ids we passed', () => {
    // The model can invent a plausible id, and a teacher cannot tell the difference.
    const doc = { sequence: { previous: 'grade_9_physics.c01.p008-009', this: 'Lesson' } };
    sanitizeSequence(doc, SEGMENT);
    expect(doc.sequence.previous).toBeNull();
  });

  test('an id embedded in an otherwise human sentence is still removed', () => {
    const doc = { sequence: { previous: 'Previous: grade_10_urdu.p1c01.r990', this: 'Lesson' } };
    sanitizeSequence(doc, SEGMENT);
    expect(doc.sequence.previous).toBeNull();
  });

  test('`this` is REQUIRED, so an id there is replaced with the segment title, never nulled', () => {
    // Nulling a required minLength-3 field would make the document schema-invalid
    // and cost the whole ladder round — a worse outcome than the leak.
    const doc = { sequence: { previous: null, this: 'grade_10_urdu.p1c01.r991' } };
    sanitizeSequence(doc, SEGMENT);

    expect(doc.sequence.this).toBe('اخلاقِ نبوی');
    expect(doc.sequence.this.length).toBeGreaterThanOrEqual(3);
  });

  test('checkpoint is sanitised too', () => {
    const doc = { sequence: { this: 'Lesson', checkpoint: 'grade_10_urdu.p1c01.r999' } };
    sanitizeSequence(doc, SEGMENT);
    expect(doc.sequence.checkpoint).toBeNull();
  });

  test('LEGITIMATE human titles are left completely alone — including Urdu, digits and dots', () => {
    const doc = {
      sequence: {
        previous: 'Chemistry & its branches',
        this: 'اخلاقِ نبوی',
        next: 'Section 1.2 — Physical quantities',
        checkpoint: 'Ch. 3 assessment (day 12)',
      },
    };
    const before = JSON.parse(JSON.stringify(doc));
    const notes = sanitizeSequence(doc, SEGMENT);

    // A sanitiser that eats real content is worse than the bug it fixes.
    expect(doc).toEqual(before);
    expect(notes).toEqual([]);
  });

  test('a document with no sequence at all is untouched and does not throw', () => {
    const doc = { lesson_id: 'x' };
    expect(() => sanitizeSequence(doc, SEGMENT)).not.toThrow();
    expect(doc.sequence).toBeUndefined();
  });
});

describe('bd-w56zx — the prompt must not label internal ids with output-field names', () => {
  const { buildUserPrompt } = require('../../bot/shared/services/lp612-author.service');

  test('the user prompt does not present raw segment ids as "previous"/"next"', () => {
    const prompt = buildUserPrompt({
      segment: SEGMENT,
      bundle: { book: {}, toc: {}, pages: [] },
      lang: 'ur',
      video: null,
    });

    // The ids may still appear (they are useful ordering context), but never on a
    // line that names them with the teacher-facing field labels — that framing is
    // what invited the copy-through.
    const offending = prompt
      .split('\n')
      .filter((l) => /where this sits/i.test(l) && /grade_10_urdu\.p1c01\.r99[02]/.test(l));
    expect(offending).toEqual([]);
  });
});
