// Render ONE lesson plan as a v7-style 6-slide PDF (Tanzania-quality) using
// Nano Banana Pro + Stage C-lite LLM enrichment.
//
// Pipeline:
//   1. Fetch LP + prior/next LPs in chapter from curriculum_lp_ast
//   2. LLM enrichment: reshape step arrays + metadata into the 25 v7 fields
//   3. Build 6 slide prompts (adapted from Tanzania Std2 Maths Ch2 Seg1 templates)
//   4. Fire 6 parallel NB Pro createTasks
//   5. Poll each until success, download PNGs
//   6. Assemble 6-page PDF via pdf-lib
//
// Usage:
//   node render-v7-lp.js --uuid=<source_lp_uuid>
//   node render-v7-lp.js --uuid=... --skip-enrich   # reuse cached enrichment
//   node render-v7-lp.js --uuid=... --dry-run       # enrichment + prompts, no NB Pro

const fs = require('fs');
const path = require('path');
const https = require('https');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');
const OpenAI = require('openai');
const { createClient } = require('@supabase/supabase-js');

// ---- env ----
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
const LP_UUID = args.uuid;
const DRY_RUN = !!args['dry-run'];
const SKIP_ENRICH = !!args['skip-enrich'];
const OUT_DIR = args.outdir || `/tmp/v7-lp-${Date.now()}`;
fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT_PDF = args.out || path.join(OUT_DIR, 'lp.pdf');
const ENRICH_CACHE = path.join(OUT_DIR, 'enriched.json');
if (!LP_UUID) throw new Error('--uuid is required');

// ---- LP fetch ----
async function fetchLpAndSiblings() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: lps, error } = await sb.from('curriculum_lp_ast').select('*').eq('source_lp_uuid', LP_UUID).limit(1);
  if (error || !lps || lps.length === 0) throw new Error(`No LP for ${LP_UUID}: ${error?.message}`);
  const lp = lps[0];

  // Prior + next LPs in the same chapter (for journey_so_far + coming_up)
  const { data: siblings } = await sb.from('curriculum_lp_ast')
    .select('lp_index, topic, source_lp_uuid')
    .eq('curriculum_key', lp.curriculum_key)
    .eq('grade', lp.grade)
    .eq('subject', lp.subject)
    .eq('chapter_number', lp.chapter_number)
    .order('lp_index');

  // Also all chapters in this book (for "day X of N" — approximated by total lp_index in chapter)
  const priorLps = (siblings || []).filter(s => s.lp_index < lp.lp_index);
  const nextLps = (siblings || []).filter(s => s.lp_index > lp.lp_index).slice(0, 3);
  return { lp, siblings: siblings || [], priorLps, nextLps };
}

// ---- LLM enrichment (Stage C-lite) ----
function createLlm() {
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: { 'HTTP-Referer': 'https://niete-rumi.local', 'X-Title': 'NIETE-Rumi LP Renderer' },
  });
}

const ENRICH_SYSTEM = `You are a pedagogical LP designer for Pakistan primary schools (Grades 1-5).
You transform structured atomic lesson-plan steps into the enriched 25-field v7 lesson plan format.
All content in Urdu (Nastaliq script) unless the source LP is English (then keep English but include bilingual teacher dialogue in Roman-Urdu).
Pakistan cultural context: names Ali, Fatima, Sana, Usman, Ayesha, Bilal; places bazaar, cricket ground, mosque, home, classroom; foods roti, chai, aam.
For Islamiyat: respectful religious references welcomed. For Math/English/Urdu: no religious references.
Output STRICT JSON matching the schema. No markdown, no commentary.`;

