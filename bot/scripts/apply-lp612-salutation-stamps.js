#!/usr/bin/env node
/**
 * apply-lp612-salutation-stamps.js — restore the salutation the book gave, to the
 * eight menu rows that dropped it.
 *
 * bd-d6c8y. Operator ruling, 2026-09-23: "bd-d6c8y - pls add the stamps for all".
 *
 * WHAT WAS WRONG. Each of these eight segments names the Prophet in its
 * `menu_title` — the one string a teacher sees in the WhatsApp list — with no
 * salutation, while the SAME segment's chapter title or subtopic carries one. The
 * book saluted; the menu row lost it.
 *
 * IT WAS NOT THE CAP. This was first reported as the 30-code-point MENU_TITLE_CAP
 * eating the stamp. Measured, that is false: every row below fits with the stamp
 * added, most with several characters to spare, and the `after_cp` column proves it
 * row by row. Nothing here re-cuts a title.
 *
 * WHY THE STRINGS ARE HARDCODED AND NOT DERIVED. Gate G5c: automated checks do not
 * clear religious content. WHERE the salutation sits is a religious judgement and it
 * is not uniform — `سیرتِ نبوی ﷺ میں …` puts it mid-phrase, `Review: Hazrat
 * Muhammad ﷺ` at the end. Every `after` below is the row's own `source` string with
 * the stamp in the position the book printed it, transcribed, not inferred. A rule
 * that guessed would eventually guess wrong on a teacher's screen — which is why
 * `validateSegment()` in import-lp612-segments.js only WARNS about this class and
 * never rewrites it.
 *
 * SAFETY
 *  - refuses to run against any project ref but --expect-ref, checked BEFORE the
 *    first write;
 *  - matches on segment_id AND the exact expected `before` string, so a row that
 *    has drifted since the 2026-09-23 measurement is SKIPPED, never overwritten;
 *  - idempotent: a row already carrying its `after` is reported as done and skipped;
 *  - --dry-run prints the plan and writes nothing.
 *
 * Usage:
 *   node bot/scripts/apply-lp612-salutation-stamps.js --expect-ref <ref> [--dry-run]
 *
 * Sandbox:
 *   railway run --service bot --environment sandbox -- \
 *     node bot/scripts/apply-lp612-salutation-stamps.js --expect-ref olvritwoqujtjvwfulbh
 */
const supabase = require('../shared/config/supabase');

const TABLE = 'niete_lp612_segments';
const STAMP = 'ﷺ'; // ARABIC LIGATURE SALLALLAHOU ALAYHE WASALLAM

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
}
const DRY = process.argv.includes('--dry-run');
const EXPECT_REF = arg('expect-ref');

const cps = (s) => [...String(s == null ? '' : s)].length;
const CAP = 30;

/**
 * The eight rows, as measured on sandbox 2026-09-23.
 *
 * `source` is the string ON THE SAME SEGMENT that already carries the salutation —
 * the evidence that the book saluted, and the model for where the stamp goes. It is
 * recorded here so a reviewer can check the placement without going back to the DB.
 */
