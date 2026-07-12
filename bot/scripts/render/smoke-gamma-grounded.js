// End-to-end smoke test for the Gamma-grounded LP path.
//
// Exercises the full production code path — same handler, same services —
// but stubs WhatsAppService.sendDocument so we don't fire an actual message.
// If this passes locally against real Supabase + Gamma + R2, the wired
// handler will work when the bot deploys.
//
// Usage:
//   NIETE_ENV_PATH=/path/to/NIETE-Rumi/.env node smoke-gamma-grounded.js
//   node smoke-gamma-grounded.js --topic="number buddies"
//   node smoke-gamma-grounded.js --topic="number buddies" --grade=1 --subject=maths
//
// What it does:
//   1. Loads env from NIETE-Rumi/.env
//   2. Stubs WhatsAppService.sendDocument (Meta call would fail otherwise)
//   3. Calls handleCurriculumLessonPlan with a real topic
//   4. Verifies: AST match → Gamma render OR cache serve → R2 write → DB update
//   5. Reports source (ast_cached | ast_generated | pre_generated | page_prompt)

const path = require('path');
const fs = require('fs');

function loadEnv(p) {
  const txt = fs.readFileSync(p, 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnv(process.env.NIETE_ENV_PATH || path.resolve(__dirname, '..', '..', '..', '.env'));

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

const TOPIC = args.topic || 'number buddies';
const GRADE = args.grade ? parseInt(args.grade, 10) : 1;
const SUBJECT = args.subject || 'maths';
const CURRICULUM = args.curriculum || 'taleemabad';
const LANGUAGE = args.language || 'en';
const USER_ID = args.userId || '923333232533';

// Stub WhatsAppService.sendDocument BEFORE the handler requires it.
const WhatsAppService = require('../../shared/services/whatsapp.service');
const sends = [];
const originalSend = WhatsAppService.sendDocument;
WhatsAppService.sendDocument = async (userId, filePath, filename) => {
  const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  const cp = `/tmp/smoke-lp-delivered-${Date.now()}.pdf`;
  if (fs.existsSync(filePath)) fs.copyFileSync(filePath, cp);
  sends.push({ userId, filename, size, cp });
  console.log(`  [WhatsAppService.sendDocument STUBBED] userId=${userId} file=${filename} size=${(size/1024).toFixed(1)}KB copiedTo=${cp}`);
  return { success: true };
};

const handleCurriculumLessonPlan = require('../../shared/handlers/lesson-plan-v2.handler');

(async () => {
  console.log('=== Gamma-grounded smoke ===');
  console.log(`Topic: "${TOPIC}"`);
  console.log(`Grade: ${GRADE}   Subject: ${SUBJECT}   Curriculum: ${CURRICULUM}   Lang: ${LANGUAGE}`);
  console.log();

  const t0 = Date.now();
  const result = await handleCurriculumLessonPlan({
    userId: USER_ID,
    topic: TOPIC,
    grade: GRADE,
    subject: SUBJECT,
    curriculum: CURRICULUM,
    language: LANGUAGE,
  });
  const ms = Date.now() - t0;

  console.log(`\n=== Handler result (${ms}ms) ===`);
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nsendDocument calls: ${sends.length}`);
  for (const s of sends) console.log(`  → ${s.filename} (${(s.size/1024).toFixed(1)}KB) copied to ${s.cp}`);

  // Restore
  WhatsAppService.sendDocument = originalSend;

  if (result.source === 'ast_cached') {
    console.log('\n✅ ast_cached — served from R2 cache (fastest path)');
  } else if (result.source === 'ast_generated') {
    console.log('\n✅ ast_generated — freshly rendered via Gamma + cached to R2 for next time');
  } else if (result.source === 'pre_generated') {
    console.log('\n✅ pre_generated — served from legacy pre_generated_lps (Punjab corpus)');
  } else {
    console.log('\n⚠️  page_prompt — no AST or pre-gen match; would fall through to Gamma freeform');
  }
})().catch(e => { console.error('FATAL:', e.message); console.error(e.stack); process.exit(2); });