function enrichSchemaDescription() {
  return `{
  "cpa_phase": "concrete" | "pictorial" | "abstract" | null,  // for math only, else null
  "slo_full": "the full learning-outcome sentence in the target language",
  "prep_checklist": ["item 1 (with page number)", "item 2", "item 3", "item 4"],
  "warm_up_review": "a 2-minute warm-up scenario with 1 question + expected answer + CFU trigger",
  "hook_type": "REAL_WORLD" | "STORY" | "PROBLEM_POSING" | "GAME",
  "hook_story_setup": "one-sentence context",
  "hook_characters": [
    {"name": "Ali", "role": "student", "gender": "boy", "dialogue": "verbatim speech bubble text"},
    {"name": "Fatima", "role": "student", "gender": "girl", "dialogue": "verbatim speech bubble text"}
  ],
  "lengo_la_leo": "today's goal — matches slo_full",
  "maneno_muhimu": [{"term": "vocab in target lang", "gloss": "english gloss"}, ...5 items...],
  "board_work_content": "verbatim text/math the teacher writes on the board",
  "three_step_procedure": [
    {"step_no": 1, "action": "detailed teacher-does + student-outcome"},
    {"step_no": 2, "action": "..."},
    {"step_no": 3, "action": "..."}
  ],
  "teacher_says_bubble": "the blue speech bubble text — key explanation the teacher says verbatim",
  "key_fact": "the amber key-fact callout — one sentence, the load-bearing insight",
  "worked_example": "columnar/step-by-step working with numbers OR the specific example content",
  "model_answer": "the summarized answer + rule",
  "partner_activity": {
    "instruction": "what pairs do together",
    "dialogue_a": "Partner A verbatim speech",
    "dialogue_b": "Partner B verbatim speech"
  },
  "circulate_instruction": "what the teacher does while pairs work",
  "cfu_check": {"problem": "problem to solve on slate", "answer": "expected answer"},
  "problems": [
    {"num": 1, "problem": "verbatim problem", "answer": "answer with method"},
    {"num": 2, "problem": "...", "answer": "..."},
    {"num": 3, "problem": "...", "answer": "..."}
  ],
  "word_problem": {"context": "Pakistan-context story", "calc": "math setup", "answer": "final answer"},
  "weak_learner_support": "concrete manipulative activity + tactile approach",
  "challenge_extension": "extension problem for advanced students",
  "key_facts_summary": ["takeaway 1", "takeaway 2", "takeaway 3"],
  "exit_ticket_mcq": {
    "question": "verbatim MCQ question",
    "choices": {"A": "option A", "B": "option B", "C": "option C", "D": "option D"},
    "correct": "A" | "B" | "C" | "D"
  },
  "homework": {"page": "page ref", "exercise": "exercise ref", "problems": ["prob 1", "prob 2", "..."]},
  "coach_corner": "one-paragraph teacher-reflection prompt, warm tone, ends with a self-check question"
}`;
}

