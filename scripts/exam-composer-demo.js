#!/usr/bin/env node
/**
 * End-to-end demo for the exam composer with post-generation validators
 * (bd-2013). Simulates a Grade Five Math weekly-test compose end-to-end:
 *
 *   1. Build a synthetic-but-realistic bank pool that includes some rows
 *      matching each of the four failure classes.
 *   2. Run the composer's post-generation gates (sampleBucketValidated) —
 *      broken rows should be swapped out for clean ones.
 *   3. Run the source-grouping pass (applySourceGrouping) — same-image /
 *      same-passage rows should cluster.
 *   4. Render the paper to a .docx via the real template.
 *   5. Print a verification report so Alishba can eyeball each fix.
 *
 * No DB, no WhatsApp send. Writes /tmp/bd-2013-test-exam.docx.
 *
 * Usage: node scripts/exam-composer-demo.js
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');

// Silence the logger — this is a demo, not prod.
process.env.LOG_LEVEL = 'silent';

// Bare-minimum env so supabase config doesn't hard-exit.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://demo.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'demo-key';

// Stand-alone stub — this demo doesn't run the bot's DB / logger deps, so
// intercept the requires that need them. Keeps the demo script runnable
// from the worktree root with only devDependencies installed.
const ROOT = path.resolve(__dirname, '..');
const STUBS = {
  [path.resolve(ROOT, 'bot/shared/config/supabase.js')]: {},
  [path.resolve(ROOT, 'bot/shared/utils/logger.js')]: {
    logToFile: () => {}, logInfo: () => {}, logError: () => {}, logDebug: () => {}, logWarn: () => {},
  },
  dotenv: { config: () => {} },
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  try {
    const resolved = origResolve.call(this, request, parent, ...rest);
    return resolved;
  } catch (err) {
    // dotenv is required by supabase.js; short-circuit to the stub.
    if (request === 'dotenv') return 'dotenv';
    // @supabase/supabase-js also referenced by supabase.js — same idea.
    if (request === '@supabase/supabase-js') return '@supabase/supabase-js';
    if (request === 'axios') return 'axios';
    throw err;
  }
};
const origLoad = Module._load;
Module._load = function(request, parent, ...rest) {
  if (request === 'dotenv') return STUBS.dotenv;
  if (request === '@supabase/supabase-js') return { createClient: () => ({}) };
  // axios is only used in exam-paper.template for image fetching. We ship a
  // stub that pretends every image URL is a fetchable placeholder — the
  // template already handles null returns via "[Figure unavailable]".
  if (request === 'axios') {
    return {
      get: async () => { throw new Error('demo: no network fetch'); },
    };
  }
  const resolved = (() => {
    try { return origResolve.call(this, request, parent, ...rest); }
    catch { return null; }
  })();
  if (resolved && STUBS[resolved]) return STUBS[resolved];
  return origLoad.call(this, request, parent, ...rest);
};

const {
  sampleBucketValidated,
  applySourceGrouping,
  sectionOf,
} = require('../bot/shared/services/exam/exam-composer.service');
const { validateQuestion } = require('../bot/shared/services/exam/exam-composer.validators');
const { buildExamDocx } = require('../bot/shared/services/exam/exam-paper.template');

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic Grade Five Math bank — includes rows that exercise every gate.
// ─────────────────────────────────────────────────────────────────────────────

const IMG_SHAPES = 'https://cdn.example.com/exam-demo/shapes.png';
const IMG_GRAPH  = 'https://cdn.example.com/exam-demo/bar-graph.png';

// Broken rows the composer must REJECT (never appear in output).
const BROKEN = [
  // Fix 1 — statement references figure but no media attached
  {
    id: 'bad-img-1',
    type: 'Short Answer',
    category: 'SEEN',
    question_statement: 'Look at the figure below and count the sides.',
    question_media: [],
    answer_options: [],
    chapter_index: 1, index_in_chapter: 90,
    bloom_tags: ['REMEMBER'],
    score: 2,
  },
  // Fix 3 — MCQ with only 3 options
  {
    id: 'bad-mcq-1',
    type: 'MCQs',
    category: 'SEEN',
    question_statement: 'Which of the following is a prime number?',
    question_media: [],
    answer_options: [
      { statement: '4', is_correct: false },
      { statement: '6', is_correct: false },
      { statement: '7', is_correct: true },
    ],
    chapter_index: 1, index_in_chapter: 91,
    bloom_tags: ['REMEMBER'],
    score: 1,
  },
  // Fix 4 — match-columns with placeholder right column
  {
    id: 'bad-match-1',
    type: 'Match the Column',
    category: 'SEEN',
    question_statement: 'Match the shape with its number of sides.',
    question_media: [],
    answer_options: [
      { left: 'Triangle', right: 'answer 1' },
      { left: 'Square',   right: 'answer 2' },
      { left: 'Pentagon', right: 'answer 3' },
    ],
    chapter_index: 1, index_in_chapter: 92,
    bloom_tags: ['UNDERSTAND'],
    score: 3,
  },
];

// Valid rows — enough for the composer to produce a full paper.
// Two of them share IMG_SHAPES so the grouping pass has something to cluster.
const VALID = [
  // MCQs — REMEMBER
  ...['2 + 3', '5 × 6', '12 - 4', '9 ÷ 3', '7 + 8', '11 - 5'].map((expr, i) => ({
    id: `mcq-r-${i}`, type: 'MCQs', category: i % 2 === 0 ? 'SEEN' : 'UNSEEN',
    question_statement: `What is ${expr}?`,
    question_media: [], answer_options: mcqOpts(4, expr),
    chapter_index: 1, index_in_chapter: 10 + i,
    bloom_tags: ['REMEMBER'], score: 1,
  })),
  // MCQs — UNDERSTAND
  ...['half of 20', 'twice of 7', 'a quarter of 16'].map((expr, i) => ({
    id: `mcq-u-${i}`, type: 'MCQs', category: 'SEEN',
    question_statement: `Which value equals ${expr}?`,
    question_media: [], answer_options: mcqOpts(4, expr),
    chapter_index: 2, index_in_chapter: 20 + i,
    bloom_tags: ['UNDERSTAND'], score: 1,
  })),
  // Short answers — with shared IMG_SHAPES (drift cluster — Fix 2)
  {
    id: 'sa-shapes-1', type: 'Short Answer', category: 'SEEN',
    question_statement: 'Count the triangles in the figure.',
    question_media: [{ url: IMG_SHAPES }], answer_options: [],
    chapter_index: 3, index_in_chapter: 50,
    bloom_tags: ['REMEMBER'], score: 2,
  },
  {
    id: 'sa-shapes-2', type: 'Short Answer', category: 'SEEN',
    question_statement: 'Name each polygon shown in the figure.',
    question_media: [{ url: IMG_SHAPES }], answer_options: [],
    chapter_index: 3, index_in_chapter: 51,
    bloom_tags: ['UNDERSTAND'], score: 2,
  },
  // Another short answer (different image) — should not cluster with above.
  {
    id: 'sa-graph-1', type: 'Short Answer', category: 'UNSEEN',
    question_statement: 'Which day sold the most ice-cream? See the bar graph.',
    question_media: [{ url: IMG_GRAPH }], answer_options: [],
    chapter_index: 4, index_in_chapter: 60,
    bloom_tags: ['APPLY'], score: 2,
  },
  // Match the column (well-formed)
  {
    id: 'match-good-1', type: 'Match the Column', category: 'SEEN',
    question_statement: 'Match the shape with its number of sides.',
    question_media: [],
    answer_options: [
      { left: 'Triangle', right: '3 sides' },
      { left: 'Square',   right: '4 equal sides' },
      { left: 'Pentagon', right: '5 sides' },
      { left: 'Hexagon',  right: '6 sides' },
    ],
    chapter_index: 2, index_in_chapter: 30,
    bloom_tags: ['UNDERSTAND'], score: 4,
  },
  // Fill in the blanks (subjective family for a bit of variety)
  {
    id: 'fib-1', type: 'Fill in the Blanks', category: 'SEEN',
    question_statement: 'The sum of the angles of a triangle is _____ degrees.',
    question_media: [], answer_options: [],
    chapter_index: 2, index_in_chapter: 35,
    bloom_tags: ['REMEMBER'], score: 1,
  },
  {
    id: 'fib-2', type: 'Fill in the Blanks', category: 'UNSEEN',
    question_statement: 'A square has _____ equal sides.',
    question_media: [], answer_options: [],
    chapter_index: 3, index_in_chapter: 40,
    bloom_tags: ['REMEMBER'], score: 1,
  },
  // Apply-bucket MCQ so the APPLY quota can fill
  {
    id: 'mcq-a-1', type: 'MCQs', category: 'SEEN',
    question_statement: 'If a rope is 12m long and cut into 4 equal pieces, how long is each piece?',
    question_media: [], answer_options: mcqOpts(4, '3m'),
    chapter_index: 4, index_in_chapter: 65,
    bloom_tags: ['APPLY'], score: 1,
  },
  {
    id: 'mcq-a-2', type: 'MCQs', category: 'UNSEEN',
    question_statement: 'A shop sold 15 pens on Monday and 24 on Tuesday. How many altogether?',
    question_media: [], answer_options: mcqOpts(4, '39'),
    chapter_index: 4, index_in_chapter: 66,
    bloom_tags: ['APPLY'], score: 1,
  },
];

function mcqOpts(n, correctText) {
  const distractors = ['?', '??', '???', '????', '?????'];
  const arr = [{ statement: correctText, is_correct: true }];
  for (let i = 0; i < n - 1; i++) {
    arr.push({ statement: `${correctText} + ${distractors[i]}`, is_correct: false });
  }
  // Shuffle so the correct one isn't always position 1.
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─────────────────────────────────────────────────────────────────────────────
// Compose using the fixed pipeline
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const pool = [...BROKEN, ...VALID];

  // Simulate the blueprint's REMEMBER / UNDERSTAND / APPLY buckets by filtering
  // pool on bloom_tags and sampling.
  const buckets = { REMEMBER: 5, UNDERSTAND: 4, APPLY: 2 };
  let allPicks = [];
  for (const [name, count] of Object.entries(buckets)) {
    const bucketPool = pool.filter(q => (q.bloom_tags || []).includes(name));
    const picked = sampleBucketValidated(bucketPool, count, 80, 20);
    allPicks.push(...picked);
  }

  // Belt-and-braces — inject the three broken rows too so we can prove the
  // grouping pass doesn't accidentally leak them. If the sampler already
  // rejected them, they won't be in allPicks at all.
  const brokenIds = new Set(BROKEN.map(q => q.id));
  const leakedBroken = allPicks.filter(q => brokenIds.has(q.id));

  // Section-tag + group.
  for (const q of allPicks) q._section = sectionOf(q.type);
  allPicks = applySourceGrouping(allPicks);

  // Build the render-shape.
  const exam = {
    id: 'demo-exam-bd-2013',
    grade: 'Five',
    subject: 'Math',
    type: 'WEEKLY',
    language: 'en',
    created_by_user_id: 'demo-user',
    chapters: [1, 2, 3, 4],
    total_marks: allPicks.reduce((s, q) => s + (q.score || 0), 0),
    total_questions: allPicks.length,
    duration_minutes: 40,
    status: 'composing',
    created_at: new Date().toISOString(),
  };
  const questions = allPicks.map(q => ({
    order_index: null,
    source_bank_id: q.id,
    section: q._section,
    question_format: q.type,
    statement_snapshot: q.question_statement,
    options_snapshot: q.answer_options || [],
    correct_answer_snapshot: null,
    marking_scheme_snapshot: null,
    media_snapshot: q.question_media || [],
    score: q.score,
    bloom_tags: q.bloom_tags || [],
    group_ref: q.group_ref || null,
  }));

  // ── Verification report ───────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  bd-2013 end-to-end demo — verification report');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`  Broken rows injected:  ${BROKEN.length}`);
  console.log(`  Broken rows leaked:    ${leakedBroken.length}  ${leakedBroken.length === 0 ? '✓' : '✗'}`);
  if (leakedBroken.length > 0) {
    for (const q of leakedBroken) console.log(`    - LEAKED: ${q.id}`);
  }
  console.log(`  Final question count:  ${questions.length}`);
  console.log(`  Total marks:           ${exam.total_marks}`);

  // Per-fix eyeball table.
  console.log('\n  Per-question fix trace:');
  console.log('  # | source-hash                | type              | opts | media | valid?');
  console.log('  ──┼────────────────────────────┼───────────────────┼──────┼───────┼───────');
  let allValid = true;
  questions.forEach((q, i) => {
    const check = validateQuestion({
      type: q.question_format,
      question_statement: q.statement_snapshot,
      question_media: q.media_snapshot,
      answer_options: q.options_snapshot,
    });
    if (!check.valid) allValid = false;
    const bankQ = pool.find(p => p.id === q.source_bank_id);
    const { sourceHashOf } = require('../bot/shared/services/exam/exam-composer.validators');
    const hash = bankQ ? sourceHashOf(bankQ).slice(0, 26) : '?';
    console.log(
      `  ${String(i + 1).padStart(2)} | ${hash.padEnd(26)} | ${String(q.question_format).padEnd(17)} | ` +
      `${String(q.options_snapshot.length).padStart(4)} | ${String(q.media_snapshot.length).padStart(5)} | ` +
      `${check.valid ? '  ✓  ' : ' ✗ ' + check.reason.slice(0, 30)}`
    );
  });

  // Group-adjacency check — same source-hash rows should be adjacent.
  const { sourceHashOf } = require('../bot/shared/services/exam/exam-composer.validators');
  const hashes = questions.map(q => {
    const bankQ = pool.find(p => p.id === q.source_bank_id);
    return bankQ ? sourceHashOf(bankQ) : `nokey-${q.source_bank_id}`;
  });
  const clusterCheck = checkClusterAdjacency(hashes);

  console.log('\n  ─── verdict ───');
  console.log(`  Fix 1 (missing images):    ${allValid ? '✓ no broken image refs' : '✗ image ref failure'}`);
  console.log(`  Fix 2 (source grouping):   ${clusterCheck.ok ? '✓ same-source rows contiguous' : `✗ split cluster: ${clusterCheck.split}`}`);
  console.log(`  Fix 3 (MCQ opts):          ${allValid ? '✓ every MCQ has ≥4 options' : '✗ MCQ option failure'}`);
  console.log(`  Fix 4 (match-columns):     ${allValid ? '✓ every match row has a unique specific right side' : '✗ match failure'}`);
  console.log('');

  // Render the docx.
  const buf = await buildExamDocx({ exam, questions, groupMeta: new Map() });
  const outPath = '/tmp/bd-2013-test-exam.docx';
  fs.writeFileSync(outPath, buf);
  console.log(`  → wrote ${outPath}  (${(buf.length / 1024).toFixed(1)} KB)`);
  console.log('');
}

function checkClusterAdjacency(hashes) {
  // For each hash that appears more than once, indexes should form a
  // contiguous run (no other hash in between).
  const seen = new Map();
  hashes.forEach((h, i) => {
    if (!seen.has(h)) seen.set(h, []);
    seen.get(h).push(i);
  });
  for (const [h, idxs] of seen) {
    if (idxs.length < 2) continue;
    const min = idxs[0];
    const max = idxs[idxs.length - 1];
    if (max - min + 1 !== idxs.length) {
      return { ok: false, split: `${h.slice(0, 20)} (indices ${idxs.join(',')})` };
    }
  }
  return { ok: true };
}

main().catch(err => {
  console.error('DEMO FAILED:', err);
  process.exit(1);
});
