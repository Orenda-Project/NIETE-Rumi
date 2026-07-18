/**
 * Seed `pre_generated_lps` with the FEAT-059 (primary Pakistan corpus) and
 * FEAT-080 (method-comparison corpus) rows for the NIETE deployment.
 *
 * The PDFs already live in R2 under `lesson_plans/pakistan/pregen/*` (uploaded
 * by the FEAT-059 R2 upload job — see PR #300 lineage). This script only
 * populates the DB pointers so PreGenLookupService.findPreGenLP can serve them.
 *
 * Idempotent: uses upsert on (curriculum, grade, subject, chapter_number).
 *
 * Row split:
 *   - `curriculum='pakistan'`             — 11 primary rows surfaced in the
 *                                            Pakistan LP Flow (Grade→Subject→Topic)
 *   - `curriculum='pakistan_methods'`     — 12 method-comparison rows, queryable
 *                                            directly for study but hidden from
 *                                            the picker (chapter_number encodes
 *                                            grade*100 + method_index)
 *
 * Usage:
 *   node bot/scripts/seed-feat059-feat080-pakistan-lps.js
 *   node bot/scripts/seed-feat059-feat080-pakistan-lps.js --dry-run
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env') });
const supabase = require('../shared/config/supabase');

// ---- PRIMARY (11) — served through the Grade→Subject→Topic picker Flow ------
// grade/subject/chapter_number is the unique identity for lookup. The R2 key
// is `lesson_plans/pakistan/pregen/<basename>` per the FEAT-059 upload naming.
const PRIMARY = [
  // Fresh Grade 3 corpus (4)
  { grade: 3, subject: 'English',    chapter_number: 1, chapter_title: 'English — Chapter 1',    pdf: 'PK_G3_ENG_CH1.pdf' },
  { grade: 3, subject: 'Math',       chapter_number: 1, chapter_title: 'Math — Chapter 1',       pdf: 'PK_G3_MATH_CH1.pdf' },
  { grade: 3, subject: 'Urdu',       chapter_number: 1, chapter_title: 'اردو — باب 1',          pdf: 'PK_G3_URDU_CH1.pdf' },
  { grade: 3, subject: 'GK-Science', chapter_number: 1, chapter_title: 'GK-Science — Chapter 1', pdf: 'PK_G3_GKSCI_CH1.pdf' },
  // Legacy Grade 1-2 (7)
  { grade: 1, subject: 'English',            chapter_number: 1, chapter_title: 'Hello World',                     pdf: 'Rumi_TA_G1_English_Hello_World.pdf' },
  { grade: 1, subject: 'Math',               chapter_number: 1, chapter_title: 'Number Buddies (0–9)',            pdf: 'Rumi_TA_G1_Math_Number_Buddies_0-9.pdf' },
  { grade: 1, subject: 'Numeracy',           chapter_number: 1, chapter_title: 'Extended Hour: Number Sense',     pdf: 'Rumi_TA_G1_Numeracy_Extended_Hour_Number_Sense.pdf' },
  { grade: 1, subject: 'Reading Hour Urdu',  chapter_number: 1, chapter_title: 'حروف: ب، م، ن، ا',                pdf: 'Rumi_TA_G1_ReadingHourUrdu_Huroof_B_M_N_A.pdf' },
  { grade: 1, subject: 'Urdu',               chapter_number: 1, chapter_title: 'حمد — میرا خدا',                  pdf: 'Rumi_TA_G1_Urdu_Hamd_Mera_Khuda.pdf' },
  { grade: 2, subject: 'Math',               chapter_number: 1, chapter_title: 'Numberland Adventures (up to 999)', pdf: 'Rumi_TA_G2_Math_Numberland_Adventures_Up_to_999.pdf' },
  { grade: 2, subject: 'Reading Hour English', chapter_number: 1, chapter_title: 'Phonics',                       pdf: 'Rumi_TA_G2_ReadingHourEnglish_Phonics.pdf' },
];

// ---- METHOD-COMPARISON (12) — FEAT-080 A/B/C/D method study corpus ----------
// chapter_number encodes `grade*100 + method_index` so each row is unique
// within the (curriculum, grade, subject) triple.
const METHODS = [
  // G6 English CH1 × 4 methods
  { grade: 6, subject: 'English', method_index: 1, method_label: 'Explicit Instruction',     pdf: 'method_comparison/PK_G6_ENG_CH1_M1_ExplicitInstruction.pdf' },
  { grade: 6, subject: 'English', method_index: 2, method_label: 'Think-Pair-Share',         pdf: 'method_comparison/PK_G6_ENG_CH1_M2_ThinkPairShare.pdf' },
  { grade: 6, subject: 'English', method_index: 3, method_label: 'Guided Discovery',         pdf: 'method_comparison/PK_G6_ENG_CH1_M3_GuidedDiscovery.pdf' },
  { grade: 6, subject: 'English', method_index: 4, method_label: 'Retrieval Practice',       pdf: 'method_comparison/PK_G6_ENG_CH1_M4_RetrievalPractice.pdf' },
  // G7 Math CH1 × 4 methods
  { grade: 7, subject: 'Math',    method_index: 1, method_label: 'Explicit Instruction',     pdf: 'method_comparison/PK_G7_MATH_CH1_M1_ExplicitInstruction.pdf' },
  { grade: 7, subject: 'Math',    method_index: 2, method_label: 'Think-Pair-Share',         pdf: 'method_comparison/PK_G7_MATH_CH1_M2_ThinkPairShare.pdf' },
  { grade: 7, subject: 'Math',    method_index: 3, method_label: 'Guided Discovery',         pdf: 'method_comparison/PK_G7_MATH_CH1_M3_GuidedDiscovery.pdf' },
  { grade: 7, subject: 'Math',    method_index: 4, method_label: 'Retrieval Practice',       pdf: 'method_comparison/PK_G7_MATH_CH1_M4_RetrievalPractice.pdf' },
  // G9 English CH1 × 4 methods (M5-M8)
  { grade: 9, subject: 'English', method_index: 5, method_label: 'Inquiry-Based',            pdf: 'method_comparison/PK_G9_ENG_CH1_M5_InquiryBased.pdf' },
  { grade: 9, subject: 'English', method_index: 6, method_label: 'Problem-Based',            pdf: 'method_comparison/PK_G9_ENG_CH1_M6_ProblemBased.pdf' },
  { grade: 9, subject: 'English', method_index: 7, method_label: 'Socratic',                 pdf: 'method_comparison/PK_G9_ENG_CH1_M7_Socratic.pdf' },
  { grade: 9, subject: 'English', method_index: 8, method_label: 'Peer Teaching',            pdf: 'method_comparison/PK_G9_ENG_CH1_M8_PeerTeaching.pdf' },
];

const R2_PREFIX = 'lesson_plans/pakistan/pregen/';

function primaryRow(r) {
  return {
    curriculum: 'pakistan',
    grade: r.grade,
    subject: r.subject,
    chapter_number: r.chapter_number,
    chapter_title: r.chapter_title,
    pdf_r2_key_en: `${R2_PREFIX}${r.pdf}`,
    pdf_r2_key_ur: null,
    days: 1,
    prompt_version: 'feat059-v1',
    is_current: true,
    generation_status: 'completed',
    generated_at: new Date().toISOString(),
  };
}

function methodRow(r) {
  return {
    curriculum: 'pakistan_methods',
    grade: r.grade,
    subject: r.subject,
    chapter_number: r.grade * 100 + r.method_index,
    chapter_title: `Chapter 1 — ${r.method_label}`,
    pdf_r2_key_en: `${R2_PREFIX}${r.pdf}`,
    pdf_r2_key_ur: null,
    days: 1,
    prompt_version: 'feat080-v1',
    is_current: true,
    generation_status: 'completed',
    generated_at: new Date().toISOString(),
  };
}

async function upsertRow(row) {
  // Manual upsert: check on (curriculum, grade, subject, chapter_number). We
  // don't rely on a unique constraint because the live table has none —
  // idempotence lives here in the script.
  const { data: existing, error: findErr } = await supabase
    .from('pre_generated_lps')
    .select('id')
    .eq('curriculum', row.curriculum)
    .eq('grade', row.grade)
    .eq('subject', row.subject)
    .eq('chapter_number', row.chapter_number)
    .maybeSingle();
  if (findErr) throw new Error(`lookup failed: ${findErr.message}`);
  if (existing?.id) {
    const { error: updErr } = await supabase
      .from('pre_generated_lps')
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (updErr) throw new Error(`update failed: ${updErr.message}`);
    return 'updated';
  }
  const { error: insErr } = await supabase.from('pre_generated_lps').insert(row);
  if (insErr) throw new Error(`insert failed: ${insErr.message}`);
  return 'inserted';
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`=== FEAT-059 + FEAT-080 seed ${dryRun ? '(DRY RUN)' : ''} ===`);
  const rows = [...PRIMARY.map(primaryRow), ...METHODS.map(methodRow)];
  console.log(`Rows to upsert: ${rows.length}`);
  if (dryRun) {
    for (const r of rows) console.log(`  ${r.curriculum}/G${r.grade}/${r.subject}/ch${r.chapter_number} → ${r.pdf_r2_key_en}`);
    return;
  }
  let inserted = 0, updated = 0;
  for (const r of rows) {
    try {
      const result = await upsertRow(r);
      if (result === 'inserted') inserted += 1;
      if (result === 'updated') updated += 1;
      console.log(`  ${result.padEnd(8)} ${r.curriculum}/G${r.grade}/${r.subject}/ch${r.chapter_number}`);
    } catch (e) {
      console.error(`  FAILED  ${r.curriculum}/G${r.grade}/${r.subject}/ch${r.chapter_number}: ${e.message}`);
      throw e;
    }
  }
  console.log(`\nDone: ${inserted} inserted, ${updated} updated`);

  // Post-seed verification: assert the two curriculum tags have the expected counts.
  const { count: primaryCount } = await supabase
    .from('pre_generated_lps')
    .select('*', { count: 'exact', head: true })
    .eq('curriculum', 'pakistan');
  const { count: methodCount } = await supabase
    .from('pre_generated_lps')
    .select('*', { count: 'exact', head: true })
    .eq('curriculum', 'pakistan_methods');
  console.log(`\nLive counts:`);
  console.log(`  curriculum='pakistan':         ${primaryCount} rows  (expected 11)`);
  console.log(`  curriculum='pakistan_methods': ${methodCount} rows  (expected 12)`);
  if (primaryCount !== 11 || methodCount !== 12) {
    console.error('\n❌ Row counts do not match expected values.');
    process.exit(2);
  }
  console.log('\n✅ Seed complete.');
}

if (require.main === module) {
  main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
}

module.exports = { PRIMARY, METHODS, primaryRow, methodRow };