async function enrich(lp, priorLps, nextLps) {
  if (SKIP_ENRICH && fs.existsSync(ENRICH_CACHE)) {
    console.log(`[enrich] Using cached: ${ENRICH_CACHE}`);
    return JSON.parse(fs.readFileSync(ENRICH_CACHE, 'utf8'));
  }

  const isUrdu = ['urdu', 'islamiyat', 'reading_hour_urdu'].includes(lp.subject);
  const targetLang = isUrdu ? 'Urdu (Nastaliq)' : 'English';

  const userPrompt = `Enrich this lesson plan into the v7 25-field format.

LP metadata:
  Publisher: ${lp.publisher}
  Grade: ${lp.grade_label} (numeric ${lp.grade})
  Subject: ${lp.subject_label}
  Chapter ${lp.chapter_number}: "${lp.chapter_title}"
  LP index within chapter: ${lp.lp_index}
  Topic: "${lp.topic}"
  Target language: ${targetLang}
  Total duration (min): ${(lp.opening_time||0)+(lp.explain_time||0)+(lp.practice_time||0)+(lp.independent_practice_time||0)+(lp.conclusion_time||0)}

Source content (atomic steps — {type, statement} shape):
  opening_steps (${(lp.opening_steps||[]).length}): ${JSON.stringify(lp.opening_steps||[]).slice(0, 2000)}
  explain_steps (${(lp.explain_steps||[]).length}): ${JSON.stringify(lp.explain_steps||[]).slice(0, 3000)}
  practice_steps (${(lp.practice_steps||[]).length}): ${JSON.stringify(lp.practice_steps||[]).slice(0, 2000)}
  independent_practice_steps (${(lp.independent_practice_steps||[]).length}): ${JSON.stringify(lp.independent_practice_steps||[]).slice(0, 2000)}
  conclusion_steps (${(lp.conclusion_steps||[]).length}): ${JSON.stringify(lp.conclusion_steps||[]).slice(0, 2000)}
  classroom_setup: ${JSON.stringify(lp.classroom_setup_instructions||[]).slice(0, 800)}
  homework_instructions: ${JSON.stringify(lp.homework_instructions||[]).slice(0, 800)}

Prior LPs (for journey_so_far): ${JSON.stringify(priorLps.map(p => p.topic))}
Next LPs (for coming_up): ${JSON.stringify(nextLps.map(n => n.topic))}

Output STRICT JSON matching this schema:
${enrichSchemaDescription()}

Rules:
- Every string field MUST be in ${targetLang} except keys which stay in English.
- Do NOT invent facts not derivable from the source content. Where the source is silent, use pedagogically-safe defaults grounded in the topic.
- Character names: pick 2 from [Ali, Fatima, Sana, Usman, Ayesha, Bilal, Zainab, Hamza]. Pick genders that match the names.
- For math: worked_example MUST use columnar arithmetic notation (e.g., "  8\\n+ 5\\n---\\n 13") where applicable.
- exit_ticket_mcq MUST have exactly 4 choices with exactly one correct answer.
- Return only the JSON object. No prose before or after.`;

  console.log(`[enrich] Calling LLM (model=openai/gpt-4o, ${targetLang})...`);
  const t0 = Date.now();
  const client = createLlm();
  const resp = await client.chat.completions.create({
    model: 'openai/gpt-4o',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: ENRICH_SYSTEM },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
  });
  const ms = Date.now() - t0;
  const enriched = JSON.parse(resp.choices[0].message.content);
  console.log(`[enrich] Done in ${ms}ms; keys: ${Object.keys(enriched).length}`);
  fs.writeFileSync(ENRICH_CACHE, JSON.stringify(enriched, null, 2));
  return enriched;
}

// ---- Slide prompt templates (ported from Tanzania Std2 Maths Ch2 Seg1) ----
const STYLE_HEADER = `Clean flat vector illustration, educational infographic style.
Pakistani ${'{gradeContext}'} classroom. White background. Minimal clutter.
Bold simple shapes. High contrast colors.
Dark navy #1e293b header bar. Amber #fbbf24 highlights.
Subject color: #059669.
Clean sans-serif font (Nunito or Inter for English; Noto Nastaliq Urdu for Urdu). {directionNote}.
No photography. Crisp digital illustration. Print-ready A4 portrait 3:4 format.
`;

function commonStyleBlock(lp) {
  const isUrdu = ['urdu','islamiyat','reading_hour_urdu'].includes(lp.subject);
  return STYLE_HEADER
    .replace('{gradeContext}', `${lp.grade_label} ${lp.subject_label}`)
    .replace('{directionNote}', isUrdu ? 'RTL layout for Urdu; LTR for embedded English terms' : 'LTR layout');
}

function langNote(lp) {
  const isUrdu = ['urdu','islamiyat','reading_hour_urdu'].includes(lp.subject);
  return isUrdu
    ? 'ALL text in Urdu using Noto Nastaliq Urdu font (Nastaleeq script). RTL direction. English technical terms in brackets within Urdu text.'
    : 'ALL text in English (Title Case for headings, sentence case for body). Roman-Urdu transliterations allowed in teacher-speech bubbles.';
}

function progressDots(currentIndex, total) {
  return Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    if (n < currentIndex) return `[✓${n}]`;
    if (n === currentIndex) return `[★${n}★]`;
    return `[${n}]`;
  }).join(' ');
}

function commonNegative() {
  return `--no extra digits, mislabeled numbers, duplicated objects, mixed shapes, blurry text, handwritten numbers, grid pattern, watermark, lorem ipsum, fake brand logos, cartoon smileys, corporate stock imagery`;
}