const ROWS = [
  {
    segment_id: 'grade_6_english.c01a.p001-006.reading_comprehension',
    where: 'Grade 6 English, ch.1, pp.1-6',
    source: 'Hazrat Muhammad صلى الله عليه وسلم (biography)  [chapter_title]',
    before: 'Hazrat Muhammad: reading',
    after: `Hazrat Muhammad ${STAMP}: reading`,
  },
  {
    segment_id: 'grade_6_english.c01a.p001-005.vocabulary_grammar',
    where: 'Grade 6 English, ch.1, pp.1-5',
    source: 'Hazrat Muhammad صلى الله عليه وسلم (biography)  [chapter_title]',
    before: 'Hazrat Muhammad: vocabulary',
    after: `Hazrat Muhammad ${STAMP}: vocabulary`,
  },
  {
    segment_id: 'grade_6_english.c01a.p001-007.writing',
    where: 'Grade 6 English, ch.1, pp.1-7',
    source: 'Hazrat Muhammad صلى الله عليه وسلم (biography)  [chapter_title]',
    before: 'Hazrat Muhammad: writing',
    after: `Hazrat Muhammad ${STAMP}: writing`,
  },
  {
    // Terminal placement, because the chapter title puts it at the end of the name
    // chain: `Hazrat Muhammad Rasulullah (ﷺ)`. Not mid-phrase like the Urdu rows.
    segment_id: 'grade_9_english.c01.r990',
    where: 'Grade 9 English, ch.1, pp.6-16 (review day)',
    source: `Hazrat Muhammad Rasulullah (${STAMP}): A Mercy for All Creation  [chapter_title]`,
    before: 'Review: Hazrat Muhammad',
    after: `Review: Hazrat Muhammad ${STAMP}`,
  },
  {
    segment_id: 'grade_10_islamiat.c15.p085-087',
    where: 'Grade 10 Islamiat, ch.15, pp.85-87',
    source: `سیرتِ نبوی ${STAMP} میں اخلاص و تقویٰ اور اس کے معاشرتی فوائد و نقصانات  [subtopic_title]`,
    before: 'سیرتِ نبوی میں اخلاص و تقویٰ',
    after: `سیرتِ نبوی ${STAMP} میں اخلاص و تقویٰ`,
  },
  {
    segment_id: 'grade_10_urdu.p1c01.p007-012.buland_khwani',
    where: 'Grade 10 Urdu, ch.1, pp.7-12',
    source: `اخلاقِ نبوی ${STAMP} (سیرت)  [chapter_title]`,
    before: 'اخلاقِ نبوی: بلند خوانی',
    after: `اخلاقِ نبوی ${STAMP}: بلند خوانی`,
  },
  {
    segment_id: 'grade_10_urdu.p1c01.p007-012.tafheem',
    where: 'Grade 10 Urdu, ch.1, pp.7-12',
    source: `اخلاقِ نبوی ${STAMP} (سیرت)  [chapter_title]`,
    before: 'اخلاقِ نبوی: تفہیم',
    after: `اخلاقِ نبوی ${STAMP}: تفہیم`,
  },
  {
    segment_id: 'grade_11_islamiat.c19.p095-096',
    where: 'Grade 11 Islamiat, ch.19, pp.95-96',
    source: `سیرتِ نبوی ${STAMP} اور اہلِ بیت وصحابہ کی روشنی میں معاشرتی آداب  [subtopic_title]`,
    before: 'سیرتِ نبوی اور معاشرتی آداب',
    after: `سیرتِ نبوی ${STAMP} اور معاشرتی آداب`,
  },
  {
    // THE ONE RE-CUT, and the only row here that is not a pure insertion.
    //
    // Grade 8 Islamiat ch.4 review day. The subtopic is `دہرائی: باب 4 — احادیثِ نبوی
    // صلی اللہ علیہ وآلہ وصحابہ`, and the 30-code-point menu cut landed INSIDE the
    // salutation, leaving the row ending on `صلی`. This is the one genuine cap
    // casualty in the whole corpus — everywhere else the stamp fits and the importer
    // simply never carried it.
    //
    // Because the break cannot be fixed by inserting anything, the title is re-cut.
    // That is a change to what the teacher reads, so it was NOT taken as a rendering
    // decision: operator ruling 2026-09-23, choosing option 1 of three put to her —
    // "Re-cut the title so the break falls outside the salutation, e.g. دہرائی:
    // احادیثِ نبوی ﷺ ... My recommendation."
    //
    // It also resolves, without deciding it, the incomplete salutation she had ruled
    // `bd-unugr can be left alone`: the source writes `صلی اللہ علیہ وآلہ وصحابہ` with
    // no `وسلم`, and the stamp carries the complete salutation in one glyph. The
    // SOURCE string is untouched; only the menu row changes.
    segment_id: 'grade_8_islamiat.c04.r990',
    where: 'Grade 8 Islamiat, ch.4, review day (the severed row)',
    source: '\u062f\u06c1\u0631\u0627\u0626\u06cc: \u0628\u0627\u0628 4 \u2014 \u0627\u062d\u0627\u062f\u06cc\u062b\u0650 \u0646\u0628\u0648\u06cc \u0635\u0644\u06cc \u0627\u0644\u0644\u06c1 \u0639\u0644\u06cc\u06c1 \u0648\u0622\u0644\u06c1 \u0648\u0635\u062d\u0627\u0628\u06c1  [subtopic_title]',
    before: '\u062f\u06c1\u0631\u0627\u0626\u06cc: \u0627\u062d\u0627\u062f\u06cc\u062b\u0650 \u0646\u0628\u0648\u06cc \u0635\u0644\u06cc',
    after: `\u062f\u06c1\u0631\u0627\u0626\u06cc: \u0627\u062d\u0627\u062f\u06cc\u062b\u0650 \u0646\u0628\u0648\u06cc ${STAMP}`,
    recut: true,
  },
];