function slide1Prompt(lp, e, priorLps, nextLps, totalDays) {
  const day = lp.lp_index;
  const dots = progressDots(day, totalDays);
  const journey = priorLps.slice(-3).map(p => `✓ ${p.topic.replace(/۔$/,'')}`).join('\n  ') || '(This is the first lesson)';
  const upcoming = nextLps.slice(0,3).map((n, i) => `Day ${day+i+1}: ${n.topic.replace(/۔$/,'')}`).join('\n  ');
  const prep = (e.prep_checklist || []).map(x => `- ${x}`).join('\n  ');
  const totalMin = (lp.opening_time||0)+(lp.explain_time||0)+(lp.practice_time||0)+(lp.independent_practice_time||0)+(lp.conclusion_time||0);

  return `${commonStyleBlock(lp)}
Lesson plan navigation and preparation card. Portrait 3:4. ${langNote(lp)} Render every word EXACTLY as written below.

TOP STRIP (dark navy #1e293b background):
  Left: "DAY ${day} OF ${totalDays}" in large amber #fbbf24 text.
  Center: "${lp.subject_label} · ${lp.grade_label} · ${lp.chapter_title}" in white.
  Right: progress dots (${dots}). Completed dots green with checkmarks; today's dot filled solid amber; future dots hollow.
  Time badge "${totalMin} min" as small teal pill in top-right corner.

JOURNEY SO FAR (light green #d1fae5 background):
  Heading: "JOURNEY SO FAR" in bold teal.
  Content:
  ${journey}

TODAY box (amber #fbbf24 background, centered):
  Title: "TODAY: ${lp.topic.replace(/۔$/,'')}" in large bold dark navy text.
  Badge: "${(e.cpa_phase || 'CONCEPTUAL').toUpperCase()}" as small navy pill.

COMING UP (light grey #f3f4f6 background):
  Heading: "COMING UP" in gray italic.
  ${upcoming}

SLO strip (teal #059669 background, white text, full width):
  "BY END OF LESSON: ${e.slo_full}"

TO PREPARE checklist (light amber #fef3c7 background):
  "TO PREPARE:" heading in bold navy.
  ${prep}

Clean modern dashboard style. Pakistani primary classroom context.

${commonNegative()}`;
}

function slide2Prompt(lp, e) {
  const chars = e.hook_characters || [];
  const c1 = chars[0] || {name:'Ali', gender:'boy', dialogue:''};
  const c2 = chars[1] || {name:'Fatima', gender:'girl', dialogue:''};
  const words = (e.maneno_muhimu || []).map(w => `${w.term} (${w.gloss})`).join('\n    ');

  return `${commonStyleBlock(lp)}
Hook and board work card. Portrait 3:4. ${langNote(lp)} Render every word EXACTLY as written.

TOP: Amber badge "DAY ${lp.lp_index}" on left. Title "${lp.topic.replace(/۔$/,'')}" in bold dark navy, large. Time badge "${lp.opening_time || 5} min" teal pill in top-right of header.

WARM-UP REVIEW (light gray #f3f4f6 background):
  ${e.warm_up_review}
  CFU: "Thumbs up if you remember!"

HOOK (white background):
  Hook type: ${e.hook_type || 'REAL_WORLD'}.
  "${e.hook_story_setup || ''}"
  Flat illustration of Pakistani school children in the story scene with:
  Character "${c1.name}" (student, ${c1.gender}) positioned left: speech bubble says exactly "${c1.dialogue}"
  Character "${c2.name}" (student, ${c2.gender}) positioned right: speech bubble says exactly "${c2.dialogue}"
  Each character has a distinct speech bubble with their text clearly visible.
  Pakistani school uniform (white shirt + navy trousers for boys; white/blue shalwar-kameez for girls; boys and girls both wearing simple shoes). Bright warm colors.

TODAY'S GOAL + KEY WORDS (two boxes side by side):
  Left box (teal #059669, white text): "TODAY'S GOAL" heading, then: "${e.lengo_la_leo}"
  Right box (amber #fbbf24, navy text): "KEY WORDS" heading, then vertical list:
    ${words}

BOARD WORK (dark navy #1e293b chalkboard-style box, full width):
  "WRITE ON BOARD:" in amber #fbbf24 header text.
  ${e.board_work_content}

Warm encouraging tone. Clean flat illustration. No clutter.
${lp.subject === 'islamiyat' ? '' : 'No religious imagery.'}

${commonNegative()}`;
}

function slide3Prompt(lp, e) {
  const steps = e.three_step_procedure || [];
  const s1 = steps[0] || {action:''};
  const s2 = steps[1] || {action:''};
  const s3 = steps[2] || {action:''};

  return `${commonStyleBlock(lp)}
IKEA-style instructional diagram. Portrait 3:4. ${langNote(lp)} Render every word EXACTLY as written.

HEADER BAR: Dark navy #1e293b strip, white text: "${lp.topic.replace(/۔$/,'')} — How It Works". Time badge "${lp.explain_time || 10} min" teal pill in top-right of header.

Generate EXACTLY 3 step panels. Do not add additional panels.

THREE-STEP PROCEDURE (upper half), each step in its own bordered card stacked vertically:
  Step 1 (amber #fbbf24 circle "1" on left): ${s1.action}
  Step 2 (amber #fbbf24 circle "2" on left): ${s2.action}
  Step 3 (amber #fbbf24 circle "3" on left): ${s3.action}
  Downward arrows connecting cards 1 -> 2 -> 3 on the right edge.

TEACHER SAYS (blue #2563eb speech bubble, below steps):
  "${e.teacher_says_bubble}"

KEY FACT (amber #fbbf24 callout):
  "${e.key_fact}"

WORKED EXAMPLE (bottom, teal #d1fae5 background):
  "WORKED EXAMPLE" label in teal bold.
  ${e.worked_example}

Clean instructional diagram. Pakistani classroom context.

${commonNegative()}`;
}

function slide4Prompt(lp, e) {
  const pa = e.partner_activity || {};
  const cfu = e.cfu_check || {};

  return `${commonStyleBlock(lp)}
Guided practice card. Portrait 3:4. ${langNote(lp)} Render every word EXACTLY as written.

HEADER: "Let's Learn Together! · ${lp.topic.replace(/۔$/,'')}" in teal #059669 bar with white text. Time badge "${lp.practice_time || 8} min" teal pill in top-right of header.

WORKED EXAMPLE (upper portion, light teal #d1fae5 background):
  Teacher models step by step:
  ${e.worked_example}
  MODEL ANSWER in green #059669 callout box: "${e.model_answer}"

PARTNER ACTIVITY (middle portion, white background):
  "WITH YOUR PARTNER:" in bold navy.
  Instruction: "${pa.instruction || ''}"
  Two-column dialogue frame below:
    Left column (amber #fbbf24 background): "Partner A:" then "${pa.dialogue_a || ''}"
    Right column (teal #d1fae5 background): "Partner B:" then "${pa.dialogue_b || ''}"

CIRCULATE (amber #fbbf24 strip, thin):
  "${e.circulate_instruction || 'Walk around the class; support struggling students.'}"

CFU (teal #059669 box at bottom):
  "BEFORE MOVING ON: Solve on your slate — ${cfu.problem || ''} (Answer: ${cfu.answer || ''})"

Color-coded sections. Pakistani children illustrated in margins with school uniform.

IMPORTANT: Render ALL text exactly as specified in this prompt. Do not hallucinate, invent, or modify any text. Every word must match the prompt precisely.

${commonNegative()}`;
}

function slide5Prompt(lp, e) {
  const probs = e.problems || [];
  const wp = e.word_problem || {};

  return `${commonStyleBlock(lp)}
Independent practice card. Portrait 3:4. ${langNote(lp)} Render every word EXACTLY as written.

HEADER: "Your Turn! · ${lp.topic.replace(/۔$/,'')}" in amber #fbbf24 bar with dark navy text. Time badge "${lp.independent_practice_time || 10} min" teal pill in top-right of header.

PROBLEMS (upper half):
  Bold heading "YOUR TURN" in amber.
  Problems stacked vertically, each in an amber-bordered box with a dotted answer space below:
  1. Problem 1: ${probs[0]?.problem || ''}
  2. Problem 2: ${probs[1]?.problem || ''}
  3. Problem 3: ${probs[2]?.problem || ''}
  Answer boxes shown as dotted rectangles next to each problem.

WORD PROBLEM (light gray #f3f4f6 card):
  "${wp.context || ''}"
  ${wp.calc || ''}  Answer: ${wp.answer || ''}
  Pakistani context — bazaar, cricket, roti, mithai — as appropriate.

DIFFERENTIATION (bottom portion):
  LEFT (amber #f59e0b box with "Need help?" label):
    "${e.weak_learner_support}"
  RIGHT (purple #7c3aed box with "Challenge!" label, white text):
    "${e.challenge_extension}"

CIRCULATE strip (thin amber): "Support struggling students. Review their work."

Color-coded differentiation. Print-ready. Pakistani classroom context.

${commonNegative()}`;
}