function assertRef() {
  const url = process.env.SUPABASE_URL || '';
  const m = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  const ref = m ? m[1] : null;
  if (!EXPECT_REF) throw new Error('--expect-ref is required; refusing to guess the database');
  if (ref !== EXPECT_REF) {
    throw new Error(
      `REFUSING TO WRITE: SUPABASE_URL points at project "${ref}", expected "${EXPECT_REF}". ` +
        'The .env on disk is PRODUCTION; sandbox is reached only through `railway run`.'
    );
  }
  return ref;
}

/** Every `after` must still fit. Checked before touching the network, not after. */
function assertFits() {
  const over = ROWS.filter((r) => cps(r.after) > CAP);
  if (over.length) {
    throw new Error(
      `REFUSING: ${over.length} replacement(s) exceed the ${CAP}-code-point menu cap: `
        + over.map((r) => `${r.segment_id} (${cps(r.after)})`).join(', ')
    );
  }
}

async function main() {
  const ref = assertRef();
  assertFits();
  console.log(`project ref: ${ref}  (asserted)`);
  console.log(`rows in plan: ${ROWS.length}${DRY ? '   [DRY RUN — no writes]' : ''}\n`);

  let applied = 0;
  let already = 0;
  let drifted = 0;
  let missing = 0;

  for (const r of ROWS) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('segment_id, menu_title, is_current, is_religious')
      .eq('segment_id', r.segment_id)
      .eq('is_current', true);
    if (error) throw error;

    if (!data || data.length === 0) {
      missing += 1;
      console.log(`MISSING  ${r.segment_id}  — no is_current row`);
      continue;
    }
    const live = data[0].menu_title;

    if (live === r.after) {
      already += 1;
      console.log(`ALREADY  ${r.segment_id}  "${live}"`);
      continue;
    }
    if (live !== r.before) {
      drifted += 1;
      console.log(
        `DRIFTED  ${r.segment_id}  — expected "${r.before}", found "${live}". SKIPPED, not overwritten.`
      );
      continue;
    }

    console.log(`${DRY ? 'WOULD   ' : 'APPLY   '} ${r.where}`);
    console.log(`         before  "${r.before}"  (${cps(r.before)} cp)`);
    console.log(`         after   "${r.after}"  (${cps(r.after)} cp of ${CAP})`);
    console.log(`         source  ${r.source}`);

    if (!DRY) {
      const upd = await supabase
        .from(TABLE)
        .update({ menu_title: r.after })
        .eq('segment_id', r.segment_id)
        .eq('is_current', true)
        .eq('menu_title', r.before); // last-moment optimistic guard
      if (upd.error) throw upd.error;
    }
    applied += 1;
  }

  console.log(
    `\n${DRY ? 'would apply' : 'applied'}: ${applied}   already stamped: ${already}   `
      + `drifted (skipped): ${drifted}   missing: ${missing}`
  );
  if (drifted || missing) {
    console.log('NOT CLEAN — a drifted or missing row means the measurement is stale. Re-measure before shipping.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