function slide6Prompt(lp, e, nextLps) {
  const kf = (e.key_facts_summary || []).map(f => `✓ ${f}`).join('\n    ');
  const mcq = e.exit_ticket_mcq || {};
  const hw = e.homework || {};
  const nextTopic = nextLps[0]?.topic?.replace(/۔$/,'') || '(next chapter)';

  return `${commonStyleBlock(lp)}
Exit ticket and lesson wrap-up card. Portrait 3:4. ${langNote(lp)} Render every word EXACTLY as written.

TOP AREA (two columns side by side):
  Left column (dark navy #1e293b background):
    Title "KEY THINGS TO REMEMBER" in amber #fbbf24 at top.
    List in white text:
    ${kf}
    Pakistani child character at bottom giving thumbs up (school uniform).

  Right column (white background):
    Title "Before You Leave!" in dark navy bold text.
    EXIT TICKET (amber #fbbf24 card): "Solve: ${mcq.question || ''}"
    Four answer buttons as rounded rectangles:
    A: ${mcq.choices?.A || ''} | B: ${mcq.choices?.B || ''} | C: ${mcq.choices?.C || ''} | D: ${mcq.choices?.D || ''}
    Correct answer button (${mcq.correct || 'A'}) highlighted in green #059669.

BOTTOM STRIP (full width, three sections stacked):
  Section 1 (light grey): "HOMEWORK:" bold, then "${hw.page ? `Page ${hw.page}, ` : ''}${hw.exercise ? `Exercise ${hw.exercise} — ` : ''}${(hw.problems || []).join(', ')}"
  Section 2 (teal #059669): "COMING NEXT: ${nextTopic}" with arrow icon →
  Section 3 (light amber #fef3c7): "COACH'S CORNER:" then "${e.coach_corner}
WhatsApp Rumi at +92 320 6281951 for personalized coaching"
    Small Rumi logo watermark bottom-right of coaching corner.

Time badge "${lp.conclusion_time || 5} min" as teal pill in top-right of header.

Clean friendly quiz-card style. Encouraging and celebratory.

${commonNegative()}`;
}

// ---- Kie.ai NB Pro caller ----
const KIE_API_KEY = process.env.KIE_API_KEY;
function kieRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.kie.ai', port: 443, method, path: apiPath,
      headers: { 'Authorization': `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
    };
    const req = https.request(opts, (res) => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error(`Bad JSON: ${data.slice(0,200)}`)); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function nbProGenerate({ prompt, label }) {
  console.log(`[NB Pro] createTask: ${label} (prompt ${prompt.length} chars)`);
  const create = await kieRequest('POST', '/api/v1/jobs/createTask', {
    model: 'nano-banana-pro',
    input: { prompt, aspect_ratio: '3:4', output_format: 'png' },
  });
  const taskId = create?.data?.taskId;
  if (!taskId) throw new Error(`createTask no taskId: ${JSON.stringify(create).slice(0,200)}`);

  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(r => setTimeout(r, 8000));
    const info = await kieRequest('GET', `/api/v1/jobs/recordInfo?taskId=${taskId}`, null);
    const state = info?.data?.state;
    if (state === 'success') {
      const parsed = typeof info.data.resultJson === 'string' ? JSON.parse(info.data.resultJson) : info.data.resultJson;
      const url = parsed?.resultUrls?.[0];
      if (!url) throw new Error(`success but no resultUrls`);
      console.log(`[NB Pro] done: ${label}`);
      return url;
    }
    if (state === 'fail') throw new Error(`NB Pro job failed for ${label}: ${JSON.stringify(info).slice(0,300)}`);
  }
  throw new Error(`NB Pro poll timeout: ${label}`);
}

function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`Download ${url} status ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { fs.writeFileSync(destPath, Buffer.concat(chunks)); resolve(destPath); });
    }).on('error', reject);
  });
}

// ---- PDF assembly ----
async function assemblePdf(slidePngPaths) {
  const pdfDoc = await PDFDocument.create();
  for (let i = 0; i < slidePngPaths.length; i++) {
    const png = slidePngPaths[i];
    if (!fs.existsSync(png)) { console.warn(`  missing slide ${i+1}: ${png}`); continue; }
    const jpgBuf = await sharp(png).jpeg({ quality: 92 }).toBuffer();
    const jpgImage = await pdfDoc.embedJpg(jpgBuf);
    const { width, height } = jpgImage.scale(1);
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(jpgImage, { x: 0, y: 0, width, height });
    console.log(`  slide ${i+1}: ${(jpgBuf.length/1024).toFixed(0)}KB @ ${width}x${height}`);
  }
  const bytes = await pdfDoc.save();
  fs.writeFileSync(OUT_PDF, bytes);
  console.log(`\nWrote: ${OUT_PDF} (${(bytes.length/1024).toFixed(0)}KB)`);
  return OUT_PDF;
}

// ---- main ----
async function main() {
  console.log(`Output dir: ${OUT_DIR}`);
  console.log(`Fetching LP + siblings for ${LP_UUID}...`);
  const { lp, siblings, priorLps, nextLps } = await fetchLpAndSiblings();
  console.log(`LP: ${lp.publisher} ${lp.grade_label} ${lp.subject_label} Ch${lp.chapter_number} #${lp.lp_index}`);
  console.log(`     "${lp.topic}"`);
  console.log(`Chapter siblings: ${siblings.length} total (${priorLps.length} prior, ${nextLps.length} following-shown)`);

  console.log('\n=== Stage C-lite: enrichment ===');
  const enriched = await enrich(lp, priorLps, nextLps);
  console.log(`Enriched keys: ${Object.keys(enriched).join(', ')}`);

  console.log('\n=== Building slide prompts ===');
  const totalDays = siblings.length;
  const promptBuilders = [
    () => slide1Prompt(lp, enriched, priorLps, nextLps, totalDays),
    () => slide2Prompt(lp, enriched),
    () => slide3Prompt(lp, enriched),
    () => slide4Prompt(lp, enriched),
    () => slide5Prompt(lp, enriched),
    () => slide6Prompt(lp, enriched, nextLps),
  ];
  const prompts = promptBuilders.map(fn => fn());
  for (let i = 0; i < prompts.length; i++) {
    const promptPath = path.join(OUT_DIR, `slide${i+1}_prompt.txt`);
    fs.writeFileSync(promptPath, prompts[i]);
    console.log(`  slide ${i+1}: ${prompts[i].length} chars → ${promptPath}`);
  }

  if (DRY_RUN) {
    console.log('\nDRY-RUN: skipping NB Pro + PDF assembly. Prompts + enrichment.json written.');
    return;
  }

  console.log('\n=== NB Pro: 6 parallel createTasks ===');
  const t0 = Date.now();
  const results = await Promise.allSettled(prompts.map((p, i) => nbProGenerate({ prompt: p, label: `slide${i+1}` })));
  const totalMs = Date.now() - t0;
  console.log(`\nAll 6 images resolved in ${(totalMs/1000).toFixed(0)}s`);

  const slidePngPaths = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') {
      const destPath = path.join(OUT_DIR, `slide${i+1}.png`);
      await downloadImage(results[i].value, destPath);
      slidePngPaths.push(destPath);
    } else {
      console.error(`  slide ${i+1} FAILED: ${results[i].reason.message}`);
      slidePngPaths.push(null);
    }
  }

  console.log('\n=== Assembling PDF ===');
  await assemblePdf(slidePngPaths.filter(Boolean));
  console.log(`\nDONE. All artifacts in ${OUT_DIR}`);
}

main().catch(e => { console.error('FATAL:', e.message); console.error(e.stack); process.exit(2); });
